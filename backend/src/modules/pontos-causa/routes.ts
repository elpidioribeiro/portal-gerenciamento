import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { agora } from '../../lib/datas.js'
import { semanasDoMes } from '../../lib/semanas.js'
import { filtroDeFiliais, resolverVisao } from '../auth/escopo.js'

/**
 * OS PONTOS DE CAUSA DA REDE — a leitura do N2.
 *
 * O Pareto que já existe (`/variaveis/:id/pareto`) responde uma pergunta de
 * reunião: *dentro desta variável, nesta gerência, o que mais apareceu?* O N2
 * faz outra pergunta, e nenhuma tela respondia: **o que está travando a rede,
 * atravessando filial e GD?**
 *
 * Por que módulo separado e não mais uma rota em `variaveis`: aquele arquivo é
 * organizado POR VARIÁVEL — todas as rotas dele têm `:variavelId` no caminho e
 * a variável como assunto. Esta não tem variável nenhuma: ela soma por cima de
 * todas. Pendurá-la lá obrigaria a inventar um id que não existe.
 *
 * **O recorte é o da visão, sempre.** A tela é do N2, mas a rota não confia
 * nisso: `filtroDeFiliais` é aplicado como em qualquer outra, e um N3 que
 * digite a URL recebe a própria loja em vez das nove. Autorização não pode
 * morar em quem desenha o menu.
 */

const erroSchema = z.object({
  erro: z.string(),
  codigo: z.string(),
  requestId: z.string().optional(),
})

/**
 * A situação de cada semana do ciclo. **Não é um booleano de propósito.**
 *
 * A média por semana divide o total pelas semanas APURADAS. Com um booleano eu
 * teria de escolher entre contar a semana corrente (e afundar a média com dias
 * que ainda não aconteceram) ou não contá-la (e sumir com as marcações de
 * hoje). Com três estados, a tela diz qual é qual: a corrente aparece no
 * gráfico, com as marcações que já tem, e fica fora do divisor.
 */
const situacaoSemana = z.enum(['APURADA', 'EM_ANDAMENTO', 'FUTURA'])

const respostaSchema = z.object({
  visao: z.object({
    nivel: z.enum(['N2', 'N3', 'N4', 'CROSS']),
    filiais: z.number().int(),
    simulada: z.boolean(),
  }),
  ciclo: z.object({
    ano: z.number().int(),
    mes: z.number().int(),
    /** A semana pedida, ou nulo para o mês inteiro. */
    semana: z.number().int().nullable(),
    semanasApuradas: z.number().int(),
  }),
  resumo: z.object({
    /** Soma de `quantidade` — pontos marcados, não linhas de marcação. */
    total: z.number().int(),
    /**
     * O ritmo das semanas FECHADAS — `totalApurado ÷ semanasApuradas`.
     *
     * Nulo quando nenhuma fechou, e nulo também quando se pediu uma semana só.
     */
    porSemanaApurada: z.number().nullable(),
    /** O que as semanas fechadas marcaram. Menor que `total` no mês corrente. */
    totalApurado: z.number().int(),
    pontosDistintos: z.number().int(),
    filiaisQueMarcaram: z.number().int(),
  }),
  semanas: z.array(
    z.object({
      semana: z.number().int(),
      quantidade: z.number().int(),
      situacao: situacaoSemana,
    }),
  ),
  pontos: z.array(
    z.object({
      pontoCausaId: z.string(),
      nome: z.string(),
      /** De qual GD ele é — o mesmo nome marcado em dois GDs são dois pontos. */
      gd: z.string(),
      quantidade: z.number().int(),
      percentual: z.number(),
      /** Uma posição por semana do mês, na ordem de `semanas`. */
      porSemana: z.array(z.number().int()),
      filiais: z.number().int(),
      gds: z.number().int(),
    }),
  ),
  porFilial: z.array(
    z.object({
      sigla: z.string(),
      quantidade: z.number().int(),
      maisMarcado: z.object({ nome: z.string(), quantidade: z.number().int() }).nullable(),
    }),
  ),
  /**
   * TODOS os GDs que têm ponto de causa cadastrado, inclusive com zero.
   *
   * A tira de abas se desenha a partir daqui, e um GD sem marcação no ciclo
   * precisa continuar clicável: "nenhuma marcação em Perdas neste mês" é uma
   * resposta, e some se a aba não existir.
   */
  gds: z.array(
    z.object({
      codigo: z.string(),
      nome: z.string(),
      quantidade: z.number().int(),
      filiais: z.number().int(),
    }),
  ),
})

export async function pontosCausaRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  r.get(
    '/api/v1/pontos-causa/rede',
    {
      schema: {
        tags: ['Pontos de causa'],
        summary: 'Pontos de causa somados por filial e por GD no ciclo',
        description:
          'A leitura de rede do N2: o que mais foi marcado no mês, em quantas ' +
          'filiais e em quantos GDs. Recortado pela visão de quem pergunta.',
        querystring: z.object({
          ano: z.coerce.number().int().min(2020).max(2100),
          mes: z.coerce.number().int().min(1).max(12),
          /** Uma semana do mês (1..5); ausente é o mês inteiro. */
          semana: z.coerce.number().int().min(1).max(5).optional(),
          /** Código do indicador — o GD. Ausente é "todos os GDs". */
          gd: z.string().optional(),
          visaoNivel: z.string().optional(),
          visaoFilial: z.string().optional(),
        }),
        response: { 200: respostaSchema, 401: erroSchema, 403: erroSchema },
      },
    },
    async (req) => {
      const usuario = await app.autenticar(req)
      const { ano, mes, semana, gd, visaoNivel, visaoFilial } = req.query
      const visao = await resolverVisao(app.prisma, usuario, { visaoNivel, visaoFilial })

      const filiais = await app.prisma.filial.findMany({
        where: { tipo: 'FILIAL', ativa: true, ...filtroDeFiliais(visao) },
        orderBy: { ordem: 'asc' },
        select: { id: true, sigla: true },
      })
      /**
       * DE QUAL FILIAL É CADA ALVO DE MARCAÇÃO.
       *
       * Marca-se contra uma área de venda ou contra a gerência inteira (ver
       * `EscopoMarcacao`), e o `alvoId` aponta para tabelas diferentes em cada
       * caso — sem chave estrangeira, porque uma coluna não aponta para duas
       * tabelas. Quem sabe traduzir é este mapa, montado das duas dimensões.
       *
       * O mesmo mapa é o FILTRO de visibilidade: alvo que não está aqui é de
       * uma filial que esta visão não enxerga, e a ocorrência dele nunca entra
       * na soma.
       */
      const gerencias = await app.prisma.dimGerencia.findMany({
        where: { filialId: { in: filiais.map((f) => f.id) } },
        select: { id: true, filialId: true, areasVenda: { select: { id: true } } },
      })
      const filialDoAlvo = new Map<string, string>()
      for (const g of gerencias) {
        filialDoAlvo.set(g.id, g.filialId)
        for (const a of g.areasVenda) filialDoAlvo.set(a.id, g.filialId)
      }

      const doMes = semanasDoMes(ano, mes)
      const hoje = agora()
      const situacaoDa = (s: (typeof doMes)[number]): z.infer<typeof situacaoSemana> =>
        s.ate < hoje ? 'APURADA' : s.de <= hoje ? 'EM_ANDAMENTO' : 'FUTURA'

      /**
       * As ocorrências do ciclo, e a soma acontece AQUI, em memória.
       *
       * Um `groupBy` por ponto não serviria: a mesma consulta precisa quebrar
       * por filial, por semana e por GD ao mesmo tempo, e cada quebra seria
       * uma ida ao banco — quatro respostas que poderiam discordar entre si se
       * uma marcação fosse gravada entre elas.
       *
       * O volume permite: é UM mês de marcações de reunião — hoje 16 linhas na
       * base inteira, e o teto realista fica em alguns milhares (filial ×
       * gerência × área × ponto × 5 semanas). Se um dia passar disso, o corte
       * é somar no banco por quebra, não adivinhar aqui.
       */
      const ocorrencias = await app.prisma.ocorrenciaPontoCausa.findMany({
        where: {
          ano,
          mes,
          ...(semana !== undefined ? { semana } : {}),
          alvoId: { in: [...filialDoAlvo.keys()] },
          ...(gd !== undefined ? { pontoCausa: { variavelControle: { indicador: { codigo: gd } } } } : {}),
        },
        select: {
          alvoId: true,
          semana: true,
          quantidade: true,
          pontoCausa: {
            select: {
              id: true,
              nome: true,
              variavelControle: {
                select: { indicador: { select: { codigo: true, nome: true } } },
              },
            },
          },
        },
      })

      interface Acumulado {
        nome: string
        gd: string
        quantidade: number
        porSemana: Map<number, number>
        filiais: Set<string>
        gds: Set<string>
      }
      const porPonto = new Map<string, Acumulado>()
      const porSemanaTotal = new Map<number, number>()
      const porFilial = new Map<string, { quantidade: number; pontos: Map<string, number> }>()
      const porGd = new Map<string, { nome: string; quantidade: number; filiais: Set<string> }>()
      let total = 0

      for (const o of ocorrencias) {
        const filialId = filialDoAlvo.get(o.alvoId)
        //  Alvo fora da visão já foi excluído na consulta; isto é a rede de
        //  segurança para uma área criada entre as duas leituras.
        if (filialId === undefined) continue

        const ind = o.pontoCausa.variavelControle.indicador
        total += o.quantidade
        porSemanaTotal.set(o.semana, (porSemanaTotal.get(o.semana) ?? 0) + o.quantidade)

        const ponto = porPonto.get(o.pontoCausa.id) ?? {
          nome: o.pontoCausa.nome,
          gd: ind.nome,
          quantidade: 0,
          porSemana: new Map<number, number>(),
          filiais: new Set<string>(),
          gds: new Set<string>(),
        }
        ponto.quantidade += o.quantidade
        ponto.porSemana.set(o.semana, (ponto.porSemana.get(o.semana) ?? 0) + o.quantidade)
        ponto.filiais.add(filialId)
        ponto.gds.add(ind.codigo)
        porPonto.set(o.pontoCausa.id, ponto)

        const f = porFilial.get(filialId) ?? { quantidade: 0, pontos: new Map<string, number>() }
        f.quantidade += o.quantidade
        f.pontos.set(o.pontoCausa.nome, (f.pontos.get(o.pontoCausa.nome) ?? 0) + o.quantidade)
        porFilial.set(filialId, f)

        const g = porGd.get(ind.codigo) ?? { nome: ind.nome, quantidade: 0, filiais: new Set<string>() }
        g.quantidade += o.quantidade
        g.filiais.add(filialId)
        porGd.set(ind.codigo, g)
      }

      /*
       * Empate desempatado pelo NOME — a mesma regra do Pareto (§ da rota
       * acima): duas causas com a mesma contagem trocariam de lugar entre
       * recarregadas, e na reunião isso lê como "mudou alguma coisa".
       */
      const maiorPrimeiro = <T extends { quantidade: number; nome: string }>(a: T, b: T) =>
        b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR')

      const semanas = doMes.map((s) => ({
        semana: s.numero,
        quantidade: porSemanaTotal.get(s.numero) ?? 0,
        situacao: situacaoDa(s),
      }))
      /*
       * Quando se pede UMA semana, as outras não somem do eixo -- elas ficam
       * com a contagem daquela consulta, que é zero. O gráfico de semanas
       * mostra o MÊS sempre: é ele que responde "e as outras?", e um eixo de
       * uma barra só não responde nada.
       */
      const semanasDoEixo =
        semana === undefined
          ? semanas
          : doMes.map((s) => ({
              semana: s.numero,
              quantidade: s.numero === semana ? (porSemanaTotal.get(s.numero) ?? 0) : 0,
              situacao: situacaoDa(s),
            }))

      const apuradas = doMes.filter((s) => situacaoDa(s) === 'APURADA')

      /**
       * O RITMO SEMANAL — e o numerador tem de vir do mesmo universo que o
       * divisor.
       *
       * Estava `total / apuradas`, e medido na tela dizia **"21 por semana"**
       * com 21 pontos no ciclo e UMA semana fechada. O 21 inclui os 7 da
       * semana em andamento; o divisor não a conta. Numerador de um universo,
       * denominador de outro — a regra que este projeto repete desde o
       * primeiro dia sobre somar numerador e denominador, aqui quebrada pelo
       * lado do tempo em vez do lado da venda.
       *
       * Somando só o que as semanas FECHADAS marcaram, a resposta é 14: o
       * ritmo do que já aconteceu por inteiro. Os 7 da semana corrente
       * continuam no total e no gráfico, que é onde eles são verdade.
       *
       * Nulo quando se pediu UMA semana: "por semana" sobre uma semana só
       * repetiria o número de cima com outro nome.
       */
      const totalApurado = apuradas.reduce((a, s) => a + (porSemanaTotal.get(s.numero) ?? 0), 0)
      const ritmo =
        semana === undefined && apuradas.length > 0
          ? Math.round((totalApurado / apuradas.length) * 10) / 10
          : null

      const todosOsGds = await app.prisma.indicador.findMany({
        where: { variaveis: { some: { pontosCausa: { some: {} } } } },
        orderBy: { ordem: 'asc' },
        select: { codigo: true, nome: true },
      })

      return {
        visao: { nivel: visao.nivel, filiais: filiais.length, simulada: visao.simulada },
        ciclo: { ano, mes, semana: semana ?? null, semanasApuradas: apuradas.length },
        resumo: {
          total,
          porSemanaApurada: ritmo,
          totalApurado,
          pontosDistintos: porPonto.size,
          filiaisQueMarcaram: porFilial.size,
        },
        semanas: semanasDoEixo,
        pontos: [...porPonto]
          .map(([id, p]) => ({
            pontoCausaId: id,
            nome: p.nome,
            gd: p.gd,
            quantidade: p.quantidade,
            percentual: total > 0 ? Math.round((p.quantidade / total) * 1000) / 10 : 0,
            porSemana: doMes.map((s) => p.porSemana.get(s.numero) ?? 0),
            filiais: p.filiais.size,
            gds: p.gds.size,
          }))
          .sort(maiorPrimeiro),
        porFilial: filiais
          .map((f) => {
            const dados = porFilial.get(f.id)
            const top = [...(dados?.pontos ?? [])].sort(
              (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'),
            )[0]
            return {
              sigla: f.sigla,
              quantidade: dados?.quantidade ?? 0,
              maisMarcado: top ? { nome: top[0], quantidade: top[1] } : null,
            }
          })
          .sort((a, b) => b.quantidade - a.quantidade || a.sigla.localeCompare(b.sigla, 'pt-BR')),
        gds: todosOsGds
          .map((i) => ({
            codigo: i.codigo,
            nome: i.nome,
            quantidade: porGd.get(i.codigo)?.quantidade ?? 0,
            filiais: porGd.get(i.codigo)?.filiais.size ?? 0,
          }))
          .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR')),
      }
    },
  )
}

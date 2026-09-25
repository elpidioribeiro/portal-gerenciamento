import type { FastifyInstance } from 'fastify'
import type { PrismaClient, Usuario } from '@prisma/client'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { agora } from '../../lib/datas.js'
import { Conflito, DadosInvalidos, NaoAutorizado, NaoEncontrado } from '../../lib/erros.js'
import { podeMarcarPontoCausa } from '../contramedidas/politicas.js'
import { exigirAdmin } from '../admin/guarda.js'
import { resolverVisao } from '../auth/escopo.js'
import { idDoIndicador } from '../ingestao/service.js'
import { corteDaSemana, cotaAcumulada } from './cota-acumulada.js'
import { semanasDoMes } from '../../lib/semanas.js'
import {
  consolidar,
  fatorDeProjecao,
  performanceVendas,
  type AreaNoMes,
} from './performance-vendas.js'
import {
  consolidarVendedor,
  performanceVendedor,
  type VendedorNoMes,
} from './performance-vendedor.js'
import { gerenciaDoPerfil } from '../../lib/gerencia-do-perfil.js'
import { valorParaY, yDaMeta, type AncoraEixo } from '../../lib/escala.js'

/**
 * Marcação de ponto de causa e Pareto — o meio do ciclo do GD.
 *
 * `Indicador → Variável de controle → Ponto de causa → Contramedida`. As duas
 * pontas existiam; isto é o elo.
 *
 * A marcação é por **ÁREA DE VENDA**, por **semana do mês**, com
 * **quantidade** — e o que a reunião usa é a **SOMA** das áreas.
 *
 * **Marca-se onde o problema aparece, e decide-se sobre o total.** A área é a
 * linha do quadro, com supervisor e número próprio, e é lá que a contagem cabe.
 * O bloco de fora soma tudo e é só de leitura: `podeMarcar` volta `false` sem
 * área, porque não existe onde gravar uma soma.
 *
 * A atribuição por área NÃO é o ponto. Palavras do analista em 09/09/2026:
 * *"marca o ponto de ação dentro da área de venda, mas o que importa é o
 * somatório no final. Pode atribuir, mas não vai utilizar para muita coisa."*
 * Ou seja: a área é onde se conta, não uma dimensão nova de análise — o Pareto
 * continua sendo um só, da gerência.
 *
 * É a QUARTA vez que esta pergunta é respondida — §7.19 por área, §7.26 por
 * gerência, §7.27 por área, §7.29 por gerência —, e o PLANO §7.59 conta por
 * que a resposta de agora não é a de §7.27: lá a área era o corte do Pareto;
 * aqui ela é só o lugar do gesto.
 *
 * **As linhas com `escopo: 'GERENCIA'` continuam contando na soma** (ver
 * `contadoNasGerencias`): 25 ocorrências de ago e set/2026 foram gravadas
 * assim, e filtrá-las fora as tiraria da tela sem tirá-las do banco.
 */

const erroSchema = z.object({
  erro: z.string(),
  codigo: z.string(),
  requestId: z.string().optional(),
})

const SEMANAS_NO_MES = 5

const periodoSchema = z.object({
  ano: z.number().int().min(2020).max(2100),
  mes: z.number().int().min(1).max(12),
})

/**
 * O mesmo período, vindo da querystring.
 *
 * `coerce` porque querystring é texto: sem ele, `?ano=2026` chega como
 * `"2026"` e a validação recusa com "expected number, received string" — erro
 * que parece do cliente e é do schema.
 */
const periodoQuery = z.object({
  ano: z.coerce.number().int().min(2020).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
})

/**
 * De quais variáveis de controle o usuário responde — o que ele pode MARCAR.
 *
 * Vem de `perfil_variavel`, cadastrado junto com o nível na tela de
 * administração. É o cadastro do N4: o N3 lê a filial inteira e o N2 é
 * corporativo, e nenhum dos dois marca ponto de causa. Ver PLANO §7.20.
 *
 * **A MATRÍCULA vence, e vencer significa não consultar o perfil.** Quem está
 * cadastrado por matrícula é N2 — nível corporativo, sem variáveis próprias.
 * Ler o perfil dele assim mesmo devolveria as variáveis do cargo que ele não
 * exerce, que é exatamente o que a exceção existe para não acontecer.
 *
 * Conjunto VAZIO quando falta qualquer elo: sem filial, sem perfil, ou perfil
 * sem variáveis associadas. Devolver "todas" no lugar de "nenhuma" faria
 * alguém marcar ponto de causa de departamento que não é o dele.
 */
async function variaveisDoUsuario(
  prisma: PrismaClient,
  usuario: Usuario,
): Promise<ReadonlySet<string>> {
  if (usuario.filialId === null) return new Set()

  if (usuario.matricula !== null) {
    const daPessoa = await prisma.matriculaNivel.findUnique({
      where: { matricula: usuario.matricula },
    })
    if (daPessoa?.ativo) return new Set()
  }

  if (usuario.idPerfil === null) return new Set()

  const perfil = await prisma.perfilNivel.findUnique({
    where: { idPerfil: usuario.idPerfil },
    select: { ativo: true, variaveis: { select: { variavelControleId: true } } },
  })
  if (!perfil?.ativo) return new Set()

  return new Set(perfil.variaveis.map((v) => v.variavelControleId))
}

/**
 * Piores primeiro, pelo percentual — e sem número vai para o fim.
 *
 * A mesma ordem das telas do N3 e do N4: numa reunião, quem olha ainda não sabe
 * o que procurar, e a lista é que tem de dizer. Ordem alfabética é a de quem
 * procura um nome que já sabe.
 */
function ordenarPorPior(
  a: { percentual: number | null },
  b: { percentual: number | null },
): number {
  if (a.percentual === null) return b.percentual === null ? 0 : 1
  if (b.percentual === null) return -1
  return a.percentual - b.percentual
}

/** Rótulo curto do mês, para o eixo do gráfico. */
const MESES_CURTOS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const

/**
 * Um mês na série do histórico. O mesmo formato nas duas rotas -- a da
 * gerência e a da loja --, porque é o mesmo gráfico na tela.
 */
const mesDoHistoricoSchema = z.object({
  ano: z.number().int(),
  mes: z.number().int(),
  /** `2026-03`, para a tela não remontar a chave. */
  competencia: z.string(),
  rotulo: z.string(),
  /**
   * O mês ainda correndo. A tela precisa disso para hachurar a barra: o
   * numerador dele é PROJEÇÃO de fechamento, não realizado, e pode deixar de
   * valer na semana seguinte sem ninguém errar nada.
   */
  emCurso: z.boolean(),
  vendas: z
    .object({
      percentual: z.number(),
      vendido: z.number(),
      meta: z.number(),
      /** Dias com venda: distingue mês fechado de mês em curso. */
      dias: z.number().int(),
    })
    .nullable(),
  vendedor: z
    .object({
      percentual: z.number(),
      naMeta: z.number().int(),
      apurados: z.number().int(),
    })
    .nullable(),
})

export async function variavelRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  /**
   * Performance Vendas num CORTE — a conta inteira, num ponto do tempo.
   *
   * Mesma razão de `vendedorNoCorte`: **a faísca tem de concordar com o KPI**, e
   * a garantia só vale se as duas chamarem este código. Ver PLANO §7.25.
   */
  /**
   * ATE ONDE O DADO CHEGOU, de verdade.
   *
   * Era `syncExecucao.periodoAte` -- a janela que a carga PEDIU. Elas divergem:
   * uma carga que pede ate 03/09 e recebe do Oracle so ate 02/09 (o dia
   * corrente ainda nao fechou) grava `periodoAte = 03/09` e nao tem dado de 03.
   *
   * O corte entao avanca sozinho, e o estrago e' silencioso: o calendario passa
   * a dizer "3 de 26 dias uteis" enquanto o realizado tem 2 dias. A cota
   * rateada fica 1,5x maior que o periodo que ela julga, e treze vendedores que
   * tinham batido a cota de dois dias aparecem fora da meta -- sem que nenhum
   * deles tenha vendido menos. Medido em 04/09/2026: a gerencia caiu de 55%
   * para 29% de um dia para o outro, e a queda era so contabil.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ POR FILIAL, E NUNCA POR AREA OU POR VENDEDOR.                            │
   * │                                                                          │
   * │ E' a distincao que o comentario antigo defendia, e ele estava certo: uma  │
   * │ AREA que parou de vender no dia 20 tem ultima venda no 20, e recuar o    │
   * │ corte para lá esconderia justamente os dias ruins -- o indicador         │
   * │ melhoraria porque o desempenho piorou.                                   │
   * │                                                                          │
   * │ Numa FILIAL isso nao acontece: sao centenas de vendedores, e um dia sem  │
   * │ venda nenhuma na loja inteira nao existe. O maximo da filial responde    │
   * │ "ate onde a ingestao trouxe", que e' a pergunta certa -- e responde por   │
   * │ filial, entao uma loja cuja carga falhou nao e' arrastada pelas outras.   │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ SO' NO MES CORRENTE.                                                     │
   * │                                                                          │
   * │ O limite existe porque a carga do mes corrente esta ANDANDO: ela cobre   │
   * │ ate ontem, e o calendario nao pode correr na frente dela.                │
   * │                                                                          │
   * │ Num mes FECHADO nao ha carga em andamento, e o corte certo e' o fim do   │
   * │ mes. Aplicar o limite ali confundiria "ate onde a ingestao chegou" com   │
   * │ "quando foi a ultima venda" -- e a area que parou de vender no dia 20    │
   * │ teria o corte recuado para lá, com o indicador MELHORANDO porque o       │
   * │ desempenho piorou. E' a armadilha que o comentario antigo descrevia, e   │
   * │ ela mora aqui, no mes fechado.                                           │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * `undefined` tambem quando o mes nao tem dado nenhum: ai nao ha limite a
   * impor, e nao ha o que comparar de todo jeito.
   */
  async function ultimoDiaComDado(
    fonte: 'vendas-linha' | 'vendedor-dia',
    filialId: string,
    ano: number,
    mes: number,
  ): Promise<Date | undefined> {
    const hoje = agora()
    const ehCorrente = ano === hoje.getUTCFullYear() && mes === hoje.getUTCMonth() + 1
    if (!ehCorrente) return undefined

    const janela = {
      gte: new Date(Date.UTC(ano, mes - 1, 1)),
      lte: new Date(Date.UTC(ano, mes, 0)),
    }
    const r =
      fonte === 'vendas-linha'
        ? await app.prisma.fatoVendasLinha.aggregate({
            where: { filialId, data: janela },
            _max: { data: true },
          })
        : await app.prisma.fatoVendaVendedor.aggregate({
            where: { filialId, data: janela },
            _max: { data: true },
          })
    return r._max.data ?? undefined
  }

  async function vendasNoCorte(
    gerencia: { id: string; filialId: string; areasVenda: { id: string; nome: string; supervisor: string | null }[] },
    ano: number,
    mes: number,
    semana: number | undefined,
    /** Último dia coberto pela carga — o corte não passa dele. Lido pela rota. */
    ultimaCarga: Date | undefined,
  ) {
    const de = new Date(Date.UTC(ano, mes - 1, 1))
    const indicadorId = await idDoIndicador(app.prisma, 'vendas')
      /*
       * A SEMANA move o corte, e aqui ele governa DUAS coisas: até onde soma o
       * realizado, e de qual dia sai a tendência que vira o fator de projeção.
       *
       * As duas têm de andar juntas. Somar a venda até o fim da S2 e pegar a
       * tendência de hoje projetaria o mês com um fator que já viu três semanas
       * a mais -- o número não corresponderia a instante nenhum. É a mesma
       * invariante do `corteDe`: realizado e projeção usam o MESMO dia.
       *
       * `ultimaCarga` chega pronta da rota, e limita o corte pelo que a carga
       * cobriu — como no Vendedor.
       */
      const daSemana =
        semana === undefined ? undefined : semanasDoMes(ano, mes).find((w) => w.numero === semana)

      const ate = corteDaSemana({
        ano,
        mes,
        semana,
        fimDaSemana: daSemana?.ate,
        deDaSemana: daSemana?.de,
        hoje: agora(),
        ateACarga: ultimaCarga,
      })

      // Semana ou mês inteiramente no futuro: não há o que comparar.
      if (ate === null) {
        return { corte: null, areas: [], gerencia: null }
      }

      const [porArea, metas, agregado] = await Promise.all([
        app.prisma.fatoVendasLinha.groupBy({
          by: ['areaVendaId'],
          where: { data: { gte: de, lte: ate }, indicadorId, gerenciaId: gerencia.id },
          _sum: { valor: true },
        }),
        app.prisma.meta.findMany({
          where: {
            escopo: 'AREA_VENDA',
            ano,
            mes,
            alvoId: { in: gerencia.areasVenda.map((a) => a.id) },
          },
          select: { alvoId: true, valor: true },
        }),
        /*
         * A TENDÊNCIA DA FILIAL, do dia mais recente do mês — é dela que sai o
         * fator de projeção. Ver o comentário de `fatorDeProjecao`: não
         * reimplementamos a fórmula do BI, extraímos o fator dela.
         */
        app.prisma.fatoVendas.findFirst({
          where: { data: { gte: de, lte: ate }, indicadorId, filialId: gerencia.filialId },
          orderBy: { data: 'desc' },
          select: { tendencia: true },
        }),
      ])

      const vendidoFilial = await app.prisma.fatoVendas.aggregate({
        where: { data: { gte: de, lte: ate }, indicadorId, filialId: gerencia.filialId },
        _sum: { valorReal: true },
      })

      const fator = fatorDeProjecao(
        Number(vendidoFilial._sum.valorReal ?? 0),
        Number(agregado?.tendencia ?? 0),
      )

      const vendidoPorArea = new Map(porArea.map((g) => [g.areaVendaId, Number(g._sum.valor ?? 0)]))
      const metaPorArea = new Map(metas.map((m) => [m.alvoId, Number(m.valor)]))

      const entrada: AreaNoMes[] = gerencia.areasVenda.map((a) => ({
        areaVendaId: a.id,
        vendido: vendidoPorArea.get(a.id) ?? 0,
        meta: metaPorArea.get(a.id) ?? null,
      }))

      const calculado = performanceVendas(entrada, fator)
      const rolo = consolidar(calculado)
      const nomes = new Map(gerencia.areasVenda.map((a) => [a.id, a]))

      return {
        corte: ate.toISOString().slice(0, 10),
        areas: calculado.map((c) => ({
          ...c,
          nome: nomes.get(c.areaVendaId)?.nome ?? '—',
          supervisor: nomes.get(c.areaVendaId)?.supervisor ?? null,
        })),
        gerencia: rolo
          ? {
              numerador: rolo.numerador,
              denominador: rolo.denominador ?? 0,
              percentual: rolo.percentual ?? 0,
            }
          : null,
      }
  }

  /**
   * Performance Vendedor num CORTE — a conta inteira, num ponto do tempo.
   *
   * Extraída porque **a faísca tem de concordar com o KPI**: o ponto da semana
   * selecionada no minigráfico é o mesmo número grande ao lado dele. A rota de
   * uma semana e a da série de cinco chamam esta função; reimplementar a conta
   * para o gráfico é como as duas passariam a discordar sem erro nenhum.
   *
   * `semana` ausente = o mês até D-1.
   */
  async function vendedorNoCorte(
    gerencia: { id: string; filialId: string; areasVenda: { id: string; nome: string; supervisor: string | null }[] },
    ano: number,
    mes: number,
    semana: number | undefined,
    /** Último dia coberto pela carga — o corte não passa dele. Lido pela rota. */
    ultimaCarga: Date | undefined,
  ) {
    const areaIds = gerencia.areasVenda.map((a) => a.id)
      const primeiroDoMes = new Date(Date.UTC(ano, mes - 1, 1))

      /*
       * A SEMANA move o corte, e a conta é a mesma.
       *
       * Escolher S2 é perguntar "como estávamos no fim da S2" -- o acumulado do
       * mês até lá, contra a cota rateada pelos dias úteis até lá. Não é a
       * semana isolada: quem foi mal na S1 e bem na S2 está na meta na S2 se o
       * acumulado alcançou. Ver `bateuCotaAcumulada`.
       *
       * A semana vem de `semanasDoMes`, a definição única do quadro — a mesma
       * que a grade de marcação e o Pareto usam.
       */
      const daSemana =
        semana === undefined ? undefined : semanasDoMes(ano, mes).find((w) => w.numero === semana)

      const corte = corteDaSemana({
        ano,
        mes,
        semana,
        fimDaSemana: daSemana?.ate,
        deDaSemana: daSemana?.de,
        hoje: agora(),
        ateACarga: ultimaCarga,
      })

      // Semana ou mês inteiramente no futuro: não há o que comparar.
      if (corte === null) {
        return { corte: null, areas: [], gerencia: null }
      }

      const [calendario, vendedores, meses, vendas] = await Promise.all([
        /*
         * O dia útil do CORTE, não o de hoje. É a metade da invariante de
         * `corteDe`: realizado e calendário têm de usar o mesmo dia.
         */
        app.prisma.diaUtil.findFirst({
          where: { filialId: gerencia.filialId, data: { gte: primeiroDoMes, lte: corte } },
          orderBy: { data: 'desc' },
          select: { acumuladoDia: true, uteisDoMes: true },
        }),
        app.prisma.dimVendedor.findMany({
          where: { areaVendaId: { in: areaIds } },
          select: { id: true, codVendedor: true, nome: true, areaVendaId: true, matricula: true },
        }),
        app.prisma.vendedorMes.findMany({
          where: { ano, mes, vendedor: { areaVendaId: { in: areaIds } } },
          select: { vendedorId: true, meta: true, sitafa: true, houveVenda: true },
        }),
        app.prisma.fatoVendaVendedor.groupBy({
          by: ['vendedorId'],
          where: {
            data: { gte: primeiroDoMes, lte: corte },
            vendedor: { areaVendaId: { in: areaIds } },
          },
          _sum: { valor: true },
        }),
      ])

      /*
       * Sem calendário não se rateia, e sem ratear não se responde.
       *
       * Devolve vazio em vez de comparar contra a cota CHEIA: no dia 10, a cota
       * cheia reprovaria todo mundo, e o quadro ficaria vermelho por falta de
       * carga do calendário -- um problema de dado lido como problema de venda.
       */
      if (!calendario) {
        return { corte: null, areas: [], gerencia: null }
      }

      const dias = { acumulado: calendario.acumuladoDia, doMes: calendario.uteisDoMes }
      const realizadoPor = new Map(vendas.map((v) => [v.vendedorId, Number(v._sum.valor ?? 0)]))
      const mesPor = new Map(meses.map((m) => [m.vendedorId, m]))
      const nomes = new Map(gerencia.areasVenda.map((a) => [a.id, a]))

      /*
       * Só entra quem tem linha em `vendedor_mes`: sem ela não há cota nem
       * situação, e o vendedor não é classificável. Ele fica de fora da conta
       * inteira -- do numerador e do denominador --, que é diferente de contar
       * como "não bateu".
       */
      const entrada: VendedorNoMes[] = vendedores.flatMap((v) => {
        const m = mesPor.get(v.id)
        if (!m) return []
        const mensal = Number(m.meta)
        return [
          {
            codVendedor: v.codVendedor,
            matricula: v.matricula,
            nome: v.nome,
            areaVenda: v.areaVendaId,
            ano,
            mes,
            /*
             * A cota RATEADA entra como `meta`, e é o que faz `bateuMeta`
             * funcionar sem saber do calendário. Cota nula (nenhum dia útil
             * decorrido) vira zero AQUI, e some do denominador pelo filtro de
             * `meta > 0` -- que é a resposta certa: não há o que comparar.
             */
            meta: cotaAcumulada(mensal, dias) ?? 0,
            realizado: realizadoPor.get(v.id) ?? 0,
            sitafa: m.sitafa,
            houveVenda: m.houveVenda,
          },
        ]
      })

      const calculado = performanceVendedor(entrada)
      const rolo = consolidarVendedor(calculado)
      const porArea = new Map(calculado.map((c) => [c.areaVenda, c]))

      return {
        corte: {
          data: corte.toISOString().slice(0, 10),
          diasUteisDecorridos: dias.acumulado,
          diasUteisDoMes: dias.doMes,
        },
        /*
         * Percorre as áreas da GERÊNCIA, não o resultado do cálculo: área sem
         * vendedor nenhum tem de aparecer zerada no quadro. Omiti-la faria a
         * área sumir da reunião por falta de cadastro, e ninguém pergunta pelo
         * que não está na tela.
         */
        areas: gerencia.areasVenda.map((a) => {
          const c = porArea.get(a.id)
          return {
            areaVendaId: a.id,
            nome: nomes.get(a.id)?.nome ?? '—',
            supervisor: nomes.get(a.id)?.supervisor ?? null,
            numerador: c?.numerador ?? 0,
            denominador: c?.denominador ?? 0,
            percentual: c?.percentual ?? null,
            foraDaConta: c?.foraDaConta ?? { semMeta: 0, inativos: 0, outros: 0 },
          }
        }),
        gerencia: rolo
          ? {
              numerador: rolo.numerador,
              denominador: rolo.denominador,
              percentual: rolo.percentual,
              foraDaConta: rolo.foraDaConta,
            }
          : null,
      }
  }


  // ── A grade de marcação ────────────────────────────────────────────────────
  /**
   * O filtro de "TUDO O QUE FOI CONTADO nestas gerencias".
   *
   * A marcacao passou a ser por AREA DE VENDA (09/09/2026): conta-se dentro da
   * area, e o que a reuniao usa e' a SOMA. Mas as linhas gravadas antes disso
   * estao com `escopo: 'GERENCIA'` -- 9 linhas, 25 ocorrencias, ago e set/2026,
   * medido antes da mudanca.
   *
   * Entao a soma abrange os DOIS escopos. Filtrar so' `AREA_VENDA` faria
   * aquelas 25 desaparecerem da matriz e do Pareto sem apagar nada do banco --
   * o pior tipo de perda, porque o dado continua la' e ninguem procura o que
   * nao sabe que existiu.
   *
   * O escopo entra na busca junto com o alvo, e continua tendo de entrar: sem
   * ele, um uuid de area e um de gerencia que por acaso coincidissem se
   * misturariam. Nao acontece com uuid, mas a consulta tem de DIZER o que
   * procura.
   */
  async function contadoNasGerencias(gerenciaIds: string[]) {
    const areas = await app.prisma.dimAreaVenda.findMany({
      where: { gerenciaId: { in: gerenciaIds } },
      select: { id: true },
    })
    return {
      OR: [
        { escopo: 'GERENCIA' as const, alvoId: { in: gerenciaIds } },
        { escopo: 'AREA_VENDA' as const, alvoId: { in: areas.map((a) => a.id) } },
      ],
    }
  }

  /**
   * A área existe E é desta gerência -- ou 404.
   *
   * Sem a segunda metade, marcar na área de OUTRA gerência gravaria certinho e
   * sumiria da soma de quem marcou, aparecendo na de quem não marcou. É o tipo
   * de engano que só se descobre no mês seguinte, comparando Pareto com ata.
   */
  async function areaDaGerencia(areaVendaId: string, gerenciaId: string) {
    const area = await app.prisma.dimAreaVenda.findUnique({
      where: { id: areaVendaId },
      select: { id: true, gerenciaId: true },
    })
    if (!area) throw new NaoEncontrado('Área de venda não existe.')
    if (area.gerenciaId !== gerenciaId) {
      throw new NaoEncontrado('Área de venda não é desta gerência.')
    }
    return area
  }

  r.get(
    '/api/v1/variaveis/:variavelId/marcacoes',
    {
      schema: {
        tags: ['Variáveis de controle'],
        summary: 'A grade de pontos de causa × semanas, no mês',
        description:
          'Com `areaVendaId`, é a grade DAQUELA área — a que se preenche na ' +
          'reunião. Sem ele, é a SOMA da gerência, que é só de leitura.',
        params: z.object({ variavelId: z.string().uuid() }),
        querystring: periodoQuery.extend({
          gerenciaId: z.string().uuid(),
          /**
           * A área onde se conta. Ausente = a soma da gerência.
           *
           * `gerenciaId` continua obrigatório mesmo com a área: é ele que diz
           * QUAL soma, e é contra ele que a área é conferida.
           */
          areaVendaId: z.string().uuid().optional(),
        }),
        response: {
          200: z.object({
            podeMarcar: z.boolean(),
            pontosCausa: z.array(
              z.object({
                id: z.string(),
                nome: z.string(),
                /** Índice 0 = S1. Sempre 5 posições, mesmo que o mês tenha 4 semanas. */
                semanas: z.array(z.number().int()),
                total: z.number().int(),
              }),
            ),
          }),
          401: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (req) => {
      const usuario = await app.autenticar(req)
      const { variavelId } = req.params
      const { ano, mes, gerenciaId, areaVendaId } = req.query

      const variavel = await app.prisma.variavelControle.findUnique({
        where: { id: variavelId },
        include: { pontosCausa: { where: { ativo: true }, orderBy: { ordem: 'asc' } } },
      })
      if (!variavel) throw new NaoEncontrado(`Variável de controle ${variavelId} não existe.`)

      if (areaVendaId !== undefined) await areaDaGerencia(areaVendaId, gerenciaId)

      const marcas = await app.prisma.ocorrenciaPontoCausa.findMany({
        where: {
          /*
           * O escopo entra na busca junto com o alvo. Sem ele, um uuid de área
           * e um de gerência que por acaso coincidissem se misturariam -- não
           * acontece com uuid, mas a consulta tem de DIZER o que procura.
           */
          ...(areaVendaId !== undefined
            ? { escopo: 'AREA_VENDA' as const, alvoId: areaVendaId }
            : await contadoNasGerencias([gerenciaId])),
          ano,
          mes,
          pontoCausa: { variavelControleId: variavelId },
        },
        select: { pontoCausaId: true, semana: true, quantidade: true },
      })

      const porPonto = new Map<string, number[]>()
      for (const m of marcas) {
        // `Array<number>`, e nao `Array(...)`: sem o parametro o retorno e'
        // `any[]`, e o `any` vazava para dentro do mapa de semanas.
        const linha = porPonto.get(m.pontoCausaId) ?? Array<number>(SEMANAS_NO_MES).fill(0)
        /*
         * SOMA, e não atribuição. Com `areaVendaId` vem no máximo uma linha por
         * (ponto, semana) e o `+=` dá no mesmo; sem ele vem UMA POR ÁREA, e
         * atribuir mostraria a última que o banco devolvesse -- um número menor
         * que o real, sem erro nenhum. Foi o que a soma da gerência quebrou
         * quando deixou de ser uma linha só (09/09/2026).
         */
        linha[m.semana - 1] = (linha[m.semana - 1] ?? 0) + m.quantidade
        porPonto.set(m.pontoCausaId, linha)
      }

      const variaveis = await variaveisDoUsuario(app.prisma, usuario)

      return {
        /*
         * Quem pode marcar vem do SERVIDOR, como em contramedidas: recalcular a
         * regra na tela seria uma segunda cópia que envelhece sozinha. A
         * autorização real continua sendo verificada na gravação.
         *
         * A SOMA da gerência nunca é marcável, nem para quem responde pela
         * variável: não existe onde gravar -- a contagem é dentro da área. Dizer
         * isto aqui, e não na tela, é o que impede uma grade editável que
         * devolve erro no salvar.
         */
        podeMarcar:
          areaVendaId !== undefined &&
          podeMarcarPontoCausa({ variavelControleId: variavelId }, variaveis),
        pontosCausa: variavel.pontosCausa.map((p) => {
          const semanas = porPonto.get(p.id) ?? Array<number>(SEMANAS_NO_MES).fill(0)
          return {
            id: p.id,
            nome: p.nome,
            semanas,
            total: semanas.reduce((a, b) => a + b, 0),
          }
        }),
      }
    },
  )

  // ── Gravar a grade ─────────────────────────────────────────────────────────
  /**
   * Grava a grade de uma área DE UMA VEZ, com as quantidades absolutas.
   *
   * Era um `POST` por clique, somando `+1` ou `-1`. Funcionava, e era lento de
   * um jeito que se sentia na reunião: o banco de desenvolvimento responde em
   * ~120 ms por ida, cada toque custava dez idas, e marcar cinco células levava
   * a conversa junto. Ver PLANO §7.21.
   *
   * A tela agora conta em memória e manda tudo ao confirmar. Uma requisição,
   * uma transação, um Pareto recalculado — em vez de um de cada por clique.
   *
   * **A semântica mudou junto, e vale escrito**: o corpo diz QUANTO a célula
   * passa a valer, não quanto somar. Com `delta` duas pessoas marcando ao mesmo
   * tempo somavam as duas marcações; com valor absoluto, **quem confirma por
   * último manda**. É aceitável porque a grade é preenchida por uma pessoa, na
   * reunião de uma área — e é o preço de não ir ao banco a cada clique.
   */
  r.put(
    '/api/v1/variaveis/:variavelId/marcacoes',
    {
      schema: {
        tags: ['Variáveis de controle'],
        summary: 'Grava a grade de pontos de causa × semanas de uma área de venda',
        params: z.object({ variavelId: z.string().uuid() }),
        body: z.object({
          gerenciaId: z.string().uuid(),
          /**
           * Onde se conta. **Obrigatório** desde 09/09/2026 (PLANO §7.59).
           *
           * A soma da gerência é só de leitura: não existe grade da gerência
           * para preencher, existem as das áreas e o total delas. Deixar isto
           * opcional guardaria um segundo lugar onde gravar, e um número que
           * aparece na soma sem estar em área nenhuma não tem dono na reunião.
           */
          areaVendaId: z.string().uuid(),
          ...periodoSchema.shape,
          /**
           * As células que MUDARAM. Quantidade zero apaga a linha.
           *
           * Só as alteradas, e não a grade inteira: mandar tudo faria o
           * `registradoEm` de células intocadas ser reescrito, e o histórico
           * de quem marcou o quê e quando — que é o que se olha quando o
           * Pareto surpreende — viraria o carimbo do último salvamento.
           */
          celulas: z
            .array(
              z.object({
                pontoCausaId: z.string().uuid(),
                semana: z.number().int().min(1).max(SEMANAS_NO_MES),
                quantidade: z.number().int().min(0).max(999),
              }),
            )
            .min(1)
            .max(200),
        }),
        response: {
          200: z.object({ gravadas: z.number().int(), apagadas: z.number().int() }),
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          422: erroSchema,
        },
      },
    },
    async (req) => {
      const usuario = await app.autenticar(req)
      const { variavelId } = req.params
      const b = req.body

      /*
       * Duas células com o mesmo (ponto, semana) no mesmo corpo é erro de quem
       * chamou, e recusar é melhor do que escolher uma: qualquer escolha aqui
       * grava um número que ninguém digitou.
       */
      const chaves = new Set(b.celulas.map((c) => `${c.pontoCausaId}|${String(c.semana)}`))
      if (chaves.size !== b.celulas.length) {
        throw new DadosInvalidos('A mesma célula aparece duas vezes no corpo.')
      }

      /*
       * As três leituras são independentes — em paralelo. Sequenciais custavam
       * três idas ao banco, e a ida é o caro aqui, não a consulta.
       */
      const idsDosPontos = [...new Set(b.celulas.map((c) => c.pontoCausaId))]
      const [pontos, gerencia, variaveis] = await Promise.all([
        app.prisma.pontoCausa.findMany({
          where: { id: { in: idsDosPontos } },
          select: { id: true, ativo: true, variavelControleId: true },
        }),
        app.prisma.dimGerencia.findUnique({ where: { id: b.gerenciaId } }),
        variaveisDoUsuario(app.prisma, usuario),
      ])

      if (!gerencia) throw new NaoEncontrado('Gerência não existe.')
      await areaDaGerencia(b.areaVendaId, b.gerenciaId)

      if (pontos.length !== idsDosPontos.length) {
        throw new NaoEncontrado('Ponto de causa não existe.')
      }
      /*
       * Todo ponto tem de ser DESTA variável. Sem esta checagem, o caminho
       * autorizado seria a variável do parâmetro e o dado gravado seria de
       * outra — e o Pareto de uma variável apareceria dentro da outra.
       */
      const deOutra = pontos.find((p) => p.variavelControleId !== variavelId)
      if (deOutra) throw new DadosInvalidos('Ponto de causa não é desta variável de controle.')

      const desativado = pontos.find((p) => !p.ativo)
      if (desativado) throw new DadosInvalidos('Este ponto de causa foi desativado.')

      if (!podeMarcarPontoCausa({ variavelControleId: variavelId }, variaveis)) {
        throw new NaoAutorizado(
          'Você não responde por esta variável de controle nesta filial. ' +
            'Quem marca é quem tem a variável associada ao perfil.',
        )
      }

      const comuns = {
        /*
         * Contra a ÁREA DE VENDA. Conta-se onde o problema aparece, que é a
         * mesma linha do quadro dos indicadores; o que a reunião usa é a SOMA
         * das áreas, no bloco de fora. Ver PLANO §7.59 -- e §7.29, que era o
         * contrário e valeu de 29/08 a 09/09/2026.
         */
        escopo: 'AREA_VENDA' as const,
        alvoId: b.areaVendaId,
        ano: b.ano,
        mes: b.mes,
      }

      const zeradas = b.celulas.filter((c) => c.quantidade === 0)
      const comValor = b.celulas.filter((c) => c.quantidade > 0)

      await app.prisma.$transaction([
        /*
         * Célula zerada tem a LINHA removida, não zerada. Guardar zero encheria
         * o Pareto de causas que ninguém apontou, todas com peso nenhum — e a
         * constraint do banco recusaria de todo jeito.
         *
         * Um `deleteMany` para todas, e não um por célula: a ida ao banco é o
         * custo, e são as mesmas linhas.
         */
        ...(zeradas.length > 0
          ? [
              app.prisma.ocorrenciaPontoCausa.deleteMany({
                where: {
                  ...comuns,
                  OR: zeradas.map((c) => ({ pontoCausaId: c.pontoCausaId, semana: c.semana })),
                },
              }),
            ]
          : []),
        /*
         * `upsert` por célula porque o Prisma não tem "insert ... on conflict
         * update" em lote. Ainda assim é UMA ida: `$transaction` com array
         * manda tudo junto.
         *
         * `registradoPorId` e `registradoEm` são reescritos: com contador
         * editável, o que interessa é quem mexeu por último. Marcação
         * retroativa aparece comparando `registradoEm` com ano+mês+semana.
         */
        ...comValor.map((c) =>
          app.prisma.ocorrenciaPontoCausa.upsert({
            where: {
              pontoCausaId_escopo_alvoId_ano_mes_semana: {
                pontoCausaId: c.pontoCausaId,
                ...comuns,
                semana: c.semana,
              },
            },
            update: {
              quantidade: c.quantidade,
              registradoPorId: usuario.id,
              registradoEm: agora(),
            },
            create: {
              pontoCausaId: c.pontoCausaId,
              ...comuns,
              semana: c.semana,
              quantidade: c.quantidade,
              registradoPorId: usuario.id,
            },
          }),
        ),
      ])

      return { gravadas: comValor.length, apagadas: zeradas.length }
    },
  )

  // ── Cadastro de ponto de causa ─────────────────────────────────────────────
  /*
   * QUEM MARCA CRIA; QUEM ADMINISTRA CORRIGE. Decisão do analista, 10/09/2026.
   *
   * A causa nova aparece na reunião, e é lá que ela tem nome. Fechar a criação
   * no administrador poria a reunião esperando por ele para contar o que já
   * está acontecendo — e o que não é contado não vira Pareto e não vira ação.
   *
   * O que fica com o administrador é CONSERTAR: renomear e desativar. Ponto de
   * causa é cadastro da VARIÁVEL, não da área nem da gerência (a chave única é
   * `variavelControleId + nome`), então um nome mal escolhido aparece em todas
   * as áreas, nas duas gerências e nas outras filiais que acompanham a
   * variável. Criar é barato de corrigir; renomear em cima do histórico de
   * todos, não.
   */
  const pontoDaVariavel = async (pontoId: string, variavelId: string) => {
    const ponto = await app.prisma.pontoCausa.findUnique({
      where: { id: pontoId },
      select: { id: true, nome: true, ativo: true, variavelControleId: true },
    })
    if (!ponto) throw new NaoEncontrado('Ponto de causa não existe.')
    /*
     * Mesma checagem do PUT das marcações, e pelo mesmo motivo: sem ela o
     * caminho autorizado seria a variável do parâmetro e o alvo seria de outra.
     */
    if (ponto.variavelControleId !== variavelId) {
      throw new NaoEncontrado('Ponto de causa não é desta variável de controle.')
    }
    return ponto
  }

  const pontoSchema = z.object({
    id: z.string(),
    nome: z.string(),
    ativo: z.boolean(),
    ordem: z.number().int(),
  })

  /** Nome com espaço sobrando cria dois pontos que se leem iguais no quadro. */
  const nomeDoPonto = z
    .string()
    .trim()
    .min(3, 'O nome do ponto de causa precisa de pelo menos 3 caracteres.')
    .max(120)

  r.post(
    '/api/v1/variaveis/:variavelId/pontos-causa',
    {
      schema: {
        tags: ['Variáveis de controle'],
        summary: 'Cria um ponto de causa na variável de controle',
        description:
          'Quem pode marcar pode criar. O ponto passa a existir para TODAS as ' +
          'áreas e gerências que acompanham a variável — o cadastro é dela.',
        params: z.object({ variavelId: z.string().uuid() }),
        body: z.object({ nome: nomeDoPonto }),
        response: {
          201: pontoSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
          422: erroSchema,
        },
      },
    },
    async (req, reply) => {
      const usuario = await app.autenticar(req)
      const { variavelId } = req.params
      const nome = req.body.nome

      const [variavel, variaveis] = await Promise.all([
        app.prisma.variavelControle.findUnique({
          where: { id: variavelId },
          select: { id: true, ativo: true },
        }),
        variaveisDoUsuario(app.prisma, usuario),
      ])
      if (!variavel) throw new NaoEncontrado('Variável de controle não existe.')
      if (!variavel.ativo) {
        throw new DadosInvalidos('Esta variável de controle está desativada.')
      }
      if (!podeMarcarPontoCausa({ variavelControleId: variavelId }, variaveis)) {
        throw new NaoAutorizado(
          'Você não responde por esta variável de controle nesta filial. ' +
            'Quem cria ponto de causa é quem marca ocorrência nela.',
        )
      }

      /*
       * NOME REPETIDO TEM DOIS DESFECHOS, e é o que evita o beco sem saída.
       *
       * A chave única é `(variavelControleId, nome)`, e o desativado continua
       * ocupando o nome. Sem este ramo, quem tentasse recriar uma causa que o
       * administrador desativou levaria "já existe" apontando para uma linha
       * que não aparece em lugar nenhum da tela.
       *
       *   ativo    → 409, e o nome de quem já existe é a resposta;
       *   inativo  → REATIVA. Criar de novo o que foi desativado é isto.
       */
      const mesmoNome = await app.prisma.pontoCausa.findUnique({
        where: { variavelControleId_nome: { variavelControleId: variavelId, nome } },
        select: { id: true, nome: true, ativo: true, ordem: true },
      })
      if (mesmoNome) {
        if (mesmoNome.ativo) {
          throw new Conflito('Já existe um ponto de causa com este nome nesta variável.')
        }
        const revivido = await app.prisma.pontoCausa.update({
          where: { id: mesmoNome.id },
          data: { ativo: true },
          select: { id: true, nome: true, ativo: true, ordem: true },
        })
        return reply.code(201).send(revivido)
      }

      /*
       * `ordem` é obrigatória e a lista é ordenada por ela: o novo entra no FIM.
       * Enfiar no meio renumeraria os outros, e a ordem de hoje é a que a
       * reunião já leu dezenas de vezes de cima para baixo.
       */
      const ultimo = await app.prisma.pontoCausa.aggregate({
        where: { variavelControleId: variavelId },
        _max: { ordem: true },
      })
      const criado = await app.prisma.pontoCausa.create({
        data: {
          variavelControleId: variavelId,
          nome,
          ordem: (ultimo._max.ordem ?? 0) + 1,
        },
        select: { id: true, nome: true, ativo: true, ordem: true },
      })
      return reply.code(201).send(criado)
    },
  )

  r.patch(
    '/api/v1/variaveis/:variavelId/pontos-causa/:pontoId',
    {
      schema: {
        tags: ['Variáveis de controle'],
        summary: 'Renomeia ou desativa um ponto de causa (administrador)',
        params: z.object({
          variavelId: z.string().uuid(),
          pontoId: z.string().uuid(),
        }),
        /** Pelo menos um dos dois: corpo vazio seria uma escrita que não escreve. */
        body: z
          .object({ nome: nomeDoPonto.optional(), ativo: z.boolean().optional() })
          .refine((b) => b.nome !== undefined || b.ativo !== undefined, {
            message: 'Informe `nome`, `ativo`, ou os dois.',
          }),
        response: {
          200: pontoSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
          422: erroSchema,
        },
      },
    },
    async (req) => {
      await exigirAdmin(app, req)
      const { variavelId, pontoId } = req.params
      await pontoDaVariavel(pontoId, variavelId)

      if (req.body.nome !== undefined) {
        const outro = await app.prisma.pontoCausa.findUnique({
          where: {
            variavelControleId_nome: { variavelControleId: variavelId, nome: req.body.nome },
          },
          select: { id: true },
        })
        /* O próprio não é conflito: renomear para o mesmo nome é operação nula. */
        if (outro && outro.id !== pontoId) {
          throw new Conflito('Já existe um ponto de causa com este nome nesta variável.')
        }
      }

      return app.prisma.pontoCausa.update({
        where: { id: pontoId },
        data: {
          ...(req.body.nome !== undefined ? { nome: req.body.nome } : {}),
          ...(req.body.ativo !== undefined ? { ativo: req.body.ativo } : {}),
        },
        select: { id: true, nome: true, ativo: true, ordem: true },
      })
    },
  )

  r.delete(
    '/api/v1/variaveis/:variavelId/pontos-causa/:pontoId',
    {
      schema: {
        tags: ['Variáveis de controle'],
        summary: 'Remove um ponto de causa (administrador)',
        description:
          'Sem nada gravado, apaga. Com ocorrência ou contramedida, apenas ' +
          'DESATIVA — apagar levaria o histórico embora com ele.',
        params: z.object({
          variavelId: z.string().uuid(),
          pontoId: z.string().uuid(),
        }),
        response: {
          200: z.object({
            /** `apagado` saiu do banco; `desativado` continua lá, fora da tela. */
            resultado: z.enum(['apagado', 'desativado']),
            ocorrencias: z.number().int(),
            contramedidas: z.number().int(),
          }),
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (req) => {
      await exigirAdmin(app, req)
      const { variavelId, pontoId } = req.params
      await pontoDaVariavel(pontoId, variavelId)

      /*
       * APAGAR É EXCEÇÃO, e a diferença não é de gosto: `OcorrenciaPontoCausa`
       * e `Contramedida` apontam para cá. Um `delete` com filhos ou falha na
       * chave estrangeira ou leva o histórico do Pareto embora — e o histórico
       * é o que se olha quando o Pareto de hoje surpreende.
       *
       * Então: sem filhos, apaga (é o erro de digitação de dois minutos atrás);
       * com filhos, desativa. A resposta diz qual dos dois aconteceu, senão a
       * tela mostraria "removido" para algo que continua no banco.
       */
      const [ocorrencias, contramedidas] = await Promise.all([
        app.prisma.ocorrenciaPontoCausa.count({ where: { pontoCausaId: pontoId } }),
        app.prisma.contramedida.count({ where: { pontoCausaId: pontoId } }),
      ])

      if (ocorrencias > 0 || contramedidas > 0) {
        await app.prisma.pontoCausa.update({ where: { id: pontoId }, data: { ativo: false } })
        return { resultado: 'desativado' as const, ocorrencias, contramedidas }
      }

      await app.prisma.pontoCausa.delete({ where: { id: pontoId } })
      return { resultado: 'apagado' as const, ocorrencias, contramedidas }
    },
  )

  // ── Pareto ─────────────────────────────────────────────────────────────────
  r.get(
    '/api/v1/variaveis/:variavelId/pareto',
    {
      schema: {
        tags: ['Variáveis de controle'],
        summary: 'Ocorrências somadas no ciclo, da maior para a menor',
        description:
          'A SOMA da gerência: marca-se dentro da área de venda, e aqui vem o ' +
          'total. O N3 lê o mesmo número que o N4 — uma consulta só, não duas.',
        params: z.object({ variavelId: z.string().uuid() }),
        /*
         * UM alvo dos dois, e não os dois juntos: `gerenciaId` para a reunião
         * do N4/N3, `filial` para o drill-down do N2, que olha a loja inteira
         * (§7.43). Pedir os dois seria pedir para alguém combiná-los, e não há
         * combinação: uma gerência já está dentro de uma filial.
         */
        querystring: periodoQuery.extend({
          gerenciaId: z.string().uuid().optional(),
          filial: z.string().optional(),
        }),
        response: {
          200: z.object({
            total: z.number().int(),
            itens: z.array(
              z.object({
                pontoCausaId: z.string(),
                nome: z.string(),
                quantidade: z.number().int(),
                percentual: z.number(),
                /** Acumulado até aqui. Abaixo de 80 são os poucos vitais. */
                acumulado: z.number(),
                vital: z.boolean(),
              }),
            ),
          }),
          401: erroSchema,
          404: erroSchema,
          422: erroSchema,
        },
      },
    },
    async (req) => {
      await app.autenticar(req)
      const { variavelId } = req.params
      const { ano, mes, gerenciaId, filial } = req.query

      /**
       * **Uma soma só, servida aos dois níveis.**
       *
       * Voltou a ser soma de áreas em 09/09/2026 (§7.59) — mas o N3 e o N4 leem
       * ESTA rota, não cada um a sua. O erro de §7.19 era ter dois `GROUP BY`
       * escritos em lugares diferentes, e é isso que continua não existindo.
       */
      if ((gerenciaId === undefined) === (filial === undefined)) {
        throw new DadosInvalidos(
          'Informe gerenciaId OU filial — uma gerência já está dentro de uma filial.',
        )
      }

      /**
       * Os alvos a somar: uma gerência, ou TODAS as da filial.
       *
       * Confere que existem antes de somar. Sem isto um id errado devolveria
       * Pareto vazio, que na tela lê como "nada foi marcado" -- e ninguém
       * procura o que parece estar certo.
       */
      let alvos: string[]
      if (gerenciaId !== undefined) {
        const gerencia = await app.prisma.dimGerencia.findUnique({
          where: { id: gerenciaId },
          select: { id: true },
        })
        if (!gerencia) throw new NaoEncontrado('Gerência não existe.')
        alvos = [gerencia.id]
      } else {
        //  -- a checagem acima garante que um dos dois veio.
        const daFilial = await app.prisma.dimGerencia.findMany({
          where: { filial: { sigla: filial! } },
          select: { id: true },
        })
        if (daFilial.length === 0) throw new NaoEncontrado('Filial não existe, ou não tem gerência.')
        alvos = daFilial.map((g) => g.id)
      }

      const grupos = await app.prisma.ocorrenciaPontoCausa.groupBy({
        by: ['pontoCausaId'],
        where: {
          ...(await contadoNasGerencias(alvos)),
          ano,
          mes,
          pontoCausa: { variavelControleId: variavelId },
        },
        _sum: { quantidade: true },
      })

      const total = grupos.reduce((a, g) => a + (g._sum.quantidade ?? 0), 0)
      if (total === 0) return { total: 0, itens: [] }

      const nomes = new Map(
        (
          await app.prisma.pontoCausa.findMany({
            where: { id: { in: grupos.map((g) => g.pontoCausaId) } },
            select: { id: true, nome: true },
          })
        ).map((p) => [p.id, p.nome]),
      )

      /*
       * Empate desempatado pelo NOME, não deixado à ordem do banco.
       *
       * Duas causas com a mesma contagem trocariam de lugar entre recarregadas,
       * e na reunião isso lê como "mudou alguma coisa" quando nada mudou.
       */
      const ordenado = grupos
        .map((g) => ({
          pontoCausaId: g.pontoCausaId,
          nome: nomes.get(g.pontoCausaId) ?? '—',
          quantidade: g._sum.quantidade ?? 0,
        }))
        .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR'))

      let acumulado = 0
      return {
        total,
        itens: ordenado.map((i) => {
          const antes = acumulado
          acumulado += (i.quantidade / total) * 100
          return {
            ...i,
            percentual: Number(((i.quantidade / total) * 100).toFixed(1)),
            acumulado: Number(acumulado.toFixed(1)),
            /*
             * "Vital" é quem ENTRA antes dos 80%, não quem termina abaixo deles.
             * Medido pelo acumulado ANTERIOR: senão a barra que cruza a linha
             * ficaria de fora, e é justamente ela que fecha o corte de Pareto.
             */
            vital: antes < 80,
          }
        }),
      }
    },
  )

  // ── Performance Vendas ─────────────────────────────────────────────────────
  r.get(
    '/api/v1/gerencias/:gerenciaId/performance-vendas',
    {
      schema: {
        tags: ['Variáveis de controle'],
        summary: 'Cumprimento da meta do mês por área de venda, e o rolo da gerência',
        params: z.object({ gerenciaId: z.string().uuid() }),
        /*
         * A SEMANA move o corte da conta. Ausente = o mês até D-1, que é o
         * comportamento de sempre e o que a tela mensal continua pedindo.
         */
        querystring: periodoQuery.extend({
          semana: z.coerce.number().int().min(1).max(SEMANAS_NO_MES).optional(),
        }),
        response: {
          200: z.object({
            /**
             * O dia até onde a conta foi, devolvido de propósito.
             *
             * Vendas e Vendedor têm cortes INDEPENDENTES: cada uma é limitada
             * pela janela da própria carga, e `vendas-linha` e `vendedor-dia`
             * podem estar em dias diferentes — medido em 29/08/2026, 23/08
             * contra 27/08. Sem dizer o dia, a tela põe dois números lado a
             * lado que não são do mesmo instante.
             */
            corte: z.string().nullable(),
            areas: z.array(
              z.object({
                areaVendaId: z.string(),
                nome: z.string(),
                supervisor: z.string().nullable(),
                /** Projeção de fechamento do mês. */
                numerador: z.number(),
                /** Meta do mês. Nula quando não cadastrada. */
                denominador: z.number().nullable(),
                percentual: z.number().nullable(),
              }),
            ),
            gerencia: z
              .object({
                numerador: z.number(),
                denominador: z.number(),
                percentual: z.number(),
              })
              .nullable(),
          }),
          401: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (req) => {
      await app.autenticar(req)
      const { gerenciaId } = req.params
      const { ano, mes, semana } = req.query

      const gerencia = await app.prisma.dimGerencia.findUnique({
        where: { id: gerenciaId },
        include: { areasVenda: { orderBy: { nome: 'asc' } } },
      })
      if (!gerencia) throw new NaoEncontrado('Gerência não existe.')

      const ateODado = await ultimoDiaComDado('vendas-linha', gerencia.filialId, ano, mes)

      return vendasNoCorte(gerencia, ano, mes, semana, ateODado)
    },
  )

  // ── Performance Vendedor ───────────────────────────────────────────────────
  r.get(
    '/api/v1/gerencias/:gerenciaId/performance-vendedor',
    {
      schema: {
        tags: ['Variáveis de controle'],
        summary: '% dos vendedores da área que cumpriram a cota rateada, e o rolo da gerência',
        params: z.object({ gerenciaId: z.string().uuid() }),
        /*
         * A SEMANA move o corte da conta. Ausente = o mês até D-1, que é o
         * comportamento de sempre e o que a tela mensal continua pedindo.
         */
        querystring: periodoQuery.extend({
          semana: z.coerce.number().int().min(1).max(SEMANAS_NO_MES).optional(),
        }),
        response: {
          200: z.object({
            /**
             * O corte usado, devolvido de propósito.
             *
             * Sem ele a tela não tem como dizer "até o dia 26 de 31 dias
             * úteis", e um percentual de meio de mês sem essa frase é lido
             * como o número do mês fechado.
             */
            corte: z
              .object({
                data: z.string(),
                diasUteisDecorridos: z.number(),
                diasUteisDoMes: z.number(),
              })
              .nullable(),
            areas: z.array(
              z.object({
                areaVendaId: z.string(),
                nome: z.string(),
                supervisor: z.string().nullable(),
                /** Vendedores que alcançaram a cota rateada até o corte. */
                numerador: z.number(),
                /** Vendedores que contam no mês. */
                denominador: z.number(),
                percentual: z.number().nullable(),
                /** Quantos ficaram de fora, e por quê. A tela precisa disto. */
                foraDaConta: z.object({
                  semMeta: z.number(),
                  inativos: z.number(),
                  outros: z.number(),
                }),
              }),
            ),
            gerencia: z
              .object({
                numerador: z.number(),
                denominador: z.number(),
                percentual: z.number().nullable(),
                foraDaConta: z.object({
                  semMeta: z.number(),
                  inativos: z.number(),
                  outros: z.number(),
                }),
              })
              .nullable(),
          }),
          401: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (req) => {
      await app.autenticar(req)
      const { gerenciaId } = req.params
      const { ano, mes, semana } = req.query

      const gerencia = await app.prisma.dimGerencia.findUnique({
        where: { id: gerenciaId },
        include: { areasVenda: { orderBy: { nome: 'asc' } } },
      })
      if (!gerencia) throw new NaoEncontrado('Gerência não existe.')

      /*
       * O CORTE NÃO PODE PASSAR DO QUE A CARGA COBRIU.
       *
       * `corteDe` diz D-1, mas D-1 pode não ter chegado ainda: se a carga
       * diária não rodou hoje, o fato termina em D-2 e o calendário não.
       *
       * Medido na primeira carga real (28/08/2026): o corte deu 27/08 com a
       * carga indo até 26/08, e a cota foi rateada por 23 dias úteis contra
       * venda de 22. A gerência apareceu com 17% em vez de 22% -- cinco pontos
       * de queda sem que nenhum vendedor tivesse vendido menos.
       *
       * O limite é o ÚLTIMO DIA COM DADO NA FILIAL -- ver `ultimoDiaComDado`,
       * que explica por que é por filial e nunca por área, e por que deixou de
       * ser a janela declarada pela carga.
       */
      const ateODado = await ultimoDiaComDado('vendedor-dia', gerencia.filialId, ano, mes)

      return vendedorNoCorte(gerencia, ano, mes, semana, ateODado)
    },
  )

  // ── A faísca: as cinco semanas de uma gerência ─────────────────────────────
  /**
   * A série semanal de Performance Vendedor, da gerência e de cada área.
   *
   * É o minigráfico que fica ao lado do KPI nos dois quadros. O protótipo
   * explica por que ele existe, e vale repetir: **a tendência é a história.**
   * `88-71-64-57` é uma conversa diferente de `57%`, e antes só aparecia
   * clicando semana por semana.
   *
   * **Chama o MESMO cálculo do KPI**, uma vez por semana. É a garantia que
   * importa: o ponto da semana selecionada no gráfico é o número grande ao
   * lado dele. Uma segunda implementação, mais barata, é como os dois passariam
   * a discordar sem erro nenhum — e num gráfico a discordância nem chama
   * atenção, porque ninguém confere ponto a ponto.
   *
   * Custa cinco vezes as consultas de uma semana, e é UMA ida ao banco do ponto
   * de vista da tela: as cinco vão em paralelo. A alternativa seria ler o mês
   * inteiro por dia e acumular em memória — mais rápido e com uma conta nova
   * para manter em pé ao lado da que já existe. Não vale, ainda.
   *
   * A janela da carga é lida UMA vez e passada às cinco: ela não muda entre
   * semanas, e cinco leituras iguais seriam desperdício puro.
   */
  r.get(
    '/api/v1/gerencias/:gerenciaId/serie-semanal',
    {
      schema: {
        tags: ['Variáveis de controle'],
        summary: 'Performance Vendedor e Vendas semana a semana — a faísca do quadro',
        params: z.object({ gerenciaId: z.string().uuid() }),
        querystring: periodoQuery,
        response: {
          200: z.object({
            /**
             * As semanas que o mês TEM, com as datas.
             *
             * Vêm na resposta porque um mês pode ter 4 ou 5, e as pontas podem
             * ser parciais — a tela não deve recalcular o calendário para saber
             * quantos pontos desenhar. Ver `lib/semanas.ts`.
             */
            semanas: z.array(
              z.object({ numero: z.number().int(), de: z.string(), ate: z.string() }),
            ),
            /**
             * Uma série por VARIÁVEL, porque são duas perguntas diferentes e
             * cada KPI tem a sua faísca. Devolver só uma faria a outra ficar
             * sem gráfico — e a assimetria na tela lê como defeito.
             */
            vendedor: z.object({
              /** Percentual da gerência em cada semana. `null` = sem conta. */
              gerencia: z.array(z.number().nullable()),
              areas: z.array(
                z.object({ areaVendaId: z.string(), serie: z.array(z.number().nullable()) }),
              ),
            }),
            vendas: z.object({
              gerencia: z.array(z.number().nullable()),
              areas: z.array(
                z.object({ areaVendaId: z.string(), serie: z.array(z.number().nullable()) }),
              ),
            }),
          }),
          401: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (req) => {
      await app.autenticar(req)
      const { gerenciaId } = req.params
      const { ano, mes } = req.query

      const gerencia = await app.prisma.dimGerencia.findUnique({
        where: { id: gerenciaId },
        include: { areasVenda: { orderBy: { nome: 'asc' } } },
      })
      if (!gerencia) throw new NaoEncontrado('Gerência não existe.')

      /*
       * Um limite por fonte: `vendedor-dia` e `vendas-linha` podem estar em
       * dias diferentes, e cada série tem de respeitar o seu. Um só limitaria a
       * mais adiantada pela mais atrasada.
       *
       * ÚLTIMO DIA COM DADO, e não a janela declarada pela carga -- ver
       * `ultimoDiaComDado`. A faísca tem de terminar no mesmo dia em que o
       * cartão termina, senão a última semana da série cai por uma cota rateada
       * a mais dias do que o realizado tem.
       */
      const [cargaVendedor, cargaVendas] = await Promise.all([
        ultimoDiaComDado('vendedor-dia', gerencia.filialId, ano, mes),
        ultimoDiaComDado('vendas-linha', gerencia.filialId, ano, mes),
      ])

      const semanas = semanasDoMes(ano, mes)
      const [porSemana, vendasPorSemana] = await Promise.all([
        Promise.all(
          semanas.map((w) => vendedorNoCorte(gerencia, ano, mes, w.numero, cargaVendedor)),
        ),
        Promise.all(
          semanas.map((w) => vendasNoCorte(gerencia, ano, mes, w.numero, cargaVendas)),
        ),
      ])

      /*
       * Semana no futuro devolve `areas: []`, e o ponto vira `null` — a tela
       * não desenha. Zero ali seria "ninguém bateu numa semana que não
       * aconteceu", que é pior do que buraco no gráfico.
       */
      return {
        semanas: semanas.map((w) => ({
          numero: w.numero,
          de: w.de.toISOString().slice(0, 10),
          ate: w.ate.toISOString().slice(0, 10),
        })),
        vendedor: {
          gerencia: porSemana.map((r) => r.gerencia?.percentual ?? null),
          areas: gerencia.areasVenda.map((a) => ({
            areaVendaId: a.id,
            serie: porSemana.map(
              (r) => r.areas.find((x) => x.areaVendaId === a.id)?.percentual ?? null,
            ),
          })),
        },
        vendas: {
          gerencia: vendasPorSemana.map((r) => r.gerencia?.percentual ?? null),
          areas: gerencia.areasVenda.map((a) => ({
            areaVendaId: a.id,
            serie: vendasPorSemana.map((r) => {
              const c = r.areas.find((x) => x.areaVendaId === a.id)
              /*
               * Denominador nulo é área SEM META na competência — não é zero
               * por cento. O ponto some do gráfico, como some do KPI.
               */
              return c && c.denominador !== null && c.denominador > 0 ? c.percentual : null
            }),
          })),
        },
      }
    },
  )

  // ── O quadro do N3: gerências da filial, com o que cada uma acompanha ──────
  r.get(
    '/api/v1/gerencias',
    {
      schema: {
        tags: ['Variáveis de controle'],
        summary: 'Gerências da filial do usuário, com áreas de venda e variáveis',
        /*
         * `ano` e `mes` são OPCIONAIS e servem só para trazer a META de cada
         * variável na competência. Sem eles a meta vem nula, e a tela mostra o
         * percentual sem o "/85%" ao lado -- que é o comportamento certo:
         * inventar 100% como padrão faria a variável parecer no alvo.
         */
        querystring: z.object({
          ano: z.coerce.number().int().min(2020).max(2100).optional(),
          mes: z.coerce.number().int().min(1).max(12).optional(),
          /*
           * A troca de visão do administrador, igual a `/painel` e
           * `/indicador`. Substitui o antigo `filial=`, que era regra própria
           * desta rota: só o N2 informava a sigla, e quem administra sem ser N2
           * de nascença ficava sem saída — a rota exigia filial própria, e o
           * corporativo não tem nenhuma.
           */
          visaoNivel: z.string().optional(),
          visaoFilial: z.string().optional(),
        }),
        response: {
          200: z.object({
            gerencias: z.array(
              z.object({
                id: z.string(),
                nome: z.string(),
                /**
                 * Esta é a gerência de quem pediu — a tela abre nela.
                 *
                 * Falso em todas quando não dá para saber, e aí o quadro abre
                 * na primeira e a pessoa escolhe. Ver `gerenciaDoPerfil`.
                 */
                minha: z.boolean(),
                areasVenda: z.array(
                  z.object({
                    id: z.string(),
                    nome: z.string(),
                    supervisor: z.string().nullable(),
                  }),
                ),
                /**
                 * Agrupadas por INDICADOR — é a categoria da tela do N3
                 * (Vendas, Operacional…). Derivada, nunca guardada: ver o
                 * comentário do modelo `GerenciaVariavel`.
                 */
                categorias: z.array(
                  z.object({
                    indicador: z.string(),
                    nome: z.string(),
                    variaveis: z.array(
                      z.object({
                        id: z.string(),
                        nome: z.string(),
                        unidade: z.string(),
                        sentido: z.enum(['MAIOR_MELHOR', 'MENOR_MELHOR']),
                        /** Meta da variável na competência. Nula = não cadastrada. */
                        meta: z.number().nullable(),
                      }),
                    ),
                  }),
                ),
              }),
            ),
          }),
          401: erroSchema,
          403: erroSchema,
        },
      },
    },
    async (req) => {
      const usuario = await app.autenticar(req)

      /**
       * A filial sai da VISÃO, e a visão é resolvida no servidor.
       *
       * `resolverVisao` é a mesma função de `/painel` e `/indicador` — ela
       * devolve a filial do próprio perfil quando ninguém pediu nada, e valida
       * a troca quando um administrador pede. Concentrar a regra ali é o que
       * impede esta rota de discordar das outras sobre quem pode ver o quê.
       *
       * Antes a regra estava escrita aqui, e discordava: "N2 informa a filial,
       * os outros usam a própria". Quem administra sem ser N2 de nascença
       * ficava sem saída — a rota exigia filial própria, e o corporativo não
       * tem nenhuma.
       *
       */
      const visao = await resolverVisao(app.prisma, usuario, {
        visaoNivel: req.query.visaoNivel,
        visaoFilial: req.query.visaoFilial,
      })

      const filialId = visao.filialId
      if (!filialId) {
        throw new DadosInvalidos(
          `${visao.nivel} é corporativo e não tem filial própria: o quadro da reunião é de uma ` +
            'loja. Escolha a filial na visão.',
        )
      }

      const gerencias = await app.prisma.dimGerencia.findMany({
        where: { filialId },
        orderBy: { nome: 'asc' },
        include: {
          /*
           * Por NOME, e a ordem que vale é a da tela.
           *
           * O `destaque` saiu daqui em 09/09/2026 (§7.59): as três promovidas
           * eram exemplo, não gestão -- *"pode tirar os 3 primeiros que foram
           * mockados"* --, e a lista passou a abrir pela área de PIOR
           * DESEMPENHO. Esse número não existe nesta consulta: ele vem de
           * `performance-vendas`, que é outra rota, então quem ordena é o
           * cliente, que tem as duas respostas na mão.
           *
           * Este `orderBy` fica como ordem ESTÁVEL -- para que a resposta não
           * mude de sequência entre chamadas iguais --, e não como a ordem da
           * tela. O campo `destaque` saiu do `select` junto: devolver um dado
           * que nenhuma tela lê convida a próxima pessoa a acreditar que ele
           * significa algo.
           */
          areasVenda: {
            orderBy: { nome: 'asc' },
            select: { id: true, nome: true, supervisor: true },
          },
          /*
           * NA ORDEM DO CADASTRO -- e não havia ordem nenhuma aqui.
           *
           * Sem `orderBy`, o Postgres devolve na ordem que quiser, e o seletor
           * de "contando causas de" desenhava os botões nessa ordem. Era por
           * isso que "Performance Vendedor" vinha primeiro: acaso, não decisão.
           * E não é só a ordem dos botões -- a tela abre na PRIMEIRA da lista
           * (`variaveis[0]`), então o acaso escolhia também o que o quadro
           * conta por padrão.
           *
           * `VariavelControle.ordem` existe desde o começo para isto e ninguém
           * a lia. Lida aqui, reordenar a tela vira uma linha no catálogo
           * (`prisma/seed/variaveis-gd.ts`), não um `if` no cliente.
           */
          variaveis: {
            orderBy: { variavelControle: { ordem: 'asc' } },
            include: {
              variavelControle: { include: { indicador: { select: { codigo: true, nome: true } } } },
            },
          },
        },
      })

      /*
       * A meta de cada variável na competência, quando `ano`/`mes` vieram.
       *
       * Uma consulta só para todas as gerências, e não uma por variável: são
       * poucas linhas e o custo de N idas ao banco por uma etiqueta de tela não
       * se paga.
       *
       * A chave inclui a GERÊNCIA porque a meta é por filial, e duas gerências
       * da mesma filial compartilham a variável -- sem a gerência na chave, a
       * meta de uma sobrescreveria a da outra em silêncio.
       */
      const metaDaVariavel = new Map<string, number>()
      if (req.query.ano !== undefined && req.query.mes !== undefined) {
        const ids = [...new Set(gerencias.flatMap((g) => g.variaveis.map((gv) => gv.variavelControleId)))]
        const metas = await app.prisma.meta.findMany({
          where: {
            escopo: 'VARIAVEL',
            ano: req.query.ano,
            mes: req.query.mes,
            alvoId: { in: ids },
            filialId: { in: [...new Set(gerencias.map((g) => g.filialId))] },
          },
          select: { alvoId: true, filialId: true, valor: true },
        })
        const porFilial = new Map(metas.map((m) => [`${m.filialId}|${m.alvoId}`, Number(m.valor)]))
        for (const g of gerencias) {
          for (const gv of g.variaveis) {
            const v = porFilial.get(`${g.filialId}|${gv.variavelControleId}`)
            if (v !== undefined) metaDaVariavel.set(`${g.id}|${gv.variavelControleId}`, v)
          }
        }
      }

      /*
       * A gerência de quem PEDIU, não da visão simulada: quando o
       * administrador escolhe uma no cabeçalho, é a escolha dele que manda, e
       * a tela já resolve isso. Aqui é para o N4 de verdade abrir na dele.
       */
      const minhaGerencia = gerenciaDoPerfil(usuario.idPerfil)

      return {
        gerencias: gerencias.map((g) => {
          const porIndicador = new Map<
            string,
            {
              indicador: string
              nome: string
              variaveis: Array<{
                id: string
                nome: string
                unidade: string
                sentido: 'MAIOR_MELHOR' | 'MENOR_MELHOR'
                meta: number | null
              }>
            }
          >()

          for (const gv of g.variaveis) {
            const v = gv.variavelControle
            const chave = v.indicador.codigo
            const grupo = porIndicador.get(chave) ?? {
              indicador: chave,
              nome: v.indicador.nome,
              variaveis: [],
            }
            grupo.variaveis.push({
              id: v.id,
              nome: v.nome,
              unidade: v.unidade,
              sentido: v.sentido,
              meta: metaDaVariavel.get(`${g.id}|${v.id}`) ?? null,
            })
            porIndicador.set(chave, grupo)
          }

          return {
            id: g.id,
            nome: g.nome,
            minha: minhaGerencia !== null && g.nome === minhaGerencia,
            areasVenda: g.areasVenda,
            /*
             * Gerência sem vínculo devolve lista VAZIA, e a tela não desenha a
             * categoria. É o que impede o Depósito de aparecer sob Vendas com
             * um traço no lugar do número — que se lê como dado faltando,
             * quando a verdade é que a pergunta não se aplica.
             */
            categorias: [...porIndicador.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
          }
        }),
      }
    },
  )

  /**
   * A série semanal de uma variável na FILIAL inteira — o gráfico do
   * drill-down do N2 (§7.44).
   *
   * **Soma numerador e denominador, nunca a média dos percentuais.** Uma
   * gerência de 8 áreas não pode pesar igual a uma de 13, e foi por achar que
   * "percentual não se soma" encerrava o assunto que eu disse que este gráfico
   * era impossível. Percentual não soma mesmo — mas `vendedorNoCorte` e
   * `vendasNoCorte` devolvem as duas partes, e elas somam. É exatamente para
   * isto que §7.25 as extraiu.
   *
   * O ponto de cada semana usa o MESMO cálculo do KPI daquela semana, então a
   * linha e o número da reunião não têm como discordar.
   *
   * `null` na semana sem resposta — futura, ou sem carga que a alcance. Zero
   * ali seria "ninguém bateu numa semana que não aconteceu".
   */
  r.get(
    '/api/v1/filiais/:filial/variaveis/:variavelId/serie-semanal',
    {
      schema: {
        tags: ['Variáveis'],
        summary: 'Série semanal de uma variável na filial inteira',
        params: z.object({ filial: z.string(), variavelId: z.string().uuid() }),
        querystring: periodoQuery,
        response: {
          200: z.object({
            semanas: z.array(
              z.object({ numero: z.number().int(), de: z.string(), ate: z.string() }),
            ),
            /** Percentual da filial em cada semana. `null` = sem resposta. */
            serie: z.array(z.number().nullable()),
            /**
             * O gráfico PRONTO, no mesmo formato do indicador.
             *
             * A conversão valor→y mora em `lib/escala.ts` e é usada pela rota do
             * indicador; devolver os pontos já convertidos mantém UMA definição
             * da régua. Se a tela calculasse o `y` por conta, seriam duas
             * conversões para divergirem -- e a linha da variável ficaria em
             * altura diferente da do indicador para o mesmo percentual.
             */
            escalaY: z.array(
              z.object({
                valor: z.number(),
                rotulo: z.string(),
                y: z.number(),
                meta: z.boolean().optional(),
              }),
            ),
            yMeta: z.number(),
            pontos: z.array(
              z.object({
                rotulo: z.string(),
                valor: z.number().nullable(),
                y: z.number().nullable(),
              }),
            ),
            /**
             * O RESUMO da variável na semana mais recente com resposta.
             *
             * É o mesmo par que o cartão do N3 mostra — percentual e a fração
             * que o produziu —, condensado numa linha. Existe porque o gráfico
             * responde "como está indo" e não responde "quanto é": `92%` de
             * quê, de quantos.
             *
             * `null` quando nenhuma semana do mês tem resposta.
             */
            resumo: z
              .object({
                semana: z.number().int(),
                percentual: z.number(),
                numerador: z.number(),
                denominador: z.number(),
                /** Contra a semana anterior, em pontos percentuais. */
                delta: z.number().nullable(),
                /**
                 * O que a fração CONTA — a tela não tem como saber pelo número.
                 *
                 * `38 de 68` são pessoas; `41.420.000 de 43.810.000` são reais,
                 * e se lê `R$ 41,42 mi de R$ 43,81 mi`. As duas variáveis têm
                 * unidade `%` (o resultado é percentual), então a unidade não
                 * responde isso -- e deixar a tela adivinhar pelo NOME repetiria
                 * o casamento frágil que já é dívida em `ehVendedor`.
                 */
                conta: z.enum(['PESSOAS', 'REAIS']),
                /**
                 * O DESDOBRAMENTO — gerência, e as áreas dentro dela.
                 *
                 * É o que o cartão do N3 mostra, e o que faltava aqui: o número
                 * da loja diz que está em 95%, e não diz ONDE. Numa reunião a
                 * pergunta seguinte é sempre essa.
                 *
                 * Vem da MESMA conta do ponto do gráfico -- `vendedorNoCorte` e
                 * `vendasNoCorte` já devolvem as áreas junto com o rolo da
                 * gerência. Somar de novo aqui seria uma segunda conta para
                 * discordar da primeira.
                 */
                gerencias: z.array(
                  z.object({
                    nome: z.string(),
                    percentual: z.number().nullable(),
                    numerador: z.number(),
                    denominador: z.number(),
                    areas: z.array(
                      z.object({
                        nome: z.string(),
                        supervisor: z.string().nullable(),
                        percentual: z.number().nullable(),
                        numerador: z.number(),
                        denominador: z.number(),
                      }),
                    ),
                  }),
                ),
              })
              .nullable(),
            /** Qual das duas contas foi usada — a tela rotula o eixo com isto. */
            variavel: z.object({ nome: z.string(), unidade: z.string() }),
          }),
          401: erroSchema,
          404: erroSchema,
          422: erroSchema,
        },
      },
    },
    async (req) => {
      await app.autenticar(req)
      const { filial, variavelId } = req.params
      const { ano, mes } = req.query

      const variavel = await app.prisma.variavelControle.findUnique({
        where: { id: variavelId },
        select: { nome: true, unidade: true },
      })
      if (!variavel) throw new NaoEncontrado('Variável de controle não existe.')

      /*
       * Qual das duas contas. O casamento é por NOME, como no resto da tela --
       * e quebra em silêncio se alguém renomear a variável no cadastro. É a
       * mesma dívida registrada em `ehVendedor`, e não uma nova.
       */
      const ehVendedor = /vendedor/i.test(variavel.nome)
      const ehVendas = /vendas/i.test(variavel.nome)
      if (!ehVendedor && !ehVendas) {
        throw new DadosInvalidos(
          `"${variavel.nome}" não tem série semanal: só Performance Vendedor e ` +
            'Performance Vendas têm cálculo próprio. As demais não têm fato — a variável ' +
            'de controle é cadastro, e os fatos são por indicador.',
        )
      }

      const gerencias = await app.prisma.dimGerencia.findMany({
        where: { filial: { sigla: filial } },
        include: { areasVenda: { orderBy: { nome: 'asc' } } },
      })
      if (gerencias.length === 0) {
        throw new NaoEncontrado('Filial não existe, ou não tem gerência.')
      }

      /*
       * ÚLTIMO DIA COM DADO na filial, e não a janela declarada pela carga --
       * ver `ultimoDiaComDado`. Todas as gerências desta rota são da mesma
       * filial, então um limite serve para todas.
       */
      const carga = await ultimoDiaComDado(
        ehVendedor ? 'vendedor-dia' : 'vendas-linha',
        gerencias[0]!.filialId,
        ano,
        mes,
      )

      const semanas = semanasDoMes(ano, mes)

      /*
       * Uma conta por (semana, gerência). São 5 x 2 hoje; o custo é o mesmo da
       * série por gerência, multiplicado pelo número de gerências da loja.
       */
      const porSemana = await Promise.all(
        semanas.map(async (w) => {
          const resultados = await Promise.all(
            gerencias.map((g) =>
              ehVendedor
                ? vendedorNoCorte(g, ano, mes, w.numero, carga)
                : vendasNoCorte(g, ano, mes, w.numero, carga),
            ),
          )

          let numerador = 0
          let denominador = 0
          for (const r of resultados) {
            if (!r.gerencia) continue
            numerador += r.gerencia.numerador
            // Sem `?? 0`: `denominador` nao e' nulavel aqui. Ver a nota abaixo,
            // que fala do denominador AGREGADO -- esse sim pode faltar.
            denominador += r.gerencia.denominador
          }
          // Sem denominador não há percentual -- e não é zero, é ausência.
          if (denominador <= 0) return null

          /*
           * Os resultados por gerência viajam junto com o total: o
           * desdobramento do resumo sai daqui, e não de uma segunda conta.
           */
          return { percentual: (numerador / denominador) * 100, numerador, denominador, resultados }
        }),
      )

      /*
       * A ÚLTIMA semana com resposta, e não a última do mês: no meio do mês as
       * semanas seguintes ainda não aconteceram, e resumir por elas devolveria
       * vazio numa tela que tem número.
       */
      const iUltima = porSemana.reduce((achado, v, i) => (v !== null ? i : achado), -1)
      const ultima = iUltima >= 0 ? porSemana[iUltima]! : null
      const anterior = iUltima > 0 ? porSemana[iUltima - 1] : null

      /**
       * A régua vai de 0 a 120, com a META em 100 — e é FIXA.
       *
       * Ajustá-la aos dados faria duas semanas iguais parecerem diferentes em
       * meses diferentes: o que esta linha compara é contra a meta, não contra
       * si mesma. Os espaçamentos dão mais resolução perto de 100, que é onde a
       * conversa acontece -- a mesma ideia do eixo do handoff.
       */
      const escalaY: AncoraEixo[] = [
        { valor: 120, rotulo: '120%', y: 20 },
        { valor: 110, rotulo: '110%', y: 55 },
        { valor: 100, rotulo: '100% · meta', y: 90, meta: true },
        { valor: 90, rotulo: '90%', y: 125 },
        { valor: 75, rotulo: '75%', y: 155 },
        { valor: 0, rotulo: '0%', y: 185 },
      ]

      return {
        semanas: semanas.map((w) => ({
          numero: w.numero,
          de: w.de.toISOString().slice(0, 10),
          ate: w.ate.toISOString().slice(0, 10),
        })),
        serie: porSemana.map((v) => v?.percentual ?? null),
        escalaY,
        yMeta: yDaMeta(escalaY),
        pontos: semanas.map((w, i) => {
          const v = porSemana[i]?.percentual ?? null
          return {
            rotulo: `Sem ${String(w.numero)}`,
            valor: v,
            y: v === null ? null : Number(valorParaY(v, escalaY).toFixed(2)),
          }
        }),
        resumo:
          ultima === null
            ? null
            : {
                semana: semanas[iUltima]?.numero ?? iUltima + 1,
                percentual: ultima.percentual,
                numerador: ultima.numerador,
                denominador: ultima.denominador,
                delta: anterior ? ultima.percentual - anterior.percentual : null,
                conta: ehVendedor ? ('PESSOAS' as const) : ('REAIS' as const),
                /*
                 * PIORES PRIMEIRO, como nas telas do N3 e do N4: o olho começa
                 * onde dói. Quem não tem denominador vai para o fim -- não dá
                 * para dizer que está mal quem ninguém comparou.
                 */
                gerencias: gerencias
                  .map((g, i) => {
                    const r = ultima.resultados[i]
                    return {
                      nome: g.nome,
                      percentual: r?.gerencia?.percentual ?? null,
                      numerador: r?.gerencia?.numerador ?? 0,
                      denominador: r?.gerencia?.denominador ?? 0,
                      areas: (r?.areas ?? [])
                        .map((a) => ({
                          nome: a.nome,
                          supervisor: a.supervisor,
                          percentual: a.percentual,
                          numerador: a.numerador,
                          denominador: a.denominador ?? 0,
                        }))
                        /*
                         * Área sem denominador sai da lista -- é a mesma regra
                         * da tabela do N3 (§7.36): linha sem número nenhum não
                         * informa nada e ocupa o mesmo peso de uma que importa.
                         */
                        .filter((a) => a.denominador > 0)
                        .sort(ordenarPorPior),
                    }
                  })
                  .sort(ordenarPorPior),
              },
        variavel,
      }
    },
  )

  /**
   * O HISTÓRICO MENSAL da gerência — os dois quadros da parede.
   *
   * Responde "como viemos até aqui", que é o que o quadro semanal não responde:
   * ele mostra a semana, e a reunião do GD precisa da tendência.
   *
   * As duas séries têm **origens e alcances diferentes**, e a resposta diz qual
   * é qual em vez de esconder:
   *
   *   VENDAS     de `venda_area_mes` (o resumo, §7.56) sobre a `meta` da
   *              competência. Alcança o que o resumo guardar — hoje desde
   *              janeiro/2026, e crescendo.
   *   VENDEDOR   de `fato_venda_vendedor` cruzado com `vendedor_mes`. Alcança a
   *              RETENÇÃO DO DETALHE, 60 dias, porque `bateuMeta` compara
   *              realizado contra cota e o realizado só existe no detalhe.
   *              Enquanto não houver resumo próprio, são ~2 meses.
   *
   * Mês sem dado volta com `null`, e não com zero: zero é um resultado, ausência
   * não é, e a tela desenha os dois de formas diferentes.
   */
  /**
   * O HISTÓRICO MENSAL de um escopo — uma gerência, ou a loja inteira.
   *
   * A conta é a mesma nos dois: soma `numerador` e `denominador` das áreas do
   * escopo, NUNCA promedia percentuais. Uma gerência de 8 áreas não pode pesar
   * igual a uma de 13, e é a mesma regra que o rolo da gerência já segue sobre
   * as áreas dela.
   *
   * Aqui, e não copiada na rota da loja, porque as duas telas mostram o MESMO
   * gráfico: o N4 apresenta o dele na reunião do N3, onde ele aparece somado às
   * outras gerências. Duas implementações divergiriam no primeiro ajuste feito
   * num lado só -- e o projeto já pagou esse preço.
   */
  async function historicoMensalDe(escopo: {
    filialId: string
    gerenciaIds: string[]
    meses: number
  }) {
    const hoje = agora()
    const competencias: Array<{ ano: number; mes: number }> = []
    for (let i = escopo.meses - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - i, 1))
      competencias.push({ ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 })
    }

    /*
     * As ÁREAS da gerência saem do próprio resumo, e não da dimensão.
     *
     * A dimensão diz onde a área está HOJE; o resumo congelou onde ela estava
     * no mês. Ler da dimensão faria a venda de março passar a contar para a
     * gerência de hoje, e o histórico mudaria sozinho sem ninguém tocar em
     * fato nenhum — o mesmo motivo pelo qual o detalhe congela a gerência.
     */
    const resumo = await app.prisma.vendaAreaMes.findMany({
      where: {
        gerenciaId: { in: escopo.gerenciaIds },
        OR: competencias.map((c) => ({ ano: c.ano, mes: c.mes })),
      },
      select: { ano: true, mes: true, areaVendaId: true, vendido: true, dias: true },
    })

    const metas = await app.prisma.meta.findMany({
      where: {
        escopo: 'AREA_VENDA',
        filialId: escopo.filialId,
        alvoId: { in: [...new Set(resumo.map((r) => r.areaVendaId))] },
        OR: competencias.map((c) => ({ ano: c.ano, mes: c.mes })),
      },
      select: { alvoId: true, ano: true, mes: true, valor: true },
    })
    const metaDe = new Map(metas.map((m) => [`${m.ano}-${m.mes}-${m.alvoId}`, Number(m.valor)]))

    /*
     * Vendedor: do RESUMO MENSAL, e não do detalhe.
     *
     * A primeira versão cruzava `vendedor_mes` com `fato_venda_vendedor` --
     * e o detalhe retém 60 dias, então a série tinha dois meses e dez
     * buracos. Pior: os buracos não eram visíveis como falta de dado, porque
     * `vendedor_mes` guarda a competência inteira; os meses velhos vinham com
     * denominador cheio e realizado zero, ou seja **0%**.
     *
     * `vendedor_area_mes` guarda a conta já feita, do mês em que o detalhe
     * ainda existia. Mês que nunca foi consolidado simplesmente não tem linha,
     * e vira `null` -- ausência, que é o que ele é.
     */
    /*
     * O MÊS CORRENTE ENTRA COMO PROJEÇÃO DE FECHAMENTO -- a MESMA medida do
     * cartão do topo, e não uma segunda.
     *
     * Assim as doze barras querem dizer uma coisa só: *fechamento contra a
     * meta do mês*, real nos meses fechados e projetado no corrente.
     *
     * A primeira versão comparava o realizado PARCIAL contra a meta rateada
     * pelos dias úteis. É uma medida legítima -- ritmo contra ritmo -- e era
     * OUTRA: no dia 3 de setembro a barra dizia 72% e o cartão logo acima
     * dizia 108%, para o mesmo mês. As duas coincidem apenas quando a
     * projeção do BI é linear por dia útil, e ela não é (medido: fator 15,0
     * contra 13,0 do linear).
     *
     * `fatorDeProjecao` é importada de `performance-vendas.ts`, a mesma que o
     * cartão usa: o número passa a ser igual POR CONSTRUÇÃO, e não por
     * coincidência de fórmula.
     *
     * Some também a dependência do calendário, e com ela a chance de o corte
     * do realizado e o do calendário apontarem para dias diferentes.
     */
    const corrente = competencias.find(
      (c) => c.ano === hoje.getUTCFullYear() && c.mes === hoje.getUTCMonth() + 1,
    )
    let fatorCorrente = 1
    if (corrente) {
      const indicadorId = await idDoIndicador(app.prisma, 'vendas')
      const de = new Date(Date.UTC(corrente.ano, corrente.mes - 1, 1))
      const ate = await ultimoDiaComDado('vendas-linha', escopo.filialId, corrente.ano, corrente.mes)
      const janela = { gte: de, ...(ate ? { lte: ate } : {}) }
      const [somaFilial, ultima] = await Promise.all([
        app.prisma.fatoVendas.aggregate({
          where: { filialId: escopo.filialId, indicadorId, data: janela },
          _sum: { valorReal: true },
        }),
        app.prisma.fatoVendas.findFirst({
          where: { filialId: escopo.filialId, indicadorId, data: janela },
          orderBy: { data: 'desc' },
          select: { tendencia: true },
        }),
      ])
      fatorCorrente = fatorDeProjecao(
        Number(somaFilial._sum.valorReal ?? 0),
        Number(ultima?.tendencia ?? 0),
      )
    }

    const resumoVendedor = await app.prisma.vendedorAreaMes.findMany({
      where: {
        gerenciaId: { in: escopo.gerenciaIds },
        OR: competencias.map((c) => ({ ano: c.ano, mes: c.mes })),
      },
      select: { ano: true, mes: true, aptos: true, naMeta: true },
    })

    const meses = competencias.map((c) => {
      const doMes = resumo.filter((r) => r.ano === c.ano && r.mes === c.mes)
      let vendido = 0
      let meta = 0
      let dias = 0
      for (const r of doMes) {
        vendido += Number(r.vendido)
        meta += metaDe.get(`${c.ano}-${c.mes}-${r.areaVendaId}`) ?? 0
        dias = Math.max(dias, r.dias)
      }

      /*
       * Soma numerador e denominador das áreas, NUNCA promedia percentuais
       * -- a mesma regra de `consolidarVendedor`. Promediar pesaria uma área
       * de 4 vendedores igual a uma de 18.
       */
      let aptos = 0
      let naMeta = 0
      for (const r of resumoVendedor.filter((r) => r.ano === c.ano && r.mes === c.mes)) {
        aptos += r.aptos
        naMeta += r.naMeta
      }

      const emCurso = c.ano === hoje.getUTCFullYear() && c.mes === hoje.getUTCMonth() + 1
      /*
       * O NUMERADOR do mês em curso é a projeção; nos fechados, o realizado.
       *
       * O denominador é sempre a meta do MÊS INTEIRO -- nada de ratear. Ver o
       * bloco de `fatorCorrente` acima.
       */
      const fechamento = emCurso ? vendido * fatorCorrente : vendido

      return {
        ano: c.ano,
        mes: c.mes,
        competencia: `${c.ano}-${String(c.mes).padStart(2, '0')}`,
        rotulo: `${MESES_CURTOS[c.mes - 1]}/${String(c.ano).slice(2)}`,
        emCurso,
        // Sem meta nao ha percentual, e nao e zero: e ausencia de alvo.
        vendas:
          meta > 0
            ? { percentual: (fechamento / meta) * 100, vendido: fechamento, meta, dias }
            : null,
        vendedor:
          aptos > 0 ? { percentual: (naMeta / aptos) * 100, naMeta, apurados: aptos } : null,
      }
    })

    return {
      meses,
      alcance: {
        vendas: meses.find((m) => m.vendas !== null)?.competencia ?? null,
        vendedor: meses.find((m) => m.vendedor !== null)?.competencia ?? null,
      },
    }
  }

  r.get(
    '/api/v1/gerencias/:gerenciaId/historico-mensal',
    {
      schema: {
        tags: ['Variáveis de controle'],
        summary: 'Série mensal de Performance Vendas e Performance Vendedor da gerência',
        params: z.object({ gerenciaId: z.string().uuid() }),
        querystring: z.object({
          /**
           * Quantos meses para trás, contando o corrente. DOZE por padrão: é o
           * ano móvel, e é o que a parede mostra.
           */
          meses: z.coerce.number().int().min(3).max(24).default(12),
          visaoNivel: z.string().optional(),
          visaoFilial: z.string().optional(),
        }),
        response: {
          200: z.object({
            gerencia: z.object({ id: z.string(), nome: z.string() }),
            meses: z.array(mesDoHistoricoSchema),
            /**
             * Até onde CADA série alcança. A tela precisa disso para dizer
             * "ainda não há histórico" em vez de desenhar um buraco.
             */
            alcance: z.object({
              vendas: z.string().nullable(),
              vendedor: z.string().nullable(),
            }),
          }),
          403: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (req) => {
      const usuario = await app.autenticar(req)
      const visao = await resolverVisao(app.prisma, usuario, {
        visaoNivel: req.query.visaoNivel,
        visaoFilial: req.query.visaoFilial,
      })

      const gerencia = await app.prisma.dimGerencia.findUnique({
        where: { id: req.params.gerenciaId },
        select: { id: true, nome: true, filialId: true },
      })
      if (!gerencia) throw new NaoEncontrado('Gerência não existe.')
      /*
       * O escopo vale aqui como em qualquer outra rota: quem tem filial só vê a
       * dela. Sem isto, o id de uma gerência de outra loja abriria o histórico
       * dela para quem soubesse o UUID.
       */
      if (visao.filialId && gerencia.filialId !== visao.filialId) {
        throw new NaoAutorizado('Esta gerência é de outra filial.')
      }

      const historico = await historicoMensalDe({
        filialId: gerencia.filialId,
        gerenciaIds: [gerencia.id],
        meses: req.query.meses,
      })

      return { gerencia: { id: gerencia.id, nome: gerencia.nome }, ...historico }
    },
  )

  /**
   * O MESMO histórico, no escopo da LOJA — os dois quadros da parede do N3.
   *
   * Soma as áreas de todas as gerências da filial. `historicoMensalDe` é a
   * mesma função da rota da gerência: o gráfico que o N4 apresenta é o gráfico
   * que o N3 vê somado, e uma segunda implementação divergiria no primeiro
   * ajuste feito num lado só.
   */
  r.get(
    '/api/v1/filiais/:filial/historico-mensal',
    {
      schema: {
        tags: ['Variáveis de controle'],
        summary: 'Série mensal de Performance Vendas e Performance Vendedor da loja',
        params: z.object({ filial: z.string() }),
        querystring: z.object({
          meses: z.coerce.number().int().min(3).max(24).default(12),
          visaoNivel: z.string().optional(),
          visaoFilial: z.string().optional(),
        }),
        response: {
          200: z.object({
            filial: z.object({ sigla: z.string(), nome: z.string() }),
            meses: z.array(mesDoHistoricoSchema),
            alcance: z.object({
              vendas: z.string().nullable(),
              vendedor: z.string().nullable(),
            }),
          }),
          403: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (req) => {
      const usuario = await app.autenticar(req)
      const visao = await resolverVisao(app.prisma, usuario, {
        visaoNivel: req.query.visaoNivel,
        visaoFilial: req.query.visaoFilial,
      })

      const filial = await app.prisma.filial.findFirst({
        where: { sigla: req.params.filial },
        select: { id: true, sigla: true, nome: true },
      })
      if (!filial) throw new NaoEncontrado('Filial não existe.')
      /* O mesmo escopo da rota da gerência: quem tem filial só vê a dela. */
      if (visao.filialId && filial.id !== visao.filialId) {
        throw new NaoAutorizado('Esta filial é outra.')
      }

      const gerencias = await app.prisma.dimGerencia.findMany({
        where: { filialId: filial.id },
        select: { id: true },
      })

      const historico = await historicoMensalDe({
        filialId: filial.id,
        gerenciaIds: gerencias.map((g) => g.id),
        meses: req.query.meses,
      })

      return { filial: { sigla: filial.sigla, nome: filial.nome }, ...historico }
    },
  )


}

import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { agora } from '../../lib/datas.js'
import { filtroDeFiliais, resolverVisao } from '../auth/escopo.js'
import {
  AGREGACAO,
  CALCULOS,
  casasDoIndicador,
  limiteDeMesesDaMeta,
  type Janela,
} from '../indicadores/calculos.js'
import { contarAbaixo, montarCelula, FAIXA_POR_INDICADOR } from '../indicadores/status.js'
import { consolidar } from '../indicadores/consolidado.js'

/** Matriz do quadro de indicadores — 4 indicadores × 9 filiais. */

// 'atencao' existe apenas em NPS: ate' 5 pontos abaixo da meta. Ver
// FAIXA_POR_INDICADOR em status.ts.
const situacaoEnum = z.enum(['otimo', 'acima', 'atencao', 'abaixo'])

const respostaSchema = z.object({
  periodo: z.object({
    modo: z.enum(['mes', 'ano']),
    ano: z.number().int(),
    mes: z.number().int().nullable(),
    rotulo: z.string(),
  }),
  filiais: z.array(z.object({ sigla: z.string(), nome: z.string() })),
  /**
   * O recorte com que a resposta foi montada.
   *
   * Vai na resposta porque o cliente **não pode presumir** que o recorte pedido
   * foi o aplicado: o servidor é quem decide, e uma tela que exibe o nível
   * escolhido a partir do próprio seletor mentiria no dia em que a validação
   * recusasse a escolha.
   */
  visao: z.object({
    nivel: z.enum(['N2', 'N3', 'N4']),
    filial: z.string().nullable(),
    /** Administrador vendo como outro nível. O front avisa em tela. */
    simulada: z.boolean(),
  }),
  indicadores: z.array(
    z.object({
      codigo: z.string(),
      nome: z.string(),
      unidade: z.string(),
      sentido: z.enum(['MAIOR_MELHOR', 'MENOR_MELHOR']),
      metaRotulo: z.string().nullable(),
      /** Casas decimais com que o valor deve ser exibido. Ver CASAS_DECIMAIS. */
      casasDecimais: z.number().int(),
      foraDaMeta: z.number().int(),
      /**
       * Alguma gerência acompanha variável de controle deste indicador.
       *
       * Falso = não existe reunião de N3 dele, e a célula da matriz não leva a
       * lugar nenhum (§7.63). Hoje só `vendas` é verdadeiro.
       */
      temReuniao: z.boolean(),
      /**
       * O número DA REDE, no recorte que a visão permite.
       *
       * `null` quando nenhuma filial tem dado. Ver `consolidar`: soma numerador
       * e denominador, e nunca promedia percentuais.
       */
      consolidado: z
        .object({
          valor: z.number().nullable(),
          meta: z.number().nullable(),
          desvio: z.number().nullable(),
          situacao: situacaoEnum.nullable(),
          /** Quantas filiais entraram na conta -- as que têm dado. */
          filiais: z.number().int(),
        })
        .nullable(),
      celulas: z.array(
        z.object({
          filial: z.string(),
          valor: z.number().nullable(),
          meta: z.number().nullable(),
          desvio: z.number().nullable(),
          situacao: situacaoEnum.nullable(),
        }),
      ),
    }),
  ),
})

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export async function painelRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  r.get(
    '/api/v1/painel',
    {
      schema: {
        tags: ['Indicadores'],
        summary: 'Matriz do quadro de indicadores',
        querystring: z.object({
          modo: z.enum(['mes', 'ano']).default('mes'),
          ano: z.coerce.number().int().min(2000).max(2100),
          mes: z.coerce.number().int().min(1).max(12).optional(),
          /**
           * Troca de visão — só o administrador. Validado em `resolverVisao`,
           * nunca aceito como veio: um N4 mandando `visaoNivel=N2` recebe 403,
           * não a resposta do próprio nível em silêncio.
           */
          visaoNivel: z.string().optional(),
          visaoFilial: z.string().optional(),
        }),
        response: { 200: respostaSchema, 403: z.object({ erro: z.string(), codigo: z.string(), requestId: z.string().optional() }) },
      },
    },
    async (req) => {
      const usuario = await app.autenticar(req)
      const { modo, ano, mes, visaoNivel, visaoFilial } = req.query

      const visao = await resolverVisao(app.prisma, usuario, { visaoNivel, visaoFilial })
      const janela = montarJanela(modo, ano, mes)

      const [filiais, indicadores] = await Promise.all([
        app.prisma.filial.findMany({
          // O filtro é sempre aplicado e às vezes não restringe nada — nos
          // níveis corporativos `filtroDeFiliais` devolve `{}`. Ver escopo.ts.
          where: { tipo: 'FILIAL', ativa: true, ...filtroDeFiliais(visao) },
          orderBy: { ordem: 'asc' },
        }),
        app.prisma.indicador.findMany({ orderBy: { ordem: 'asc' } }),
      ])

      /**
       * QUAIS INDICADORES TÊM REUNIÃO — os que alguma gerência acompanha.
       *
       * A célula da matriz abre a reunião do N3 daquela filial (§7.63), e só
       * faz sentido para o indicador que TEM reunião. Palavra do analista
       * (10/09/2026): *"não deveria ir pra lugar nenhum, pq não temos ainda GD
       * de NPS e GD de Perdas"*.
       *
       * Vem do SERVIDOR, e não de uma lista na tela: é a mesma pergunta que o
       * quadro do N3 responde com `gds` (§7.11) -- existe reunião quando existe
       * variável de controle vinculada a uma gerência. Cravar `['vendas']` no
       * front deixaria a matriz afirmando o contrário do N3 no dia em que NPS
       * fosse cadastrado, e ninguém iria lembrar de mexer aqui.
       *
       * Sem recorte de filial de propósito: o GD é do PORTAL, não da loja. Se
       * NPS existe em Centro e não no Recife, a célula do Recife continua
       * levando -- e a tela do N3 lá dirá que aquela loja não acompanha, que é
       * mais informativo do que uma célula morta sem explicação.
       */
      const comReuniao = new Set(
        (
          await app.prisma.gerenciaVariavel.findMany({
            select: { variavelControle: { select: { indicador: { select: { codigo: true } } } } },
          })
        ).map((v) => v.variavelControle.indicador.codigo),
      )

      const linhas = await Promise.all(
        indicadores.map(async (ind) => {
          const calcular = CALCULOS[ind.codigo]
          if (!calcular) throw new Error(`Sem cálculo definido para o indicador "${ind.codigo}"`)

          const valores = await calcular(app.prisma, janela)
          const metas = await metasDoPeriodo(app, ind.id, janela, AGREGACAO[ind.codigo] ?? 'RAZAO')

          const sentido = ind.sentido

          const celulas = filiais.map((f) => {
            const resultado = valores.get(f.id)
            const c = montarCelula(resultado?.valor ?? null, metas.get(f.id) ?? null, sentido, {
              ...(resultado?.desvio === undefined ? {} : { desvioDaOrigem: resultado.desvio }),
              casasDecimais: casasDoIndicador(ind.codigo),
              // Sem faixa definida, vale a regra binária. Ver status.ts.
              ...(FAIXA_POR_INDICADOR[ind.codigo] === undefined
                ? {}
                : { faixa: FAIXA_POR_INDICADOR[ind.codigo] }),
            })
            return { filial: f.sigla, ...c }
          })

          const situacoes = celulas.map((c) => c.situacao)
          return {
            consolidado: consolidar({
              agregacao: AGREGACAO[ind.codigo] ?? 'RAZAO',
              sentido,
              codigo: ind.codigo,
              itens: filiais.map((f) => ({
                resultado: valores.get(f.id) ?? null,
                meta: metas.get(f.id) ?? null,
              })),
            }),
            codigo: ind.codigo,
            nome: ind.nome,
            unidade: ind.unidade,
            sentido,
            metaRotulo: rotuloDaMeta(ind.codigo, metas, filiais),
            casasDecimais: casasDoIndicador(ind.codigo),
            foraDaMeta: contarAbaixo(situacoes),
            temReuniao: comReuniao.has(ind.codigo),
            celulas,
          }
        }),
      )

      return {
        periodo: {
          modo,
          ano,
          mes: modo === 'mes' ? (mes ?? null) : null,
          rotulo: modo === 'ano' ? `Ano inteiro · ${ano}` : `${MESES[(mes ?? 1) - 1]} de ${ano}`,
        },
        filiais: filiais.map((f) => ({ sigla: f.sigla, nome: f.nome })),
        visao: {
          nivel: visao.nivel,
          // Sigla, não UUID: é o que a tela mostra, e o id da filial não
          // significa nada para quem lê a resposta.
          filial: filiais.find((f) => f.id === visao.filialId)?.sigla ?? null,
          simulada: visao.simulada,
        },
        indicadores: linhas,
      }
    },
  )
}

function montarJanela(modo: 'mes' | 'ano', ano: number, mes?: number): Janela {
  if (modo === 'ano') {
    return {
      de: new Date(Date.UTC(ano, 0, 1)),
      ate: new Date(Date.UTC(ano, 11, 31)),
      ano,
    }
  }
  const m = mes ?? 1
  return {
    de: new Date(Date.UTC(ano, m - 1, 1)),
    // Dia 0 do mês seguinte = último dia deste mês, sem tabela de dias.
    ate: new Date(Date.UTC(ano, m, 0)),
    ano,
    mes: m,
  }
}

/**
 * Meta do período por filial.
 *
 * A meta é agregada com a MESMA aritmética do indicador: soma para Vendas
 * (medida que acumula), média para os indicadores que são razão — cujas metas
 * mensais são iguais, então a média devolve o próprio alvo. Agregar meta e
 * realizado de formas diferentes produziria desvio sem significado.
 */
async function metasDoPeriodo(
  app: FastifyInstance,
  indicadorId: string,
  janela: Janela,
  agregacao: 'SOMA' | 'RAZAO',
): Promise<Map<string, number>> {
  const metas = await app.prisma.meta.findMany({
    where: {
      escopo: 'INDICADOR',
      alvoId: indicadorId,
      ano: janela.ano,
      // Mesma regra do drill-down: no anual do ano corrente, só os decorridos.
      ...(janela.mes === undefined
        ? { mes: limiteDeMesesDaMeta(janela, agora()) }
        : { mes: janela.mes }),
    },
  })

  const porFilial = new Map<string, number[]>()
  for (const m of metas) {
    const lista = porFilial.get(m.filialId) ?? []
    lista.push(Number(m.valor))
    porFilial.set(m.filialId, lista)
  }

  return new Map(
    [...porFilial].map(([filialId, valores]) => [
      filialId,
      agregacao === 'SOMA'
        ? valores.reduce((a, b) => a + b, 0)
        : valores.reduce((a, b) => a + b, 0) / valores.length,
    ]),
  )
}

/** "meta 80" · "meta 4,0%" — subtítulo da primeira coluna da matriz. */
function rotuloDaMeta(
  codigo: string,
  metas: Map<string, number>,
  filiais: Array<{ id: string }>,
): string | null {
  const valores = filiais.map((f) => metas.get(f.id)).filter((v): v is number => v !== undefined)
  if (valores.length === 0) return null

  // Vendas tem meta distinta por filial — não há um rótulo único que sirva.
  const todasIguais = valores.every((v) => v === valores[0])
  if (!todasIguais) return null

  const valor = valores[0]!
  if (codigo === 'nps') return `meta ${valor}`
  return `meta ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { agora } from '../../lib/datas.js'
import { NaoAutorizado, NaoEncontrado } from '../../lib/erros.js'
import { valorParaY, yDaMeta, type AncoraEixo } from '../../lib/escala.js'
import { desvioPercentual } from '../../lib/percentual.js'
import { filtroDeFiliais, resolverVisao } from '../auth/escopo.js'
import { consolidar } from './consolidado.js'
import {
  AGREGACAO,
  CALCULOS,
  casasDoIndicador,
  limiteDeMesesDaMeta,
  type Janela,
} from './calculos.js'
import { montarSerie } from './serie.js'
import { montarCelula, FAIXA_POR_INDICADOR } from './status.js'

/** Drill-down de um indicador numa filial — handoff seção "3". */

const ancoraSchema = z.object({
  valor: z.number(),
  rotulo: z.string(),
  y: z.number(),
  meta: z.boolean().optional(),
})

/** As quatro situações que a célula e o ponto do gráfico compartilham. */
const situacaoDoPonto = z.enum(['otimo', 'acima', 'atencao', 'abaixo']).nullable()

const respostaSchema = z.object({
  indicador: z.object({
    codigo: z.string(),
    nome: z.string(),
    unidade: z.string(),
    sentido: z.enum(['MAIOR_MELHOR', 'MENOR_MELHOR']),
    /** Casas decimais com que o valor deve ser exibido. Ver CASAS_DECIMAIS. */
    casasDecimais: z.number().int(),
  }),
  filial: z.object({ sigla: z.string(), nome: z.string() }),
  periodo: z.object({
    modo: z.enum(['mes', 'ano']),
    ano: z.number().int(),
    mes: z.number().int().nullable(),
    rotulo: z.string(),
  }),
  /** Cards do cabeçalho. */
  realizado: z.number().nullable(),
  meta: z.number().nullable(),
  desvio: z.number().nullable(),
  // 'atencao' existe apenas em NPS: ate' 5 pontos abaixo da meta. Ver
  // FAIXA_POR_INDICADOR em status.ts.
  situacao: z.enum(['otimo', 'acima', 'atencao', 'abaixo']).nullable(),
  /** Aderência = realizado sobre meta, em %. */
  aderencia: z.number().nullable(),
  grafico: z.object({
    /**
     * A escala que a série TEM — semanal dentro do mês, ou mensal no ano.
     *
     * Vai na resposta porque quem decide é aqui: o pedido, o indicador (Custo
     * não tem semana) e o `escala` da query entram na conta. A tela re-derivava
     * essa regra para escrever o rótulo, e duas cópias de uma decisão já
     * fizeram painel e gráfico discordarem sobre o mesmo mês neste projeto.
     */
    escala: z.enum(['semanal', 'mensal']),
    /** Vendas plota desvio; os demais plotam o próprio valor. */
    plota: z.enum(['desvio', 'valor']),
    escalaY: z.array(ancoraSchema),
    yMeta: z.number(),
    pontos: z.array(
      z.object({
        rotulo: z.string(),
        valor: z.number().nullable(),
        valorIndicador: z.number().nullable(),
        /** Desvio do ponto sobre a meta do período, para o rótulo discreto. */
        desvio: z.number().nullable(),
        /**
         * O FAROL DAQUELE PONTO, com a mesma regra da célula da matriz.
         *
         * Vem daqui, e não de um `desvio >= 0` no gráfico: em Perdas, que é
         * MENOR_MELHOR, abaixo da meta é BOM, e o sinal sozinho pintaria o mês
         * bom de vermelho. NPS ainda tem faixa de atenção. Calcular no
         * frontend seria a terceira cópia de uma regra que já mora em
         * `montarCelula`.
         */
        situacao: situacaoDoPonto,
        y: z.number().nullable(),
        de: z.string(),
        ate: z.string(),
      }),
    ),
  }),
  variaveis: z.array(
    z.object({ id: z.string().uuid(), nome: z.string(), unidade: z.string() }),
  ),
})

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export async function indicadorRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  r.get(
    '/api/v1/indicadores/:codigo/:filial',
    {
      schema: {
        tags: ['Indicadores'],
        summary: 'Desdobramento de um indicador numa filial',
        params: z.object({ codigo: z.string(), filial: z.string() }),
        querystring: z.object({
          modo: z.enum(['mes', 'ano']).default('mes'),
          ano: z.coerce.number().int().min(2000).max(2100),
          mes: z.coerce.number().int().min(1).max(12).optional(),
          /**
           * Força a série MENSAL do ano, mesmo com o período em mês.
           *
           * É o gráfico do quadro do N2: ali a pergunta é a trajetória do ano,
           * e não as semanas do mês corrente — essa é a leitura da reunião do
           * N3 e do N4, que têm tela própria.
           */
          escala: z.enum(['auto', 'mensal']).default('auto'),
          /** Troca de visão — só o administrador. Ver escopo.ts. */
          visaoNivel: z.string().optional(),
          visaoFilial: z.string().optional(),
        }),
        response: {
          200: respostaSchema,
          403: z.object({ erro: z.string(), codigo: z.string(), requestId: z.string().optional() }),
        },
      },
    },
    async (req) => {
      const usuario = await app.autenticar(req)
      const { codigo, filial: sigla } = req.params
      const { modo, ano, mes, escala, visaoNivel, visaoFilial } = req.query

      const visao = await resolverVisao(app.prisma, usuario, { visaoNivel, visaoFilial })

      const [indicador, filial] = await Promise.all([
        app.prisma.indicador.findUnique({ where: { codigo } }),
        app.prisma.filial.findUnique({ where: { sigla } }),
      ])
      if (!indicador) throw new NaoEncontrado(`Indicador "${codigo}"`)
      if (!filial) throw new NaoEncontrado(`Filial "${sigla}"`)

      /**
       * A filial vem no CAMINHO, então o escopo não pode ser um filtro de
       * consulta — tem de ser uma recusa. Um N4 que trocasse a sigla na URL
       * veria a filial de outro, e a tela nem precisaria oferecer o link.
       *
       * 403 e não 404: dizer "não existe" para uma filial que existe é mentira
       * que atrapalha o suporte. Quem tenta já sabe que a filial existe — o que
       * ele não tem é acesso.
       */
      if (visao.filialId !== null && visao.filialId !== filial.id) {
        throw new NaoAutorizado(
          `Sua visão é da filial da sua lotação. "${sigla}" não é ela.`,
        )
      }

      const janela = montarJanela(modo, ano, mes)
      const sentido = indicador.sentido
      const escalaY = indicador.escalaY as unknown as AncoraEixo[]

      const calcular = CALCULOS[codigo]
      if (!calcular) throw new NaoEncontrado(`Cálculo do indicador "${codigo}"`)

      const [valores, meta] = await Promise.all([
        calcular(app.prisma, janela),
        metaDoPeriodo(app, indicador.id, filial.id, janela, AGREGACAO[codigo] ?? 'RAZAO'),
      ])

      const resultado = valores.get(filial.id)
      const celula = montarCelula(resultado?.valor ?? null, meta, sentido, {
        ...(resultado?.desvio === undefined ? {} : { desvioDaOrigem: resultado.desvio }),
        casasDecimais: casasDoIndicador(codigo),
        // Sem faixa definida, vale a regra binária. Ver status.ts.
        ...(FAIXA_POR_INDICADOR[codigo] === undefined
          ? {}
          : { faixa: FAIXA_POR_INDICADOR[codigo] }),
      })

      // Custo é mensal: não existe série semanal, então o gráfico sempre mostra
      // os 12 meses do ano. Repetir o valor mensal em 4 barras desenharia uma
      // estabilidade que não foi medida.
      //
      // `escala: 'mensal'` força o mesmo para qualquer indicador — é o que o
      // quadro do N2 pede.
      const modoGrafico = codigo === 'custo' || escala === 'mensal' ? undefined : janela.mes

      const metasPorMes = await metasDoAnoPorMes(app, indicador.id, filial.id, ano)

      const pontos = await montarSerie({
        prisma: app.prisma,
        filialIds: [filial.id],
        codigo,
        metasPorMes,
        ano,
        ...(modoGrafico === undefined ? {} : { mes: modoGrafico }),
      })

      /*
       * `ativo: true` -- só as variáveis que o GD acompanha (§7.43).
       *
       * Sem o filtro a tela oferecia cinco chips em Vendas, três deles do
       * handoff: sem fato, sem ação, e sem ninguém que as acompanhe. Clicar
       * neles não levava a lugar nenhum, e a lista misturando o que existe com
       * o que foi exemplo faz alguém escolher o exemplo.
       */
      const variaveis = await app.prisma.variavelControle.findMany({
        where: { indicadorId: indicador.id, ativo: true },
        orderBy: { ordem: 'asc' },
        select: { id: true, nome: true, unidade: true },
      })

      return {
        indicador: {
          codigo: indicador.codigo,
          nome: indicador.nome,
          unidade: indicador.unidade,
          casasDecimais: casasDoIndicador(codigo),
          sentido,
        },
        filial: { sigla: filial.sigla, nome: filial.nome },
        periodo: {
          modo,
          ano,
          mes: modo === 'mes' ? (mes ?? null) : null,
          rotulo: modo === 'ano' ? `Ano inteiro · ${ano}` : `${MESES[(mes ?? 1) - 1]} de ${ano}`,
        },
        realizado: celula.valor,
        meta,
        desvio: celula.desvio,
        situacao: celula.situacao,
        aderencia:
          celula.valor === null || meta === null || meta === 0
            ? null
            : Number(((celula.valor / meta) * 100).toFixed(1)),
        grafico: {
          escala: modoGrafico === undefined ? ('mensal' as const) : ('semanal' as const),
          plota: codigo === 'vendas' ? ('desvio' as const) : ('valor' as const),
          escalaY,
          yMeta: yDaMeta(escalaY),
          pontos: pontos.map((p) => ({
            ...p,
            // Desvio de cada ponto contra a meta DO MÊS do ponto, não a do
            // período. No modo anual a meta do período é a soma dos 12 meses:
            // comparar a tendência de um mês com ela dava −92% em toda a série,
            // e o gráfico anual ficava sem significado.
            desvio: desvioDoPonto(p.valorIndicador, metasPorMes.get(Number(p.de.slice(5, 7)))),
            // O farol do ponto pela MESMA função da célula. Ver o schema.
            situacao: montarCelula(
              p.valorIndicador,
              metasPorMes.get(Number(p.de.slice(5, 7))) ?? null,
              sentido,
              {
                casasDecimais: casasDoIndicador(codigo),
                ...(FAIXA_POR_INDICADOR[codigo] === undefined
                  ? {}
                  : { faixa: FAIXA_POR_INDICADOR[codigo] }),
              },
            ).situacao,
            y: p.valor === null ? null : Number(valorParaY(p.valor, escalaY).toFixed(2)),
          })),
        },
        variaveis,
      }
    },
  )

  /**
   * O MESMO desdobramento, no escopo da REDE — o chip "Visão geral" do N2.
   *
   * Soma as filiais que a visão permite: numerador e denominador de cada ponto
   * da série, nunca a média das séries. Uma loja de R$ 13 mi não pode pesar
   * igual a uma de R$ 50 mi, e é a mesma regra que o consolidado da faixa e o
   * rolo da gerência já seguem.
   *
   * Rota separada, e não `:filial = "todas"`: uma sigla reservada no caminho é
   * uma armadilha para o dia em que alguém cadastrar uma filial com esse nome,
   * e o erro seria silencioso — a rota devolveria a rede achando que devolvia
   * uma loja.
   */
  r.get(
    '/api/v1/indicadores/:codigo/consolidado/rede',
    {
      schema: {
        tags: ['Indicadores'],
        summary: 'Desdobramento de um indicador somando as filiais da visão',
        params: z.object({ codigo: z.string() }),
        querystring: z.object({
          modo: z.enum(['mes', 'ano']).default('mes'),
          ano: z.coerce.number().int().min(2000).max(2100),
          mes: z.coerce.number().int().min(1).max(12).optional(),
          /** Ver a rota da filial: força a série mensal do ano. */
          escala: z.enum(['auto', 'mensal']).default('auto'),
          visaoNivel: z.string().optional(),
          visaoFilial: z.string().optional(),
        }),
        response: {
          200: respostaSchema,
          403: z.object({ erro: z.string(), codigo: z.string(), requestId: z.string().optional() }),
        },
      },
    },
    async (req) => {
      const usuario = await app.autenticar(req)
      const { codigo } = req.params
      const { modo, ano, mes, escala, visaoNivel, visaoFilial } = req.query

      const visao = await resolverVisao(app.prisma, usuario, { visaoNivel, visaoFilial })

      const indicador = await app.prisma.indicador.findUnique({ where: { codigo } })
      if (!indicador) throw new NaoEncontrado(`Indicador "${codigo}"`)

      /*
       * As filiais do ESCOPO, e não todas: quem tem visão de uma loja recebe a
       * "rede" dela, que é ela mesma. Sem o filtro, o N4 veria o total da
       * empresa por uma rota que a tela dele oferece.
       */
      const filiais = await app.prisma.filial.findMany({
        where: { tipo: 'FILIAL', ativa: true, ...filtroDeFiliais(visao) },
        orderBy: { ordem: 'asc' },
        select: { id: true },
      })
      if (filiais.length === 0) throw new NaoEncontrado('Nenhuma filial na sua visão')

      const janela = montarJanela(modo, ano, mes)
      const sentido = indicador.sentido
      const escalaY = indicador.escalaY as unknown as AncoraEixo[]
      const agregacao = AGREGACAO[codigo] ?? 'RAZAO'

      const calcular = CALCULOS[codigo]
      if (!calcular) throw new NaoEncontrado(`Cálculo do indicador "${codigo}"`)

      const valores = await calcular(app.prisma, janela)
      const metasPorFilial = await Promise.all(
        filiais.map(async (f) => ({
          resultado: valores.get(f.id) ?? null,
          meta: await metaDoPeriodo(app, indicador.id, f.id, janela, agregacao),
        })),
      )

      /* A MESMA função da faixa do quadro: os dois números não têm como divergir. */
      const rede = consolidar({ agregacao, sentido, codigo, itens: metasPorFilial })
      const meta = rede?.meta ?? null

      const modoGrafico = codigo === 'custo' || escala === 'mensal' ? undefined : janela.mes

      /*
       * A meta de cada mês some as metas das filiais quando o indicador é SOMA,
       * e pondera pelo peso de cada uma quando é razão -- a mesma regra do
       * `consolidar`, aplicada mês a mês para a série.
       *
       * Com a mesma meta em todas as filiais, o caso de hoje em NPS e Perdas, a
       * ponderação devolve exatamente essa meta.
       */
      const porFilialPorMes = await Promise.all(
        filiais.map((f) => metasDoAnoPorMes(app, indicador.id, f.id, ano)),
      )
      const metasPorMes = new Map<number, number>()
      for (let m = 1; m <= 12; m++) {
        const doMes = porFilialPorMes.map((x) => x.get(m)).filter((v) => v !== undefined)
        if (doMes.length === 0) continue
        metasPorMes.set(
          m,
          agregacao === 'SOMA'
            ? doMes.reduce((a, v) => a + v, 0)
            : doMes.reduce((a, v) => a + v, 0) / doMes.length,
        )
      }

      const pontos = await montarSerie({
        prisma: app.prisma,
        filialIds: filiais.map((f) => f.id),
        codigo,
        metasPorMes,
        ano,
        ...(modoGrafico === undefined ? {} : { mes: modoGrafico }),
      })

      const variaveis = await app.prisma.variavelControle.findMany({
        where: { indicadorId: indicador.id, ativo: true },
        orderBy: { ordem: 'asc' },
        select: { id: true, nome: true, unidade: true },
      })

      return {
        indicador: {
          codigo: indicador.codigo,
          nome: indicador.nome,
          unidade: indicador.unidade,
          casasDecimais: casasDoIndicador(codigo),
          sentido,
        },
        /*
         * `sigla` é o que o título do gráfico mostra -- "Vendas · 9 filiais ·
         * mensal em 2026".
         *
         * O QUE O NÚMERO É, e não o nome do botão que o selecionou. Chegou a ser
         * "REDE" e depois "Visão geral", e as duas repetiam o chip marcado ao
         * lado sem acrescentar nada -- enquanto "9 filiais" diz de quantas
         * lojas aquela linha é a soma, que é a única dúvida que sobra ao olhar
         * o gráfico.
         */
        filial: {
          sigla: filiais.length === 1 ? 'a sua filial' : `${filiais.length} filiais`,
          nome: filiais.length === 1 ? 'a filial da sua visão' : `${filiais.length} filiais somadas`,
        },
        periodo: {
          modo,
          ano,
          mes: modo === 'mes' ? (mes ?? null) : null,
          rotulo: modo === 'ano' ? `Ano inteiro · ${ano}` : `${MESES[(mes ?? 1) - 1]} de ${ano}`,
        },
        realizado: rede?.valor ?? null,
        meta,
        desvio: rede?.desvio ?? null,
        situacao: rede?.situacao ?? null,
        aderencia:
          rede?.valor == null || meta === null || meta === 0
            ? null
            : Number(((rede.valor / meta) * 100).toFixed(1)),
        grafico: {
          escala: modoGrafico === undefined ? ('mensal' as const) : ('semanal' as const),
          plota: codigo === 'vendas' ? ('desvio' as const) : ('valor' as const),
          escalaY,
          yMeta: yDaMeta(escalaY),
          pontos: pontos.map((p) => ({
            ...p,
            // Desvio de cada ponto contra a meta DO MÊS do ponto, não a do
            // período. No modo anual a meta do período é a soma dos 12 meses:
            // comparar a tendência de um mês com ela dava −92% em toda a série,
            // e o gráfico anual ficava sem significado.
            desvio: desvioDoPonto(p.valorIndicador, metasPorMes.get(Number(p.de.slice(5, 7)))),
            // O farol do ponto pela MESMA função da célula. Ver o schema.
            situacao: montarCelula(
              p.valorIndicador,
              metasPorMes.get(Number(p.de.slice(5, 7))) ?? null,
              sentido,
              {
                casasDecimais: casasDoIndicador(codigo),
                ...(FAIXA_POR_INDICADOR[codigo] === undefined
                  ? {}
                  : { faixa: FAIXA_POR_INDICADOR[codigo] }),
              },
            ).situacao,
            y: p.valor === null ? null : Number(valorParaY(p.valor, escalaY).toFixed(2)),
          })),
        },
        variaveis,
      }
    },
  )
}

function montarJanela(modo: 'mes' | 'ano', ano: number, mes?: number): Janela {
  if (modo === 'ano') {
    return { de: new Date(Date.UTC(ano, 0, 1)), ate: new Date(Date.UTC(ano, 11, 31)), ano }
  }
  const m = mes ?? 1
  return {
    de: new Date(Date.UTC(ano, m - 1, 1)),
    ate: new Date(Date.UTC(ano, m, 0)),
    ano,
    mes: m,
  }
}

/**
 * Metas do ano indexadas por mês.
 *
 * O gráfico precisa da meta de cada ponto, não a do período: no modo anual, a
 * meta do período é a soma dos 12 meses, e comparar um mês contra ela produz
 * desvio de −90% em toda a série.
 */
async function metasDoAnoPorMes(
  app: FastifyInstance,
  indicadorId: string,
  filialId: string,
  ano: number,
): Promise<Map<number, number>> {
  const metas = await app.prisma.meta.findMany({
    where: { escopo: 'INDICADOR', alvoId: indicadorId, filialId, ano },
    select: { mes: true, valor: true },
  })
  return new Map(metas.map((m) => [m.mes, Number(m.valor)]))
}

/** Desvio de um ponto, nulo quando falta valor ou meta. */
function desvioDoPonto(valor: number | null, meta: number | undefined): number | null {
  if (valor === null || meta === undefined || meta === 0) return null
  return Number(desvioPercentual(valor, meta).toFixed(2))
}

async function metaDoPeriodo(
  app: FastifyInstance,
  indicadorId: string,
  filialId: string,
  janela: Janela,
  agregacao: 'SOMA' | 'RAZAO',
): Promise<number | null> {
  const metas = await app.prisma.meta.findMany({
    where: {
      escopo: 'INDICADOR',
      alvoId: indicadorId,
      filialId,
      ano: janela.ano,
      // Mês específico, ou — no anual do ano corrente — só os meses decorridos.
      ...(janela.mes === undefined
        ? { mes: limiteDeMesesDaMeta(janela, agora()) }
        : { mes: janela.mes }),
    },
  })
  if (metas.length === 0) return null

  const valores = metas.map((m) => Number(m.valor))
  return agregacao === 'SOMA'
    ? valores.reduce((a, b) => a + b, 0)
    : valores.reduce((a, b) => a + b, 0) / valores.length
}

import type { PrismaClient } from '@prisma/client'
import { desvioPercentual, razao } from '../../lib/percentual.js'
import { agora } from '../../lib/datas.js'
import { ehMesCorrente, mesesDoAno, semanasDoMes } from '../../lib/semanas.js'

/**
 * Série do gráfico de evolução.
 *
 * Cada ponto agrega um intervalo (uma semana no modo mês, um mês no modo ano)
 * e o valor plotado depende do indicador:
 *
 * - **Vendas, semanal** → fotografia: a `tendencia` do primeiro dia útil da
 *   semana, convertida em desvio sobre a meta do mês. É o que o eixo Y do
 *   handoff mostra (`+10% … −20%`).
 * - **Vendas, mensal** → realizado do mês nos meses FECHADOS, tendência no mês
 *   CORRENTE, sempre contra a meta do mês. Cada ponto responde "como esse mês
 *   terminou (ou vai terminar)".
 * - **Demais** → o próprio valor do indicador no intervalo, recalculado sobre
 *   os totais (nunca a média das razões diárias).
 *
 * O mês corrente é a exceção deliberada: comparar acumulado parcial com a meta
 * do mês inteiro dava −45% no dia 19 de 31, enquanto o painel mostrava −11% para
 * a mesma filial e mês. Dois números para o mesmo fato, em telas diferentes.
 */

export interface PontoSerie {
  rotulo: string
  /** Valor plotado: desvio % em Vendas, valor do indicador nos demais. */
  valor: number | null
  /** Valor do indicador, para o rótulo da pílula. */
  valorIndicador: number | null
  de: string
  ate: string
}

interface Contexto {
  prisma: PrismaClient
  /**
   * UMA OU VÁRIAS filiais — a série de uma loja, ou a da rede.
   *
   * O consolidado NÃO é a média das séries: cada ponto soma numerador e
   * denominador das filiais e só então divide. Ver `valorNoIntervalo`, onde
   * cada indicador diz como se soma — e onde dois deles não podem usar `in`.
   */
  filialIds: string[]
  codigo: string
  /**
   * Meta de cada mês do ano, indexada por 1–12.
   *
   * Por mês, não do período: no modo anual a meta do período é a soma dos 12
   * meses, e comparar a tendência de um mês contra ela dava −92% em toda a
   * série. Para intervalos semanais todos caem no mesmo mês, então o resultado
   * é o mesmo de antes.
   */
  metasPorMes: Map<number, number>
  ano: number
  /** Ausente no modo ano. */
  mes?: number
}

interface Intervalo {
  rotulo: string
  de: Date
  ate: Date
}

function intervalos(ano: number, mes?: number): Intervalo[] {
  if (mes === undefined) return mesesDoAno(ano)
  return semanasDoMes(ano, mes)
}

export async function montarSerie(ctx: Contexto): Promise<PontoSerie[]> {
  const lista = intervalos(ctx.ano, ctx.mes)

  return Promise.all(
    lista.map(async (i) => {
      const valorIndicador = await valorNoIntervalo(ctx, i)
      const metaDoMes = ctx.metasPorMes.get(i.de.getUTCMonth() + 1) ?? null
      const valor =
        ctx.codigo === 'vendas'
          ? valorIndicador === null || metaDoMes === null || metaDoMes === 0
            ? null
            : desvioPercentual(valorIndicador, metaDoMes)
          : valorIndicador

      return {
        rotulo: i.rotulo,
        valor,
        valorIndicador,
        de: i.de.toISOString().slice(0, 10),
        ate: i.ate.toISOString().slice(0, 10),
      }
    }),
  )
}

async function valorNoIntervalo(ctx: Contexto, i: Intervalo): Promise<number | null> {
  const { prisma } = ctx
  const filialId = { in: ctx.filialIds }
  const janela = { data: { gte: i.de, lte: i.ate } }

  switch (ctx.codigo) {
    case 'vendas': {
      // No modo semanal o ponto é uma FOTOGRAFIA, não média: a tendência
      // registrada num dia, lida como ela era naquele dia. Média de tendências
      // mistura previsões feitas em momentos diferentes — a de segunda projeta
      // de 1 dia de venda, a de sexta de 5 — e o resultado não corresponde a
      // nenhum instante real.
      //
      // QUAL dia depende de a semana já ter fechado:
      //
      //  - **semana passada** → o PRIMEIRO dia útil dela. É a leitura que a
      //    reunião faz: como a projeção estava quando a semana começou.
      //    "Primeiro dia útil" resolve o recuo sozinho — se segunda não tem
      //    registro (feriado, loja fechada), a busca cai em terça, e assim até
      //    sexta. Sábado e domingo ficam fora de propósito: são dias atípicos e
      //    distorceriam a projeção.
      //
      //  - **semana CORRENTE** → o ÚLTIMO dia com registro. A projeção de
      //    segunda-feira, lida numa quinta, é de três dias de venda atrás — e
      //    era o que a tela mostrava. Na semana em curso o que interessa é onde
      //    a projeção está agora. Decisão do analista (28/08/2026).
      /*
       * A ESCOLHA DO DIA É POR FILIAL, e por isso aqui não cabe um `in`.
       *
       * Cada loja tem o próprio "primeiro dia útil com registro" — uma abre na
       * segunda, outra só tem lançamento na terça. Um `findFirst` sobre as nove
       * pegaria UMA tendência, de UMA loja, e a chamaria de rede.
       *
       * Escolhe o dia em cada filial, e só então soma. Com uma filial só, é
       * exatamente o que era antes.
       */
      if (ctx.mes !== undefined) {
        const emCurso = i.de <= agora() && agora() <= i.ate

        const sexta = new Date(i.de)
        sexta.setUTCDate(sexta.getUTCDate() + 4)

        const porFilial = await Promise.all(
          ctx.filialIds.map((id) =>
            prisma.fatoVendas.findFirst({
              where: emCurso
                ? { filialId: id, ...janela }
                : { filialId: id, data: { gte: i.de, lte: sexta } },
              orderBy: { data: emCurso ? 'desc' : 'asc' },
              select: { tendencia: true },
            }),
          ),
        )

        const comDado = porFilial.filter((r) => r !== null)
        return comDado.length === 0 ? null : comDado.reduce((a, r) => a + Number(r.tendencia), 0)
      }

      // No modo anual: realizado nos meses FECHADOS, tendência no mês CORRENTE.
      //
      // Mês fechado já tem valor de verdade, e projeção sobre fato consumado
      // não acrescenta nada. Mas o mês em curso tem acumulado parcial: medido,
      // CEN aparecia com −45,4% no dia 19 de 31, contra −11,33% no painel — dois
      // números para o mesmo mês em telas diferentes. A tendência é a estimativa
      // de fechamento, então cada ponto passa a ser "como esse mês deve terminar".
      // Mesma razão do bloco acima: a última tendência é de CADA filial.
      if (ehMesCorrente(i.de.getUTCFullYear(), i.de.getUTCMonth() + 1, agora())) {
        const porFilial = await Promise.all(
          ctx.filialIds.map((id) =>
            prisma.fatoVendas.findFirst({
              where: { filialId: id, ...janela },
              orderBy: { data: 'desc' },
              select: { tendencia: true },
            }),
          ),
        )
        const comDado = porFilial.filter((r) => r !== null)
        return comDado.length === 0 ? null : comDado.reduce((a, r) => a + Number(r.tendencia), 0)
      }

      const r = await prisma.fatoVendas.aggregate({
        where: { filialId, ...janela },
        _sum: { valorReal: true },
      })
      return r._sum.valorReal === null ? null : Number(r._sum.valorReal)
    }

    case 'nps': {
      const r = await prisma.fatoNps.aggregate({
        where: { filialId, ...janela },
        _sum: { qtdPromotores: true, qtdNeutros: true, qtdDetratores: true },
      })
      const p = r._sum.qtdPromotores ?? 0
      const n = r._sum.qtdNeutros ?? 0
      const d = r._sum.qtdDetratores ?? 0
      const q = razao(p - d, p + n + d)
      return q === null ? null : q * 100
    }

    case 'perdas': {
      const [perda, mov] = await Promise.all([
        prisma.fatoPerdas.aggregate({
          where: { filialId, status: 'APROVADA', ...janela },
          _sum: { valor: true },
        }),
        prisma.fatoMovimentacao.aggregate({ where: { filialId, ...janela }, _sum: { valor: true } }),
      ])
      const q = razao(Number(perda._sum.valor ?? 0), Number(mov._sum.valor ?? 0))
      return q === null ? null : q * 100
    }

    case 'custo': {
      // Custo é mensal: no modo mês não há série semanal, e o gráfico exibe a
      // série anual. Aqui só o intervalo que corresponde a um mês tem valor.
      const mesDoIntervalo = i.de.getUTCMonth() + 1
      const anoDoIntervalo = i.de.getUTCFullYear()
      /*
       * SÓ AS FILIAIS QUE JÁ FECHARAM entram, e dos DOIS lados da razão.
       *
       * Custo é lançado no fechamento, e nem toda loja fecha no mesmo dia.
       * Somar o custo de quem fechou sobre o faturamento de TODAS daria um
       * percentual diluído — numerador de três lojas sobre denominador de nove
       * — e ele subiria sozinho conforme as outras fossem fechando, sem que
       * custo nenhum tivesse mudado.
       */
      const custos = await prisma.fatoCusto.findMany({
        // `findMany` e nao `findUnique`: a chave unica passou a incluir o
        // indicador, e aqui o custo do periodo e' um so' POR FILIAL. Filtrar
        // por codigo evita resolver o id do indicador so' para esta leitura.
        where: {
          filialId,
          ano: anoDoIntervalo,
          mes: mesDoIntervalo,
          indicador: { codigo: 'custo' },
        },
        select: { filialId: true, valor: true },
      })
      if (custos.length === 0) return null

      const vendas = await prisma.fatoVendas.aggregate({
        where: {
          filialId: { in: custos.map((c) => c.filialId) },
          data: {
            gte: new Date(Date.UTC(anoDoIntervalo, mesDoIntervalo - 1, 1)),
            lte: new Date(Date.UTC(anoDoIntervalo, mesDoIntervalo, 0)),
          },
        },
        _sum: { valorReal: true },
      })
      const q = razao(
        custos.reduce((a, c) => a + Number(c.valor), 0),
        Number(vendas._sum.valorReal ?? 0),
      )
      return q === null ? null : q * 100
    }

    default:
      return null
  }
}

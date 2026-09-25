import type { PrismaClient } from '@prisma/client'
import { agora } from '../../lib/datas.js'
import { razao } from '../../lib/percentual.js'
import { ehMesCorrente } from '../../lib/semanas.js'

/**
 * Cálculo dos quatro indicadores a partir das tabelas fato.
 *
 * Duas regras que valem para todos e não podem ser violadas:
 *
 * 1. **Guardar cru, calcular na leitura.** O banco tem promotores/detratores,
 *    perda e movimentação — nunca o percentual pronto. Percentual gravado não
 *    pode ser reagregado para outro período.
 *
 * 2. **Razão se recalcula sobre os totais.** Perdas do mês é
 *    `Σ perda / Σ movimentação`, jamais a média das razões diárias — senão um
 *    domingo de movimento baixo pesa igual a um sábado cheio.
 */

export interface Janela {
  de: Date
  ate: Date
  ano: number
  /** 1–12 no modo mês; ausente no modo ano. */
  mes?: number
}

/** Como a meta do período é agregada — a mesma aritmética do indicador. */
export type Agregacao = 'SOMA' | 'RAZAO'

/**
 * Meses que entram na agregação da meta do período.
 *
 * No modo anual do ano CORRENTE, apenas os decorridos. Somar as 12 metas contra
 * um realizado de 8 meses dava −85% de desvio sem nada estar errado — o mesmo
 * erro de comparar parcial com total que já apareceu no mês.
 *
 * Ano fechado entra inteiro, e no modo mês o filtro já é o próprio mês.
 */
export function limiteDeMesesDaMeta(janela: Janela, hoje: Date): { lte: number } | Record<string, never> {
  if (janela.mes !== undefined) return {}
  if (janela.ano !== hoje.getFullYear()) return {}
  return { lte: hoje.getMonth() + 1 }
}

export const AGREGACAO: Record<string, Agregacao> = {
  vendas: 'SOMA',
  nps: 'RAZAO',
  perdas: 'RAZAO',
  custo: 'RAZAO',
}

/**
 * Casas decimais com que cada indicador é EXIBIDO.
 *
 * O desvio é calculado sobre o valor já arredondado para esta precisão, e não
 * sobre o valor bruto. Motivo: a tela mostra `3,5%` contra meta `4,0%`; quem
 * conferir a conta chega a −13%. Se o desvio viesse do valor bruto
 * (3,50012… por causa do arredondamento diário na origem), sairia −12% — e o
 * painel contradiria a própria aritmética, num número que a diretoria confere
 * de cabeça.
 *
 * Ou seja: os números da tela precisam ser consistentes entre si, mesmo que
 * isso custe um décimo de precisão no desvio.
 */
export const CASAS_DECIMAIS: Record<string, number> = {
  vendas: 0,
  nps: 0,
  // Duas casas, e não uma como o handoff sugeria: o valor real de Perdas gira em
  // torno de 0,2%, não dos 4-6% do mockup. Com uma casa, CEN variando de 0,06% a
  // 0,33% ao longo do ano aparecia como `0,1 / 0,3 / 0,2 / 0,2` — quatro meses
  // diferentes no mesmo número, e a variação que o indicador existe para mostrar
  // desaparecia no arredondamento.
  perdas: 2,
  custo: 1,
}

/**
 * A precisão vai na RESPOSTA da API, e o frontend obedece.
 *
 * Antes ela existia duas vezes: aqui e num `switch` do `formatarValorIndicador`.
 * Duas cópias de uma constante de formatação já produziram painel e gráfico
 * discordando sobre o mesmo mês, e é a terceira vez neste projeto que uma
 * definição duplicada custa caro. Servindo o número, não há como divergirem.
 */
export function casasDoIndicador(codigo: string): number {
  return CASAS_DECIMAIS[codigo] ?? 1
}

/**
 * Resultado por filial.
 *
 * `desvio` só vem preenchido quando a **origem** o fornece — hoje apenas Vendas
 * no mês vigente, onde o `delta_meta` é calculado no Oracle sobre a tendência.
 * Nos demais casos fica indefinido e o desvio é derivado de valor × meta.
 */
export interface Resultado {
  /** `null` quando não há dado — nunca 0, que significaria "medimos e deu zero". */
  valor: number | null
  desvio?: number
  /**
   * As DUAS PARTES da razão, quando o indicador é uma.
   *
   * Existem para o CONSOLIDADO das filiais. Perdas é `perdas / movimento` e NPS
   * é `(promotores − detratores) / respondentes`: somar os nove percentuais e
   * dividir por nove pesaria uma loja de R$ 13 mi igual a uma de R$ 50 mi, e o
   * número da diretoria deixaria de ser o da rede.
   *
   * É a mesma regra que o rolo da gerência e o da loja já seguem: soma
   * numerador e denominador, nunca promedia percentuais.
   *
   * Ausente em `vendas`, que é SOMA e não razão — ali o consolidado é a soma
   * dos valores.
   */
  partes?: { numerador: number; denominador: number }
}

export type ValoresPorFilial = Map<string, Resultado>

/**
 * Vendas tem três regras distintas, conforme o período:
 *
 * - **Mês vigente** → último `tendencia` e `delta_meta` do mês (o do dia mais
 *   recente). É previsão de fechamento contra meta de mês cheio, então valor e
 *   desvio descrevem a mesma coisa e podem ser conferidos um pelo outro.
 * - **Mês fechado** → `Σ valor_real` do mês; o desvio sai da meta, porque não
 *   há mais o que prever.
 * - **Ano** → `Σ valor_real` do ano, mesma lógica de mês fechado.
 */
export async function calcularVendas(
  prisma: PrismaClient,
  janela: Janela,
): Promise<ValoresPorFilial> {
  if (janela.mes !== undefined && ehMesCorrente(janela.ano, janela.mes, agora())) {
    return ultimaTendenciaPorFilial(prisma, janela)
  }

  const linhas = await prisma.fatoVendas.groupBy({
    by: ['filialId'],
    where: { data: { gte: janela.de, lte: janela.ate } },
    _sum: { valorReal: true },
  })

  return new Map(
    linhas.map((l) => [
      l.filialId,
      { valor: l._sum.valorReal === null ? null : Number(l._sum.valorReal) },
    ]),
  )
}

/**
 * Último registro do mês por filial — a tendência e o delta vigentes.
 *
 * Um `groupBy` não serve aqui: precisamos da linha inteira do dia mais recente,
 * não de uma agregação. `DISTINCT ON` do Postgres resolve numa varredura só,
 * em vez de N consultas (uma por filial).
 */
async function ultimaTendenciaPorFilial(
  prisma: PrismaClient,
  janela: Janela,
): Promise<ValoresPorFilial> {
  const linhas = await prisma.$queryRaw<
    Array<{ filial_id: string; tendencia: unknown; delta_meta: unknown }>
  >`
    SELECT DISTINCT ON (filial_id) filial_id, tendencia, delta_meta
    FROM fato_venda
    WHERE data BETWEEN ${janela.de} AND ${janela.ate}
    ORDER BY filial_id, data DESC
  `

  return new Map(
    linhas.map((l) => [
      l.filial_id,
      {
        valor: Number(l.tendencia),
        // Sem delta da origem, o campo é omitido e quem chama calcula o desvio
        // a partir da meta cadastrada. `null` viraria desvio zero, que seria
        // lido como "está exatamente na meta" — o oposto de "não informado".
        ...(l.delta_meta === null ? {} : { desvio: Number(l.delta_meta) }),
      },
    ]),
  )
}

export async function calcularNps(prisma: PrismaClient, janela: Janela): Promise<ValoresPorFilial> {
  const linhas = await prisma.fatoNps.groupBy({
    by: ['filialId'],
    where: { data: { gte: janela.de, lte: janela.ate } },
    _sum: { qtdPromotores: true, qtdNeutros: true, qtdDetratores: true },
  })

  return new Map(
    linhas.map((l) => {
      const p = l._sum.qtdPromotores ?? 0
      const n = l._sum.qtdNeutros ?? 0
      const d = l._sum.qtdDetratores ?? 0
      const r = razao(p - d, p + n + d)
      return [
        l.filialId,
        { valor: r === null ? null : r * 100, partes: { numerador: p - d, denominador: p + n + d } },
      ]
    }),
  )
}

export async function calcularPerdas(
  prisma: PrismaClient,
  janela: Janela,
): Promise<ValoresPorFilial> {
  const [perdas, movimentacao] = await Promise.all([
    prisma.fatoPerdas.groupBy({
      by: ['filialId'],
      // Só APROVADA entra. Uma quebra PENDENTE que vira APROVADA meses depois
      // altera um dia já fechado — por isso a janela de recarga de Perdas é
      // de 2 anos, e não de 60 dias como as demais fontes.
      where: { status: 'APROVADA', data: { gte: janela.de, lte: janela.ate } },
      _sum: { valor: true },
    }),
    prisma.fatoMovimentacao.groupBy({
      by: ['filialId'],
      where: { data: { gte: janela.de, lte: janela.ate } },
      _sum: { valor: true },
    }),
  ])

  const mov = new Map(movimentacao.map((m) => [m.filialId, Number(m._sum.valor ?? 0)]))

  return new Map(
    perdas.map((p) => {
      const numerador = Number(p._sum.valor ?? 0)
      const denominador = mov.get(p.filialId) ?? 0
      const r = razao(numerador, denominador)
      return [p.filialId, { valor: r === null ? null : r * 100, partes: { numerador, denominador } }]
    }),
  )
}

/**
 * Custo % = custo / faturamento, com faturamento = Σ fato_vendas do período.
 *
 * Como o denominador vem de Vendas, uma falha na carga de Vendas corrompe dois
 * indicadores — e o de Custo sem sintoma, porque o numerador dele carregou
 * normalmente. Por isso o selo "ATUALIZADO" usa a mais antiga das duas fontes.
 *
 * Custo é mensal e só existe após o fechamento: no mês corrente devolve `null`,
 * e a célula mostra `—`. Exibir o mês anterior sob o cabeçalho do mês corrente
 * colocaria quatro indicadores em períodos diferentes sem nada avisando.
 */
export async function calcularCusto(
  prisma: PrismaClient,
  janela: Janela,
): Promise<ValoresPorFilial> {
  const filtroMes =
    janela.mes === undefined
      ? { ano: janela.ano }
      : { ano: janela.ano, mes: janela.mes }

  const [custos, vendas] = await Promise.all([
    prisma.fatoCusto.groupBy({ by: ['filialId'], where: filtroMes, _sum: { valor: true } }),
    // Faturamento é o REALIZADO, nunca a tendência: custo é um número contábil
    // fechado, e dividi-lo por uma previsão daria um percentual que muda quando
    // a previsão muda, sem nada ter acontecido no custo.
    prisma.fatoVendas.groupBy({
      by: ['filialId'],
      where: { data: { gte: janela.de, lte: janela.ate } },
      _sum: { valorReal: true },
    }),
  ])

  const faturamento = new Map(vendas.map((v) => [v.filialId, Number(v._sum.valorReal ?? 0)]))

  return new Map(
    custos.map((c) => {
      const numerador = Number(c._sum.valor ?? 0)
      const denominador = faturamento.get(c.filialId) ?? 0
      const r = razao(numerador, denominador)
      return [c.filialId, { valor: r === null ? null : r * 100, partes: { numerador, denominador } }]
    }),
  )
}

export const CALCULOS: Record<
  string,
  (prisma: PrismaClient, janela: Janela) => Promise<ValoresPorFilial>
> = {
  vendas: calcularVendas,
  nps: calcularNps,
  perdas: calcularPerdas,
  custo: calcularCusto,
}

import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import { semanasDoMes } from '../../src/lib/semanas.js'

/**
 * A série semanal de Vendas é FOTOGRAFIA, não média.
 *
 * Média de tendências mistura previsões feitas em momentos diferentes — a de
 * segunda projeta de 1 dia de venda, a de sexta de 5 — e o número não
 * corresponde a nenhum instante real.
 *
 * **Qual dia depende de a semana já ter fechado:**
 *
 *  - semana passada → o PRIMEIRO dia útil dela;
 *  - semana CORRENTE → o ÚLTIMO dia com registro.
 *
 * Os testes montam semanas com valores propositalmente distintos por dia, para
 * que média e fotografia não possam coincidir por acaso.
 */

let app: FastifyInstance
const prisma = new PrismaClient()

/** Semana isolada em 2025, longe do mês corrente que outros testes conferem. */
const ANO = 2025
const MES = 4
let semana: { de: Date; ate: Date }
let filialId = ''
let syncId = ''
let indicadorId = ''
let backup: Array<{
  data: Date
  valorReal: unknown
  tendencia: unknown
  deltaMeta: unknown
  indicadorId: string
}> = []

const dia = (base: Date, n: number) => {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + n)
  return d
}

beforeAll(async () => {
  app = await buildApp()
  await app.ready()

  const f = await prisma.filial.findUniqueOrThrow({ where: { sigla: 'CEN' } })
  filialId = f.id
  const s = await prisma.syncExecucao.findFirstOrThrow({ orderBy: { iniciadoEm: 'desc' } })
  syncId = s.id
  indicadorId = (await prisma.indicador.findUniqueOrThrow({ where: { codigo: 'vendas' } })).id

  semana = semanasDoMes(ANO, MES)[1]! // segunda semana do mês
  backup = await prisma.fatoVendas.findMany({
    where: { filialId, data: { gte: semana.de, lte: semana.ate } },
    select: { data: true, valorReal: true, tendencia: true, deltaMeta: true, indicadorId: true },
  })
})

afterAll(async () => {
  await prisma.fatoVendas.deleteMany({
    where: { filialId, data: { gte: semana.de, lte: semana.ate } },
  })
  if (backup.length > 0) {
    await prisma.fatoVendas.createMany({
      data: backup.map((b) => ({
        filialId,
        data: b.data,
        valorReal: b.valorReal as never,
        tendencia: b.tendencia as never,
        deltaMeta: b.deltaMeta as never,
        indicadorId: b.indicadorId,
        syncId,
      })),
    })
  }
  await prisma.$disconnect()
  await app.close()
})

/** Reescreve a semana com um valor por dia e devolve o ponto da série. */
async function comSemana(valoresPorDiaDaSemana: Record<number, number>) {
  await prisma.fatoVendas.deleteMany({
    where: { filialId, data: { gte: semana.de, lte: semana.ate } },
  })
  await prisma.fatoVendas.createMany({
    data: Object.entries(valoresPorDiaDaSemana).map(([offset, tendencia]) => ({
      filialId,
      data: dia(semana.de, Number(offset)),
      valorReal: 1000,
      tendencia,
      indicadorId,
      deltaMeta: null,
      syncId,
    })),
  })

  const r = await app.inject({
    method: 'GET',
    url: `/api/v1/indicadores/vendas/CEN?modo=mes&ano=${ANO}&mes=${MES}`,
  })
  expect(r.statusCode, r.body).toBe(200)
  const pontos = r.json().grafico.pontos
  return pontos.find((p: { rotulo: string }) => p.rotulo === 'Sem 2')
}

describe('série semanal de Vendas', () => {
  it('usa a segunda-feira quando ela existe', async () => {
    // Valores muito diferentes: qualquer média cairia longe de 10.000.000.
    const p = await comSemana({ 0: 10_000_000, 1: 20_000_000, 2: 30_000_000, 3: 40_000_000, 4: 50_000_000 })
    expect(p.valorIndicador).toBe(10_000_000)
  })

  it('recua para terça quando segunda não tem registro', async () => {
    const p = await comSemana({ 1: 22_000_000, 2: 30_000_000, 3: 40_000_000 })
    expect(p.valorIndicador).toBe(22_000_000)
  })

  it('recua até sexta se for o único dia útil com registro', async () => {
    const p = await comSemana({ 4: 44_000_000 })
    expect(p.valorIndicador).toBe(44_000_000)
  })

  it('IGNORA sábado e domingo — são dias atípicos', async () => {
    // Só fim de semana tem registro: o ponto fica sem valor, e não pega o
    // sábado. Se a regra olhasse a semana inteira, viria 99.000.000.
    const p = await comSemana({ 5: 99_000_000, 6: 98_000_000 })
    expect(p.valorIndicador).toBeNull()
  })

  it('não é média: o valor é exatamente o do dia escolhido', async () => {
    const valores = { 0: 12_000_000, 1: 13_000_000, 2: 14_000_000, 3: 15_000_000, 4: 16_000_000 }
    const media = Object.values(valores).reduce((a, b) => a + b, 0) / 5
    const p = await comSemana(valores)

    expect(p.valorIndicador).toBe(12_000_000)
    expect(p.valorIndicador).not.toBe(media)
  })

  it('semana sem nenhum registro fica sem ponto', async () => {
    const p = await comSemana({})
    expect(p.valorIndicador).toBeNull()
    expect(p.y).toBeNull()
  })
})

/**
 * O gráfico anual e o painel não podem discordar sobre o mesmo mês.
 *
 * Já discordaram: o gráfico usava o realizado acumulado e mostrava −45% para
 * agosto, enquanto o painel usava a tendência e mostrava −11%. Dois números
 * para o mesmo fato, em telas diferentes — e nenhuma pista de qual estava certo.
 */
/**
 * **A semana CORRENTE usa o dia vigente**, e não o primeiro dia útil dela.
 *
 * A projeção de segunda-feira, lida numa quinta, é de três dias de venda atrás
 * — e era o que a tela mostrava. Na semana em curso o que interessa é onde a
 * projeção está agora. Decisão do analista (28/08/2026).
 *
 * O teste escreve na semana de HOJE, então ele restaura o que havia: os testes
 * de painel leem o mês corrente da mesma filial.
 */
describe('a semana corrente', () => {
  const hoje = new Date()
  const anoAtual = hoje.getUTCFullYear()
  const mesAtual = hoje.getUTCMonth() + 1
  let daSemana: { numero: number; de: Date; ate: Date } | undefined
  let anterior: Array<{ data: Date; valorReal: unknown; tendencia: unknown; deltaMeta: unknown }> = []

  beforeAll(async () => {
    daSemana = semanasDoMes(anoAtual, mesAtual).find((w) => hoje >= w.de && hoje <= w.ate)
    if (!daSemana) return
    anterior = await prisma.fatoVendas.findMany({
      where: { filialId, indicadorId, data: { gte: daSemana.de, lte: daSemana.ate } },
      select: { data: true, valorReal: true, tendencia: true, deltaMeta: true },
    })
  })

  afterAll(async () => {
    if (!daSemana) return
    await prisma.fatoVendas.deleteMany({
      where: { filialId, indicadorId, data: { gte: daSemana.de, lte: daSemana.ate } },
    })
    if (anterior.length > 0) {
      await prisma.fatoVendas.createMany({
        data: anterior.map((b) => ({
          filialId,
          indicadorId,
          syncId,
          data: b.data,
          valorReal: b.valorReal as never,
          tendencia: b.tendencia as never,
          deltaMeta: b.deltaMeta as never,
        })),
      })
    }
  })

  it('pega o ÚLTIMO registro, não o primeiro dia útil', async () => {
    if (!daSemana) return // Hoje caiu num dia fora de semana (1º num sábado).

    /*
     * Segunda vale 10 milhões e o último dia com registro vale 90. A regra
     * antiga devolveria 10 -- e é justamente essa a diferença que se quer ver.
     */
    const ate = hoje < daSemana.ate ? hoje : daSemana.ate
    const dias: Array<{ data: Date; tendencia: number }> = []
    for (const d = new Date(daSemana.de); d <= ate; d.setUTCDate(d.getUTCDate() + 1)) {
      dias.push({ data: new Date(d), tendencia: 10_000_000 + dias.length * 20_000_000 })
    }
    if (dias.length < 2) return // Semana com um dia só não distingue as regras.

    await prisma.fatoVendas.deleteMany({
      where: { filialId, indicadorId, data: { gte: daSemana.de, lte: daSemana.ate } },
    })
    await prisma.fatoVendas.createMany({
      data: dias.map((x) => ({
        filialId,
        indicadorId,
        syncId,
        data: x.data,
        valorReal: 1000,
        tendencia: x.tendencia,
        deltaMeta: null,
      })),
    })

    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/indicadores/vendas/CEN?modo=mes&ano=${String(anoAtual)}&mes=${String(mesAtual)}`,
    })
    expect(r.statusCode, r.body).toBe(200)
    const ponto = r.json().grafico.pontos.find(
      (p: { rotulo: string }) => p.rotulo === `Sem ${String(daSemana!.numero)}`,
    )

    const ultimo = dias[dias.length - 1]!.tendencia
    const primeiro = dias[0]!.tendencia
    expect(ponto?.valorIndicador).toBe(ultimo)
    expect(ponto?.valorIndicador).not.toBe(primeiro)
  })
})

describe('mês corrente: gráfico anual concorda com o painel', () => {
  it('o ponto do mês corrente é igual à célula do painel', async () => {
    const hoje = new Date()
    const ano = hoje.getFullYear()
    const mes = hoje.getMonth() + 1

    const [anual, painel] = await Promise.all([
      app.inject({ method: 'GET', url: `/api/v1/indicadores/vendas/CEN?modo=ano&ano=${ano}` }),
      app.inject({ method: 'GET', url: `/api/v1/painel?modo=mes&ano=${ano}&mes=${mes}` }),
    ])
    expect(anual.statusCode).toBe(200)
    expect(painel.statusCode).toBe(200)

    const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
    const ponto = anual
      .json()
      .grafico.pontos.find((p: { rotulo: string }) => p.rotulo === MESES_ABREV[mes - 1])
    const celula = painel
      .json()
      .indicadores.find((i: { codigo: string }) => i.codigo === 'vendas')
      .celulas.find((c: { filial: string }) => c.filial === 'CEN')

    if (celula.valor === null) return // sem dado no mês: nada a comparar

    // Comparado em reais inteiros: o painel arredonda o valor para a precisão
    // exibida antes de calcular o desvio (regra de montarCelula), enquanto o
    // gráfico guarda o valor cru. A diferença é de centavos e é intencional —
    // o que não pode divergir é a medida e o desvio.
    expect(Math.round(ponto.valorIndicador)).toBe(Math.round(celula.valor))
    expect(ponto.desvio).toBeCloseTo(celula.desvio, 1)
  })
})

import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import { desvioPercentual } from '../../src/lib/percentual.js'

/**
 * A checagem de coerência do `deltaMeta`.
 *
 * Os três erros que ela existe para pegar não geram exceção nenhuma: a carga
 * entra, o painel fica errado e ninguém percebe. São todos plausíveis com uma
 * medida `%GAP` vinda do Power BI.
 *
 * Requer banco semeado.
 */

let app: FastifyInstance
const prisma = new PrismaClient()
const TOKEN = process.env.INGEST_TOKEN ?? ''

/** Janela isolada, longe do mês corrente que os testes da matriz conferem. */
const DIA = '2025-05-14'

let metaGus = 0
let vendasAntes: Array<{
  data: Date
  valorReal: unknown
  tendencia: unknown
  deltaMeta: unknown
  indicadorId: string
}> = []
let filialGus = ''

beforeAll(async () => {
  app = await buildApp()
  await app.ready()

  const gus = await prisma.filial.findUniqueOrThrow({ where: { sigla: 'CEN' } })
  filialGus = gus.id
  const vendas = await prisma.indicador.findUniqueOrThrow({ where: { codigo: 'vendas' } })
  const meta = await prisma.meta.findUniqueOrThrow({
    where: {
      escopo_alvoId_filialId_ano_mes: {
        escopo: 'INDICADOR',
        alvoId: vendas.id,
        filialId: gus.id,
        ano: 2025,
        mes: 5,
      },
    },
  })
  metaGus = Number(meta.valor)

  vendasAntes = await prisma.fatoVendas.findMany({
    where: { filialId: gus.id, data: new Date(`${DIA}T00:00:00Z`) },
    select: { data: true, valorReal: true, tendencia: true, deltaMeta: true, indicadorId: true },
  })
})

afterAll(async () => {
  // Restaura a linha original para não corromper o seed dos outros testes.
  if (vendasAntes.length > 0) {
    const sync = await prisma.syncExecucao.findFirstOrThrow({ orderBy: { iniciadoEm: 'desc' } })
    await prisma.fatoVendas.deleteMany({
      where: { filialId: filialGus, data: new Date(`${DIA}T00:00:00Z`) },
    })
    await prisma.fatoVendas.createMany({
      data: vendasAntes.map((v) => ({
        filialId: filialGus,
        data: v.data,
        valorReal: v.valorReal as never,
        tendencia: v.tendencia as never,
        deltaMeta: v.deltaMeta as never,
        indicadorId: v.indicadorId,
        syncId: sync.id,
      })),
    })
  }
  await prisma.$disconnect()
  await app.close()
})

/** Tendência propositalmente distante da meta, para o delta ser expressivo. */
const TENDENCIA = () => metaGus * 0.87

function enviar(deltaMeta: number) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/ingest/vendas',
    headers: { 'x-ingest-token': TOKEN },
    payload: {
      periodo: { de: DIA, ate: DIA },
      linhas: [
        { filial: 'CEN', data: DIA, valorReal: 10_000, tendencia: TENDENCIA(), deltaMeta },
      ],
    },
  })
}

describe('coerência entre deltaMeta e tendencia', () => {
  it('aceita o delta correto', async () => {
    const correto = desvioPercentual(TENDENCIA(), metaGus)
    const r = await enviar(correto)
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json().avisos).toEqual([])
  })

  it('RECUSA delta em fração decimal e aponta a causa', async () => {
    // O erro clássico: Power BI guarda -0,13 e exibe -13%.
    const emFracao = desvioPercentual(TENDENCIA(), metaGus) / 100
    const r = await enviar(emFracao)

    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/FRAÇÃO/i)
    expect(r.json().erro).toMatch(/multiplique por 100/i)
  })

  it('RECUSA delta com o sinal invertido e aponta a causa', async () => {
    // "GAP" costuma ser meta − realizado, o oposto do que o portal espera.
    const invertido = -desvioPercentual(TENDENCIA(), metaGus)
    const r = await enviar(invertido)

    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/SINAL/i)
  })

  it('RECUSA delta calculado sobre outra base', async () => {
    // Medida comparando o realizado acumulado, não a tendência.
    const r = await enviar(desvioPercentual(10_000, metaGus))
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/TENDÊNCIA/i)
  })

  it('a carga recusada não grava nada', async () => {
    const antes = await prisma.fatoVendas.count({
      where: { filialId: filialGus, data: new Date(`${DIA}T00:00:00Z`) },
    })
    await enviar(desvioPercentual(TENDENCIA(), metaGus) / 100)
    const depois = await prisma.fatoVendas.count({
      where: { filialId: filialGus, data: new Date(`${DIA}T00:00:00Z`) },
    })
    expect(depois).toBe(antes)
  })

  it('divergência isolada passa com aviso; a maioria divergindo derruba', async () => {
    // A distinção é entre ruído em algumas linhas e a medida da origem
    // calculando outra coisa. Com uma linha só não existe "minoria" — por isso
    // o cenário precisa de várias.
    const certo = desvioPercentual(TENDENCIA(), metaGus)
    const dias = ['2025-05-12', '2025-05-13', '2025-05-14', '2025-05-15']

    const enviarLote = (deltas: number[]) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/ingest/vendas',
        headers: { 'x-ingest-token': TOKEN },
        payload: {
          periodo: { de: dias[0]!, ate: dias[3]! },
          linhas: dias.map((data, i) => ({
            filial: 'CEN',
            data,
            valorReal: 10_000,
            tendencia: TENDENCIA(),
            deltaMeta: deltas[i]!,
          })),
        },
      })

    // 1 de 4 divergente (25%) → passa, com aviso.
    const minoria = await enviarLote([certo, certo, certo, certo + 9])
    expect(minoria.statusCode, minoria.body).toBe(200)
    expect(minoria.json().avisos.length).toBeGreaterThan(0)
    expect(minoria.json().avisos[0]).toMatch(/divergente/i)

    // 3 de 4 divergentes (75%) → sistemático, recusa.
    const maioria = await enviarLote([certo, certo + 9, certo + 9, certo + 9])
    expect(maioria.statusCode).toBe(422)
  })

  it('sem meta cadastrada, avisa em vez de recusar', async () => {
    // O fluxo de metas pode simplesmente ainda não ter rodado — não é erro.
    const semMeta = '2024-05-14'
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/vendas',
      headers: { 'x-ingest-token': TOKEN },
      payload: {
        periodo: { de: semMeta, ate: semMeta },
        linhas: [
          { filial: 'CEN', data: semMeta, valorReal: 1, tendencia: 1, deltaMeta: 999 },
        ],
      },
    })
    expect(r.statusCode).toBe(200)
    expect(r.json().avisos[0]).toMatch(/nenhuma meta/i)
  })
})

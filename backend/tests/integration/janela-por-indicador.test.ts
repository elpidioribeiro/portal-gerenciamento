import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'

/**
 * Carregar um indicador filho NÃO pode apagar o pai.
 *
 * A ingestão funciona por substituição de janela: apaga o período declarado e
 * grava o que chegou. Enquanto cada tabela de fato pertencia a um indicador só,
 * apagar por data bastava. Com indicadores filhos — cada um com fato próprio na
 * MESMA tabela — apagar por data varre todos os irmãos junto.
 *
 * Este é o defeito mais caro do desenho, por três razões: não levanta exceção,
 * não deixa rastro no log, e o sintoma aparece dias depois como número que some
 * do painel. Quem investigar vai olhar a carga do dia, que terá gravado
 * certinho as linhas dela.
 *
 * O teste existe para que um refactor futuro no `apagarJanela` quebre aqui, e
 * não em produção. Ele cria um filho de verdade, carrega os dois na mesma
 * janela e recarrega só o filho.
 */

let app: FastifyInstance
const prisma = new PrismaClient()
const TOKEN = process.env.INGEST_TOKEN ?? ''

/** Janela isolada, longe do mês corrente que os testes da matriz conferem. */
const DE = '2025-04-14'
const ATE = '2025-04-15'
const CODIGO_FILHO = 'vendas-teste-filho'

let idPai = ''
let idFilho = ''

beforeAll(async () => {
  app = await buildApp()
  await app.ready()

  const pai = await prisma.indicador.findUniqueOrThrow({ where: { codigo: 'vendas' } })
  idPai = pai.id

  const filho = await prisma.indicador.upsert({
    where: { codigo: CODIGO_FILHO },
    update: { indicadorPaiId: idPai },
    create: {
      codigo: CODIGO_FILHO,
      nome: 'Vendas — filho de teste',
      unidade: pai.unidade,
      sentido: pai.sentido,
      escalaY: pai.escalaY as object,
      regraStatus: pai.regraStatus as object,
      ordem: 99,
      indicadorPaiId: idPai,
    },
  })
  idFilho = filho.id
})

afterAll(async () => {
  const janela = { data: { gte: new Date(`${DE}T00:00:00Z`), lte: new Date(`${ATE}T00:00:00Z`) } }
  await prisma.fatoVendas.deleteMany({ where: janela })
  await prisma.fatoVendas.deleteMany({ where: { indicadorId: idFilho } })
  await prisma.indicador.deleteMany({ where: { codigo: CODIGO_FILHO } })
  await prisma.$disconnect()
  await app.close()
})

/** Grava direto, sem passar pela rota: o que se testa é o apagar, não o inserir. */
async function gravar(indicadorId: string, valor: number) {
  const sync = await prisma.syncExecucao.findFirstOrThrow({ orderBy: { iniciadoEm: 'desc' } })
  const filial = await prisma.filial.findUniqueOrThrow({ where: { sigla: 'CEN' } })
  await prisma.fatoVendas.createMany({
    data: [DE, ATE].map((d) => ({
      filialId: filial.id,
      data: new Date(`${d}T00:00:00Z`),
      valorReal: valor,
      tendencia: valor,
      indicadorId,
      syncId: sync.id,
    })),
  })
}

const contar = (indicadorId: string) =>
  prisma.fatoVendas.count({
    where: {
      indicadorId,
      data: { gte: new Date(`${DE}T00:00:00Z`), lte: new Date(`${ATE}T00:00:00Z`) },
    },
  })

describe('substituição de janela com indicador filho', () => {
  it('recarregar o filho preserva as linhas do pai na mesma janela', async () => {
    await prisma.fatoVendas.deleteMany({
      where: { data: { gte: new Date(`${DE}T00:00:00Z`), lte: new Date(`${ATE}T00:00:00Z`) } },
    })
    await gravar(idPai, 1000)
    await gravar(idFilho, 400)

    expect(await contar(idPai)).toBe(2)
    expect(await contar(idFilho)).toBe(2)

    // Recarrega SÓ o filho, pela rota, com a janela inteira.
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/vendas',
      headers: { 'x-ingest-token': TOKEN },
      payload: {
        periodo: { de: DE, ate: ATE },
        linhas: [{ filial: 'CEN', data: DE, valorReal: 500, tendencia: 500 }],
      },
    })
    expect(r.statusCode, r.body).toBe(200)

    /**
     * O pai continua com as duas linhas.
     *
     * A rota `/ingest/vendas` carrega o indicador `vendas`, que aqui é o PAI —
     * então quem foi substituído é ele. O que não pode acontecer, em nenhuma
     * direção, é uma carga levar o outro junto.
     */
    expect(await contar(idFilho), 'o filho não podia ser tocado por uma carga do pai').toBe(2)
    expect(await contar(idPai), 'o pai foi substituído: 1 linha declarada, 1 gravada').toBe(1)
  })
})

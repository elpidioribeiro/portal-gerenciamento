import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { atualizarResumoVendedor, competenciasDaJanela } from '../../src/modules/ingestao/resumo-vendedor.js'
import { exigirSeed } from '../helpers/seed.js'

/**
 * O resumo mensal de Performance Vendedor.
 *
 * O que ele existe para impedir: `fato_venda_vendedor` retém 60 dias, e sem o
 * realizado não há "bateu a meta". Um mês velho recalculado depois do expurgo
 * daria realizado zero para todo mundo e o indicador desabaria para **0%** --
 * sem erro, com número plausível na tela. Por isso o que se guarda é a conta
 * já feita, e por isso existe a trava contra encolher.
 */

await exigirSeed()

const prisma = new PrismaClient()

const ANO = 2024
const MES = 7

let filialId: string
let gerenciaId: string
let areaId: string
let vendedores: string[] = []
let syncId: string

const linha = async () =>
  prisma.vendedorAreaMes.findUnique({
    where: { filialId_areaVendaId_ano_mes: { filialId, areaVendaId: areaId, ano: ANO, mes: MES } },
  })

/** Um vendedor com cota, situação e (opcionalmente) venda em N dias. */
async function vendedor(
  i: number,
  p: { meta: number; realizadoPorDia: number; dias: number; sitafa?: number; houveVenda?: 'SEM_VENDA' | 'COM_VENDA' },
) {
  const v = await prisma.dimVendedor.create({
    data: {
      filialId,
      codVendedor: `TST-RV-${i}`,
      nome: `VENDEDOR TESTE ${i}`,
      areaVendaId: areaId,
    },
    select: { id: true },
  })
  vendedores.push(v.id)

  await prisma.vendedorMes.create({
    data: {
      filialId,
      vendedorId: v.id,
      ano: ANO,
      mes: MES,
      meta: p.meta,
      sitafa: p.sitafa ?? 1,
      houveVenda: p.houveVenda ?? 'COM_VENDA',
      syncId,
    },
  })

  for (let d = 1; d <= p.dias; d++) {
    await prisma.fatoVendaVendedor.create({
      data: {
        filialId,
        data: new Date(Date.UTC(ANO, MES - 1, d)),
        vendedorId: v.id,
        valor: p.realizadoPorDia,
        syncId,
      },
    })
  }
  return v.id
}

beforeAll(async () => {
  const f = await prisma.filial.findFirstOrThrow({ select: { id: true } })
  filialId = f.id

  const g = await prisma.dimGerencia.create({
    data: { filialId, nome: 'GERENCIA RESUMO VENDEDOR' },
    select: { id: true },
  })
  const a = await prisma.dimAreaVenda.create({
    data: { filialId, nome: 'AREA RESUMO VENDEDOR', cdArea: 'TST-RV', gerenciaId: g.id },
    select: { id: true },
  })
  gerenciaId = g.id
  areaId = a.id

  const s = await prisma.syncExecucao.create({
    data: {
      fonte: 'vendedor-dia',
      status: 'SUCESSO',
      periodoDe: new Date(Date.UTC(ANO, MES - 1, 1)),
      periodoAte: new Date(Date.UTC(ANO, MES - 1, 28)),
      linhasRecebidas: 0,
      linhasGravadas: 0,
      origemIp: '127.0.0.1',
    },
    select: { id: true },
  })
  syncId = s.id
})

/** O calendário da filial no mês de teste: `acumulado` de `doMes` dias úteis. */
async function calendario(acumulado: number, doMes: number) {
  for (let d = 1; d <= acumulado; d++) {
    await prisma.diaUtil.create({
      data: {
        filialId,
        data: new Date(Date.UTC(ANO, MES - 1, d)),
        diaUtil: true,
        acumuladoDia: d,
        uteisDoMes: doMes,
        syncId,
      },
    })
  }
}

const limparCalendario = () =>
  prisma.diaUtil.deleteMany({
    where: {
      filialId,
      data: {
        gte: new Date(Date.UTC(ANO, MES - 1, 1)),
        lte: new Date(Date.UTC(ANO, MES - 1, 28)),
      },
    },
  })

beforeEach(async () => {
  await limparCalendario()
  await prisma.vendedorAreaMes.deleteMany({ where: { areaVendaId: areaId } })
  await prisma.fatoVendaVendedor.deleteMany({ where: { vendedorId: { in: vendedores } } })
  await prisma.vendedorMes.deleteMany({ where: { vendedorId: { in: vendedores } } })
  await prisma.dimVendedor.deleteMany({ where: { id: { in: vendedores } } })
  vendedores = []
})

afterAll(async () => {
  await limparCalendario()
  await prisma.vendedorAreaMes.deleteMany({ where: { areaVendaId: areaId } })
  await prisma.fatoVendaVendedor.deleteMany({ where: { vendedorId: { in: vendedores } } })
  await prisma.vendedorMes.deleteMany({ where: { vendedorId: { in: vendedores } } })
  await prisma.dimVendedor.deleteMany({ where: { id: { in: vendedores } } })
  await prisma.dimAreaVenda.delete({ where: { id: areaId } })
  await prisma.dimGerencia.delete({ where: { id: gerenciaId } })
  await prisma.syncExecucao.delete({ where: { id: syncId } })
  await prisma.$disconnect()
})

describe('competências da janela', () => {
  it('cobre todos os meses que a janela toca, sem repetir', () => {
    const c = competenciasDaJanela(new Date('2026-01-20'), new Date('2026-03-02'))
    expect(c).toEqual([
      { ano: 2026, mes: 1 },
      { ano: 2026, mes: 2 },
      { ano: 2026, mes: 3 },
    ])
  })

  /** A virada do ano é onde uma regra escrita à mão erra. */
  it('atravessa a virada do ano', () => {
    expect(competenciasDaJanela(new Date('2025-12-15'), new Date('2026-01-05'))).toEqual([
      { ano: 2025, mes: 12 },
      { ano: 2026, mes: 1 },
    ])
  })
})

describe('resumo mensal do vendedor', () => {
  it('grava a conta feita: aptos e quem bateu', async () => {
    await vendedor(1, { meta: 100, realizadoPorDia: 60, dias: 2 }) // 120 >= 100, bateu
    await vendedor(2, { meta: 100, realizadoPorDia: 10, dias: 2 }) // 20  <  100
    await atualizarResumoVendedor(prisma, [{ ano: ANO, mes: MES }])

    const r = await linha()
    expect(r?.aptos).toBe(2)
    expect(r?.naMeta).toBe(1)
    expect(r?.dias).toBe(2)
    expect(r?.gerenciaId).toBe(gerenciaId)
  })

  /**
   * A regra do denominador é a MESMA da tela semanal, importada — não uma
   * cópia em SQL. Sem cota não há o que cumprir, e inativo não conta.
   */
  it('aplica `contaNoDenominador`, e não uma cópia da regra', async () => {
    await vendedor(1, { meta: 100, realizadoPorDia: 100, dias: 1 })
    await vendedor(2, { meta: 0, realizadoPorDia: 500, dias: 1 }) // sem cota: fora
    await vendedor(3, { meta: 100, realizadoPorDia: 500, dias: 1, sitafa: 7 }) // inativo: fora
    await vendedor(4, { meta: 100, realizadoPorDia: 500, dias: 1, houveVenda: 'SEM_VENDA' })
    await atualizarResumoVendedor(prisma, [{ ano: ANO, mes: MES }])

    const r = await linha()
    expect(r?.aptos).toBe(1)
    expect(r?.naMeta).toBe(1)
  })

  /**
   * A TRAVA CONTRA ENCOLHER, que é o defeito que o resumo existe para evitar.
   *
   * Depois do expurgo o mês fica com poucos dias de detalhe (ou nenhum), e
   * refazer a conta ali daria realizado zero e 0% na tela. O `dias` guardado
   * denuncia: menos dias que o registrado é reposição parcial, não correção.
   */
  it('não deixa uma reposição parcial derrubar o mês', async () => {
    const id = await vendedor(1, { meta: 100, realizadoPorDia: 50, dias: 4 }) // 200: bateu
    await atualizarResumoVendedor(prisma, [{ ano: ANO, mes: MES }])
    expect((await linha())?.naMeta).toBe(1)

    // O expurgo leva quase tudo -- sobra um dia, e o realizado vira 50.
    await prisma.fatoVendaVendedor.deleteMany({
      where: { vendedorId: id, data: { gt: new Date(Date.UTC(ANO, MES - 1, 1)) } },
    })
    await atualizarResumoVendedor(prisma, [{ ano: ANO, mes: MES }])

    const r = await linha()
    expect(r?.naMeta, 'o mês guardado vale mais que a reposição parcial').toBe(1)
    expect(r?.dias).toBe(4)
  })

  /**
   * Área sem ninguém apto não vira linha de zero.
   *
   * Zero por cento diria "ninguém bateu"; a verdade é "não havia quem medir", e
   * a tela desenha as duas de formas diferentes.
   */
  it('não grava linha para área sem ninguém apto', async () => {
    await vendedor(1, { meta: 0, realizadoPorDia: 500, dias: 1 })
    await atualizarResumoVendedor(prisma, [{ ano: ANO, mes: MES }])
    expect(await linha()).toBeNull()
  })

  /** Competência sem situação carregada é pulada, e não zerada. */
  it('pula competência que a carga nunca trouxe', async () => {
    await atualizarResumoVendedor(prisma, [{ ano: ANO, mes: MES }])
    expect(await linha()).toBeNull()
  })

  /**
   * SITUAÇÃO SEM DETALHE também é pulada -- e este é o caso que aconteceu.
   *
   * A carga de `vendedor-situacao` dispara a consolidação, e ela roda antes de o
   * realizado do mês existir. Sem a guarda, a competência nascia com `aptos`
   * cheio e `naMeta` zero: um mês inteiro a **0%** na tela, que se lê como
   * "ninguém bateu a meta" e significa "o realizado ainda não chegou".
   *
   * A trava contra encolher não alcançava isso: ela compara com o que já está
   * gravado, e aqui não havia nada gravado ainda.
   */
  it('pula competência com cota carregada e nenhum dia de realizado', async () => {
    await vendedor(1, { meta: 100, realizadoPorDia: 0, dias: 0 })
    await atualizarResumoVendedor(prisma, [{ ano: ANO, mes: MES }])
    expect(await linha(), 'sem detalhe não há resposta, e 0% é uma resposta').toBeNull()
  })
})

/**
 * "BATEU" é contra a COTA RATEADA pelos dias úteis decorridos, e não contra a
 * cota do mês inteiro.
 *
 * É uma regra só, sem ramo por mês: em mês fechado `acumulado = doMes` e a cota
 * rateada é a cota inteira, então o número não muda. No mês em curso ela é a
 * única comparação que faz sentido -- no dia 2, medir contra a cota do mês
 * inteiro dava **0%** enquanto o cartão da mesma tela dizia 55%.
 */
describe('a cota rateada no resumo', () => {
  it('mede o mês em curso contra a cota proporcional', async () => {
    // 2 de 20 dias uteis: a cota efetiva e' um decimo de 1000, ou seja 100.
    await calendario(2, 20)
    await vendedor(1, { meta: 1000, realizadoPorDia: 60, dias: 2 }) // 120 >= 100
    await vendedor(2, { meta: 1000, realizadoPorDia: 20, dias: 2 }) //  40 <  100
    await atualizarResumoVendedor(prisma, [{ ano: ANO, mes: MES }])

    const r = await linha()
    expect(r?.aptos).toBe(2)
    expect(r?.naMeta, 'contra a cota do mês inteiro os dois falhariam').toBe(1)
  })

  /** Mês fechado: `acumulado = doMes`, e a cota rateada é a cota inteira. */
  it('no mês fechado dá o mesmo que a cota cheia', async () => {
    await calendario(20, 20)
    await vendedor(1, { meta: 1000, realizadoPorDia: 100, dias: 20 }) // 2000 >= 1000
    await vendedor(2, { meta: 1000, realizadoPorDia: 20, dias: 20 }) //   400 <  1000
    await atualizarResumoVendedor(prisma, [{ ano: ANO, mes: MES }])

    const r = await linha()
    expect(r?.naMeta).toBe(1)
  })

  /**
   * NENHUM dia útil decorrido é o 1º do mês: a cota rateada seria zero e
   * QUALQUER realizado passaria, inclusive zero -- 100% dos vendedores na meta
   * no primeiro dia útil, todo mês. `bateuCotaAcumulada` devolve `null`, e a
   * competência inteira é pulada.
   */
  it('pula a competência quando nenhum dia útil decorreu', async () => {
    await prisma.diaUtil.create({
      data: {
        filialId,
        data: new Date(Date.UTC(ANO, MES - 1, 1)),
        diaUtil: false,
        acumuladoDia: 0,
        uteisDoMes: 20,
        syncId,
      },
    })
    await vendedor(1, { meta: 1000, realizadoPorDia: 0, dias: 1 })
    await atualizarResumoVendedor(prisma, [{ ano: ANO, mes: MES }])

    expect(await linha(), '100% no dia 1º seria o defeito').toBeNull()
  })
})

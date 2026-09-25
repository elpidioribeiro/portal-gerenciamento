import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { atualizarResumoMensal } from '../../src/modules/ingestao/gravar.js'
import { exigirSeed } from '../helpers/seed.js'

/**
 * O resumo mensal por área, e a trava que impede ele de encolher.
 *
 * O resumo existe porque `fato_venda_linha` é a única tabela que sabe a
 * gerência de uma venda e retém 60 dias: um ano dela são ~2 milhões de linhas e
 * 506 MB, contra ~2.200 linhas do mesmo ano resumido (medido em 03/09/2026).
 *
 * O risco que este arquivo cobre é **o resumo perder o passado**. Ele é
 * recalculado do detalhe a cada carga, e depois que a retenção voltou para 60
 * dias o detalhe de um mês antigo está incompleto ou ausente. Recarregar três
 * dias de março recalcularia março a partir dos três dias que sobraram, e o
 * total do mês viraria um décimo do que foi — **sem erro nenhum**, e sem nada
 * na tela dizendo que o histórico mudou.
 *
 * O `dias` guardado é o que denuncia: recálculo que vê MENOS dias do que o
 * resumo já registrava é reposição parcial, não correção.
 */

await exigirSeed()

const prisma = new PrismaClient()
afterAll(() => prisma.$disconnect())

const ANO = 2024
const MES = 3
let filialId: string
let indicadorId: string
let areaId: string
let gerenciaId: string

/** Grava o resumo como se um mês completo já tivesse sido consolidado. */
async function semearResumo(vendido: number, dias: number) {
  await prisma.$executeRawUnsafe(
    `insert into venda_area_mes
       (filial_id, indicador_id, area_venda_id, gerencia_id, ano, mes, vendido, dias)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::int, $6::int, $7, $8::int)
     on conflict (filial_id, area_venda_id, indicador_id, ano, mes)
     do update set vendido = excluded.vendido, dias = excluded.dias`,
    filialId, indicadorId, areaId, gerenciaId, ANO, MES, vendido, dias,
  )
}

/** O detalhe que "sobrou" no mês, em dias consecutivos a partir do dia 1. */
async function semearDetalhe(dias: number, valorPorDia: number) {
  await prisma.$executeRawUnsafe(
    `delete from fato_venda_linha where extract(year from data)=$1::int and extract(month from data)=$2::int`,
    ANO, MES,
  )
  if (dias === 0) return
  /*
   * A execução é criada AQUI, e não buscada do seed: uma busca que devolve nulo
   * estoura no insert com "reading 'id'" — erro que não diz o que faltou.
   *
   * Havia uma `dimensao_linha` criada junto, porque o fato exigia `linha_id`.
   * A coluna saiu em 18/09/2026, quando o grão passou a ser a ÁREA.
   */
  const syncId = (
    await prisma.syncExecucao.create({
      data: {
        fonte: 'vendas-linha',
        status: 'SUCESSO',
        periodoDe: new Date(`${ANO}-03-01T00:00:00.000Z`),
        periodoAte: new Date(`${ANO}-03-31T00:00:00.000Z`),
        linhasRecebidas: dias,
        linhasGravadas: dias,
        origemIp: 'teste',
      },
      select: { id: true },
    })
  ).id
  /*
   * `createMany` e não SQL cru: o `id` de `fato_venda_linha` é gerado pelo
   * Prisma, não pelo banco, e um INSERT cru falha com "null violates not-null"
   * apontando uma linha inteira de UUIDs — erro que custa mais para ler do que
   * para evitar.
   */
  await prisma.fatoVendasLinha.createMany({
    data: Array.from({ length: dias }, (_, i) => ({
      filialId,
      indicadorId,
      data: new Date(Date.UTC(ANO, MES - 1, i + 1)),
      areaVendaId: areaId,
      gerenciaId,
      valor: valorPorDia,
      syncId,
    })),
  })
}

const guardado = async () => {
  const r = await prisma.$queryRawUnsafe<Array<{ vendido: string; dias: number }>>(
    `select vendido::text, dias from venda_area_mes
      where filial_id=$1::uuid and area_venda_id=$2::uuid and ano=$3::int and mes=$4::int`,
    filialId, areaId, ANO, MES,
  )
  return r[0] ? { vendido: Number(r[0].vendido), dias: r[0].dias } : null
}

/** A janela de carga que cobre o mês inteiro — é ela que dispara o recálculo. */
const janelaDoMes = { de: `${ANO}-03-01`, ate: `${ANO}-03-31` }

beforeEach(async () => {
  const f = await prisma.filial.findFirstOrThrow({ select: { id: true } })
  const i = await prisma.indicador.findFirstOrThrow({
    where: { codigo: 'vendas' },
    select: { id: true },
  })
  const a = await prisma.dimAreaVenda.findFirstOrThrow({
    where: { filialId: f.id },
    select: { id: true, gerenciaId: true },
  })
  filialId = f.id
  indicadorId = i.id
  areaId = a.id
  gerenciaId = a.gerenciaId!
  await prisma.$executeRawUnsafe(
    `delete from venda_area_mes where ano=$1::int and mes=$2::int`, ANO, MES,
  )
})

afterAll(async () => {
  await prisma.$executeRawUnsafe(`delete from venda_area_mes where ano=${ANO} and mes=${MES}`)
  await prisma.$executeRawUnsafe(
    `delete from fato_venda_linha where extract(year from data)=${ANO} and extract(month from data)=${MES}`,
  )
})

describe('resumo mensal por área', () => {
  it('consolida o mês a partir do detalhe', async () => {
    await semearDetalhe(10, 100)
    await atualizarResumoMensal(prisma, janelaDoMes, indicadorId)

    expect(await guardado()).toEqual({ vendido: 1000, dias: 10 })
  })

  it('atualiza quando o detalhe cresce', async () => {
    await semearDetalhe(10, 100)
    await atualizarResumoMensal(prisma, janelaDoMes, indicadorId)
    await semearDetalhe(20, 100)
    await atualizarResumoMensal(prisma, janelaDoMes, indicadorId)

    expect(await guardado()).toEqual({ vendido: 2000, dias: 20 })
  })

  /**
   * O caso que este arquivo existe para pegar.
   *
   * Março consolidado com 31 dias; meses depois, alguém recarrega três dias
   * dele. O detalhe antigo já foi expurgado, então o recálculo só enxerga os
   * três — e sem a trava o histórico de março viraria um décimo, calado.
   */
  it('NÃO encolhe o mês fechado quando o detalhe volta parcial', async () => {
    await semearResumo(31_000, 31)
    await semearDetalhe(3, 100)

    await atualizarResumoMensal(prisma, janelaDoMes, indicadorId)

    expect(await guardado()).toEqual({ vendido: 31_000, dias: 31 })
  })

  /**
   * Detalhe AUSENTE é o caso comum depois do expurgo, e é seguro por
   * construção: sem linha no `SELECT`, não há `INSERT`, e o resumo fica.
   */
  it('não toca no resumo quando o detalhe do mês já foi expurgado', async () => {
    await semearResumo(31_000, 31)
    await semearDetalhe(0, 0)

    await atualizarResumoMensal(prisma, janelaDoMes, indicadorId)

    expect(await guardado()).toEqual({ vendido: 31_000, dias: 31 })
  })

  /**
   * Só os meses da JANELA são recalculados. Uma carga de setembro não pode
   * tocar em março — se tocasse, cada carga diária arrastaria o ano inteiro.
   */
  it('só recalcula os meses que a janela cobre', async () => {
    await semearResumo(31_000, 31)
    await semearDetalhe(3, 100)

    await atualizarResumoMensal(prisma, { de: `${ANO}-09-01`, ate: `${ANO}-09-30` }, indicadorId)

    expect(await guardado()).toEqual({ vendido: 31_000, dias: 31 })
  })
})

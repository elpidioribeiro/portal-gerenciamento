import type { PrismaClient } from '@prisma/client'
import { type z } from 'zod'
import { agora } from '../../lib/datas.js'
import {
  resolverAreasPorCodigo,
  resolverVendedores,
  validarAcumuladoContraQtutil,
} from './dimensoes.js'
import type {
  areaSupervisorSchema,
  diasUteisSchema,
  vendedorAreaSchema,
  vendedorSituacaoSchema,
} from './schemas.js'
import {
  dataDe,
  exigirChaveUnica,
  mapearFiliais,
  TETO_DA_CARGA,
  type ResultadoIngestao,
} from './service.js'
import type { Origem } from './gravar.js'
import { atualizarResumoVendedor } from './resumo-vendedor.js'

/**
 * Gravação das fontes de CADASTRO — as que não têm janela de datas.
 *
 * `vendedor-area`, `area-supervisor`, `vendedor-situacao` e `dias-uteis` são
 * retrato: uma consulta ao Oracle devolve o estado atual, e a carga substitui o
 * que havia. Não existe "últimos N dias" para elas -- o SQL nem recebe `:de` e
 * `:ate` (`janelaDias: null` em `fontes.mjs`).
 *
 * Por isso não passam por `executarCarga`, que é construído em volta de janela:
 * cada uma faz a própria transação, com o próprio critério de substituição --
 * competência em `vendedor-situacao` e `dias-uteis`, e o conjunto que veio nas
 * outras duas.
 *
 * O `periodo` que aparece em `sync_execucao` é DERIVADO das linhas, e não
 * pedido por quem dispara: é a extensão do que veio, não um filtro.
 *
 * Os tipos de linha saem dos schemas Zod das rotas, com `z.infer`. Redeclará-los
 * aqui criaria uma segunda verdade sobre a mesma forma, e as duas divergiriam no
 * primeiro campo novo.
 */

type LinhasDe<T extends z.ZodType<{ linhas: unknown[] }>> = z.infer<T>['linhas']


/** Cadastro de vendedores e a área de cada um. */
export async function gravarVendedorArea(
  prisma: PrismaClient,
  entrada: { linhas: LinhasDe<typeof vendedorAreaSchema>; origem: Origem },
): Promise<ResultadoIngestao> {
  const { linhas, origem } = entrada

  const filiais = await mapearFiliais(prisma, linhas.map((l) => l.filial))
  exigirChaveUnica(linhas.map((l) => `${l.filial}|${l.codVendedor}`), 'filial+codVendedor')

  const areas = await resolverAreasPorCodigo(prisma, filiais, linhas)

  /*
   * Upsert, e NÃO substituição: quem sai do cadastro na origem continua
   * aqui. É deliberado -- `fato_venda_vendedor` e `vendedor_mes` apontam
   * para esta tabela, e apagar um vendedor desligado levaria junto a venda
   * que ele fez enquanto estava. O histórico do GD ficaria com buraco.
   */
  /*
   * Lê uma vez, escreve só a diferença -- e não um `upsert` por vendedor.
   *
   * Eram 2.530 upserts em sequência dentro de uma transação, e a conexão
   * caía no meio (P1017, medido em 27/08/2026). Em regime normal o cadastro
   * não muda de um dia para o outro, e este caminho não escreve nada.
   *
   * Upsert e NÃO substituição: quem sai do cadastro na origem continua
   * aqui. É deliberado -- `fato_venda_vendedor` e `vendedor_mes` apontam
   * para esta tabela, e apagar um vendedor desligado levaria junto a venda
   * que ele fez enquanto estava. O histórico do GD ficaria com buraco.
   */
  const desejados = linhas.map((l) => ({
    filialId: filiais.get(l.filial)!,
    codVendedor: l.codVendedor,
    matricula: l.matricula,
    nome: l.nome,
    areaVendaId: areas.get(`${l.filial}|${l.cdArea}`)!,
  }))

  const jaExistem = await prisma.dimVendedor.findMany({
    where: { filialId: { in: [...new Set(desejados.map((v) => v.filialId))] } },
    select: {
      id: true,
      filialId: true,
      codVendedor: true,
      matricula: true,
      nome: true,
      areaVendaId: true,
    },
  })
  const atual = new Map(jaExistem.map((v) => [`${v.filialId}|${v.codVendedor}`, v]))

  const criar = desejados.filter((v) => !atual.has(`${v.filialId}|${v.codVendedor}`))
  const mudaram = desejados.filter((v) => {
    const a = atual.get(`${v.filialId}|${v.codVendedor}`)
    return (
      a &&
      (a.matricula !== v.matricula || a.nome !== v.nome || a.areaVendaId !== v.areaVendaId)
    )
  })

  let gravadas = 0
  await prisma.$transaction(async (tx) => {
    if (criar.length > 0) {
      gravadas += (await tx.dimVendedor.createMany({ data: criar, skipDuplicates: true })).count
    }
    for (const v of mudaram) {
      await tx.dimVendedor.update({
        where: {
          filialId_codVendedor: { filialId: v.filialId, codVendedor: v.codVendedor },
        },
        data: { matricula: v.matricula, nome: v.nome, areaVendaId: v.areaVendaId },
      })
      gravadas++
    }
  }, TETO_DA_CARGA)

  const sync = await prisma.syncExecucao.create({
    data: {
      fonte: 'vendedor-area',
      status: 'SUCESSO',
      periodoDe: agora(),
      periodoAte: agora(),
      linhasRecebidas: linhas.length,
      linhasGravadas: gravadas,
      finalizadoEm: new Date(),
      origemIp: origem,
    },
  })

  return {
    syncId: sync.id,
    recebidas: linhas.length,
    gravadas,
    removidas: 0,
    expurgadas: 0,
    avisos: [],
  }
}

/** Supervisor de cada área de venda. */
export async function gravarAreaSupervisor(
  prisma: PrismaClient,
  entrada: { linhas: LinhasDe<typeof areaSupervisorSchema>; origem: Origem },
): Promise<ResultadoIngestao> {
  const { linhas, origem } = entrada

  const filiais = await mapearFiliais(prisma, linhas.map((l) => l.filial))
  exigirChaveUnica(linhas.map((l) => `${l.filial}|${l.cdArea}`), 'filial+cdArea')

  /*
   * CRIA a área que não existe, como `vendedor-area` e `metas`. A gerência
   * vem na consulta, de `ERP_AREA_VENDA.TIPO_AREA` -- o mesmo cadastro
   * corporativo, não um palpite.
   */
  const areas = await resolverAreasPorCodigo(prisma, filiais, linhas)

  const existentes = await prisma.dimAreaVenda.findMany({
    where: { id: { in: [...areas.values()] } },
    select: { id: true, supervisor: true },
  })
  const supervisorAtual = new Map(existentes.map((a) => [a.id, a.supervisor]))

  /*
   * Escreve só o que MUDOU. Em regime normal o supervisor é o mesmo de
   * ontem, e este caminho não escreve nada.
   */
  const mudaram = linhas.filter(
    (l) => supervisorAtual.get(areas.get(`${l.filial}|${l.cdArea}`)!) !== l.supervisor,
  )

  let gravadas = 0
  await prisma.$transaction(async (tx) => {
    for (const l of mudaram) {
      await tx.dimAreaVenda.update({
        where: { id: areas.get(`${l.filial}|${l.cdArea}`)! },
        data: { supervisor: l.supervisor },
      })
      gravadas++
    }
  }, TETO_DA_CARGA)

  const sync = await prisma.syncExecucao.create({
    data: {
      fonte: 'area-supervisor',
      status: 'SUCESSO',
      periodoDe: agora(),
      periodoAte: agora(),
      linhasRecebidas: linhas.length,
      linhasGravadas: gravadas,
      finalizadoEm: new Date(),
      origemIp: origem,
    },
  })

  return {
    syncId: sync.id,
    recebidas: linhas.length,
    gravadas,
    removidas: 0,
    expurgadas: 0,
    avisos: [],
  }
}

/** Situação e cota mensal do vendedor. */
export async function gravarVendedorSituacao(
  prisma: PrismaClient,
  entrada: { linhas: LinhasDe<typeof vendedorSituacaoSchema>; origem: Origem },
): Promise<ResultadoIngestao> {
  const { linhas, origem } = entrada

  const filiais = await mapearFiliais(prisma, linhas.map((l) => l.filial))
  exigirChaveUnica(
    linhas.map((l) => `${l.filial}|${l.codVendedor}|${l.ano}-${l.mes}`),
    'filial+codVendedor+ano+mes',
  )

  const vendedores = await resolverVendedores(prisma, linhas)

  /*
   * SUBSTITUI as competências presentes no lote, em vez de só inserir.
   *
   * `houveVenda` é calculada com `SYSDATE` na origem: enquanto o mês corre
   * todo mundo é MES_EM_VIGOR, e quando fecha a MESMA linha vira COM_VENDA
   * ou SEM_VENDA. Só-inserção congelaria o mês inteiro como MES_EM_VIGOR --
   * o denominador nunca mais mudaria, sem erro e com número plausível.
   *
   * Apaga por (filial, ano, mês) dos pares enviados, não por intervalo: um
   * lote pode trazer competências salteadas, e apagar o intervalo removeria
   * mês que não estava nele.
   */
  const competencias = [
    ...new Map(
      linhas.map((l) => [
        `${l.filial}|${l.ano}-${l.mes}`,
        { filialId: filiais.get(l.filial)!, ano: l.ano, mes: l.mes },
      ]),
    ).values(),
  ]

  let gravadas = 0
  let removidas = 0
  const sync = await prisma.syncExecucao.create({
    data: {
      fonte: 'vendedor-situacao',
      status: 'EM_ANDAMENTO',
      periodoDe: new Date(Date.UTC(Math.min(...linhas.map((l) => l.ano)), 0, 1)),
      periodoAte: new Date(Date.UTC(Math.max(...linhas.map((l) => l.ano)), 11, 31)),
      linhasRecebidas: linhas.length,
      linhasGravadas: 0,
      origemIp: origem,
    },
  })

  await prisma.$transaction(async (tx) => {
    removidas = (await tx.vendedorMes.deleteMany({ where: { OR: competencias } })).count
    gravadas = (
      await tx.vendedorMes.createMany({
        data: linhas.map((l) => ({
          filialId: filiais.get(l.filial)!,
          vendedorId: vendedores.get(`${l.filial}|${l.codVendedor}`)!,
          ano: l.ano,
          mes: l.mes,
          meta: l.meta,
          sitafa: l.sitafa,
          houveVenda: l.houveVenda,
          syncId: sync.id,
        })),
      })
    ).count
  }, TETO_DA_CARGA)

  await prisma.syncExecucao.update({
    where: { id: sync.id },
    data: { status: 'SUCESSO', linhasGravadas: gravadas, finalizadoEm: new Date() },
  })

  /*
   * O resumo mensal de Performance Vendedor depende DAS DUAS cargas.
   *
   * `vendedor-dia` traz o realizado; esta traz cota, SITAFA e a classificação
   * -- e `houveVenda` muda quando o mês fecha, virando MÊS EM VIGOR em COM
   * VENDA ou SEM VENDA. Refazer só na carga do detalhe deixaria o resumo do mês
   * anterior parado na classificação de quando ele ainda corria.
   */
  await atualizarResumoVendedor(
    prisma,
    [...new Map(competencias.map((c) => [`${c.ano}-${c.mes}`, { ano: c.ano, mes: c.mes }])).values()],
  )

  return {
    syncId: sync.id,
    recebidas: linhas.length,
    gravadas,
    removidas,
    expurgadas: 0,
    avisos: [],
  }
}

/** Calendário de dias em que a loja abre. */
export async function gravarDiasUteis(
  prisma: PrismaClient,
  entrada: { linhas: LinhasDe<typeof diasUteisSchema>; origem: Origem },
): Promise<ResultadoIngestao> {
  const { linhas, origem } = entrada

  const filiais = await mapearFiliais(prisma, linhas.map((l) => l.filial))
  exigirChaveUnica(linhas.map((l) => `${l.filial}|${l.data}`), 'filial+data')

  validarAcumuladoContraQtutil(linhas)

  const competencias = [
    ...new Map(
      linhas.map((l) => [
        `${l.filial}|${l.data.slice(0, 7)}`,
        { filialId: filiais.get(l.filial)!, competencia: l.data.slice(0, 7) },
      ]),
    ).values(),
  ]

  let gravadas = 0
  let removidas = 0
  const sync = await prisma.syncExecucao.create({
    data: {
      fonte: 'dias-uteis',
      status: 'EM_ANDAMENTO',
      periodoDe: dataDe(linhas.reduce((a, l) => (l.data < a ? l.data : a), linhas[0]!.data)),
      periodoAte: dataDe(linhas.reduce((a, l) => (l.data > a ? l.data : a), linhas[0]!.data)),
      linhasRecebidas: linhas.length,
      linhasGravadas: 0,
      origemIp: origem,
    },
  })

  /*
   * Um `deleteMany` só, com o OR das competências -- e não um por mês.
   *
   * Era um laço, e ele estourava o teto da transação: um ano de calendário
   * são 108 competências (9 filiais × 12 meses), 108 idas e voltas em
   * sequência dentro de uma transação que o Prisma fecha em 5 segundos.
   * Medido em 27/08/2026, P2028 no meio da carga.
   *
   * Por COMPETÊNCIA, e não por intervalo de datas: um mês recarregado se
   * refaz inteiro, e um mês que não veio no lote fica intacto.
   */
  const janelas = competencias.map((c) => {
    const de = dataDe(`${c.competencia}-01`)
    return {
      filialId: c.filialId,
      data: { gte: de, lte: new Date(Date.UTC(de.getUTCFullYear(), de.getUTCMonth() + 1, 0)) },
    }
  })

  await prisma.$transaction(async (tx) => {
    removidas = (await tx.diaUtil.deleteMany({ where: { OR: janelas } })).count
    gravadas = (
      await tx.diaUtil.createMany({
        data: linhas.map((l) => ({
          filialId: filiais.get(l.filial)!,
          data: dataDe(l.data),
          diaUtil: l.diaUtil,
          acumuladoDia: l.acumuladoDia,
          uteisDoMes: l.uteisDoMes,
          syncId: sync.id,
        })),
      })
    ).count
  })

  await prisma.syncExecucao.update({
    where: { id: sync.id },
    data: { status: 'SUCESSO', linhasGravadas: gravadas, finalizadoEm: new Date() },
  })

  return {
    syncId: sync.id,
    recebidas: linhas.length,
    gravadas,
    removidas,
    expurgadas: 0,
    avisos: [],
  }
}

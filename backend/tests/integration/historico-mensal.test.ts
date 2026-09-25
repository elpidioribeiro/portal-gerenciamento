import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fatorDeProjecao } from '../../src/modules/variaveis/performance-vendas.js'
import { exigirSeed } from '../helpers/seed.js'

/**
 * O histórico mensal da gerência — os dois quadros da parede.
 *
 * O que este arquivo protege é a diferença entre **zero e ausência**. As duas
 * séries têm alcances diferentes (Vendas vem do resumo mensal; Vendedor depende
 * do detalhe, que retém 60 dias), então a resposta tem meses cheios e meses
 * vazios lado a lado — e um mês sem dado desenhado como zero seria lido como
 * "a gerência não vendeu nada", que é o oposto de "ainda não sei".
 *
 * Também trava a fonte da GERÊNCIA de cada área: ela sai do resumo, que
 * congelou onde a área estava no mês, e não da dimensão, que diz onde ela está
 * hoje. Lendo da dimensão, o histórico mudaria sozinho quando uma área trocasse
 * de gerência — sem ninguém tocar em fato nenhum.
 */

await exigirSeed()

const prisma = new PrismaClient()
let app: FastifyInstance

const ANO = 2025
let gerenciaId: string
let outraGerenciaId: string
let filialId: string
let areaId: string
let indicadorId: string

const competencia = (mes: number) => `${ANO}-${String(mes).padStart(2, '0')}`

/** Consolida um mês como se a carga já o tivesse fechado. */
async function resumo(mes: number, vendido: number, dias = 30) {
  await prisma.$executeRawUnsafe(
    `insert into venda_area_mes
       (filial_id, indicador_id, area_venda_id, gerencia_id, ano, mes, vendido, dias)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::int, $6::int, $7, $8::int)
     on conflict (filial_id, area_venda_id, indicador_id, ano, mes)
     do update set vendido = excluded.vendido, dias = excluded.dias`,
    filialId, indicadorId, areaId, gerenciaId, ANO, mes, vendido, dias,
  )
}

async function meta(mes: number, valor: number) {
  await prisma.meta.upsert({
    where: {
      escopo_alvoId_filialId_ano_mes: {
        escopo: 'AREA_VENDA',
        alvoId: areaId,
        filialId,
        ano: ANO,
        mes,
      },
    },
    update: { valor },
    create: { escopo: 'AREA_VENDA', alvoId: areaId, filialId, ano: ANO, mes, valor },
  })
}


/** Consolida Performance Vendedor de um mês, como a carga faria. */
async function resumoVendedor(mes: number, aptos: number, naMeta: number, dias = 30) {
  await prisma.vendedorAreaMes.upsert({
    where: { filialId_areaVendaId_ano_mes: { filialId, areaVendaId: areaId, ano: ANO, mes } },
    update: { aptos, naMeta, dias },
    create: { filialId, areaVendaId: areaId, gerenciaId, ano: ANO, mes, aptos, naMeta, dias },
  })
}

const pedir = async (id: string, meses = 12) => {
  const r = await app.inject({
    method: 'GET',
    url: `/api/v1/gerencias/${id}/historico-mensal?meses=${meses}`,
  })
  return { status: r.statusCode, corpo: r.json() }
}

beforeAll(async () => {
  const { buildApp } = await import('../../src/app.js')
  app = await buildApp()
  await app.ready()

  const f = await prisma.filial.findFirstOrThrow({ select: { id: true } })
  const i = await prisma.indicador.findFirstOrThrow({
    where: { codigo: 'vendas' },
    select: { id: true },
  })
  filialId = f.id
  indicadorId = i.id

  /*
   * GERÊNCIA E ÁREA PRÓPRIAS, criadas aqui.
   *
   * A primeira versão reusava as do seed e limpava com `delete ... where ano =
   * 2025` -- e isso apagou as metas de 2025 que `coerencia-delta` lê. O arquivo
   * passava sozinho e derrubava a suíte, que é o pior formato de teste ruim.
   *
   * Com alvos próprios, a limpeza alcança só o que este arquivo criou.
   */
  const g = await prisma.dimGerencia.create({
    data: { filialId, nome: 'GERENCIA DE TESTE HISTORICO' },
    select: { id: true },
  })
  const outra = await prisma.dimGerencia.create({
    data: { filialId, nome: 'GERENCIA DE TESTE HISTORICO 2' },
    select: { id: true },
  })
  const a = await prisma.dimAreaVenda.create({
    data: { filialId, nome: 'AREA DE TESTE HISTORICO', cdArea: 'TST-HIST', gerenciaId: g.id },
    select: { id: true },
  })
  gerenciaId = g.id
  outraGerenciaId = outra.id
  areaId = a.id
})

afterAll(async () => {
  await prisma.$executeRawUnsafe(`delete from venda_area_mes where area_venda_id = $1::uuid`, areaId)
  await prisma.vendedorAreaMes.deleteMany({ where: { areaVendaId: areaId } })
  await prisma.meta.deleteMany({ where: { alvoId: areaId } })
  await prisma.dimAreaVenda.delete({ where: { id: areaId } })
  await prisma.dimGerencia.deleteMany({ where: { id: { in: [gerenciaId, outraGerenciaId] } } })
  await app.close()
  await prisma.$disconnect()
})

describe('histórico mensal da gerência', () => {
  it('devolve uma janela contígua de meses, do mais antigo ao mais recente', async () => {
    const { status, corpo } = await pedir(gerenciaId, 6)

    expect(status).toBe(200)
    expect(corpo.meses).toHaveLength(6)
    expect(corpo.gerencia.id).toBe(gerenciaId)

    // Contígua e crescente: o gráfico desenha na ordem que recebe.
    const chaves = corpo.meses.map((m: { competencia: string }) => m.competencia)
    expect([...chaves].sort()).toEqual(chaves)
    expect(new Set(chaves).size).toBe(6)
  })

  /**
   * O caso central: mês sem dado é `null`, nunca zero.
   *
   * Zero é um resultado — "vendeu, e não bateu nada". Ausência é outra coisa, e
   * a tela precisa poder desenhar as duas diferente.
   */
  it('devolve null no mês sem dado, e não zero', async () => {
    const { corpo } = await pedir(gerenciaId, 13)
    const vazios = corpo.meses.filter(
      (m: { vendas: unknown }) => m.vendas === null,
    )

    expect(vazios.length).toBeGreaterThan(0)
    for (const m of vazios) expect(m.vendas).toBeNull()
  })

  it('calcula o percentual sobre a meta da competência', async () => {
    const hoje = new Date()
    const mes = hoje.getUTCMonth() + 1
    // O ano do teste é passado, então uso um mês dentro da janela pedida.
    await resumo(mes, 90_000, 30)
    await meta(mes, 100_000)

    const { corpo } = await pedir(gerenciaId, 24)
    const alvo = corpo.meses.find(
      (m: { competencia: string }) => m.competencia === competencia(mes),
    )

    expect(alvo?.vendas).not.toBeNull()
    expect(alvo.vendas.percentual).toBeCloseTo(90, 5)
    expect(alvo.vendas.vendido).toBe(90_000)
    expect(alvo.vendas.meta).toBe(100_000)
    expect(alvo.vendas.dias).toBe(30)
  })

  /**
   * Sem meta cadastrada não há percentual — e não é zero.
   *
   * É a mesma regra de §7.36: supor 100% faria a gerência parecer no alvo, e
   * mostrar zero a faria parecer fracassada. As duas afirmam o que ninguém sabe.
   */
  it('não inventa percentual quando falta a meta', async () => {
    const hoje = new Date()
    const mes = hoje.getUTCMonth() + 1
    await resumo(mes, 90_000, 30)
    await prisma.meta.deleteMany({ where: { alvoId: areaId, ano: ANO, mes } })

    const { corpo } = await pedir(gerenciaId, 24)
    const alvo = corpo.meses.find(
      (m: { competencia: string }) => m.competencia === competencia(mes),
    )

    expect(alvo.vendas).toBeNull()
  })

  /**
   * `alcance` diz até onde CADA série chega, e é o que permite à tela escrever
   * "ainda não há histórico" em vez de desenhar um buraco sem explicação.
   */
  it('informa até onde cada série alcança', async () => {
    const { corpo } = await pedir(gerenciaId, 13)

    expect(corpo.alcance).toHaveProperty('vendas')
    expect(corpo.alcance).toHaveProperty('vendedor')
    for (const v of Object.values(corpo.alcance)) {
      expect(v === null || /^\d{4}-\d{2}$/.test(v as string)).toBe(true)
    }
  })

  /**
   * O resumo de uma gerência não vaza para a outra. Parece óbvio e é o tipo de
   * coisa que só se descobre quando dois números somam errado numa reunião.
   */
  it('não mistura o histórico de outra gerência', async () => {
    if (outraGerenciaId === gerenciaId) return

    const hoje = new Date()
    const mes = hoje.getUTCMonth() + 1
    await resumo(mes, 90_000, 30)
    await meta(mes, 100_000)

    const { corpo } = await pedir(outraGerenciaId, 24)
    const alvo = corpo.meses.find(
      (m: { competencia: string }) => m.competencia === competencia(mes),
    )

    expect(alvo.vendas).toBeNull()
  })

  it('recusa gerência que não existe', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/gerencias/00000000-0000-4000-8000-000000000000/historico-mensal',
    })
    expect(r.statusCode).toBe(404)
  })
})

/**
 * PERFORMANCE VENDEDOR VEM DO RESUMO, e não do detalhe.
 *
 * A primeira versão cruzava `vendedor_mes` com `fato_venda_vendedor`, e o
 * detalhe retém 60 dias: os meses velhos vinham com denominador cheio e
 * realizado zero, ou seja **0%** -- que se lê como "ninguém bateu a meta" e
 * significa "o dado não existe mais". São coisas opostas.
 */
describe('performance vendedor no histórico', () => {
  it('vem do resumo mensal, com o percentual da competência', async () => {
    const mes = new Date().getUTCMonth() + 1
    await resumoVendedor(mes, 8, 6)

    const { corpo } = await pedir(gerenciaId, 24)
    const alvo = corpo.meses.find(
      (m: { competencia: string }) => m.competencia === competencia(mes),
    )

    expect(alvo.vendedor.percentual).toBeCloseTo(75, 5)
    expect(alvo.vendedor.naMeta).toBe(6)
    expect(alvo.vendedor.apurados).toBe(8)
  })

  /** Mês sem consolidação é ausência, e não 0%. */
  it('devolve null no mês que nunca foi consolidado', async () => {
    const { corpo } = await pedir(gerenciaId, 24)
    const vazios = corpo.meses.filter((m: { vendedor: unknown }) => m.vendedor === null)

    expect(vazios.length).toBeGreaterThan(0)
    for (const m of vazios) expect(m.vendedor).toBeNull()
  })

  /**
   * Soma numerador e denominador das áreas, NUNCA promedia percentuais.
   *
   * Duas áreas, 1/1 e 0/9: promediando dá 50%; somando dá 10%, que é o
   * cumprimento real da gerência.
   */
  it('soma numerador e denominador entre áreas', async () => {
    const mes = new Date().getUTCMonth() + 1
    const outra = await prisma.dimAreaVenda.create({
      data: { filialId, nome: 'AREA DE TESTE HISTORICO B', cdArea: 'TST-HIST-B', gerenciaId },
      select: { id: true },
    })
    await resumoVendedor(mes, 1, 1)
    await prisma.vendedorAreaMes.create({
      data: { filialId, areaVendaId: outra.id, gerenciaId, ano: ANO, mes, aptos: 9, naMeta: 0, dias: 30 },
    })

    const { corpo } = await pedir(gerenciaId, 24)
    const alvo = corpo.meses.find(
      (m: { competencia: string }) => m.competencia === competencia(mes),
    )

    expect(alvo.vendedor.percentual).toBeCloseTo(10, 5)

    await prisma.vendedorAreaMes.deleteMany({ where: { areaVendaId: outra.id } })
    await prisma.dimAreaVenda.delete({ where: { id: outra.id } })
  })
})

/**
 * O MÊS EM CURSO entra como PROJEÇÃO DE FECHAMENTO contra a meta do mês
 * inteiro -- a mesma medida do cartão do topo, e não uma segunda.
 *
 * Já foi de duas outras formas, e as duas contradiziam a tela:
 *
 *   1. realizado parcial / meta do MÊS INTEIRO. No dia 2 de setembro a barra
 *      dizia 7% e o cartão dizia 108%.
 *   2. realizado parcial / meta RATEADA pelos dias úteis. Coincidia com o
 *      cartão só quando a projeção do BI fosse linear por dia útil, e ela não
 *      é: medido em 04/09/2026, fator 15,0 contra 13,0 do linear. A barra
 *      dizia 72% e o cartão 108%.
 *
 * Agora o denominador é sempre a meta do mês, e as doze barras querem dizer
 * uma coisa só: fechamento contra a meta, real nos meses fechados e projetado
 * no corrente.
 */
describe('o mês em curso', () => {
  const hoje = new Date()
  const anoCorrente = hoje.getUTCFullYear()
  const mesCorrente = hoje.getUTCMonth() + 1

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `delete from venda_area_mes where area_venda_id = $1::uuid`,
      areaId,
    )
    await prisma.meta.deleteMany({ where: { alvoId: areaId } })
  })

  it('marca `emCurso` no mês corrente, e só nele', async () => {
    const { corpo } = await pedir(gerenciaId, 12)
    const emCurso = corpo.meses.filter((m: { emCurso: boolean }) => m.emCurso)

    expect(emCurso).toHaveLength(1)
    expect(emCurso[0].competencia).toBe(
      `${anoCorrente}-${String(mesCorrente).padStart(2, '0')}`,
    )
  })

  /**
   * DUAS coisas, e as duas eram o defeito:
   *
   *   DENOMINADOR  a meta do MÊS INTEIRO, e não uma fração dela pelos dias
   *                úteis decorridos.
   *   NUMERADOR    a PROJEÇÃO de fechamento, e não o realizado parcial.
   *
   * O fator sai de `fatorDeProjecao`, a mesma função que a rota usa -- e não
   * de uma fórmula reescrita aqui. Uma primeira versão deste teste supunha
   * fator 1 por achar que o seed não tinha `fato_venda` no mês corrente; tinha,
   * e o fator medido era 11,35.
   */
  it('mede a projeção contra a meta do mês inteiro', async () => {
    await prisma.$executeRawUnsafe(
      `insert into venda_area_mes
         (filial_id, indicador_id, area_venda_id, gerencia_id, ano, mes, vendido, dias)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::int, $6::int, $7, $8::int)
       on conflict (filial_id, area_venda_id, indicador_id, ano, mes)
       do update set vendido = excluded.vendido, dias = excluded.dias`,
      filialId, indicadorId, areaId, gerenciaId, anoCorrente, mesCorrente, 10_000, 2,
    )
    await prisma.meta.upsert({
      where: {
        escopo_alvoId_filialId_ano_mes: {
          escopo: 'AREA_VENDA',
          alvoId: areaId,
          filialId,
          ano: anoCorrente,
          mes: mesCorrente,
        },
      },
      update: { valor: 100_000 },
      create: {
        escopo: 'AREA_VENDA',
        alvoId: areaId,
        filialId,
        ano: anoCorrente,
        mes: mesCorrente,
        valor: 100_000,
      },
    })

    /*
     * O fator da filial, do mês corrente -- exatamente as entradas que a rota
     * usa: a soma de `valorReal` e a `tendencia` do dia mais recente.
     */
    const soma = await prisma.fatoVendas.aggregate({
      where: {
        filialId,
        indicadorId,
        data: { gte: new Date(Date.UTC(anoCorrente, mesCorrente - 1, 1)) },
      },
      _sum: { valorReal: true },
    })
    const ultima = await prisma.fatoVendas.findFirst({
      where: {
        filialId,
        indicadorId,
        data: { gte: new Date(Date.UTC(anoCorrente, mesCorrente - 1, 1)) },
      },
      orderBy: { data: 'desc' },
      select: { tendencia: true },
    })
    const fator = fatorDeProjecao(
      Number(soma._sum.valorReal ?? 0),
      Number(ultima?.tendencia ?? 0),
    )

    const { corpo } = await pedir(gerenciaId, 12)
    const alvo = corpo.meses.find((m: { emCurso: boolean }) => m.emCurso)

    expect(alvo.vendas.meta, 'a meta do mês inteiro, sem rateio').toBe(100_000)
    expect(alvo.vendas.vendido, 'o numerador é projeção, não realizado').toBeCloseTo(
      10_000 * fator,
      5,
    )
    expect(alvo.vendas.percentual).toBeCloseTo(((10_000 * fator) / 100_000) * 100, 5)
  })
})

import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'

/**
 * As quatro cargas de Performance Vendedor. PLANO §7.14 e §7.15.
 *
 * O que se protege aqui não é a gravação — é a ORDEM e a SUBSTITUIÇÃO.
 *
 * A ordem porque `fato_venda_vendedor` e `vendedor_mes` apontam para
 * `dimensao_vendedor`, que só nasce em `vendedor-area`. Um vendedor criado pela
 * metade, sem área, não entra em denominador nenhum: a venda dele fica gravada
 * e o indicador não o enxerga.
 *
 * A substituição porque `houve_venda` é calculada com `SYSDATE` na origem. A
 * mesma linha muda de rótulo quando o mês fecha, e carga só-inserção congelaria
 * o mês como MES_EM_VIGOR — o denominador nunca mais mudaria, sem erro nenhum.
 */

let app: FastifyInstance
const prisma = new PrismaClient()
const TOKEN = process.env.INGEST_TOKEN ?? ''

/**
 * Ano isolado para o que NÃO tem janela: 2028 não é tocado por seed nem por
 * outro teste, e situação e calendário são por competência.
 */
const ANO = 2028

/**
 * A venda por dia precisa de datas REAIS, e por dois motivos que se somam:
 * `validarSemFuturo` recusa 2028, e o expurgo de 60 dias apagaria uma data
 * antiga na mesma transação em que ela entrasse. Sobra a janela recente.
 *
 * Só este teste escreve em `fato_venda_vendedor`, então a substituição de
 * janela não atropela ninguém.
 */
const diasAtras = (n: number) => {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
const DE = diasAtras(5)
const ATE = diasAtras(3)
const COD = 'T-VEND-1'

let cdArea: string
let filialId: string

const enviar = (fonte: string, body: unknown) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/ingest/${fonte}`,
    headers: { 'x-ingest-token': TOKEN },
    payload: body as object,
  })

beforeAll(async () => {
  app = await buildApp()
  await app.ready()

  const area = await prisma.dimAreaVenda.findFirst({
    where: { filial: { sigla: 'CEN' } },
    include: { filial: true },
  })
  if (!area) throw new Error('Sem área de venda no seed — rode `npm run db:seed`.')
  cdArea = area.cdArea
  filialId = area.filialId
})

afterAll(async () => {
  const vend = await prisma.dimVendedor.findFirst({ where: { filialId, codVendedor: COD } })
  if (vend) {
    await prisma.fatoVendaVendedor.deleteMany({ where: { vendedorId: vend.id } })
    await prisma.vendedorMes.deleteMany({ where: { vendedorId: vend.id } })
    await prisma.dimVendedor.delete({ where: { id: vend.id } })
  }
  await prisma.diaUtil.deleteMany({ where: { filialId } })
  await prisma.$disconnect()
  await app.close()
})

const vendedor = (over: Record<string, unknown> = {}) => ({
  filial: 'CEN',
  codVendedor: COD,
  matricula: '90001',
  nome: 'Vendedor de Teste',
  cdArea,
  areaVenda: 'Área de Teste',
  gerencia: 'CONSTRUÇÃO',
  ...over,
})

describe('a ordem das cargas', () => {
  /**
   * O caso que a ordem existe para impedir.
   *
   * Se a venda criasse o vendedor sob demanda, ele nasceria sem área — e
   * `dimensao_vendedor.area_venda_id` é obrigatória justamente porque vendedor
   * sem área não entra no denominador de área nenhuma. A venda ficaria gravada
   * e o indicador não o veria.
   */
  it('vendedor-dia RECUSA vendedor que não está no cadastro, dizendo o que rodar antes', async () => {
    const r = await enviar('vendedor-dia', {
      periodo: { de: DE, ate: ATE },
      linhas: [{ filial: 'CEN', data: DE, codVendedor: 'NAO-EXISTE', valor: 1000 }],
    })
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/não cadastrado.*vendedor-area/s)
  })

  it('vendedor-situacao recusa do mesmo jeito', async () => {
    const r = await enviar('vendedor-situacao', {
      linhas: [
        {
          filial: 'CEN',
          codVendedor: 'NAO-EXISTE',
          ano: ANO,
          mes: 3,
          meta: 100_000,
          sitafa: 1,
          houveVenda: 'COM_VENDA',
        },
      ],
    })
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/não cadastrado/)
  })

  /**
   * A área desconhecida é CRIADA aqui, e a regra mudou em 27/08/2026.
   *
   * Era recusa, com o argumento de que "a área nasce em `vendas-linha`, onde
   * vem acompanhada do movimento que a justifica". A primeira carga real
   * mostrou o custo: 27 áreas de CEN têm vendedor no cadastro e não venderam na
   * janela. Recusar fazia o vendedor SUMIR do indicador -- exatamente o que a
   * ordem das cargas existe para impedir.
   *
   * Criar aqui é seguro porque a gerência vem do MESMO cadastro corporativo,
   * não de um palpite. Metas continua recusando, e lá o argumento vale: meta de
   * área inventada ficaria no denominador para sempre, sem numerador.
   */
  it('vendedor-area CRIA a área que não existe, com a gerência da origem', async () => {
    const r = await enviar('vendedor-area', {
      linhas: [
        vendedor({
          codVendedor: 'T-VEND-NOVA',
          cdArea: 'T-AREA-NOVA',
          areaVenda: 'Área Nascida Aqui',
          gerencia: 'NÃO CONSTRUÇÃO',
        }),
      ],
    })
    expect(r.statusCode, r.body).toBe(200)

    const area = await prisma.dimAreaVenda.findFirst({
      where: { filialId, cdArea: 'T-AREA-NOVA' },
      include: { gerencia: true },
    })
    expect(area?.nome).toBe('Área Nascida Aqui')
    expect(area?.gerencia.nome).toBe('NÃO CONSTRUÇÃO')

    await prisma.dimVendedor.deleteMany({ where: { filialId, codVendedor: 'T-VEND-NOVA' } })
    await prisma.dimAreaVenda.deleteMany({ where: { filialId, cdArea: 'T-AREA-NOVA' } })
  })
})

describe('cadastro e venda', () => {
  it('vendedor-area cria, e reenviar não duplica', async () => {
    expect((await enviar('vendedor-area', { linhas: [vendedor()] })).statusCode).toBe(200)
    expect((await enviar('vendedor-area', { linhas: [vendedor({ nome: 'Nome Novo' })] })).statusCode).toBe(200)

    const todos = await prisma.dimVendedor.findMany({ where: { filialId, codVendedor: COD } })
    expect(todos).toHaveLength(1)
    expect(todos[0]?.nome, 'o cadastro segue a origem').toBe('Nome Novo')
  })

  /**
   * Negativo é legítimo: a medida é `LIQUIDA` (venda − devolução + refaturamento),
   * e um dia em que a devolução supera a venda fecha negativo de verdade.
   */
  it('vendedor-dia aceita valor negativo', async () => {
    const r = await enviar('vendedor-dia', {
      periodo: { de: DE, ate: ATE },
      linhas: [{ filial: 'CEN', data: DE, codVendedor: COD, valor: -4_500.5 }],
    })
    expect(r.statusCode, r.body).toBe(200)

    const f = await prisma.fatoVendaVendedor.findFirst({
      where: { filialId, data: new Date(`${DE}T00:00:00Z`) },
    })
    expect(Number(f?.valor)).toBe(-4_500.5)
  })

  it('reenviar a janela substitui, não soma', async () => {
    const carga = (valor: number) => ({
      periodo: { de: DE, ate: ATE },
      linhas: [{ filial: 'CEN', data: DE, codVendedor: COD, valor }],
    })
    await enviar('vendedor-dia', carga(1_000))
    await enviar('vendedor-dia', carga(2_000))

    const linhas = await prisma.fatoVendaVendedor.findMany({
      where: { filialId, data: { gte: new Date(`${DE}T00:00:00Z`) } },
    })
    expect(linhas).toHaveLength(1)
    expect(Number(linhas[0]?.valor)).toBe(2_000)
  })
})

describe('a situação do mês tem de ser REESCRITA', () => {
  /**
   * O defeito que este teste existe para impedir, e ele não daria erro nenhum.
   *
   * Enquanto março corre, a origem classifica todo mundo como MES_EM_VIGOR.
   * Quando março fecha, a MESMA linha vira COM_VENDA ou SEM_VENDA. Se a carga
   * só inserisse, o rótulo de março ficaria MES_EM_VIGOR para sempre — e como
   * a regra do denominador é `<> SEM_VENDA`, ninguém sairia dele nunca.
   */
  it('o rótulo do mês muda quando o mês fecha', async () => {
    const linha = (houveVenda: string, meta: number) => ({
      linhas: [{ filial: 'CEN', codVendedor: COD, ano: ANO, mes: 3, meta, sitafa: 1, houveVenda }],
    })

    await enviar('vendedor-situacao', linha('MES_EM_VIGOR', 500_000))
    await enviar('vendedor-situacao', linha('SEM_VENDA', 500_000))

    const meses = await prisma.vendedorMes.findMany({ where: { filialId, ano: ANO, mes: 3 } })
    expect(meses, 'substituição, não acúmulo').toHaveLength(1)
    expect(meses[0]?.houveVenda).toBe('SEM_VENDA')
  })

  it('substituir um mês não toca nos outros', async () => {
    const linha = (mes: number, meta: number) => ({
      filial: 'CEN',
      codVendedor: COD,
      ano: ANO,
      mes,
      meta,
      sitafa: 1,
      houveVenda: 'COM_VENDA' as const,
    })
    await enviar('vendedor-situacao', { linhas: [linha(4, 100), linha(5, 200)] })
    await enviar('vendedor-situacao', { linhas: [linha(4, 999)] })

    const abril = await prisma.vendedorMes.findFirst({ where: { filialId, ano: ANO, mes: 4 } })
    const maio = await prisma.vendedorMes.findFirst({ where: { filialId, ano: ANO, mes: 5 } })
    expect(Number(abril?.meta)).toBe(999)
    expect(Number(maio?.meta), 'maio não estava no lote e não foi tocado').toBe(200)
  })
})

describe('o calendário confere contra a origem', () => {
  /** Fevereiro de 2028 é bissexto: 29 dias. */
  const fevereiro = (naoUteis: number[], qtutil: number) => {
    const linhas = []
    let acumulado = 0
    for (let d = 1; d <= 29; d++) {
      const util = !naoUteis.includes(d)
      if (util) acumulado++
      linhas.push({
        filial: 'CEN',
        data: `${ANO}-02-${String(d).padStart(2, '0')}`,
        diaUtil: util,
        acumuladoDia: acumulado,
        uteisDoMes: qtutil,
      })
    }
    return { linhas }
  }

  it('aceita quando a contagem bate', async () => {
    const r = await enviar('dias-uteis', fevereiro([6, 13, 20, 27], 25))
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json().gravadas).toBe(29)
  })

  /**
   * A única defesa contra uma leitura errada de `FERIADO<n>`.
   *
   * As marcas são código de tipo de dia, com 32 valores distintos na base, e o
   * portal lê "zero é dia em que a loja abre". Se a leitura mudar, ou aparecer
   * um código novo, o número sai PLAUSÍVEL: uma cota diária alta demais põe a
   * loja inteira fora da meta, e ninguém desconfia do calendário olhando um
   * percentual baixo.
   */
  it('RECUSA quando o acumulado não fecha com o QTUTIL da origem', async () => {
    const r = await enviar('dias-uteis', fevereiro([6, 13, 20, 27], 21))
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/contei 25, a origem diz 21/)
  })

  /**
   * Mês parcial não é erro: o acumulado é menor que o total por direito. Cobrar
   * igualdade aqui recusaria a carga do mês corrente todo dia.
   */
  it('não cobra igualdade em mês incompleto', async () => {
    const parcial = fevereiro([6, 13, 20, 27], 25)
    parcial.linhas = parcial.linhas.slice(0, 10)
    const r = await enviar('dias-uteis', parcial)
    expect(r.statusCode, r.body).toBe(200)
  })

  it('recarregar o mês o refaz inteiro, sem duplicar', async () => {
    await enviar('dias-uteis', fevereiro([6, 13, 20, 27], 25))
    await enviar('dias-uteis', fevereiro([6, 13, 20, 27], 25))
    const dias = await prisma.diaUtil.findMany({
      where: { filialId, data: { gte: new Date(`${ANO}-02-01`), lte: new Date(`${ANO}-02-29`) } },
    })
    expect(dias).toHaveLength(29)
  })
})

/**
 * A rota de leitura — `GET /gerencias/:id/performance-vendedor`.
 *
 * Três coisas aqui erram em SILÊNCIO, e cada uma tem um teste:
 *
 *  - o corte de um mês PASSADO ser o D-1 de hoje, e não o fim daquele mês;
 *  - a falta do calendário virar comparação contra a cota CHEIA, que reprova
 *    todo mundo no dia 10 e faz um problema de carga parecer problema de venda;
 *  - área sem vendedor sumir da resposta, e com ela sumir da reunião.
 */
describe('a rota de Performance Vendedor', () => {
  const ANO_P = 2024
  const MES_P = 5
  const COD_A = 'T-ROTA-A'
  const COD_B = 'T-ROTA-B'
  const COD_C = 'T-ROTA-C'

  let gerenciaId: string
  let areaComVendedor: string
  let areaVazia: string
  let filial: string
  let syncId: string

  type Resposta = {
    corte: { data: string; diasUteisDecorridos: number; diasUteisDoMes: number } | null
    areas: {
      areaVendaId: string
      nome: string
      numerador: number
      denominador: number
      percentual: number | null
      foraDaConta: { semMeta: number; inativos: number; outros: number }
    }[]
    gerencia: { numerador: number; denominador: number; percentual: number | null } | null
  }

  const pedir = async (semana?: number): Promise<Resposta> => {
    const q = semana === undefined ? '' : `&semana=${String(semana)}`
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/gerencias/${gerenciaId}/performance-vendedor?ano=${ANO_P}&mes=${MES_P}${q}`,
    })
    expect(r.statusCode, r.body).toBe(200)
    return r.json<Resposta>()
  }

  /** Calendário do mês inteiro, sem nenhum dia fechado. */
  const semearCalendario = async () => {
    const dias = []
    for (let d = 1; d <= 31; d++) {
      dias.push({
        filialId: filial,
        data: new Date(Date.UTC(ANO_P, MES_P - 1, d)),
        diaUtil: true,
        acumuladoDia: d,
        uteisDoMes: 31,
        syncId,
      })
    }
    await prisma.diaUtil.createMany({ data: dias })
  }

  beforeAll(async () => {
    const g = await prisma.dimGerencia.findFirst({
      where: { areasVenda: { some: {} } },
      include: { areasVenda: { orderBy: { nome: 'asc' }, select: { id: true } } },
    })
    if (!g || g.areasVenda.length < 2) throw new Error('Precisa de gerência com 2+ áreas.')
    gerenciaId = g.id
    filial = g.filialId
    areaComVendedor = g.areasVenda[0]!.id
    areaVazia = g.areasVenda[1]!.id

    const sync = await prisma.syncExecucao.create({
      data: {
        fonte: 'teste-rota-vendedor',
        status: 'SUCESSO',
        periodoDe: new Date(Date.UTC(ANO_P, MES_P - 1, 1)),
        periodoAte: new Date(Date.UTC(ANO_P, MES_P, 0)),
        linhasRecebidas: 0,
        linhasGravadas: 0,
        finalizadoEm: new Date(),
      },
    })
    syncId = sync.id

    /*
     * Três vendedores na mesma área, cada um exercitando um caminho:
     *   A  bateu a cota
     *   B  não bateu
     *   C  cota ZERO -- fica fora do denominador, e não como "não bateu"
     */
    for (const [cod, meta, valor] of [
      [COD_A, 100_000, 120_000],
      [COD_B, 100_000, 50_000],
      [COD_C, 0, 80_000],
    ] as const) {
      const v = await prisma.dimVendedor.create({
        data: {
          filialId: filial,
          codVendedor: cod,
          matricula: null,
          nome: cod,
          areaVendaId: areaComVendedor,
        },
      })
      await prisma.vendedorMes.create({
        data: {
          filialId: filial,
          vendedorId: v.id,
          ano: ANO_P,
          mes: MES_P,
          meta,
          sitafa: 1,
          houveVenda: 'COM_VENDA',
          syncId,
        },
      })
      await prisma.fatoVendaVendedor.create({
        data: {
          filialId: filial,
          data: new Date(Date.UTC(ANO_P, MES_P - 1, 15)),
          vendedorId: v.id,
          valor,
          syncId,
        },
      })
    }
  })

  afterAll(async () => {
    const vs = await prisma.dimVendedor.findMany({
      where: { codVendedor: { in: [COD_A, COD_B, COD_C] } },
      select: { id: true },
    })
    const ids = vs.map((v) => v.id)
    await prisma.fatoVendaVendedor.deleteMany({ where: { vendedorId: { in: ids } } })
    await prisma.vendedorMes.deleteMany({ where: { vendedorId: { in: ids } } })
    await prisma.dimVendedor.deleteMany({ where: { id: { in: ids } } })
    await prisma.diaUtil.deleteMany({ where: { syncId } })
    await prisma.syncExecucao.deleteMany({ where: { id: syncId } })
  })

  /**
   * Sem calendário a rota devolve VAZIO, e não a comparação contra a cota cheia.
   *
   * A cota cheia no dia 10 reprovaria todo mundo: o quadro ficaria vermelho por
   * falta de CARGA, e um problema de dado seria lido como problema de venda —
   * a reunião discutiria uma queda que não existe.
   */
  it('sem calendário não inventa comparação: devolve vazio', async () => {
    const r = await pedir()
    expect(r.corte).toBeNull()
    expect(r.areas).toEqual([])
    expect(r.gerencia).toBeNull()
  })

  describe('com o calendário carregado', () => {
    beforeAll(semearCalendario)

    /**
     * O corte de um mês PASSADO é o fim daquele mês, não o D-1 de hoje.
     *
     * Sem o limite, olhar maio de 2024 em agosto de 2026 rateria a cota de maio
     * pelos dias úteis decorridos de ONTEM — que nem são do mesmo mês.
     */
    it('mês passado usa o mês inteiro, não o D-1 de hoje', async () => {
      const r = await pedir()
      expect(r.corte?.data).toBe(`${ANO_P}-0${MES_P}-31`)
      expect(r.corte?.diasUteisDecorridos).toBe(31)
      expect(r.corte?.diasUteisDoMes).toBe(31)
    })

    /**
     * **A SEMANA move o corte** — e é isso que a tela do N4 e a do N3 pedem
     * quando alguém clica em S1…S5.
     *
     * Escolher a S2 pergunta "como estávamos no fim da S2": o acumulado do mês
     * até lá, contra a cota rateada pelos dias úteis até lá. Não é a semana
     * isolada — quem foi mal na S1 e bem na S2 está na meta na S2 se o
     * acumulado alcançou. Ver `bateuCotaAcumulada`.
     *
     * Maio/2024 começa numa quarta, então a S1 vai de 01 a 05 e a S2 de 06 a
     * 12 — pela definição única do quadro (`semanasDoMes`), que é a mesma da
     * grade de marcação.
     */
    it('a semana escolhida corta o mês: S2 termina no dia 12', async () => {
      const r = await pedir(2)
      expect(r.corte?.data).toBe(`${ANO_P}-0${MES_P}-12`)
      expect(r.corte?.diasUteisDecorridos, 'o calendário do corte, não o do mês').toBe(12)
      expect(r.corte?.diasUteisDoMes, 'o divisor continua sendo o mês inteiro').toBe(31)
    })

    it('a S1 de maio/2024 vai do dia 1 ao 5 — o mês começa numa quarta', async () => {
      expect(new Date(`${ANO_P}-0${MES_P}-01T00:00:00Z`).getUTCDay(), 'quarta').toBe(3)
      const r = await pedir(1)
      expect(r.corte?.data).toBe(`${ANO_P}-0${MES_P}-05`)
    })

    /**
     * A cota rateada por menos dias é MENOR, então o mesmo realizado passa a
     * bater com mais folga. É o ponto do rateio: comparar acumulado com
     * acumulado, nunca com a cota cheia do mês.
     */
    it('sem semana, o corte é o mês inteiro — e a cota é maior', async () => {
      const semanal = await pedir(1)
      const mensal = await pedir()
      expect(semanal.corte?.diasUteisDecorridos).toBe(5)
      expect(mensal.corte?.diasUteisDecorridos).toBe(31)
    })

    /**
     * **A FAÍSCA TEM DE CONCORDAR COM O KPI.**
     *
     * O ponto da semana selecionada no minigráfico é o número grande ao lado
     * dele. É a razão de a série chamar o mesmo cálculo em vez de uma versão
     * própria e mais barata: num gráfico a discordância nem chama atenção,
     * porque ninguém confere ponto a ponto.
     */
    it('a série semanal bate com o KPI de cada semana', async () => {
      const r = await app.inject({
        method: 'GET',
        url: `/api/v1/gerencias/${gerenciaId}/serie-semanal?ano=${ANO_P}&mes=${MES_P}`,
      })
      expect(r.statusCode, r.body).toBe(200)
      const serie = r.json<{
        semanas: { numero: number }[]
        vendedor: {
          gerencia: (number | null)[]
          areas: { areaVendaId: string; serie: (number | null)[] }[]
        }
        vendas: { gerencia: (number | null)[] }
      }>()

      expect(serie.semanas.length).toBeGreaterThan(0)
      expect(serie.vendedor.gerencia).toHaveLength(serie.semanas.length)
      // As duas variáveis têm série: uma faísca por KPI.
      expect(serie.vendas.gerencia).toHaveLength(serie.semanas.length)

      for (const [i, w] of serie.semanas.entries()) {
        const kpi = await pedir(w.numero)
        expect(serie.vendedor.gerencia[i], `gerência na S${String(w.numero)}`).toBe(
          kpi.gerencia?.percentual ?? null,
        )
        for (const a of serie.vendedor.areas) {
          const naSemana = kpi.areas.find((x) => x.areaVendaId === a.areaVendaId)
          expect(a.serie[i], `${a.areaVendaId} na S${String(w.numero)}`).toBe(
            naSemana?.percentual ?? null,
          )
        }
      }
    })

    /**
     * As semanas vêm na resposta porque o mês pode ter 4 ou 5, e as pontas
     * podem ser parciais. A tela não deve recalcular o calendário para saber
     * quantos pontos desenhar — seria uma terceira definição de semana.
     */
    it('devolve as semanas do mês, com as datas', async () => {
      const r = await app.inject({
        method: 'GET',
        url: `/api/v1/gerencias/${gerenciaId}/serie-semanal?ano=${ANO_P}&mes=${MES_P}`,
      })
      const { semanas } = r.json<{ semanas: { numero: number; de: string; ate: string }[] }>()
      // Maio/2024 começa numa quarta: a S1 abre no dia 1.
      expect(semanas[0]?.de).toBe(`${ANO_P}-0${MES_P}-01`)
      expect(semanas.map((w) => w.numero)).toEqual(semanas.map((_, i) => i + 1))
    })

    it('conta quem bateu, e tira do denominador quem não tem cota', async () => {
      const r = await pedir()
      const a = r.areas.find((x) => x.areaVendaId === areaComVendedor)
      expect(a?.numerador).toBe(1)
      expect(a?.denominador).toBe(2)
      expect(a?.percentual).toBe(50)
      expect(a?.foraDaConta.semMeta, 'cota zero sai da conta, não conta como falha').toBe(1)
    })

    /**
     * Área sem vendedor aparece ZERADA, não sumida.
     *
     * Omiti-la faria a área desaparecer do quadro por falta de cadastro — e
     * ninguém pergunta pelo que não está na tela.
     */
    it('área sem vendedor aparece zerada, não some', async () => {
      const r = await pedir()
      const vazia = r.areas.find((x) => x.areaVendaId === areaVazia)
      expect(vazia, 'a área tem de estar na resposta').toBeDefined()
      expect(vazia?.denominador).toBe(0)
      expect(vazia?.percentual).toBeNull()
    })

    it('o rolo da gerência soma numerador e denominador', async () => {
      const r = await pedir()
      expect(r.gerencia?.numerador).toBe(1)
      expect(r.gerencia?.denominador).toBe(2)
      expect(r.gerencia?.percentual).toBe(50)
    })
  })
})

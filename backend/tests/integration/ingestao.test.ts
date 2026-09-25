import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'

/**
 * Ingestão n8n → portal.
 *
 * A garantia mais importante é a **idempotência**: reenviar a mesma carga não
 * pode dobrar nenhum número. Depois vem a substituição de janela — o que sumiu
 * da origem tem que sumir do portal, senão fica um valor alto sem sintoma.
 *
 * Requer banco semeado. Os testes usam uma filial e datas fora da janela do
 * seed para não corromper os dados que os outros testes conferem.
 */

let app: FastifyInstance
const prisma = new PrismaClient()
const TOKEN = process.env.INGEST_TOKEN ?? ''

/** Janela isolada: 2025-03, longe do mês corrente usado pelos testes da matriz. */
const DE = '2025-03-10'
const ATE = '2025-03-12'

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  // Limpa a janela de teste para não deixar resíduo no banco de desenvolvimento.
  const janela = { data: { gte: new Date(`${DE}T00:00:00Z`), lte: new Date(`${ATE}T00:00:00Z`) } }
  await prisma.fatoNps.deleteMany({ where: janela })
  await prisma.fatoPerdas.deleteMany({ where: janela })
  await prisma.fatoMovimentacao.deleteMany({ where: janela })
  await prisma.$disconnect()
  await app.close()
})

function enviar(fonte: string, body: unknown, token: string | null = TOKEN) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/ingest/${fonte}`,
    ...(token === null ? {} : { headers: { 'x-ingest-token': token } }),
    payload: body as object,
  })
}

const lote = (valores: Array<[string, number, number, number]>) => ({
  periodo: { de: DE, ate: ATE },
  linhas: valores.map(([data, p, n, d]) => ({
    filial: 'CEN',
    data,
    qtdPromotores: p,
    qtdNeutros: n,
    qtdDetratores: d,
  })),
})

async function somaNps() {
  const r = await prisma.fatoNps.aggregate({
    where: { data: { gte: new Date(`${DE}T00:00:00Z`), lte: new Date(`${ATE}T00:00:00Z`) } },
    _sum: { qtdPromotores: true, qtdDetratores: true },
    _count: true,
  })
  return {
    linhas: r._count,
    promotores: r._sum.qtdPromotores ?? 0,
    detratores: r._sum.qtdDetratores ?? 0,
  }
}

describe('autenticação da ingestão', () => {
  it('recusa sem token', async () => {
    const r = await enviar('nps', lote([[DE, 10, 5, 2]]), null)
    expect(r.statusCode).toBe(401)
  })

  it('recusa token errado', async () => {
    const r = await enviar('nps', lote([[DE, 10, 5, 2]]), 'token-invalido-mas-com-tamanho')
    expect(r.statusCode).toBe(401)
  })

  it('token ausente e token errado dão a MESMA resposta', async () => {
    // Distinguir os dois já entrega ao atacante que ele acertou o formato.
    const semToken = await enviar('nps', lote([[DE, 10, 5, 2]]), null)
    const tokenRuim = await enviar('nps', lote([[DE, 10, 5, 2]]), 'x'.repeat(40))
    expect(semToken.json().erro).toBe(tokenRuim.json().erro)
    expect(semToken.json().codigo).toBe(tokenRuim.json().codigo)
  })
})

describe('idempotência', () => {
  it('reenviar a mesma carga não dobra nada', async () => {
    const carga = lote([
      [DE, 100, 20, 10],
      ['2025-03-11', 90, 25, 15],
    ])

    const primeira = await enviar('nps', carga)
    expect(primeira.statusCode, primeira.body).toBe(200)
    const depoisDaPrimeira = await somaNps()

    const segunda = await enviar('nps', carga)
    expect(segunda.statusCode).toBe(200)
    const depoisDaSegunda = await somaNps()

    expect(depoisDaSegunda).toEqual(depoisDaPrimeira)
    expect(depoisDaSegunda.linhas).toBe(2)
  })
})

describe('substituição de janela', () => {
  it('linha que sumiu da origem some do portal', async () => {
    await enviar(
      'nps',
      lote([
        [DE, 100, 20, 10],
        ['2025-03-11', 90, 25, 15],
        ['2025-03-12', 80, 30, 20],
      ]),
    )
    expect((await somaNps()).linhas).toBe(3)

    // A origem passa a devolver só 2 dias — o terceiro foi estornado.
    const r = await enviar(
      'nps',
      lote([
        [DE, 100, 20, 10],
        ['2025-03-11', 90, 25, 15],
      ]),
    )
    expect(r.statusCode).toBe(200)
    expect(r.json().removidas).toBeGreaterThanOrEqual(3)

    // Com upsert puro, a linha do dia 12 continuaria viva e o número ficaria alto.
    expect((await somaNps()).linhas).toBe(2)
  })

  it('não toca em dados fora da janela declarada', async () => {
    const antes = await prisma.fatoNps.count({
      where: { data: { lt: new Date(`${DE}T00:00:00Z`) } },
    })
    await enviar('nps', lote([[DE, 100, 20, 10]]))
    const depois = await prisma.fatoNps.count({
      where: { data: { lt: new Date(`${DE}T00:00:00Z`) } },
    })
    expect(depois).toBe(antes)
  })
})

/**
 * Perdas é a única fonte que aceita valor negativo.
 *
 * O valor vem da origem com sinal, e nenhum sinal está associado a um tipo de
 * quebra: QI e QNI podem vir positivas ou negativas. Um dia negativo é fato, não
 * defeito.
 *
 * Recusar derrubaria a carga inteira num dia desses; forçar para positivo
 * mudaria o número sem sintoma nenhum.
 */
describe('perdas aceita valor negativo, as outras fontes não', () => {
  const linha = (valor: number) => ({
    periodo: { de: DE, ate: ATE },
    linhas: [
      { filial: 'CEN', data: DE, tipoQuebra: 'QI', status: 'APROVADA', valor },
    ],
  })

  it('aceita valor negativo', async () => {
    const r = await enviar('perdas', linha(-5797.22))
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json().gravadas).toBe(1)

    const gravada = await prisma.fatoPerdas.findFirst({
      where: { data: new Date(`${DE}T00:00:00Z`), tipoQuebra: 'QI' },
      select: { valor: true },
    })
    expect(Number(gravada?.valor)).toBe(-5797.22)
  })

  it('aceita valor positivo', async () => {
    const r = await enviar('perdas', linha(17126.43))
    expect(r.statusCode, r.body).toBe(200)
  })

  it('movimentação continua recusando negativo — é faturamento, não tem sinal', async () => {
    const r = await enviar('movimentacao', {
      periodo: { de: DE, ate: ATE },
      linhas: [{ filial: 'CEN', data: DE, valor: -100 }],
    })
    expect(r.statusCode).toBe(400)
  })
})

describe('validação recusa a carga inteira', () => {
  it('filial desconhecida', async () => {
    const r = await enviar('nps', {
      periodo: { de: DE, ate: ATE },
      linhas: [{ filial: 'ZZZ', data: DE, qtdPromotores: 1, qtdNeutros: 1, qtdDetratores: 1 }],
    })
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/ZZZ/)
  })

  it('data fora do período declarado', async () => {
    const r = await enviar('nps', {
      periodo: { de: DE, ate: ATE },
      linhas: [
        { filial: 'CEN', data: '2025-01-01', qtdPromotores: 1, qtdNeutros: 1, qtdDetratores: 1 },
      ],
    })
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/fora do período/i)
  })

  it('período no futuro', async () => {
    const futuro = new Date()
    futuro.setFullYear(futuro.getFullYear() + 1)
    const iso = futuro.toISOString().slice(0, 10)
    const r = await enviar('nps', {
      periodo: { de: iso, ate: iso },
      linhas: [{ filial: 'CEN', data: iso, qtdPromotores: 1, qtdNeutros: 1, qtdDetratores: 1 }],
    })
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/futuro/i)
  })

  it('chave repetida no payload aponta o GROUP BY faltando', async () => {
    const r = await enviar('nps', {
      periodo: { de: DE, ate: ATE },
      linhas: [
        { filial: 'CEN', data: DE, qtdPromotores: 1, qtdNeutros: 1, qtdDetratores: 1 },
        { filial: 'CEN', data: DE, qtdPromotores: 2, qtdNeutros: 2, qtdDetratores: 2 },
      ],
    })
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/GROUP BY/i)
  })

  it('valor negativo é rejeitado no schema', async () => {
    const r = await enviar('nps', {
      periodo: { de: DE, ate: ATE },
      linhas: [{ filial: 'CEN', data: DE, qtdPromotores: -1, qtdNeutros: 1, qtdDetratores: 1 }],
    })
    expect(r.statusCode).toBe(400)
  })

  it('carga inválida não grava NADA — é tudo ou nada', async () => {
    await enviar('nps', lote([[DE, 100, 20, 10]]))
    const antes = await somaNps()

    // Segunda linha inválida: a primeira também não pode entrar.
    const r = await enviar('nps', {
      periodo: { de: DE, ate: ATE },
      linhas: [
        { filial: 'CEN', data: '2025-03-11', qtdPromotores: 5, qtdNeutros: 5, qtdDetratores: 5 },
        { filial: 'ZZZ', data: '2025-03-12', qtdPromotores: 5, qtdNeutros: 5, qtdDetratores: 5 },
      ],
    })
    expect(r.statusCode).toBe(422)
    expect(await somaNps()).toEqual(antes)
  })
})

describe('registro da execução', () => {
  it('carga bem-sucedida vira SUCESSO com a contagem real', async () => {
    const r = await enviar('nps', lote([[DE, 100, 20, 10]]))
    const { syncId, gravadas } = r.json()

    const sync = await prisma.syncExecucao.findUniqueOrThrow({ where: { id: syncId } })
    expect(sync.status).toBe('SUCESSO')
    expect(sync.linhasGravadas).toBe(gravadas)
    expect(sync.fonte).toBe('nps')
    expect(sync.finalizadoEm).not.toBeNull()
  })

  it('carga que falha fica registrada como ERRO, não some junto com a transação', async () => {
    const antes = await prisma.syncExecucao.count({ where: { fonte: 'nps', status: 'ERRO' } })
    await enviar('nps', {
      periodo: { de: DE, ate: ATE },
      linhas: [{ filial: 'ZZZ', data: DE, qtdPromotores: 1, qtdNeutros: 1, qtdDetratores: 1 }],
    })
    // A validação de filial acontece antes de abrir a execução, então este
    // caso não gera registro — documenta a fronteira entre os dois momentos.
    const depois = await prisma.syncExecucao.count({ where: { fonte: 'nps', status: 'ERRO' } })
    expect(depois).toBe(antes)
  })
})

describe('lote vazio', () => {
  /**
   * A ingestão SUBSTITUI a janela: apaga o período e grava o que chegou. Lote
   * vazio apagaria dado bom sem repor nada — e é o formato exato de uma consulta
   * que falhou SEM erro na origem (coluna renomeada, filtro que deixou de casar,
   * credencial expirada devolvendo lista vazia).
   *
   * Os dois clientes já abortavam antes de enviar. Não bastava: quem apaga é o
   * servidor, e ele aceitava. Descoberto ao testar a rotação do INGEST_TOKEN com
   * um payload vazio — a janela sorteada não tinha dado, e por sorte nada se
   * perdeu.
   */
  const vazio = { periodo: { de: '2026-08-20', ate: '2026-08-20' }, linhas: [] }

  for (const fonte of ['vendas', 'vendas-linha', 'nps', 'perdas', 'movimentacao']) {
    it(`e recusado em /ingest/${fonte}`, async () => {
      const r = await app.inject({
        method: 'POST',
        url: `/api/v1/ingest/${fonte}`,
        headers: { 'x-ingest-token': process.env.INGEST_TOKEN ?? '' },
        payload: vazio,
      })
      expect(r.statusCode, r.body).toBe(400)
      expect(r.body).toMatch(/vazio/i)
    })
  }

  it('nao apaga nada ao recusar', async () => {
    const antes = await prisma.fatoNps.count()
    await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/nps',
      headers: { 'x-ingest-token': process.env.INGEST_TOKEN ?? '' },
      payload: vazio,
    })
    expect(await prisma.fatoNps.count()).toBe(antes)
  })
})

describe('carga de metas', () => {
  /**
   * A carga real do n8n manda 216 metas — 9 filiais x 12 meses x 2 indicadores.
   *
   * A versao anterior fazia um `upsert` por linha DENTRO da transacao. Com o
   * Postgres local, 216 x ~2 ms davam 0,4 s e o defeito nao aparecia. Com o banco
   * no servidor, 216 x ~105 ms dao 23 segundos — acima do teto de 5 s da
   * transacao interativa do Prisma, que fecha no meio do laco e devolve
   * `Transaction not found`. A carga do n8n quebrou exatamente assim.
   *
   * Este teste roda contra o Postgres LOCAL, entao nao reproduz a latencia. O que
   * ele trava e' a propriedade que a correcao garante: um lote grande e' gravado
   * em poucas idas ao banco, e reenviar substitui em vez de duplicar.
   */
  function metasDeTodoOAno(valor: number) {
    const filiais = ['CEN', 'NOR', 'SUL', 'LES', 'OES', 'LIT', 'SER', 'CAM', 'PRA']
    const linhas: Array<{ indicador: string; filial: string; ano: number; mes: number; valor: number }> = []
    for (const indicador of ['vendas', 'nps']) {
      for (const filial of filiais) {
        for (let mes = 1; mes <= 12; mes++) {
          linhas.push({ indicador, filial, ano: 2031, mes, valor })
        }
      }
    }
    return linhas
  }

  const enviar = (linhas: unknown[]) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/ingest/metas',
      headers: { 'x-ingest-token': process.env.INGEST_TOKEN ?? '' },
      payload: { linhas },
    })

  afterAll(async () => {
    await prisma.meta.deleteMany({ where: { ano: 2031 } })
  })

  it('grava um lote de 216 metas', async () => {
    const r = await enviar(metasDeTodoOAno(1000))
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json().gravadas).toBe(216)
    expect(await prisma.meta.count({ where: { ano: 2031 } })).toBe(216)
  })

  /** Reenviar a mesma competencia e' operacao normal: substitui, nao duplica. */
  it('reenviar substitui em vez de duplicar', async () => {
    await enviar(metasDeTodoOAno(1000))
    const r = await enviar(metasDeTodoOAno(2000))

    expect(r.statusCode).toBe(200)
    expect(await prisma.meta.count({ where: { ano: 2031 } })).toBe(216)

    const uma = await prisma.meta.findFirst({ where: { ano: 2031 } })
    expect(Number(uma?.valor)).toBe(2000)
  })

  /**
   * O `deleteMany` apaga por CHAVE, nao por intervalo de competencia. Apagar por
   * ano/mes removeria meta de indicador que nem estava no lote.
   */
  it('nao toca meta que nao veio no lote', async () => {
    await enviar(metasDeTodoOAno(1000))
    const antes = await prisma.meta.count({ where: { ano: { not: 2031 } } })

    await enviar(metasDeTodoOAno(3000))

    expect(await prisma.meta.count({ where: { ano: { not: 2031 } } })).toBe(antes)
  })
})

/**
 * A carga de vendas por linha, que até 26/08/2026 não tinha teste nenhum de
 * corpo — só entrava no laço genérico que verifica lote vazio.
 *
 * Foi assim que tornar `area` obrigatória no payload não quebrou a suíte: não
 * havia nada exercitando o contrato. O que estes testes protegem é a ÁREA, que
 * é o escopo do N4 e por isso não pode entrar errada nem faltar.
 */
describe('vendas por area de venda: a hierarquia', () => {
  /**
   * A carga de vendas por linha, que até 26/08/2026 não tinha teste de corpo
   * nenhum — só entrava no laço genérico de lote vazio. Foi assim que tornar a
   * hierarquia obrigatória não quebrou a suíte: não havia nada exercitando o
   * contrato.
   *
   * O que estes testes protegem são os dois níveis — gerência e área de venda.
   * A gerência é o escopo do N4, então não pode entrar errada nem faltar.
   *
   * ERAM TRÊS ATÉ 18/09/2026: havia a linha de produto abaixo da área, e ela
   * era o grão do fato. Saiu porque nenhuma tela a lia. Ver o cabeçalho de
   * `src/fontes/sql/vendas-linha.sql`.
   *
   * A soma do detalhe tem de bater com o agregado do dia; é regra do módulo, e
   * boa. Por isso os testes leem o agregado do seed e o distribuem, em vez de
   * mandar valor qualquer.
   */
  const DIA = '2026-08-21'
  const ONTEM = '2026-08-20'
  let totalDia = 0
  let totalOntem = 0

  const agregado = async (data: string) => {
    const f = await prisma.fatoVendas.findFirst({
      where: { data: new Date(`${data}T00:00:00.000Z`), filial: { sigla: 'CEN' } },
      select: { valorReal: true },
    })
    if (!f) throw new Error(`Sem agregado de vendas para CEN em ${data}. O seed mudou?`)
    return Number(f.valorReal)
  }

  beforeAll(async () => {
    totalDia = await agregado(DIA)
    totalOntem = await agregado(ONTEM)
  })

  const corpo = (data: string, linhas: unknown[]) => ({ periodo: { de: data, ate: data }, linhas })
  const venda = (over: Record<string, unknown> = {}) => ({
    filial: 'CEN',
    data: DIA,
    gerencia: 'Construção',
    cdArea: '10',
    areaVenda: 'Pisos e Revestimentos',
    valor: totalDia,
    ...over,
  })

  /** O grão é a ÁREA, então é por `cdArea` que se acha a linha do fato. */
  const doFato = (data: string, cdArea: string) =>
    prisma.fatoVendasLinha.findFirst({
      where: {
        data: new Date(`${data}T00:00:00.000Z`),
        areaVenda: { cdArea },
        filial: { sigla: 'CEN' },
      },
      include: {
        gerencia: { select: { nome: true } },
        areaVenda: { select: { nome: true, cdArea: true } },
      },
    })

  it('os dois níveis são obrigatórios — falta um, a carga é recusada', async () => {
    for (const faltando of ['gerencia', 'cdArea', 'areaVenda']) {
      const v = venda()
      // O apagamento dinamico E' o teste: percorre os campos obrigatorios
      // removendo um por vez para provar que cada ausencia da' 400.
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (v as Record<string, unknown>)[faltando]
      const r = await enviar('vendas-linha', corpo(DIA, [v]))
      expect(r.statusCode, `sem ${faltando}: ${r.body}`).toBe(400)
    }
  })

  it('cria as duas dimensões e grava no fato a área e a gerência do dia', async () => {
    const r = await enviar('vendas-linha', corpo(DIA, [venda()]))
    expect(r.statusCode, r.body).toBe(200)

    const f = await doFato(DIA, '10')
    expect(f?.gerencia.nome).toBe('Construção')
    expect(f?.areaVenda.nome).toBe('Pisos e Revestimentos')
  })

  /**
   * O GRÃO, e é o que mudou em 18/09/2026.
   *
   * Uma linha do fato por (filial, dia, área). Antes era por linha de produto,
   * e o mesmo lote podia trazer dez linhas da mesma área; hoje isso é chave
   * repetida, e a ingestão recusa o lote inteiro em vez de gravar o último e
   * perder os outros em silêncio.
   */
  it('o grão é a ÁREA: duas áreas dão duas linhas no fato', async () => {
    const metade = Math.round(totalDia / 2)
    const r = await enviar('vendas-linha', corpo(DIA, [
      venda({ cdArea: '10', areaVenda: 'Pisos e Revestimentos', valor: metade }),
      venda({ cdArea: '20', areaVenda: 'Eletro', gerencia: 'Não Construção', valor: totalDia - metade }),
    ]))
    expect(r.statusCode, r.body).toBe(200)

    const [pisos, eletro] = await Promise.all([doFato(DIA, '10'), doFato(DIA, '20')])
    expect(pisos?.gerencia.nome).toBe('Construção')
    expect(eletro?.gerencia.nome).toBe('Não Construção')
  })

  it('a MESMA área duas vezes no lote é chave repetida — a carga é recusada', async () => {
    const metade = Math.round(totalDia / 2)
    const r = await enviar('vendas-linha', corpo(DIA, [
      venda({ cdArea: '10', valor: metade }),
      venda({ cdArea: '10', valor: totalDia - metade }),
    ]))
    /*
     * 422 e não 400: o corpo é válido para o schema — dois objetos bem
     * formados. O que ele viola é uma regra do domínio, e `DadosInvalidos` é o
     * erro dessa camada. Escrevi 400 na primeira versão e o teste pegou.
     */
    expect(r.statusCode, r.body).toBe(422)
    // A MENSAGEM nomeia a chave nova, e é ela que diz à origem o que corrigir.
    expect(r.body).toContain('filial+data+area')
  })

  /**
   * O motivo de área e gerência existirem TAMBÉM no fato.
   *
   * Se morassem só na dimensão, realocar a área de venda reescreveria o
   * passado: as vendas de ontem passariam a contar para a gerência de hoje, e a
   * série histórica do GD mudaria sozinha sem ninguém tocar em fato nenhum.
   */
  it('realocar a área de venda NÃO reescreve o passado', async () => {
    await enviar('vendas-linha', corpo(ONTEM, [
      venda({ data: ONTEM, gerencia: 'Não Construção', cdArea: '20', areaVenda: 'Eletro', valor: totalOntem }),
    ]))

    // A origem realoca: Eletro passa para Construção.
    await enviar('vendas-linha', corpo(DIA, [
      venda({ gerencia: 'Construção', cdArea: '20', areaVenda: 'Eletro', valor: totalDia }),
    ]))

    const [antes, depois] = await Promise.all([doFato(ONTEM, '20'), doFato(DIA, '20')])
    expect(antes?.gerencia.nome).toBe('Não Construção')
    expect(depois?.gerencia.nome).toBe('Construção')

    /*
     * Por CÓDIGO, não por nome.
     *
     * Filtrar por filial não basta mais: desde 27/08 `nome` não é único, e o
     * seed cria uma "Eletro" própria em CEN (com `cd_area` `SEED:Eletro`). Duas
     * linhas com o mesmo nome na mesma loja — o `findFirst` por nome devolveria
     * uma das duas conforme a ordem do banco, e o teste passaria ou falharia
     * sem nada ter mudado. Foi assim que ele quebrou quando a coluna entrou.
     */
    const area = await prisma.dimAreaVenda.findFirst({
      where: { cdArea: '20', filial: { sigla: 'CEN' } },
      include: { gerencia: { select: { nome: true } } },
    })
    expect(area?.gerencia.nome).toBe('Construção')
  })

  /**
   * A razão de `cd_area` existir (27/08/2026, PLANO §7.14).
   *
   * Enquanto a identidade da área era o NOME, corrigir uma grafia no cadastro
   * corporativo criava uma área NOVA na carga seguinte. Nada falhava: a antiga
   * ficava com o histórico e com a meta, a nova recebia o movimento do dia, e
   * as duas apareciam no quadro do N4 — uma sem meta, outra sem venda.
   *
   * Pelo código, renomear é só renomear.
   */
  it('renomear a área na origem NÃO cria área nova — o código é a identidade', async () => {
    await enviar('vendas-linha', corpo(ONTEM, [
      venda({ data: ONTEM, cdArea: '30', areaVenda: 'Metais', valor: totalOntem }),
    ]))
    const antes = await prisma.dimAreaVenda.findFirst({
      where: { cdArea: '30', filial: { sigla: 'CEN' } },
    })
    expect(antes?.nome).toBe('Metais')

    // A origem corrige a grafia. Mesmo código, outro rótulo.
    await enviar('vendas-linha', corpo(DIA, [
      venda({ cdArea: '30', areaVenda: 'Metais e Louças', valor: totalDia }),
    ]))

    const todas = await prisma.dimAreaVenda.findMany({
      where: { cdArea: '30', filial: { sigla: 'CEN' } },
    })
    expect(todas, 'renomear não pode duplicar a área').toHaveLength(1)
    expect(todas[0]?.id, 'é a MESMA linha — o histórico e a meta seguem com ela').toBe(antes?.id)
    expect(todas[0]?.nome, 'o rótulo acompanha a origem').toBe('Metais e Louças')
  })
})

/**
 * Meta por ÁREA DE VENDA — o denominador de Performance Vendas.
 *
 * O que se protege é a assimetria que passaria em silêncio: `vendas-linha.sql`
 * usa INNER JOIN, então linha sem área some do REALIZADO. Se a meta aceitasse
 * área desconhecida, a mesma linha entraria no denominador e não no numerador —
 * e Performance Vendas apareceria pior do que é, para sempre, sem nada acusar.
 */
describe('metas por área de venda', () => {
  /*
   * Competência FORA do que o seed cobre (2025-2026).
   *
   * Estes testes gravam meta, e meta é upsert por competência — escrever em
   * agosto de 2026 sobrescreveria a do seed, que `serie-semanal.test.ts` lê
   * para conferir o gráfico contra o painel. O teste quebraria longe daqui,
   * noutro arquivo, por um motivo que não é defeito.
   */
  const ANO = 2027
  const MES = 8

  const enviarMetas = (linhas: unknown[]) => enviar('metas', { linhas })

  it('grava no escopo AREA_VENDA, com a área como alvo', async () => {
    const area = await prisma.dimAreaVenda.findFirst({
      where: { filial: { sigla: 'CEN' } },
      include: { filial: { select: { sigla: true } } },
    })
    if (!area) throw new Error('Sem área de venda no seed.')

    const r = await enviarMetas([
      {
        indicador: 'vendas',
        filial: area.filial.sigla,
        ano: ANO,
        mes: MES,
        valor: 1_234_567,
        cdArea: area.cdArea,
        areaVenda: area.nome,
        gerencia: 'Construção',
      },
    ])
    expect(r.statusCode, r.body).toBe(200)

    const m = await prisma.meta.findFirst({
      where: { escopo: 'AREA_VENDA', alvoId: area.id, ano: ANO, mes: MES },
    })
    expect(Number(m?.valor)).toBe(1_234_567)
  })

  it('sem cdArea continua sendo meta do indicador — o comportamento de sempre', async () => {
    const r = await enviarMetas([
      { indicador: 'vendas', filial: 'CEN', ano: ANO, mes: MES, valor: 9_000_000 },
    ])
    expect(r.statusCode, r.body).toBe(200)

    const ind = await prisma.indicador.findUnique({ where: { codigo: 'vendas' } })
    const m = await prisma.meta.findFirst({
      where: { escopo: 'INDICADOR', alvoId: ind!.id, ano: ANO, mes: MES, filial: { sigla: 'CEN' } },
    })
    expect(Number(m?.valor)).toBe(9_000_000)
  })

  /**
   * Área desconhecida é CRIADA, e a regra mudou em 27/08/2026.
   *
   * Era recusa, com o argumento de que uma área inventada receberia meta que
   * nunca casaria com venda. A primeira carga real derrubou o argumento: **7
   * áreas têm orçamento e não venderam nem têm vendedor na janela**, e por
   * causa delas as 9.603 metas não entravam. Recusar não protegia nada.
   *
   * A área não é inventada: o código vem da origem e a gerência de
   * `ERP_AREA_VENDA.TIPO_AREA`. Área com meta e sem venda aparece no quadro com
   * gap de −100%, que é informação.
   */
  it('cria a área que não existe, com a gerência da origem', async () => {
    const r = await enviarMetas([
      {
        indicador: 'vendas',
        filial: 'CEN',
        ano: ANO,
        mes: MES,
        valor: 100,
        cdArea: 'T-META-AREA-NOVA',
        areaVenda: 'Área Só Com Meta',
        gerencia: 'Não Construção',
      },
    ])
    expect(r.statusCode, r.body).toBe(200)

    const area = await prisma.dimAreaVenda.findFirst({
      where: { cdArea: 'T-META-AREA-NOVA', filial: { sigla: 'CEN' } },
    })
    expect(area?.nome).toBe('Área Só Com Meta')
    await prisma.meta.deleteMany({ where: { alvoId: area!.id } })
    await prisma.dimAreaVenda.delete({ where: { id: area!.id } })
  })

  /**
   * A recusa que SOBROU, e ela protege a criação.
   *
   * Sem nome e gerência não dá para criar a área -- e criar uma pela metade,
   * com rótulo vazio ou gerência inventada, seria pior que recusar.
   */
  it('recusa código de área sem o nome e a gerência que permitem criá-la', async () => {
    const r = await enviarMetas([
      { indicador: 'vendas', filial: 'CEN', ano: ANO, mes: MES, valor: 100, cdArea: 'SO-O-CODIGO' },
    ])
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/exige .areaVenda. e .gerencia./)
  })

  it('as duas metas convivem: a do indicador e a da área não se apagam', async () => {
    const area = await prisma.dimAreaVenda.findFirst({ where: { filial: { sigla: 'CEN' } } })
    await enviarMetas([
      { indicador: 'vendas', filial: 'CEN', ano: ANO, mes: MES, valor: 8_000_000 },
      {
        indicador: 'vendas',
        filial: 'CEN',
        ano: ANO,
        mes: MES,
        valor: 500_000,
        cdArea: area!.cdArea,
        areaVenda: area!.nome,
        gerencia: 'Construção',
      },
    ])

    const ind = await prisma.indicador.findUnique({ where: { codigo: 'vendas' } })
    const [doIndicador, daArea] = await Promise.all([
      // Com FILIAL: o seed cria meta de vendas nas nove, e sem o filtro o
      // `findFirst` devolve a de outra loja.
      prisma.meta.findFirst({
        where: { escopo: 'INDICADOR', alvoId: ind!.id, ano: ANO, mes: MES, filial: { sigla: 'CEN' } },
      }),
      prisma.meta.findFirst({ where: { escopo: 'AREA_VENDA', alvoId: area!.id, ano: ANO, mes: MES } }),
    ])
    expect(Number(doIndicador?.valor)).toBe(8_000_000)
    expect(Number(daArea?.valor)).toBe(500_000)
  })
})

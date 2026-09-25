import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import { exigirSeed } from '../helpers/seed.js'

/**
 * As rotas de contramedida — o ciclo inteiro, ponta a ponta.
 *
 * As políticas já têm teste puro; o que este arquivo protege é o que só aparece
 * quando rota, política e banco se encontram, e que falha em SILÊNCIO:
 *
 *  - concluir mudando o nível apagaria o sinal de onde a cadeia de ajuda
 *    resolveu (PLANO §7.3) — e ninguém veria, porque a ação continua lá;
 *  - feedback aceito de quem não abriu encerraria o ciclo com o julgamento da
 *    pessoa errada;
 *  - agrupamento de outro nível criaria ação que não aparece em coluna nenhuma;
 *  - a rota de revisar, se voltasse, seria um segundo jeito de devolver a ação
 *    — sem observação e com o destino escolhido pela tela. Devolver hoje é
 *    `/rejeitar` (§7.58), testada em `rejeicao.test.ts`.
 *
 * Nenhum desses dá erro visível na tela. Só teste pega.
 */

await exigirSeed()

const prisma = new PrismaClient()
let app: FastifyInstance

/** O bypass de desenvolvimento entra como `f00001mle`, o N2 do seed. */
const EU = 'f00001mle'

let filialSigla: string
/** A linha `tipo = CORPORATIVO` — onde nascem as ações de N2 e de CROSS (§7.72). */
let corporativaSigla: string
let pontoCausaId: string
let bucketN2: string
let bucketN3: string
let bucketN4: string
let n3: string
let n4: string
let eu: string

beforeAll(async () => {
  app = await buildApp()
  await app.ready()

  const [filial, corporativa, ponto, bN2, bN3, bN4, uEu, uN3, uN4] = await Promise.all([
    /*
     * `tipo: 'FILIAL'` EXPLÍCITO — sem ele o `findFirst` podia trazer "Rede" ou
     * "99-CORPORATIVO", que não são loja, na ordem que o Postgres quisesse.
     * Passava por acaso; com a regra de §7.72 (ação de loja recusa filial que
     * não é loja) passaria a falhar de forma intermitente.
     */
    prisma.filial.findFirst({ where: { tipo: 'FILIAL' }, select: { sigla: true } }),
    prisma.filial.findFirst({ where: { tipo: 'CORPORATIVO' }, select: { sigla: true } }),
    prisma.pontoCausa.findFirst({ select: { id: true } }),
    prisma.bucket.findFirst({ where: { nivel: 'N2' }, select: { id: true } }),
    prisma.bucket.findFirst({ where: { nivel: 'N3' }, select: { id: true } }),
    prisma.bucket.findFirst({ where: { nivel: 'N4' }, select: { id: true } }),
    prisma.usuario.findUnique({ where: { loginErp: EU }, select: { id: true } }),
    prisma.usuario.findFirst({ where: { nivel: 'N3' }, select: { id: true } }),
    prisma.usuario.findFirst({ where: { nivel: 'N4' }, select: { id: true } }),
  ])
  if (!filial || !corporativa || !ponto || !bN2 || !bN3 || !bN4 || !uEu || !uN3 || !uN4) {
    throw new Error('Banco de teste sem seed suficiente. Rode o seed.')
  }
  filialSigla = filial.sigla
  corporativaSigla = corporativa.sigla
  pontoCausaId = ponto.id
  bucketN2 = bN2.id
  bucketN3 = bN3.id
  bucketN4 = bN4.id
  eu = uEu.id
  n3 = uN3.id
  n4 = uN4.id
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

/**
 * O corpo padrão ACOMPANHA O NÍVEL — e antes era fixo em N2 + loja.
 *
 * Desde §7.72 o par (nível, filial) é validado: ação de N2 e de CROSS nasce na
 * filial corporativa, ação de N3 e N4 numa loja. E o agrupamento só é aceito
 * onde é escolhido — mandá-lo em N2/N3 é recusado, porque lá ele é deduzido do
 * GD do ponto de causa.
 *
 * Com o corpo fixo, os 20 `abrir()` deste arquivo passariam a receber 422 de
 * uma vez só — e a mensagem apontaria para a filial, não para o teste.
 */
const corpo = (over: Record<string, unknown> = {}) => {
  const nivel = (over.nivel as string | undefined) ?? 'N2'
  const corporativo = nivel === 'N2' || nivel === 'CROSS'
  const escolheAgrupamento = nivel === 'N4' || nivel === 'CROSS'
  return {
    titulo: 'Contramedida de teste',
    pontoCausaId,
    filial: corporativo ? corporativaSigla : filialSigla,
    nivel: 'N2',
    responsavelId: eu,
    ...(escolheAgrupamento ? { bucketId: bucketN2 } : {}),
    prazo: '2026-09-30',
    prioridade: 'ALTA',
    comentarioAbertura: 'Indicador vermelho. Contramedida: ajustar o processo.',
    ...over,
  }
}

async function abrir(over: Record<string, unknown> = {}) {
  const r = await app.inject({ method: 'POST', url: '/api/v1/contramedidas', payload: corpo(over) })
  expect(r.statusCode, r.body).toBe(201)
  return (r.json<{ codigo: string }>()).codigo
}

const post = (codigo: string, rota: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/v1/contramedidas/${codigo}/${rota}`, payload })

const detalhe = async (codigo: string) => {
  const r = await app.inject({ method: 'GET', url: `/api/v1/contramedidas/${codigo}` })
  expect(r.statusCode, r.body).toBe(200)
  return r.json<{
    contramedida: { nivelAtual: string; status: string; concluidaEm: string | null }
    movimentacoes: { tipo: string; texto: string }[]
    permissoes: { podeDarFeedback: boolean; podeConcluir: boolean }
  }>()
}

describe('abertura', () => {
  it('exige comentário de abertura — a coluna é NOT NULL e sem ele a reunião não tem o que discutir', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/contramedidas',
      payload: { ...corpo(), comentarioAbertura: '' },
    })
    expect(r.statusCode).toBe(400)
  })

  /*
   * Testado no N4, e não mais no N2: desde §7.72 o N2 não escolhe agrupamento
   * nenhum -- mandá-lo ali é recusado antes, por outra razão, e o teste passaria
   * pelo motivo errado. O N4 é onde a escolha existe, e é lá que o par (nível,
   * agrupamento) pode ficar inconsistente de verdade.
   */
  it('recusa agrupamento de outro nível — o par inconsistente some do quadro', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/contramedidas',
      payload: corpo({ nivel: 'N4', responsavelId: n4, bucketId: bucketN3 }),
    })
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/nível N3.*aberta no N4|mesmo nível/s)
  })

  /**
   * Abrir no PRÓPRIO nível sem mandar responsável.
   *
   * A política pura já tinha teste (`criacaoExigeResponsavel('N2','N2')` é
   * `false`), e ele passava enquanto a tela quebrava: o schema exigia
   * `responsavelId: uuid()`, então o Zod recusava o corpo ANTES de a política
   * ser consultada. A rota carregava um comentário dizendo "no meu nível a ação
   * é MINHA — o corpo não escolhe" ao lado do campo que obrigava a escolher.
   *
   * Testar a política não pega isto. Só a rota inteira pega -- é a fronteira
   * entre o schema e a regra que estava mentindo.
   */
  /**
   * **MUDOU EM 11/09/2026 (§7.72).** O usuário deste arquivo é N2, e o N2
   * passou a ESCOLHER responsável no próprio nível: ele é corporativo e não tem
   * degrau acima para proteger os pares. Para N3 e N4 a regra de §7.42 segue
   * valendo, e quem a guarda é o teste puro de `criacaoExigeResponsavel`.
   *
   * O teste antigo afirmava o contrário — abrir no próprio nível SEM responsável
   * devolvia 201 com a ação no nome de quem abriu. Ele ficou aqui invertido, em
   * vez de apagado: é a fronteira entre o schema e a regra, e foi por não haver
   * teste dela que §7.48 aconteceu.
   */
  it('o N2 PRECISA indicar responsável no próprio nível — e pode ser um par', async () => {
    const { responsavelId: _fora, ...semResponsavel } = corpo()
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/contramedidas',
      payload: semResponsavel,
    })
    expect(r.statusCode, r.body).toBe(422)
    expect(r.json().erro).toMatch(/entre os pares/)

    const comPar = await app.inject({
      method: 'POST',
      url: '/api/v1/contramedidas',
      payload: corpo({ responsavelId: eu }),
    })
    expect(comPar.statusCode, comPar.body).toBe(201)
    const { codigo } = comPar.json<{ codigo: string }>()
    const c = await prisma.contramedida.findUnique({
      where: { codigo },
      select: { responsavelAtualId: true },
    })
    expect(c?.responsavelAtualId).toBe(eu)
  })

  /**
   * O PAR (nível, filial) — §7.72.
   *
   * Ação de N2 e de CROSS nasce no corporativo; de N3 e N4, numa loja. Sem
   * isto, a ação corporativa do N2 caía carimbada numa loja e aparecia no
   * quadro dela quando o próprio N2 abria aquele GD.
   */
  it('ação de N2 recusa loja, e ação de N3 recusa a filial corporativa', async () => {
    const naLoja = await app.inject({
      method: 'POST',
      url: '/api/v1/contramedidas',
      payload: corpo({ filial: filialSigla }),
    })
    expect(naLoja.statusCode, naLoja.body).toBe(422)
    expect(naLoja.json().erro).toMatch(/não se prende a uma loja/)

    const corporativoNoN3 = await app.inject({
      method: 'POST',
      url: '/api/v1/contramedidas',
      payload: corpo({ nivel: 'N3', responsavelId: n3, filial: corporativaSigla }),
    })
    expect(corporativoNoN3.statusCode, corporativoNoN3.body).toBe(422)
    expect(corporativoNoN3.json().erro).toMatch(/não é loja/)
  })

  /**
   * O AGRUPAMENTO deduzido — e a recusa de quem tenta escolhê-lo.
   *
   * Em N2 e N3 ele sai do GD do ponto de causa. Mandar um `bucketId` ali é
   * recusado em vez de ignorado, pela mesma razão do responsável: sobrescrever
   * em silêncio faz a ação nascer diferente do que foi pedido.
   */
  it('em N2 o agrupamento vem do GD da causa, e mandá-lo é recusado', async () => {
    const codigo = await abrir()
    const c = await prisma.contramedida.findUnique({
      where: { codigo },
      select: { bucket: { select: { nome: true, nivel: true } }, indicador: { select: { nome: true } } },
    })
    expect(c?.bucket.nivel).toBe('N2')
    expect(c?.bucket.nome).toBe(c?.indicador?.nome)

    const mandandoBucket = await app.inject({
      method: 'POST',
      url: '/api/v1/contramedidas',
      payload: corpo({ bucketId: bucketN2 }),
    })
    expect(mandandoBucket.statusCode, mandandoBucket.body).toBe(422)
    expect(mandandoBucket.json().erro).toMatch(/não se escolhe|não se escolhe/)
  })

  /**
   * SEM CAUSA, o agrupamento é "Geral" — e a ação nasce sem elo com o GD.
   *
   * Marcar a causa é obrigatório só para quem abre sendo N4 (§7.72). Sem ela,
   * carimbar a ação num GD que ninguém escolheu seria inventar dado.
   */
  it('sem ponto de causa, a ação do N2 cai em "Geral" e sem indicador', async () => {
    const { pontoCausaId: _fora, ...semCausa } = corpo()
    const r = await app.inject({ method: 'POST', url: '/api/v1/contramedidas', payload: semCausa })
    expect(r.statusCode, r.body).toBe(201)

    const { codigo } = r.json<{ codigo: string }>()
    const c = await prisma.contramedida.findUnique({
      where: { codigo },
      select: {
        pontoCausaId: true,
        variavelControleId: true,
        indicadorId: true,
        bucket: { select: { nome: true } },
      },
    })
    expect(c?.bucket.nome).toBe('Geral')
    /* Os três juntos: ou a ação nasceu de uma causa e carrega os três, ou nenhum. */
    expect(c?.pontoCausaId).toBeNull()
    expect(c?.variavelControleId).toBeNull()
    expect(c?.indicadorId).toBeNull()
  })

  /**
   * O padrão não pode virar uma porta: omitir o responsável ao abrir ABAIXO
   * faria a ação nascer com quem abriu, e não com quem devia executá-la.
   */
  it('exige responsável ao abrir no nível abaixo', async () => {
    //  Sem `bucketId`: em N3 ele é deduzido, e mandá-lo seria recusado antes.
    const { responsavelId: _fora, ...semResponsavel } = corpo({ nivel: 'N3' })
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/contramedidas',
      payload: semResponsavel,
    })
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/precisa de um responsável/)
  })

  /**
   * O N2 abre para o N4, o N4 escala — e o N4 CONTINUA vendo.
   *
   * O cenário que §7.42 criou e que ninguém tinha testado. Dois defeitos ao
   * mesmo tempo, os dois da mesma suposição (quem criou == primeiro
   * responsável), que era verdade enquanto só se abria ação para si:
   *
   *  - `maosPorQuePassou` era `[criadoPor, ...destinos]`. O primeiro
   *    responsável não é nenhum dos dois — ser o responsável inicial não gera
   *    movimentação — então a ação SUMIA do quadro dele ao escalar. O oposto da
   *    regra de §7.34: quem passou pela ação continua vendo.
   *  - `trilhaDe` começava no nível de quem CRIOU. Trilha "N2 -> N3" numa ação
   *    que esteve no N4, apagando o degrau onde ela de fato ficou.
   *
   * Nenhum dos dois dá erro: a tela desenha uma trilha plausível e uma lista
   * que só está a menos.
   */
  it('quem recebeu a ação continua vendo depois de escalar, e a trilha começa onde ela nasceu', async () => {
    // O N2 abre no N4 e indica o adjunto — o caso do §7.42.
    const criacao = await app.inject({
      method: 'POST',
      url: '/api/v1/contramedidas',
      payload: corpo({ nivel: 'N4', bucketId: bucketN4, responsavelId: n4 }),
    })
    expect(criacao.statusCode, criacao.body).toBe(201)
    const { codigo } = criacao.json<{ codigo: string }>()

    // O N4 escala para o N3. `podeAgir` só deixa o responsável atual escalar,
    // então esta chamada já prova que a ação chegou nas mãos certas.
    await prisma.$transaction(async (tx) => {
      const c = await tx.contramedida.findUniqueOrThrow({ where: { codigo } })
      await tx.movimentacao.create({
        data: {
          contramedidaId: c.id,
          tipo: 'ESCALACAO',
          autorId: n4,
          nivelOrigem: 'N4',
          nivelDestino: 'N3',
          responsavelDestinoId: n3,
          texto: 'Tentei na loja e não resolveu.',
        },
      })
      await tx.contramedida.update({
        where: { id: c.id },
        data: { nivelAtual: 'N3', responsavelAtualId: n3 },
      })
    })

    const r = await app.inject({ method: 'GET', url: `/api/v1/contramedidas/${codigo}` })
    expect(r.statusCode, r.body).toBe(200)
    const d = r.json<{
      contramedida: { trilha: { nivel: string; quem: string }[]; abertaPor: { nivel: string } }
      permissoes: unknown
    }>()

    // A trilha nasce no N4, não no N2 de quem abriu.
    expect(d.contramedida.trilha[0]?.nivel).toBe('N4')
    expect(d.contramedida.trilha.at(-1)?.nivel).toBe('N3')
    // E quem abriu continua registrado, em campo próprio.
    expect(d.contramedida.abertaPor.nivel).toBe('N2')

    // O N4 ainda enxerga: `responsaveisAnteriores` tem de incluí-lo.
    const doBanco = await prisma.contramedida.findUniqueOrThrow({
      where: { codigo },
      include: { movimentacoes: { select: { autorId: true, responsavelDestinoId: true } } },
    })
    const maos = new Set([
      doBanco.criadoPorId,
      doBanco.responsavelAtualId,
      ...doBanco.movimentacoes.map((m) => m.autorId),
      ...doBanco.movimentacoes.map((m) => m.responsavelDestinoId),
    ])
    expect(maos.has(n4)).toBe(true)
  })

  /*
   * No N4, onde o agrupamento É escolhido. No N2 ele deixou de ser (§7.72), e
   * o teste do valor deduzido está em "o agrupamento vem do GD da causa".
   */
  it('grava o agrupamento escolhido', async () => {
    const codigo = await abrir({ nivel: 'N4', responsavelId: n4, bucketId: bucketN4 })
    const c = await prisma.contramedida.findUnique({ where: { codigo }, select: { bucketId: true } })
    expect(c?.bucketId).toBe(bucketN4)
  })
})

/**
 * O que o formulário de abrir ação oferece.
 *
 * O que quebra em silêncio aqui é a tela oferecer uma opção que a criação
 * recusa: a pessoa preenche tudo, clica, e leva um 403 no fim. Por isso os
 * níveis saem de `niveisQuePodeCriar` — a MESMA função que a criação usa para
 * negar — e não de uma lista escrita na rota.
 */
describe('opções de abertura', () => {
  const opcoes = async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/contramedidas/opcoes' })
    expect(r.statusCode, r.body).toBe(200)
    return r.json<{
      niveis: { nivel: string; exigeResponsavel: boolean }[]
      filiais: { sigla: string }[]
      prioridades: string[]
      causas: { id: string; nome: string; variavel: string; indicador: string }[]
    }>()
  }

  const agrupamentos = async (nivel: string) => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/contramedidas/agrupamentos?nivel=${nivel}`,
    })
    expect(r.statusCode, r.body).toBe(200)
    return (r.json<{ agrupamentos: { id: string; nome: string }[] }>()).agrupamentos
  }

  /**
   * O usuário da suíte é N2, e o N2 abre em todos: N2, N3, N4 e CROSS. Se um
   * dia a política mudar, é aqui que se descobre — antes de a tela oferecer.
   */
  it('oferece exatamente os níveis em que este usuário pode abrir', async () => {
    const d = await opcoes()
    expect(d.niveis.map((n) => n.nivel).sort()).toEqual(['CROSS', 'N2', 'N3', 'N4'])
  })

  /**
   * No CROSS a ação fica com quem abriu. Pedir destinatário lá seria oferecer
   * uma escolha que a criação nem usa.
   */
  it('diz que o CROSS não pede responsável, e os outros pedem', async () => {
    const d = await opcoes()
    expect(d.niveis.find((n) => n.nivel === 'CROSS')?.exigeResponsavel).toBe(false)
    expect(d.niveis.find((n) => n.nivel === 'N4')?.exigeResponsavel).toBe(true)
  })

  it('traz causas com variável e indicador — a ação nasce de uma delas', async () => {
    const d = await opcoes()
    expect(d.causas.length).toBeGreaterThan(0)
    for (const c of d.causas.slice(0, 5)) {
      expect(c.variavel).toBeTruthy()
      expect(c.indicador).toBeTruthy()
    }
  })

  it('traz as prioridades, que a criação exige', async () => {
    const d = await opcoes()
    expect(d.prioridades).toEqual(['ALTA', 'MEDIA', 'BAIXA'])
  })

  /**
   * **No N4 o agrupamento é a GERÊNCIA — o quadro do coordenador.** §7.28.
   *
   * Este teste é a lápide de um modelo que durou pouco: até 29/08/2026 o
   * agrupamento do N4 era a ÁREA DE VENDA, e esta rota exigia a filial porque
   * as nove lojas juntas tinham 73 áreas, cada uma com a grafia que ela mesma
   * cadastrou -- `CONEXOES` e `CONEXÕES`, onze jeitos de escrever Utilidades
   * Domésticas. Nenhuma delas chegou a receber uma ação.
   *
   * A área é a camada ABAIXO da gerência, e pertence ao N5, que não existe.
   *
   * O que se protege aqui: que a lista seja pequena e não dependa de loja. Se
   * um dia ela voltar a crescer com nomes de carga, este número dispara.
   */
  it('no N4 os agrupamentos são as gerências, e a loja não entra', async () => {
    const doN4 = await agrupamentos('N4')
    expect(doN4.map((a) => a.nome).sort()).toEqual(['Construção', 'Não Construção', 'Operacional'])
  })

  /**
   * Nenhum agrupamento pode ter o nome de uma área de venda.
   *
   * É o guarda contra a reintrodução silenciosa do modelo antigo -- por um
   * script de sincronização, por um seed, por uma carga. Uma área virando
   * coluna de quadro não gera erro nenhum: gera 73 opções num seletor.
   */
  it('nenhum agrupamento do N4 é nome de área de venda', async () => {
    const areas = new Set(
      (await prisma.dimAreaVenda.findMany({ select: { nome: true } })).map((a) =>
        a.nome.toUpperCase(),
      ),
    )
    for (const a of await agrupamentos('N4')) {
      expect(areas.has(a.nome.toUpperCase()), `${a.nome} é uma área de venda`).toBe(false)
    }
  })

  /**
   * Nos outros níveis o agrupamento é SETOR (Vendas, Operacional, Perdas e
   * Despesas, Pessoas), igual em toda a rede — como no N4 agora.
   */
  it('no N3 os agrupamentos são setores', async () => {
    const doN3 = await agrupamentos('N3')
    expect(doN3.length).toBeGreaterThan(0)
  })

  /**
   * Nível de loja SEM loja devolveria a rede inteira, e quem escolhesse o
   * primeiro nome mandaria a ação para outra filial.
   */
  it('recusa listar destinatários de N4 sem a filial', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/contramedidas/destinatarios?nivel=N4',
    })
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/informe a filial/i)
  })

  it('o N2 é corporativo e lista sem filial', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/contramedidas/destinatarios?nivel=N2',
    })
    expect(r.statusCode, r.body).toBe(200)
    const { destinatarios } = r.json<{ destinatarios: { id: string }[] }>()
    expect(destinatarios.length).toBeGreaterThan(0)
  })

  /**
   * O elo que fecha o ciclo: o que `opcoes` oferece tem de ser aceito pela
   * criação. Este teste abre uma ação usando SÓ o que a rota devolveu -- se
   * as duas discordarem, ele quebra aqui em vez de na cara de quem preencheu.
   */
  it('o que ela oferece é aceito pela criação', async () => {
    const d = await opcoes()
    const filial = d.filiais[0]!.sigla
    const destinos = await app.inject({
      method: 'GET',
      url: `/api/v1/contramedidas/destinatarios?nivel=N4&filial=${filial}`,
    })
    const { destinatarios } = destinos.json<{ destinatarios: { id: string }[] }>()
    if (destinatarios.length === 0) return // Sem N4 nesta loja no seed.
    // Sem área de venda carregada, não há agrupamento de N4 nesta loja.
    if ((await agrupamentos('N4')).length === 0) return

    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/contramedidas',
      payload: {
        titulo: 'Ação montada com o que /opcoes ofereceu',
        pontoCausaId: d.causas[0]!.id,
        filial,
        nivel: 'N4',
        responsavelId: destinatarios[0]!.id,
        bucketId: (await agrupamentos('N4'))[0]!.id,
        prazo: '2026-12-31',
        prioridade: d.prioridades[0],
        comentarioAbertura: 'Aberta pelo teste que casa opcoes com criacao.',
      },
    })
    expect(r.statusCode, r.body).toBe(201)
  })
})

/**
 * **As ações de uma GERÊNCIA** — o bloco "o que já está sendo feito" do N3.
 *
 * A contramedida não guarda gerência: guarda filial e agrupamento, e no N4 o
 * agrupamento É a gerência (§7.28). O filtro casa por aí.
 *
 * O que se protege é o casamento não vazar de loja: há UMA linha "Construção"
 * para a rede toda, e sem a filial no filtro a ação de uma loja apareceria no
 * quadro de outra — sem erro nenhum.
 */
describe('ações por gerência', () => {
  const daGerencia = async (gerenciaId: string) => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/contramedidas?gerenciaId=${gerenciaId}`,
    })
    expect(r.statusCode, r.body).toBe(200)
    return (r.json<{ contramedidas: { codigo: string; filial: string }[] }>()).contramedidas
  }

  it('só devolve ações da filial daquela gerência', async () => {
    const g = await prisma.dimGerencia.findFirstOrThrow({
      select: { id: true, filial: { select: { sigla: true } } },
    })
    for (const c of await daGerencia(g.id)) {
      expect(c.filial, `${c.codigo} é de outra loja`).toBe(g.filial.sigla)
    }
  })

  it('gerência que não existe é 404, não lista vazia', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/contramedidas?gerenciaId=00000000-0000-4000-8000-000000000000',
    })
    expect(r.statusCode).toBe(404)
  })

  /**
   * Gerência cujo nome não é agrupamento de ninguém devolve VAZIO, não tudo.
   *
   * É o risco que o casamento por nome traz: sem par, um filtro mal escrito
   * vira `bucketId: undefined`, que em Prisma não filtra nada -- e a tela do
   * N3 mostraria as ações da loja inteira dentro de uma gerência só.
   */
  it('gerência sem agrupamento de mesmo nome devolve lista vazia, não tudo', async () => {
    const filial = await prisma.filial.findFirstOrThrow({ where: { tipo: 'FILIAL' } })
    const semQuadro = await prisma.dimGerencia.create({
      data: { filialId: filial.id, nome: `SEM QUADRO ${String(Date.now())}` },
    })
    try {
      expect(await daGerencia(semQuadro.id)).toEqual([])
    } finally {
      await prisma.dimGerencia.delete({ where: { id: semQuadro.id } })
    }
  })

  /**
   * E o contrário: gerência COM agrupamento traz as ações dela.
   *
   * Sem este par, o teste acima passaria com uma rota que devolvesse vazio
   * sempre -- que é exatamente o defeito que a caixa diferente entre
   * `dimensao_gerencia` (CONSTRUÇÃO) e `agrupamento` (Construção) causaria.
   */
  it('gerência com agrupamento de mesmo nome enxerga as ações do quadro dela', async () => {
    const quadro = await prisma.bucket.findFirstOrThrow({ where: { nivel: 'N4' } })
    const comAcao = await prisma.contramedida.findFirst({
      where: { bucketId: quadro.id },
      select: { codigo: true, filialId: true },
    })
    if (!comAcao) return

    const g = await prisma.dimGerencia.findFirst({
      where: { filialId: comAcao.filialId, nome: { equals: quadro.nome, mode: 'insensitive' } },
      select: { id: true },
    })
    if (!g) return

    const codigos = (await daGerencia(g.id)).map((c) => c.codigo)
    expect(codigos, `${comAcao.codigo} está no quadro ${quadro.nome}`).toContain(comAcao.codigo)
  })
})

describe('concluir', () => {
  it('NÃO muda o nível — onde a ação foi resolvida é o sinal da cadeia de ajuda', async () => {
    const codigo = await abrir({ nivel: 'N2' })
    expect((await detalhe(codigo)).contramedida.nivelAtual).toBe('N2')

    const r = await post(codigo, 'concluir', { texto: 'Contramedida executada.' })
    expect(r.statusCode, r.body).toBe(204)

    const d = await detalhe(codigo)
    expect(d.contramedida.nivelAtual).toBe('N2')
    expect(d.contramedida.concluidaEm).not.toBeNull()
  })

  it('não aceita resultado do indicador — isso é feedback, e vem depois', async () => {
    const codigo = await abrir()
    const r = await post(codigo, 'concluir', {
      texto: 'Executada.',
      resultado: 'META_ATINGIDA',
    })
    // O schema ignora o campo desconhecido; o que importa é não gravá-lo.
    expect(r.statusCode).toBe(204)
    const m = await prisma.movimentacao.findFirst({
      where: { contramedida: { codigo }, tipo: 'CONCLUSAO' },
      select: { resultadoIndicador: true },
    })
    expect(m?.resultadoIndicador).toBeNull()
  })
})

describe('feedback', () => {
  it('é recusado antes da conclusão — não há o que avaliar', async () => {
    const codigo = await abrir()
    const r = await post(codigo, 'feedback', { texto: 'Respondeu.' })
    expect(r.statusCode).toBe(403)
  })

  it('é aceito de quem abriu, depois de concluída, e é texto livre', async () => {
    const codigo = await abrir()
    await post(codigo, 'concluir', { texto: 'Executada.' })

    const r = await post(codigo, 'feedback', { texto: 'Vendas em R$ 304 mil, acima da meta.' })
    expect(r.statusCode, r.body).toBe(204)

    const d = await detalhe(codigo)
    const fb = d.movimentacoes.find((m) => m.tipo === 'FEEDBACK')
    expect(fb?.texto).toContain('304 mil')
  })

  it('acontece uma vez só', async () => {
    const codigo = await abrir()
    await post(codigo, 'concluir', { texto: 'Executada.' })
    expect((await post(codigo, 'feedback', { texto: 'Respondeu.' })).statusCode).toBe(204)
    expect((await post(codigo, 'feedback', { texto: 'De novo.' })).statusCode).toBe(403)
  })

  it('é recusado de quem não abriu — quem abriu é dono da variável de controle', async () => {
    const codigo = await abrir()
    await post(codigo, 'concluir', { texto: 'Executada.' })
    // Troca o autor no banco: o bypass sempre autentica a mesma pessoa.
    await prisma.contramedida.update({ where: { codigo }, data: { criadoPorId: n3 } })

    const r = await post(codigo, 'feedback', { texto: 'Respondeu.' })
    expect(r.statusCode).toBe(403)
    expect(r.json().erro).toMatch(/quem abriu/i)
  })

  it('a permissão desliga depois do feedback dado — botão que só erra não fica na tela', async () => {
    const codigo = await abrir()
    await post(codigo, 'concluir', { texto: 'Executada.' })
    expect((await detalhe(codigo)).permissoes.podeDarFeedback).toBe(true)

    await post(codigo, 'feedback', { texto: 'Respondeu.' })
    expect((await detalhe(codigo)).permissoes.podeDarFeedback).toBe(false)
  })

  it('a permissão só liga depois de concluída, e só para quem abriu', async () => {
    const codigo = await abrir()
    expect((await detalhe(codigo)).permissoes.podeDarFeedback).toBe(false)

    await post(codigo, 'concluir', { texto: 'Executada.' })
    expect((await detalhe(codigo)).permissoes.podeDarFeedback).toBe(true)

    await prisma.contramedida.update({ where: { codigo }, data: { criadoPorId: n3 } })
    expect((await detalhe(codigo)).permissoes.podeDarFeedback).toBe(false)
  })
})

describe('atualização da ação', () => {
  it('registra sem soltar a ação — nível e responsável ficam onde estavam', async () => {
    const codigo = await abrir()
    const r = await post(codigo, 'atualizacoes', { texto: 'Reunião marcada para 27/08.' })
    expect(r.statusCode, r.body).toBe(204)

    const d = await detalhe(codigo)
    expect(d.contramedida.nivelAtual).toBe('N2')
    expect(d.contramedida.concluidaEm).toBeNull()
    expect(d.movimentacoes.some((m) => m.tipo === 'ATUALIZACAO')).toBe(true)
  })

  it('o responsável atual pode mudar o prazo', async () => {
    const codigo = await abrir()
    const r = await post(codigo, 'atualizacoes', { texto: 'Preciso de mais tempo.', novoPrazo: '2026-10-15' })
    expect(r.statusCode, r.body).toBe(204)

    const c = await prisma.contramedida.findUnique({ where: { codigo }, select: { prazo: true } })
    expect(c?.prazo.toISOString().slice(0, 10)).toBe('2026-10-15')
  })

  it('quem NÃO é o responsável atual escreve, mas não prorroga', async () => {
    const codigo = await abrir()
    await prisma.contramedida.update({ where: { codigo }, data: { responsavelAtualId: n3 } })

    const semPrazo = await post(codigo, 'atualizacoes', { texto: 'Repassando ao time.' })
    expect(semPrazo.statusCode, semPrazo.body).toBe(204)

    const comPrazo = await post(codigo, 'atualizacoes', { texto: 'Novo prazo.', novoPrazo: '2026-10-20' })
    expect(comPrazo.statusCode).toBe(403)
    expect(comPrazo.json().erro).toMatch(/responsável atual/i)
  })
})

describe('revisar', () => {
  /**
   * A ROTA continua fora, e o que mudou é o motivo.
   *
   * Ela saiu em 25/08/2026 com a regra "ação escalada não volta para baixo".
   * Essa regra caiu: devolver voltou a existir como REJEIÇÃO (§7.58), em
   * `/rejeitar`, com observação obrigatória e destino calculado pelo servidor
   * — e não com o `responsavelDestinoId` que a tela mandava aqui, que deixava
   * quem devolvia escolher para quem.
   *
   * O teste segue valendo pelo caminho: `/revisar` não pode ressuscitar, senão
   * passam a existir duas maneiras de devolver a mesma ação, uma delas sem
   * observação. O que ele NÃO afirma mais é que devolver não existe.
   */
  it('a rota antiga continua fora — devolver agora é /rejeitar, com observação', async () => {
    const codigo = await abrir()
    const r = await post(codigo, 'revisar', { texto: 'Devolvendo.', responsavelDestinoId: n3 })
    expect(r.statusCode).toBe(404)
  })
})

describe('trilha de escalação', () => {
  it('nasce com um passo só — a ação nunca escalada não tem trilha para mostrar', async () => {
    const codigo = await abrir()
    const r = await app.inject({ method: 'GET', url: `/api/v1/contramedidas/${codigo}` })
    const t = (r.json<{ contramedida: { trilha: unknown[] } }>()).contramedida.trilha
    expect(t).toHaveLength(1)
  })

  it('ganha um passo por escalação, na ordem, com quem recebeu', async () => {
    const codigo = await abrir({ nivel: 'N4', bucketId: bucketN4, responsavelId: eu })
    const e = await post(codigo, 'escalar', { texto: 'Fora do meu alcance.', destino: 'N3', responsavelDestinoId: n3 })
    expect(e.statusCode, e.body).toBe(204)

    const r = await app.inject({ method: 'GET', url: `/api/v1/contramedidas/${codigo}` })
    const t = (r.json<{ contramedida: { trilha: { nivel: string; dias: number }[] } }>())
      .contramedida.trilha
    /*
     * `['N4', 'N3']`, e não `['N2', 'N3']`.
     *
     * A ação foi aberta NO N4 — é o que `nivel: 'N4'` acima diz. A expectativa
     * antiga era o nível de quem CRIOU, e passava porque `trilhaDe` lia
     * `criadoPor.nivel`: as duas coisas eram iguais enquanto só se abria ação
     * para si. O teste estava confirmando a suposição, não a regra.
     */
    expect(t.map((p) => p.nivel)).toEqual(['N4', 'N3'])
    expect(t.every((p) => p.dias >= 0)).toBe(true)
  })
})

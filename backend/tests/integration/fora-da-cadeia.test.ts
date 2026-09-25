import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import { exigirSeed } from '../helpers/seed.js'

/**
 * QUEM ADMINISTRA O PORTAL SEM PARTICIPAR DA CADEIA DE AJUDA.
 *
 * Categoria pedida pelo analista em 14/09/2026: vê o quadro do N2, configura o
 * portal, **não é N2** — não aparece na lista de destinatários e não recebe
 * escalação nem direcionamento. E pode abrir ação, sempre para outra pessoa.
 *
 * O que este arquivo protege é a diferença entre **esconder** e **recusar**.
 * Tirar a pessoa da lista (`/destinatarios`) é a tela não oferecer o que o
 * servidor recusaria; a trava é o `POST`, que não passa por lista nenhuma. As
 * duas coisas precisam existir, e só a segunda é segurança.
 *
 * A prova de que isso não é teórico está no próprio código: `direcionar` já
 * conferia o destino (existe, ativo, nível certo) e **`escalar` não conferia
 * nada** — pegava o `responsavelDestinoId` do corpo e entregava direto ao
 * `movimentar`. Era por ali que a ação entrava.
 */
await exigirSeed()

const prisma = new PrismaClient()
let app: FastifyInstance

/** O bypass de desenvolvimento entra como `f00001mle`, o N2 do seed. */
const EU = 'f00001mle'

let eu: string
let corporativaSigla: string
let filialSigla: string
let pontoCausaId: string
let bucketN2: string
/** Um segundo N2, que é quem vai sair da cadeia nos testes. */
let outroN2: string
let n3: string
let n4: string
let bucketN4: string

beforeAll(async () => {
  app = await buildApp()
  await app.ready()

  const [corporativa, filial, ponto, bN2, bN4, uEu, uN3, uN4] = await Promise.all([
    prisma.filial.findFirst({ where: { tipo: 'CORPORATIVO' }, select: { sigla: true } }),
    prisma.filial.findFirst({ where: { tipo: 'FILIAL' }, select: { sigla: true } }),
    prisma.pontoCausa.findFirst({ select: { id: true } }),
    prisma.bucket.findFirst({ where: { nivel: 'N2' }, select: { id: true } }),
    prisma.bucket.findFirst({ where: { nivel: 'N4' }, select: { id: true } }),
    prisma.usuario.findUnique({ where: { loginErp: EU }, select: { id: true } }),
    prisma.usuario.findFirst({ where: { nivel: 'N3' }, select: { id: true } }),
    prisma.usuario.findFirst({ where: { nivel: 'N4' }, select: { id: true } }),
  ])
  if (!corporativa || !filial || !ponto || !bN2 || !bN4 || !uEu || !uN3 || !uN4) {
    throw new Error('Banco de teste sem seed suficiente. Rode o seed.')
  }
  corporativaSigla = corporativa.sigla
  filialSigla = filial.sigla
  pontoCausaId = ponto.id
  bucketN2 = bN2.id
  eu = uEu.id
  n3 = uN3.id
  n4 = uN4.id
  bucketN4 = bN4.id

  const par = await prisma.usuario.findFirst({
    where: { nivel: 'N2', id: { not: eu }, ativo: true },
    select: { id: true },
  })
  if (!par) throw new Error('Seed sem um segundo N2 — este arquivo precisa de um par.')
  outroN2 = par.id
})

afterEach(async () => {
  // Devolve todo mundo para a cadeia: os testes ligam e desligam a flag, e uma
  // linha esquecida em `false` faria os OUTROS arquivos falharem sem relação
  // aparente com o que mudou.
  await prisma.usuario.updateMany({ where: { recebeAcao: false }, data: { recebeAcao: true } })
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

const foraDaCadeia = (id: string) =>
  prisma.usuario.update({ where: { id }, data: { recebeAcao: false } })

const corpo = (over: Record<string, unknown> = {}) => ({
  titulo: 'Contramedida de teste',
  pontoCausaId,
  filial: corporativaSigla,
  nivel: 'N2',
  responsavelId: eu,
  prazo: '2026-09-30',
  prioridade: 'ALTA',
  comentarioAbertura: 'Indicador vermelho. Contramedida: ajustar o processo.',
  ...over,
})

const abrir = (over: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/api/v1/contramedidas', payload: corpo(over) })

/**
 * Monta a ação pelo Prisma, e não pela API.
 *
 * Dois casos deste arquivo precisam de uma ação com dono ou autor ESPECÍFICO, e
 * o bypass de desenvolvimento atende um usuário só por arquivo — pela API, quem
 * abre é sempre a sessão. Montar a linha direto é o que põe o teste no ponto que
 * importa em vez de rodeá-lo.
 */
let sequencia = 0
async function montar(over: {
  nivelAtual?: 'N2' | 'N3'
  responsavelAtualId?: string
  criadoPorId?: string
}) {
  sequencia += 1
  const sigla = (over.nivelAtual ?? 'N2') === 'N2' ? corporativaSigla : filialSigla
  const filial = await prisma.filial.findFirstOrThrow({ where: { sigla }, select: { id: true } })
  const bucket = await prisma.bucket.findFirstOrThrow({
    where: { nivel: over.nivelAtual ?? 'N2' },
    select: { id: true },
  })
  const acao = await prisma.contramedida.create({
    data: {
      codigo: `AC-FC${String(Date.now()).slice(-5)}${String(sequencia)}`,
      titulo: 'Contramedida de teste',
      filialId: filial.id,
      nivelAtual: over.nivelAtual ?? 'N2',
      bucketId: bucket.id,
      responsavelAtualId: over.responsavelAtualId ?? eu,
      criadoPorId: over.criadoPorId ?? eu,
      prazo: new Date('2026-09-30'),
      prioridade: 'ALTA',
      comentarioAbertura: 'Montada pelo teste.',
    },
    select: { codigo: true },
  })
  return acao.codigo
}

describe('a lista de destinatários', () => {
  it('esconde quem não participa da cadeia', async () => {
    const antes = await app.inject({
      method: 'GET',
      url: '/api/v1/contramedidas/destinatarios?nivel=N2',
    })
    expect(antes.statusCode, antes.body).toBe(200)
    const idsAntes = antes.json<{ destinatarios: { id: string }[] }>().destinatarios.map((d) => d.id)
    expect(idsAntes).toContain(outroN2)

    await foraDaCadeia(outroN2)

    const depois = await app.inject({
      method: 'GET',
      url: '/api/v1/contramedidas/destinatarios?nivel=N2',
    })
    const idsDepois = depois
      .json<{ destinatarios: { id: string }[] }>()
      .destinatarios.map((d) => d.id)
    expect(idsDepois).not.toContain(outroN2)
    // E não esvaziou a lista por acidente: quem participa continua lá.
    expect(idsDepois).toContain(eu)
  })
})

/**
 * A LISTA NÃO É A TRAVA. Estes são os testes que importam: o `POST` direto,
 * que é como qualquer um chamaria a rota sem passar pela tela.
 */
describe('a trava do POST', () => {
  it('abrir ação PARA quem não recebe é recusado', async () => {
    await foraDaCadeia(outroN2)
    const r = await abrir({ responsavelId: outroN2 })
    expect(r.statusCode, r.body).toBe(422)
    expect(r.json<{ erro: string }>().erro).toMatch(/não participa da cadeia/i)
  })

  /**
   * A fresta real, e por isso ela tem teste próprio: `escalar` não conferia
   * destino nenhum. A trava mora no `movimentar`, que é a única porta por onde
   * todos os movimentos passam — quatro cópias da mesma pergunta nas rotas é
   * como elas divergem.
   */
  it('escalar PARA quem não recebe é recusado', async () => {
    // A ação precisa estar NA MÃO da sessão para ela poder escalar — só o
    // responsável movimenta. Montada no N3 para que o destino N2 transfira o
    // responsável: escalar para CROSS mantém quem já tem, e aí não haveria
    // destino a recusar.
    const codigo = await montar({ nivelAtual: 'N3', responsavelAtualId: eu })

    await foraDaCadeia(outroN2)
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/contramedidas/${codigo}/escalar`,
      payload: { destino: 'N2', responsavelDestinoId: outroN2, texto: 'Preciso de decisão.' },
    })
    expect(r.statusCode, r.body).toBe(422)
    expect(r.json<{ erro: string }>().erro).toMatch(/não participa da cadeia/i)
  })

  it('direcionar PARA quem não recebe é recusado', async () => {
    const criada = await abrir({ responsavelId: eu })
    const codigo = criada.json<{ codigo: string }>().codigo

    await foraDaCadeia(outroN2)
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/contramedidas/${codigo}/direcionar`,
      payload: { responsavelDestinoId: outroN2, texto: 'Passo para você.' },
    })
    expect(r.statusCode, r.body).toBe(422)
  })

  /*
   * A mensagem separa as duas recusas porque as saídas são diferentes: quem
   * administra nunca vai receber, e quem foi desativado pode ser reativado.
   * Dizer a errada manda procurar no lugar errado.
   */
  it('a recusa diz QUAL é o caso — administra, ou foi desativado', async () => {
    await foraDaCadeia(outroN2)
    const administra = await abrir({ responsavelId: outroN2 })
    expect(administra.json<{ erro: string }>().erro).toMatch(/administra o portal/i)

    await prisma.usuario.update({ where: { id: outroN2 }, data: { recebeAcao: true, ativo: false } })
    try {
      const inativo = await abrir({ responsavelId: outroN2 })
      expect(inativo.json<{ erro: string }>().erro).toMatch(/não está.*ativo|inativo/i)
    } finally {
      await prisma.usuario.update({ where: { id: outroN2 }, data: { ativo: true } })
    }
  })
})

/**
 * ABRIR SEMPRE PARA OUTROS — a outra metade do pedido.
 *
 * A regra normal deixa a ação com quem abre quando o destino é o próprio nível.
 * Para quem está fora da cadeia isso criaria, na abertura, exatamente a ação que
 * a categoria existe para não ter — e sem passar pelo `movimentar`, porque
 * abrir não é movimento.
 */
describe('quem está fora da cadeia abrindo ação', () => {
  it('não pode ficar com ela: responsável passa a ser obrigatório', async () => {
    await foraDaCadeia(eu)
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/contramedidas',
      payload: { ...corpo(), responsavelId: undefined, bucketId: bucketN2 },
    })
    expect(r.statusCode, r.body).toBe(422)
    expect(r.json<{ erro: string }>().erro).toMatch(/sempre para outra pessoa/i)
  })

  it('mas abre normalmente quando escolhe outra pessoa', async () => {
    await foraDaCadeia(eu)
    const r = await abrir({ nivel: 'N3', filial: filialSigla, responsavelId: n3 })
    expect(r.statusCode, r.body).toBe(201)
  })

  /**
   * A EXCEÇÃO DA REJEIÇÃO, ponta a ponta.
   *
   * Sem ela, "pode abrir" e "não recebe" se contradizem: a pessoa abre para
   * outro, o outro rejeita, e `origemDaMao` devolve a quem abriu. Barrar aí
   * prenderia a ação com quem já disse que não é sua.
   *
   * Ação rejeitada está encerrada — `movimentar` recusa qualquer movimento nela,
   * inclusive atualização. Não é trabalho na mão de ninguém: é o aviso de que
   * ela voltou.
   */
  /*
   * A ação é montada pelo Prisma, e não pela API, por um motivo de sessão: a
   * rejeição parte de quem RECEBEU, e o bypass atende um usuário só por
   * arquivo. Montar a linha com `criadoPor` = o administrador e
   * `responsavelAtual` = a sessão põe o teste exatamente no ponto que importa —
   * quem rejeita é quem tem a ação na mão, e o destino calculado é o outro.
   */
  it('a rejeição consegue devolver a ação a quem a abriu', async () => {
    const codigo = await montar({ responsavelAtualId: eu, criadoPorId: outroN2 })

    // Quem abriu sai da cadeia — como aconteceria de verdade.
    await foraDaCadeia(outroN2)

    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/contramedidas/${codigo}/rejeitar`,
      payload: { texto: 'Isto não é da minha área.' },
    })
    expect(r.statusCode, r.body).toBe(204)

    const depois = await prisma.contramedida.findUnique({
      where: { codigo },
      select: { responsavelAtualId: true },
    })
    expect(depois?.responsavelAtualId).toBe(outroN2)
  })
})

/**
 * A TELA SÓ DESENHA O QUE O SERVIDOR DIZ — e é por isso que a correção do
 * formulário mora em `/opcoes`, e não no React.
 *
 * O campo "Quem responde" some quando `exigeResponsavel` é falso, e o próprio
 * comentário da tela registra a decisão: *"o servidor decide, e recusa o
 * contrário na criação; a tela só desenha o que ele disse"*. Sem este teste, a
 * regra voltaria a existir em dois lugares — que é como ela divergiu antes.
 */
describe('as opções do formulário', () => {
  it('passam a exigir responsável em TODO nível para quem está fora da cadeia', async () => {
    const antes = await app.inject({ method: 'GET', url: '/api/v1/contramedidas/opcoes' })
    expect(antes.statusCode, antes.body).toBe(200)
    const niveisAntes = antes.json<{ niveis: { nivel: string; exigeResponsavel: boolean }[] }>()
      .niveis
    // A regra normal deixa ao menos um nível sem exigir — é o caso de "fica
    // comigo". Se isto deixar de valer, o teste abaixo não prova mais nada.
    expect(niveisAntes.some((n) => !n.exigeResponsavel)).toBe(true)

    await foraDaCadeia(eu)

    const depois = await app.inject({ method: 'GET', url: '/api/v1/contramedidas/opcoes' })
    const niveisDepois = depois.json<{ niveis: { nivel: string; exigeResponsavel: boolean }[] }>()
      .niveis
    expect(niveisDepois.length).toBeGreaterThan(0)
    expect(niveisDepois.every((n) => n.exigeResponsavel)).toBe(true)
  })
})

/**
 * A INVARIANTE `bucket.nivel === contramedida.nivelAtual`.
 *
 * A abertura já a tratava como regra e recusava o contrário com todas as
 * letras: *"O agrupamento X é do nível Y, e a ação está sendo aberta no Z"*.
 * `movimentar` a quebrava em silêncio — trocava `nivelAtual` e deixava
 * `bucketId` para trás, produzindo ação no N3 com "Construção", que é coluna do
 * N4.
 *
 * Pego pelo analista em 14/09/2026 na AC-0490, olhando a tela. Não derruba a
 * ação do quadro, mostra o rótulo errado na reunião — e o rótulo é o que diz a
 * que parte do GD aquela ação pertence.
 */
describe('o agrupamento acompanha o nível', () => {
  it('escalar do N4 para o N3 troca a coluna junto', async () => {
    const criada = await abrir({
      nivel: 'N4',
      filial: filialSigla,
      responsavelId: n4,
      bucketId: bucketN4,
    })
    expect(criada.statusCode, criada.body).toBe(201)
    const codigo = criada.json<{ codigo: string }>().codigo

    const antes = await prisma.contramedida.findUniqueOrThrow({
      where: { codigo },
      include: { bucket: { select: { nome: true, nivel: true } } },
    })
    expect(antes.bucket.nivel).toBe('N4')

    await prisma.contramedida.update({ where: { codigo }, data: { responsavelAtualId: eu } })
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/contramedidas/${codigo}/escalar`,
      payload: { destino: 'N3', responsavelDestinoId: n3, texto: 'Sobe para a gerência.' },
    })
    expect(r.statusCode, r.body).toBe(204)

    const depois = await prisma.contramedida.findUniqueOrThrow({
      where: { codigo },
      include: { bucket: { select: { nome: true, nivel: true } } },
    })
    expect(depois.nivelAtual).toBe('N3')
    /* A INVARIANTE, que é o que este teste existe para travar. */
    expect(depois.bucket.nivel, `coluna "${depois.bucket.nome}" num nível que não é o dela`).toBe(
      'N3',
    )
  })

  /*
   * Direcionar NAO muda de nivel -- e por isso nao pode mexer na coluna. Sem
   * este caso, `movimentar` poderia "deduzir" a cada movimento e reclassificar
   * uma acao que ninguem pediu para reclassificar.
   */
  it('direcionar mantém o nível, e mantém a coluna', async () => {
    const codigo = await montar({ responsavelAtualId: eu })
    const antes = await prisma.contramedida.findUniqueOrThrow({ where: { codigo } })

    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/contramedidas/${codigo}/direcionar`,
      payload: { responsavelDestinoId: outroN2, texto: 'Passo para você.' },
    })
    expect(r.statusCode, r.body).toBe(204)

    const depois = await prisma.contramedida.findUniqueOrThrow({ where: { codigo } })
    expect(depois.bucketId).toBe(antes.bucketId)
  })
})

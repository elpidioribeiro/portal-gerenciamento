import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import { exigirSeed } from '../helpers/seed.js'
import type { PapelAdmin } from '@prisma/client'

/**
 * Cadastro de ponto de causa — criar na reunião, corrigir na administração.
 *
 * A regra é assimétrica de propósito (decisão do analista, 10/09/2026): **quem
 * marca cria, quem administra renomeia e desativa**. A razão está no alcance:
 * ponto de causa é cadastro da VARIÁVEL DE CONTROLE — a chave única é
 * `variavelControleId + nome` —, então ele nasce visível em todas as áreas, nas
 * duas gerências e nas outras filiais que acompanham a variável.
 *
 * O que estes testes protegem falha em silêncio ou destrói histórico:
 *
 *  - criar sem responder pela variável enche o cadastro de todo mundo a partir
 *    de uma tela onde a pessoa não marca nada;
 *  - nome repetido de um ponto DESATIVADO daria "já existe" apontando para uma
 *    linha que não aparece em tela nenhuma — beco sem saída para quem só quer
 *    contar a causa de hoje;
 *  - apagar ponto com ocorrência levaria o histórico do Pareto embora, e é o
 *    histórico que se olha quando o Pareto de hoje surpreende.
 */

await exigirSeed()

const prisma = new PrismaClient()
let app: FastifyInstance

/** O bypass autentica `f00001mle`. */
const EU = 'f00001mle'

let variavelId: string
/** Uma segunda variável, para provar que o ponto de uma não é da outra. */
let outraVariavelId: string
let eu: string
let idPerfil: number
let filialOriginal: string | null
let papelOriginal: PapelAdmin

/** Tudo que os testes criam leva este prefixo, e é por ele que a limpeza varre. */
const PREFIXO = 'ZZ teste automatizado'
const NOME = `${PREFIXO} — falta de energia`

beforeAll(async () => {
  app = await buildApp()
  await app.ready()

  const usuario = await prisma.usuario.findUnique({ where: { loginErp: EU } })
  if (!usuario) throw new Error('Usuário do bypass não existe. Rode o seed.')
  eu = usuario.id
  filialOriginal = usuario.filialId
  papelOriginal = usuario.papelAdmin

  /*
   * O usuário do bypass é N2 e N2 não tem filial — sem filial, `variaveisDoUsuario`
   * devolve conjunto vazio e ninguém marca nem cria. Damos a ele a configuração
   * de um N4 real, e devolvemos no `afterAll`.
   */
  const filial = await prisma.filial.findFirst({ where: { codigo: { not: null } } })
  if (!filial) throw new Error('Nenhuma filial com código de empresa. Rode o seed.')
  await prisma.usuario.update({ where: { id: eu }, data: { filialId: filial.id } })

  const ativas = await prisma.variavelControle.findMany({
    where: { ativo: true },
    orderBy: { nome: 'asc' },
    select: { id: true },
  })
  if (ativas.length < 2) throw new Error('Faltam variáveis de controle ativas. Rode o seed.')
  variavelId = ativas[0]!.id
  outraVariavelId = ativas[1]!.id

  idPerfil = usuario.idPerfil ?? 9001
  await prisma.usuario.update({ where: { id: eu }, data: { idPerfil } })
})

afterAll(async () => {
  await prisma.perfilNivel.deleteMany({ where: { idPerfil } })
  await prisma.usuario.update({
    where: { id: eu },
    data: { filialId: filialOriginal, papelAdmin: papelOriginal },
  })
  await app.close()
  await prisma.$disconnect()
})

beforeEach(async () => {
  /* Perfil N4 que acompanha a variável: é o que autoriza marcar e, agora, criar. */
  await prisma.perfilNivel.deleteMany({ where: { idPerfil } })
  await prisma.perfilNivel.create({
    data: {
      idPerfil,
      nivel: 'N4',
      descricao: 'Gerente adjunto de teste',
      variaveis: { create: [{ variavelControleId: variavelId }] },
    },
  })
  await prisma.usuario.update({ where: { id: eu }, data: { papelAdmin: 'NENHUM' } })
})

/*
 * A limpeza é por PREFIXO e vem DEPOIS DE CADA TESTE.
 *
 * O banco de teste é o mesmo que a tela de desenvolvimento usa, e ponto de causa
 * é cadastro compartilhado: um "ZZ teste" esquecido apareceria na grade de todas
 * as áreas e no Pareto da reunião. As ocorrências saem primeiro, senão a chave
 * estrangeira recusa o `deleteMany`.
 */
afterEach(async () => {
  const meus = await prisma.pontoCausa.findMany({
    where: { nome: { startsWith: PREFIXO } },
    select: { id: true },
  })
  if (meus.length === 0) return
  const ids = meus.map((p) => p.id)
  await prisma.ocorrenciaPontoCausa.deleteMany({ where: { pontoCausaId: { in: ids } } })
  await prisma.pontoCausa.deleteMany({ where: { id: { in: ids } } })
})

const criar = (nome: string, variavel = variavelId) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/variaveis/${variavel}/pontos-causa`,
    payload: { nome },
  })

const editar = (pontoId: string, body: Record<string, unknown>, variavel = variavelId) =>
  app.inject({
    method: 'PATCH',
    url: `/api/v1/variaveis/${variavel}/pontos-causa/${pontoId}`,
    payload: body,
  })

const remover = (pontoId: string, variavel = variavelId) =>
  app.inject({
    method: 'DELETE',
    url: `/api/v1/variaveis/${variavel}/pontos-causa/${pontoId}`,
  })

describe('criar ponto de causa', () => {
  it('quem responde pela variável cria, e o ponto entra no fim da lista', async () => {
    const antes = await prisma.pontoCausa.aggregate({
      where: { variavelControleId: variavelId },
      _max: { ordem: true },
    })

    const r = await criar(NOME)
    expect(r.statusCode).toBe(201)
    const corpo = r.json()
    expect(corpo.nome).toBe(NOME)
    expect(corpo.ativo).toBe(true)
    expect(corpo.ordem).toBe((antes._max.ordem ?? 0) + 1)
  })

  it('apara o nome — dois pontos que se leem iguais no quadro seriam um erro', async () => {
    const r = await criar(`   ${NOME}   `)
    expect(r.statusCode).toBe(201)
    expect((r.json()).nome).toBe(NOME)
  })

  /*
   * 400, e não 422: nome curto é recusado pelo SCHEMA, antes de a rota rodar.
   * O 422 (`DadosInvalidos`) é para o que só o domínio sabe — variável
   * desativada, por exemplo.
   */
  it('recusa nome curto', async () => {
    expect((await criar('ab')).statusCode).toBe(400)
  })

  it('nome repetido de ponto ATIVO é conflito', async () => {
    expect((await criar(NOME)).statusCode).toBe(201)
    const r = await criar(NOME)
    expect(r.statusCode).toBe(409)
  })

  it('nome repetido de ponto DESATIVADO reativa, em vez de dar beco sem saída', async () => {
    const criado = (await criar(NOME)).json()
    await prisma.pontoCausa.update({ where: { id: criado.id }, data: { ativo: false } })

    const r = await criar(NOME)
    expect(r.statusCode).toBe(201)
    const corpo = r.json()
    /* O MESMO registro, reativado: id novo criaria duas causas com um nome. */
    expect(corpo.id).toBe(criado.id)
    expect(corpo.ativo).toBe(true)
  })

  it('quem não responde pela variável não cria', async () => {
    await prisma.perfilNivel.update({
      where: { idPerfil },
      data: { variaveis: { deleteMany: {} } },
    })
    const r = await criar(NOME)
    expect(r.statusCode).toBe(403)
    expect(await prisma.pontoCausa.count({ where: { nome: NOME } })).toBe(0)
  })

  it('variável que não existe é 404', async () => {
    const r = await criar(NOME, '00000000-0000-0000-0000-000000000000')
    expect(r.statusCode).toBe(404)
  })
})

describe('corrigir ponto de causa', () => {
  it('renomear e desativar são do administrador', async () => {
    const criado = (await criar(NOME)).json()

    expect((await editar(criado.id, { nome: `${PREFIXO} — outro nome` })).statusCode).toBe(403)
    expect((await remover(criado.id)).statusCode).toBe(403)

    await prisma.usuario.update({ where: { id: eu }, data: { papelAdmin: 'ADMIN' } })

    const r = await editar(criado.id, { nome: `${PREFIXO} — outro nome`, ativo: false })
    expect(r.statusCode).toBe(200)
    const corpo = r.json()
    expect(corpo.nome).toBe(`${PREFIXO} — outro nome`)
    expect(corpo.ativo).toBe(false)
  })

  it('corpo vazio é recusado — escrita que não escreve nada', async () => {
    const criado = (await criar(NOME)).json()
    await prisma.usuario.update({ where: { id: eu }, data: { papelAdmin: 'ADMIN' } })
    expect((await editar(criado.id, {})).statusCode).toBe(400)
  })

  it('renomear para nome de outro ponto é conflito; para o próprio nome, não', async () => {
    const um = (await criar(NOME)).json()
    const dois = (await criar(`${PREFIXO} — dois`)).json()
    await prisma.usuario.update({ where: { id: eu }, data: { papelAdmin: 'ADMIN' } })

    expect((await editar(dois.id, { nome: NOME })).statusCode).toBe(409)
    expect((await editar(um.id, { nome: NOME })).statusCode).toBe(200)
  })

  it('ponto de OUTRA variável não é alcançado pelo caminho desta', async () => {
    const criado = (await criar(NOME)).json()
    await prisma.usuario.update({ where: { id: eu }, data: { papelAdmin: 'ADMIN' } })

    const r = await editar(criado.id, { ativo: false }, outraVariavelId)
    expect(r.statusCode).toBe(404)
    /* E o ponto continua ativo: a recusa não pode ter efeito colateral. */
    const depois = await prisma.pontoCausa.findUnique({ where: { id: criado.id } })
    expect(depois?.ativo).toBe(true)
  })
})

describe('remover ponto de causa', () => {
  it('sem nada gravado, apaga', async () => {
    const criado = (await criar(NOME)).json()
    await prisma.usuario.update({ where: { id: eu }, data: { papelAdmin: 'ADMIN' } })

    const r = await remover(criado.id)
    expect(r.statusCode).toBe(200)
    expect((r.json()).resultado).toBe('apagado')
    expect(await prisma.pontoCausa.findUnique({ where: { id: criado.id } })).toBeNull()
  })

  it('com ocorrência gravada, DESATIVA e o histórico fica', async () => {
    const criado = (await criar(NOME)).json()
    const area = await prisma.dimAreaVenda.findFirst({ select: { id: true } })
    if (!area) throw new Error('Nenhuma área de venda. Rode o seed.')
    await prisma.ocorrenciaPontoCausa.create({
      data: {
        pontoCausaId: criado.id,
        escopo: 'AREA_VENDA',
        alvoId: area.id,
        ano: 2026,
        mes: 8,
        semana: 1,
        quantidade: 3,
        registradoPorId: eu,
      },
    })
    await prisma.usuario.update({ where: { id: eu }, data: { papelAdmin: 'ADMIN' } })

    const r = await remover(criado.id)
    expect(r.statusCode).toBe(200)
    const corpo = r.json()
    expect(corpo.resultado).toBe('desativado')
    expect(corpo.ocorrencias).toBe(1)

    const depois = await prisma.pontoCausa.findUnique({ where: { id: criado.id } })
    expect(depois?.ativo).toBe(false)
    expect(await prisma.ocorrenciaPontoCausa.count({ where: { pontoCausaId: criado.id } })).toBe(1)
  })
})

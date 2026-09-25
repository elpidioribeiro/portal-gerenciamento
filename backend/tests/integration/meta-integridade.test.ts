import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * `meta.alvo_id` aponta ora para `indicador`, ora para `variavel_controle`, e
 * por isso não pode ser chave estrangeira. A integridade vem de trigger.
 *
 * O teste existe porque a regra é **invisível no `schema.prisma`** — o Prisma
 * não modela trigger. Sem ele, uma migração futura que recriasse a tabela
 * deixaria a validação para trás sem nada quebrar, e a coluna voltaria a
 * aceitar qualquer coisa.
 */

const prisma = new PrismaClient()
const CODIGO = 'meta-integridade-teste'
const UUID_INEXISTENTE = '00000000-0000-4000-8000-000000000000'

let filialId = ''
let indicadorId = ''

beforeAll(async () => {
  filialId = (await prisma.filial.findFirstOrThrow()).id
  const modelo = await prisma.indicador.findFirstOrThrow()
  const criado = await prisma.indicador.upsert({
    where: { codigo: CODIGO },
    update: {},
    create: {
      codigo: CODIGO,
      nome: 'Indicador de teste de integridade',
      unidade: modelo.unidade,
      sentido: modelo.sentido,
      escalaY: modelo.escalaY as object,
      regraStatus: modelo.regraStatus as object,
      ordem: 98,
    },
  })
  indicadorId = criado.id
})

afterAll(async () => {
  await prisma.meta.deleteMany({ where: { alvoId: indicadorId } })
  await prisma.indicador.deleteMany({ where: { codigo: CODIGO } })
  await prisma.$disconnect()
})

const meta = (alvoId: string, escopo: 'INDICADOR' | 'VARIAVEL' = 'INDICADOR') => ({
  escopo,
  alvoId,
  filialId,
  ano: 2031,
  mes: 7,
  valor: 100,
})

describe('integridade de meta.alvo_id', () => {
  it('recusa meta cujo alvo não existe', async () => {
    await expect(prisma.meta.create({ data: meta(UUID_INEXISTENTE) })).rejects.toThrow(
      /nao existe em indicador/,
    )
  })

  it('recusa meta de indicador cujo alvo é uma variável de controle', async () => {
    const variavel = await prisma.variavelControle.findFirstOrThrow()
    // O id existe — mas na tabela errada para o escopo declarado.
    await expect(prisma.meta.create({ data: meta(variavel.id) })).rejects.toThrow(
      /nao existe em indicador/,
    )
  })

  it('aceita meta com alvo válido', async () => {
    const criada = await prisma.meta.create({ data: meta(indicadorId) })
    expect(criada.id).toBeTruthy()
  })

  it('recusa apagar indicador que tem meta', async () => {
    await expect(prisma.indicador.delete({ where: { id: indicadorId } })).rejects.toThrow(
      /tem 1 meta\(s\) e nao pode ser apagado/,
    )
  })

  it('libera a remoção depois que a meta sai', async () => {
    await prisma.meta.deleteMany({ where: { alvoId: indicadorId } })
    const apagado = await prisma.indicador.delete({ where: { id: indicadorId } })
    expect(apagado.codigo).toBe(CODIGO)

    // Recria para o afterAll não falhar e para não deixar buraco no catálogo.
    const modelo = await prisma.indicador.findFirstOrThrow()
    const recriado = await prisma.indicador.create({
      data: {
        codigo: CODIGO,
        nome: 'Indicador de teste de integridade',
        unidade: modelo.unidade,
        sentido: modelo.sentido,
        escalaY: modelo.escalaY as object,
        regraStatus: modelo.regraStatus as object,
        ordem: 98,
      },
    })
    indicadorId = recriado.id
  })
})

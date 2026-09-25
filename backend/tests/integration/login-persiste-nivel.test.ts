import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import { afterAll, beforeAll, expect, it, describe } from 'vitest'

/**
 * O login grava o nível resolvido em `usuario.nivel`.
 *
 * O upsert de login cria todo usuário corporativo com `nivel: 'N4'` inicial e
 * nunca o atualizava; o nível REAL vem do `id_perfil`, resolvido a cada
 * requisição. As telas que LISTAM gente por nível (destinatários de ação,
 * contagens) leem a coluna gravada — então um N3 que fez login ficava gravado
 * como N4 e sumia da lista do próprio nível, contra o que a tela promete
 * ("a pessoa só vira destino depois do primeiro login dela").
 *
 * O defeito é silencioso: a pessoa entra, usa o portal, e só quem tenta
 * escolhê-la como responsável percebe que ela não está lá. Uma regressão aqui
 * não quebra nada visível para quem logou.
 *
 * Roda no MockAuthProvider (AUTH_PROVIDER=mock no vitest.config), que devolve a
 * linha do banco na senha certa — então dá para gravar o usuário como N4 e ver
 * o login corrigir para o nível do perfil.
 */

const LOGIN = 'ftestepersistenivel'
const SENHA = 'senha-de-teste'
const ID_PERFIL = 987654

const prisma = new PrismaClient()
let app: FastifyInstance

beforeAll(async () => {
  await prisma.perfilNivel.upsert({
    where: { idPerfil: ID_PERFIL },
    update: { nivel: 'N3', ativo: true },
    create: { idPerfil: ID_PERFIL, nivel: 'N3', descricao: 'Perfil de teste (N3)', ativo: true },
  })
  await prisma.usuario.upsert({
    where: { loginErp: LOGIN },
    update: { nivel: 'N4', idPerfil: ID_PERFIL, ativo: true, senhaHash: await argon2.hash(SENHA) },
    create: {
      loginErp: LOGIN,
      nome: 'Usuário que loga e vira N3',
      iniciais: 'UN3',
      cargo: 'Teste',
      // Gravado como N4 de propósito: é o valor inicial que o login precisa
      // corrigir para o nível do perfil.
      nivel: 'N4',
      idPerfil: ID_PERFIL,
      ativo: true,
      senhaHash: await argon2.hash(SENHA),
    },
  })
  const { buildApp } = await import('../../src/app.js')
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await prisma.usuario.delete({ where: { loginErp: LOGIN } }).catch(() => null)
  await prisma.perfilNivel.delete({ where: { idPerfil: ID_PERFIL } }).catch(() => null)
  await prisma.$disconnect()
})

describe('POST /api/v1/auth/login', () => {
  it('grava o nível resolvido do perfil na linha do usuário', async () => {
    const antes = await prisma.usuario.findUniqueOrThrow({ where: { loginErp: LOGIN } })
    expect(antes.nivel).toBe('N4')

    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: LOGIN, senha: SENHA },
    })
    expect(r.statusCode, r.body).toBe(200)

    const depois = await prisma.usuario.findUniqueOrThrow({ where: { loginErp: LOGIN } })
    // Era N4, o perfil é N3: o login tem de ter corrigido a coluna.
    expect(depois.nivel).toBe('N3')
  })
})

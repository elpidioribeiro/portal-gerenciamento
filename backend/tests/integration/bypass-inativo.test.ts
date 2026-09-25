import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * O bypass de desenvolvimento respeita `ativo`.
 *
 * Desativar alguém tem de valer nos três caminhos de entrada — senha, cookie e
 * bypass. Até 24/08/2026 valia em dois: o `MockAuthProvider` recusava
 * `ativo: false` e o cookie também, mas o bypass buscava pelo login e devolvia o
 * usuário sem olhar o campo. A assimetria apareceu ao desativar as 16 contas do
 * seed no banco de desenvolvimento (PLANO §11.4) — desativadas em toda parte,
 * menos ali.
 *
 * O teste existe porque o defeito é **silencioso na direção errada**: quem
 * desativa uma conta vê a tela de login recusar e conclui que fechou. Uma
 * regressão aqui não quebra nada visível.
 *
 * O usuário de bypass vem de `env.AUTH_DEV_USUARIO`, fixado em `f00001mle` pelo
 * `vitest.config.ts`. Em vez de mexer nele — que é compartilhado com todos os
 * outros arquivos da suíte, e alterá-lo derrubaria testes rodando em paralelo —
 * o módulo de env entra mockado apontando para um usuário próprio deste arquivo.
 */

const LOGIN = 'ftestebypass'

vi.mock('../../src/config/env.js', async (original) => {
  const mod = await original<typeof import('../../src/config/env.js')>()
  return { ...mod, env: { ...mod.env, AUTH_DEV_BYPASS: true, AUTH_DEV_USUARIO: LOGIN } }
})

const prisma = new PrismaClient()
let app: FastifyInstance

async function definirAtivo(ativo: boolean) {
  await prisma.usuario.update({ where: { loginErp: LOGIN }, data: { ativo } })
}

/** Rota qualquer que exija autenticação — o que se mede é o 401, não o corpo. */
function pedir() {
  return app.inject({ method: 'GET', url: '/api/v1/painel?modo=mes&ano=2026&mes=8' })
}

beforeAll(async () => {
  await prisma.usuario.upsert({
    where: { loginErp: LOGIN },
    update: { ativo: true },
    create: {
      loginErp: LOGIN,
      nome: 'Usuário de teste do bypass',
      iniciais: 'UTB',
      cargo: 'Teste',
      nivel: 'N2',
      ativo: true,
    },
  })
  const { buildApp } = await import('../../src/app.js')
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await prisma.usuario.delete({ where: { loginErp: LOGIN } }).catch(() => null)
  await prisma.$disconnect()
})

describe('AUTH_DEV_BYPASS', () => {
  it('atende quando o usuário está ativo', async () => {
    await definirAtivo(true)
    const r = await pedir()
    expect(r.statusCode, r.body).toBe(200)
  })

  it('recusa com 401 quando o usuário está inativo', async () => {
    await definirAtivo(false)
    const r = await pedir()
    expect(r.statusCode).toBe(401)
  })

  it('diz na mensagem que o usuário está inativo', async () => {
    await definirAtivo(false)
    const r = await pedir()
    // Sem isto o 401 é indistinguível de "sem sessão", e quem configurou o
    // ambiente procura o erro no lugar errado.
    expect(r.body).toContain('INATIVO')
    expect(r.body).toContain(LOGIN)
  })

  it('volta a atender quando o usuário é reativado', async () => {
    await definirAtivo(false)
    expect((await pedir()).statusCode).toBe(401)
    await definirAtivo(true)
    expect((await pedir()).statusCode).toBe(200)
  })
})

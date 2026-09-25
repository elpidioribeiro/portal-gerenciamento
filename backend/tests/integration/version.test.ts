import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

/**
 * A rota que diz qual commit está no ar.
 *
 * Existe para conferir de FORA se o GitOps já sincronizou (pipeline verde não é
 * código no ar — PLANO §7.83). Dois pontos que uma regressão quebra em silêncio,
 * e por isso o teste:
 *
 * 1. O caminho é `/api/v1/version`, não `/version` na raiz. O nginx da tela só
 *    encaminha `/api` para o backend; movida para a raiz, a rota some por trás
 *    do SPA sem erro nenhum — passa nos testes de unidade e não responde em
 *    produção.
 * 2. Sem `APP_VERSION` (build local, ou o build-arg caiu do CI), devolve "dev" —
 *    não um commit inventado, nem 500.
 */

let app: FastifyInstance
const salvo = process.env.APP_VERSION

beforeAll(async () => {
  const { buildApp } = await import('../../src/app.js')
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

afterEach(() => {
  if (salvo === undefined) delete process.env.APP_VERSION
  else process.env.APP_VERSION = salvo
})

describe('GET /api/v1/version', () => {
  it('responde no caminho sob /api, alcançável pelo nginx', async () => {
    process.env.APP_VERSION = 'abc1234'
    const r = await app.inject({ method: 'GET', url: '/api/v1/version' })
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json()).toEqual({ versao: 'abc1234' })
  })

  it('devolve "dev" quando APP_VERSION não está definido', async () => {
    delete process.env.APP_VERSION
    const r = await app.inject({ method: 'GET', url: '/api/v1/version' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ versao: 'dev' })
  })

  it('não expõe o commit na raiz — lá o SPA responde, não o backend', async () => {
    // Se um dia a rota voltar para `/version`, este teste cai e lembra o porquê.
    const r = await app.inject({ method: 'GET', url: '/version' })
    expect(r.statusCode).toBe(404)
  })
})

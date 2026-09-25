import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, FalhaApi } from '../src/lib/api.js'

/**
 * A RENOVAÇÃO DA SESSÃO — o portal deslogava sozinho aos 15 minutos.
 *
 * O servidor emite um cookie de acesso de 15 minutos e um de renovação de 7
 * dias, e o desenho é trocar o segundo pelo primeiro quando ele vence. O
 * cliente nunca trocava: a rota `/auth/refresh` existia desde sempre sem
 * ninguém chamar, e aos 15 minutos a primeira requisição voltava 401 e a tela
 * ia para o login.
 *
 * Relatado pelo analista: *"com um tempo o usuário desloga sozinho, tempo muito
 * curto"*.
 *
 * É um defeito de RELÓGIO, e por isso precisa de teste: ele não aparece em
 * nenhum clique, só depois de a pessoa ficar um tempo na tela -- exatamente
 * quando ninguém está olhando para o console.
 */
const chamadas: string[] = []

/** Responde 401 nas `n` primeiras chamadas a uma rota, e 200 depois. */
function servidor(opcoes: { falha401: Set<string>; refreshOk: boolean }) {
  return vi.fn((url: string) => {
    chamadas.push(url)
    if (url.endsWith('/auth/refresh')) {
      if (opcoes.refreshOk) {
        //  Renovou: as proximas chamadas passam.
        opcoes.falha401.clear()
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(
        new Response(JSON.stringify({ erro: 'Sessão expirada.', codigo: 'NAO_AUTENTICADO' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    const caminho = url.replace('/api/v1', '')
    if (opcoes.falha401.has(caminho)) {
      return Promise.resolve(
        new Response(JSON.stringify({ erro: 'Sessão inválida.', codigo: 'NAO_AUTENTICADO' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
}

beforeEach(() => {
  chamadas.length = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('renovação de sessão', () => {
  it('401 renova e REPETE a requisição, sem a tela perceber', async () => {
    vi.stubGlobal('fetch', servidor({ falha401: new Set(['/painel']), refreshOk: true }))

    await expect(api.get('/painel')).resolves.toEqual({ ok: true })

    expect(chamadas.map((c) => c.replace('/api/v1', ''))).toEqual([
      '/painel',
      '/auth/refresh',
      '/painel',
    ])
  })

  /*
   * Quando o cookie de 7 dias também venceu, não há o que fazer: o erro sobe e
   * a tela manda para o login. O que não pode é tentar de novo em laço.
   */
  it('se a renovação falha, o 401 original sobe — e tenta UMA vez só', async () => {
    vi.stubGlobal('fetch', servidor({ falha401: new Set(['/painel']), refreshOk: false }))

    await expect(api.get('/painel')).rejects.toBeInstanceOf(FalhaApi)
    expect(chamadas.filter((c) => c.endsWith('/auth/refresh'))).toHaveLength(1)
  })

  /**
   * `/auth/login` responde 401 para SENHA ERRADA, e renovar ali transformaria
   * uma credencial inválida numa ida ao `/refresh` que não tem o que fazer.
   */
  it('senha errada no login não dispara renovação', async () => {
    vi.stubGlobal('fetch', servidor({ falha401: new Set(['/auth/login']), refreshOk: true }))

    await expect(api.post('/auth/login', { login: 'x' })).rejects.toBeInstanceOf(FalhaApi)
    expect(chamadas.some((c) => c.endsWith('/auth/refresh'))).toBe(false)
  })

  /**
   * UMA RENOVAÇÃO PARA TODAS — e é isto que evita o logout que a função existe
   * para impedir.
   *
   * Uma tela abre várias requisições juntas. Se cada 401 chamasse
   * `/auth/refresh` por conta própria, a rotação invalidaria o token usado pela
   * primeira e derrubaria as outras.
   */
  it('requisições simultâneas compartilham UMA renovação', async () => {
    vi.stubGlobal(
      'fetch',
      servidor({ falha401: new Set(['/painel', '/contramedidas']), refreshOk: true }),
    )

    await Promise.all([api.get('/painel'), api.get('/contramedidas')])

    expect(chamadas.filter((c) => c.endsWith('/auth/refresh'))).toHaveLength(1)
  })
})

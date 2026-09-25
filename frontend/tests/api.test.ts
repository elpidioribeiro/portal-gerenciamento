import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/lib/api.js'

/**
 * O cliente HTTP, na parte que quebrou de verdade.
 *
 * `Content-Type: application/json` era mandado em TODA requisição, com corpo ou
 * sem. O Fastify recusa requisição sem corpo com esse header —
 * `FST_ERR_CTP_EMPTY_JSON_BODY` — então todo `DELETE` do portal voltava 400.
 *
 * Passou despercebido porque as rotas de `DELETE` foram testadas por `curl`, que
 * não manda o header sozinho. Pela tela, o botão "Remover" da classificação de
 * perfil e o "Voltar ao padrão" do horário da carga simplesmente não
 * funcionavam — sem mensagem útil, porque o erro era do Fastify e não da regra.
 */

const chamadas: Array<{ url: string; init: RequestInit }> = []

beforeEach(() => {
  chamadas.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      chamadas.push({ url, init })
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Os headers como objeto, qualquer que seja a forma que o fetch recebeu. */
function headers(init: RequestInit): Record<string, string> {
  const h = init.headers
  if (!h) return {}
  if (h instanceof Headers) return Object.fromEntries(h.entries())
  if (Array.isArray(h)) return Object.fromEntries(h)
  return h
}

describe('Content-Type só quando há corpo', () => {
  it('não manda Content-Type no DELETE', async () => {
    await api.delete('/admin/cargas/perdas/horario')

    const { init } = chamadas[0]!
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
    expect(headers(init)['Content-Type']).toBeUndefined()
  })

  it('não manda Content-Type no GET', async () => {
    await api.get('/painel')
    expect(headers(chamadas[0]!.init)['Content-Type']).toBeUndefined()
  })

  /** POST sem corpo existe: `/auth/logout` é assim. */
  it('não manda Content-Type no POST sem corpo', async () => {
    await api.post('/auth/logout')

    const { init } = chamadas[0]!
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
    expect(headers(init)['Content-Type']).toBeUndefined()
  })

  it('manda Content-Type quando há corpo', async () => {
    await api.post('/auth/login', { login: 'x', senha: 'y', filial: 'SUL' })
    expect(headers(chamadas[0]!.init)['Content-Type']).toBe('application/json')

    await api.put('/admin/cargas/perdas/horario', { hora: 3, minuto: 15 })
    expect(headers(chamadas[1]!.init)['Content-Type']).toBe('application/json')
  })

  /** Corpo vazio ainda é corpo: `{"variaveis":[]}` é operação legítima. */
  it('manda Content-Type com corpo de lista vazia', async () => {
    await api.put('/admin/perfis/1/variaveis', { nomloc: 'X', empresas: [1], variaveis: [] })
    expect(headers(chamadas[0]!.init)['Content-Type']).toBe('application/json')
  })
})

describe('a sessão vai em cookie', () => {
  /**
   * `credentials: 'include'` em tudo: a sessão vive em cookie httpOnly e o
   * JavaScript nunca vê o token — nem para enviá-lo. É o que torna a sessão imune
   * a exfiltração por XSS, e vale um teste porque é fácil de perder num refactor
   * do cliente sem nada quebrar visivelmente (em dev o cookie é same-origin).
   */
  it('em todos os métodos', async () => {
    await api.get('/painel')
    await api.post('/auth/logout')
    await api.put('/x', { a: 1 })
    await api.delete('/y')

    for (const c of chamadas) expect(c.init.credentials).toBe('include')
  })

  /**
   * O `...init` estava por ÚLTIMO no objeto do `fetch`, depois de
   * `credentials` e de `headers` — então um `init` que trouxesse qualquer um
   * dos dois substituía o que o cliente havia montado. O `Content-Type` ia
   * embora, e o `credentials: 'include'` também.
   *
   * Nenhum chamador de hoje passa esses campos, então nada estava quebrado. O
   * teste existe porque o defeito é invisível: o primeiro
   * `requisicao(caminho, { headers })` apareceria como *"o portal deslogou
   * sozinho"*, e ninguém procuraria a causa na ordem de um spread.
   */
  it('e o corpo não desliga o cookie', async () => {
    await api.post('/x', { a: 1 })
    const { init } = chamadas[0]!
    expect(init.credentials).toBe('include')
    expect(headers(init)['Content-Type']).toBe('application/json')
  })
})

/**
 * O corpo de erro é RECONHECIDO, não afirmado.
 *
 * Era `(corpo as ErroApi) ?? {...}`. O `as` dizia ao compilador que `corpo` não
 * podia ser nulo, e o `??` ao lado existia justamente porque pode — o
 * `.catch(() => null)` logo acima. O fallback era código morto aos olhos do
 * tipo e vivo na execução, e é ele que impede a tela de mostrar "undefined"
 * quando o servidor responde erro sem JSON.
 */
describe('resposta de erro', () => {
  it('sem JSON cai na mensagem genérica', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('não é json', { status: 500 }))),
    )
    // 500 tem texto próprio em `mensagemDeErro`; aqui o que importa é não
    // estourar ao ler `corpo.erro` de um `null`.
    await expect(api.get('/x')).rejects.toThrow(/comunica/i)
  })

  it('com corpo usa a mensagem do servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ erro: 'Meta não cadastrada.', codigo: 'X' }), {
            status: 422,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )
    await expect(api.get('/x')).rejects.toThrow('Meta não cadastrada.')
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { urlDeTeste } from '../setup/banco.js'

/**
 * A trava que decide em qual banco a suíte escreve.
 *
 * Vale um teste porque o erro que ela previne não dá sintoma: a ingestão apaga a
 * janela declarada antes de gravar, então a suíte apontada para o banco errado
 * destrói dado real e passa. Foi o que aconteceu — 32 linhas de maio de 2025.
 *
 * Cuidado ao ler: `DATABASE_URL` já vem trocada pelo `vitest.config.ts`, então
 * cada caso monta o ambiente que quer e o restaura depois.
 */

const salvo = { url: process.env.DATABASE_URL, teste: process.env.DATABASE_URL_TEST }

beforeEach(() => {
  delete process.env.DATABASE_URL
  delete process.env.DATABASE_URL_TEST
})

afterEach(() => {
  if (salvo.url === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = salvo.url
  if (salvo.teste === undefined) delete process.env.DATABASE_URL_TEST
  else process.env.DATABASE_URL_TEST = salvo.teste
})

describe('DATABASE_URL_TEST explícita', () => {
  it('é usada como está quando o banco se chama portalgd_test', () => {
    process.env.DATABASE_URL_TEST = 'postgresql://u:s@localhost:5432/portalgd_test?schema=public'
    expect(urlDeTeste()).toContain('/portalgd_test')
  })

  /**
   * O caso que motivou permitir a variável: desenvolvimento num servidor,
   * testes no cluster local. A derivação não conseguiria expressar isso — ela
   * só troca o nome do banco, mantendo host, porta e credencial.
   */
  it('pode apontar para outro host que a DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgresql://a:b@servidor.exemplo:5432/portal_gd?schema=public'
    process.env.DATABASE_URL_TEST = 'postgresql://u:s@localhost:5432/portalgd_test?schema=public'
    expect(urlDeTeste()).toContain('localhost')
  })

  it('tem prioridade sobre a derivação', () => {
    process.env.DATABASE_URL = 'postgresql://a:b@localhost:5432/portalgd?schema=public'
    process.env.DATABASE_URL_TEST = 'postgresql://u:s@outro:5432/portalgd_test'
    expect(urlDeTeste()).toContain('outro')
  })

  /**
   * A garantia que a derivação NÃO oferecia: derivar de uma URL qualquer sempre
   * produz um nome plausível e segue em frente. Aqui, apontar para o banco de
   * desenvolvimento é recusado pelo nome.
   */
  it('recusa qualquer banco que não seja portalgd_test', () => {
    process.env.DATABASE_URL_TEST = 'postgresql://u:s@localhost:5432/portalgd?schema=public'
    expect(() => urlDeTeste()).toThrow(/só rodam em "portalgd_test"/)
  })

  it('recusa o banco real do servidor', () => {
    process.env.DATABASE_URL_TEST =
      'postgresql://u:s@servidor.exemplo:5432/portal_gerenciamento_diario?schema=public'
    expect(() => urlDeTeste()).toThrow(/portal_gerenciamento_diario/)
  })

  /** Variável presente mas em branco é ausência, não configuração. */
  it('trata vazio como não preenchida e cai na derivação', () => {
    process.env.DATABASE_URL_TEST = '   '
    process.env.DATABASE_URL = 'postgresql://a:b@localhost:5432/portalgd?schema=public'
    expect(urlDeTeste()).toContain('/portalgd_test')
  })
})

describe('derivação da DATABASE_URL', () => {
  it('troca só o nome do banco, preservando host e credencial', () => {
    process.env.DATABASE_URL = 'postgresql://a:b@servidor.exemplo:5433/portal_gd?schema=public'
    const u = new URL(urlDeTeste())
    expect(u.pathname).toBe('/portalgd_test')
    expect(u.hostname).toBe('servidor.exemplo')
    expect(u.port).toBe('5433')
    expect(u.username).toBe('a')
    expect(u.searchParams.get('schema')).toBe('public')
  })

  it('recusa quando o próprio desenvolvimento se chama portalgd_test', () => {
    process.env.DATABASE_URL = 'postgresql://a:b@localhost:5432/portalgd_test'
    expect(() => urlDeTeste()).toThrow(/apaga o dado real/)
  })

  it('não roda sem nenhuma das duas variáveis', () => {
    expect(() => urlDeTeste()).toThrow(/DATABASE_URL ausente/)
  })
})

import { describe, expect, it } from 'vitest'
import { ENVS_POWER_AUTOMATE, validarEnv } from '../../src/config/env.js'
import { FONTES } from '../../src/fontes/fontes.mjs'

/**
 * A trava de boot dos gatilhos do Power Automate.
 *
 * O defeito que ela fecha: o portal AGENDA Vendas e NPS sozinho e lê o endereço
 * por `process.env[fonte.endpointEnv]`, FORA do schema do `env.ts`. O boot
 * passava com o secret completo e a carga quebrava no horário agendado, de
 * madrugada, longe de quem tinha acabado de subir.
 */

/** Ambiente de produção completo, para variar uma coisa por vez. */
function producao(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@host:5432/db?schema=public',
    JWT_SECRET: 'x'.repeat(64),
    INGEST_TOKEN: 'y'.repeat(43),
    COOKIE_SECURE: 'true',
    CORS_ORIGIN: 'https://portal-gd.example.com',
    AUTH_PROVIDER: 'mock',
    POWER_AUTOMATE_VENDAS: 'https://gatilho.exemplo/vendas?sig=abc',
    POWER_AUTOMATE_NPS: 'https://gatilho.exemplo/nps?sig=def',
    ...extra,
  }
}

describe('gatilhos do Power Automate no boot', () => {
  it('a lista do env.ts cobre TODA fonte que declara endpointEnv', () => {
    /*
     * O teste que mantém a lista viva.
     *
     * `ENVS_POWER_AUTOMATE` é escrita à mão porque importar `fontes.mjs` dentro
     * do `env.ts` faria I/O de arquivo no boot. O preço de escrever à mão é
     * envelhecer -- e é exatamente o que esta comparação cobra: uma fonte nova
     * do Power BI que entre em `fontes.mjs` sem passar pelo `env.ts` derruba
     * este teste, e não a carga de madrugada.
     */
    const declarados = [...new Set(FONTES.map((f) => f.endpointEnv).filter((v) => v !== null))]
    expect([...ENVS_POWER_AUTOMATE].sort()).toEqual(declarados.sort())
  })

  it('produção recusa subir sem os dois gatilhos', () => {
    expect(() =>
      validarEnv(producao({ POWER_AUTOMATE_VENDAS: undefined, POWER_AUTOMATE_NPS: undefined })),
    ).toThrow(/POWER_AUTOMATE_VENDAS, POWER_AUTOMATE_NPS/)
  })

  it('produção recusa subir com só um deles', () => {
    expect(() => validarEnv(producao({ POWER_AUTOMATE_NPS: undefined }))).toThrow(
      /Faltando em produção: POWER_AUTOMATE_NPS/,
    )
  })

  it('string vazia conta como ausente', () => {
    /*
     * O caso do secret criado com a chave presente e o valor em branco -- que é
     * como um segredo esquecido costuma chegar, e não como chave faltando.
     * Sem esta checagem o `.optional()` aceitaria `''` e a falha voltaria a ser
     * de madrugada.
     */
    expect(() => validarEnv(producao({ POWER_AUTOMATE_VENDAS: '   ' }))).toThrow(
      /Faltando em produção: POWER_AUTOMATE_VENDAS/,
    )
  })

  it('produção sobe com os dois preenchidos', () => {
    expect(() => validarEnv(producao())).not.toThrow()
  })

  it('fora de produção não exige nenhum dos dois', () => {
    /*
     * Desenvolver sem acesso ao Power BI é normal. Quem precisar de Vendas ou
     * NPS descobre na hora de carregar, pela mensagem de `endpointDa`.
     */
    expect(() =>
      validarEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
        JWT_SECRET: 'x'.repeat(64),
        INGEST_TOKEN: 'y'.repeat(43),
      }),
    ).not.toThrow()
  })
})

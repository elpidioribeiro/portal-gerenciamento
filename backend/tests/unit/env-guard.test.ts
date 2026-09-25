import { describe, expect, it } from 'vitest'
import { validarEnv } from '../../src/config/env.js'

/**
 * A trava mais importante do projeto: o bypass de autenticação não pode subir
 * em produção.
 *
 * Ignorar a variável silenciosamente pareceria mais tolerante, mas esconderia
 * um `.env` de produção que veio com a flag de desenvolvimento. O boot precisa
 * cair, e ruidosamente.
 */

const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(48),
  INGEST_TOKEN: 'y'.repeat(40),
} satisfies NodeJS.ProcessEnv

/**
 * Produção exige uma origem de CORS de verdade — o padrão é localhost e o boot
 * recusa. Ver o describe de CORS no fim do arquivo.
 */
const PRODUCAO = {
  ...BASE,
  NODE_ENV: 'production',
  CORS_ORIGIN: 'https://portal-gd.example.com',
  /*
   * Entrou em 12/09/2026, com a trava nova: produção SEM ele é inválida por
   * definição, e o fixture descreve um ambiente de produção VÁLIDO. Deixá-lo
   * de fora faria todo teste daqui para baixo falhar pelo motivo errado.
   */
  COOKIE_SECURE: 'true',
  /*
   * Entraram em 15/09/2026, pelo mesmo motivo do `COOKIE_SECURE` logo acima:
   * produção sem eles é inválida por definição, e este fixture descreve um
   * ambiente de produção VÁLIDO.
   *
   * Que estes seis testes tenham quebrado ao ganhar a trava nova é o
   * comportamento certo -- eles afirmam "produção sobe normalmente", e o que
   * "normalmente" significa acabou de mudar. A trava da carga de Vendas e NPS
   * está em `env-power-automate.test.ts`.
   */
  POWER_AUTOMATE_VENDAS: 'https://gatilho.exemplo/vendas?sig=abc',
  POWER_AUTOMATE_NPS: 'https://gatilho.exemplo/nps?sig=def',
} satisfies NodeJS.ProcessEnv

describe('trava do bypass de autenticação', () => {
  it('recusa NODE_ENV=production com AUTH_DEV_BYPASS=true', () => {
    expect(() => validarEnv({ ...PRODUCAO, AUTH_DEV_BYPASS: 'true' })).toThrow(
      /AUTH_DEV_BYPASS.*produ/is,
    )
  })

  it('permite o bypass em desenvolvimento', () => {
    const env = validarEnv({ ...BASE, NODE_ENV: 'development', AUTH_DEV_BYPASS: 'true' })
    expect(env.AUTH_DEV_BYPASS).toBe(true)
  })

  it('produção sobe normalmente sem a flag', () => {
    const env = validarEnv(PRODUCAO)
    expect(env.AUTH_DEV_BYPASS).toBe(false)
    expect(env.ehProducao).toBe(true)
  })

  it('o bypass é desligado por padrão — não basta esquecer a variável', () => {
    expect(validarEnv(BASE).AUTH_DEV_BYPASS).toBe(false)
  })

  it('qualquer valor que não seja exatamente "true" mantém o bypass desligado', () => {
    // Um `AUTH_DEV_BYPASS=1` ou `=yes` num .env de produção não pode ligar nada.
    for (const valor of ['1', 'yes', 'sim', 'TRUE', '']) {
      expect(() => validarEnv({ ...BASE, AUTH_DEV_BYPASS: valor })).toThrow()
    }
  })
})

describe('validação de ambiente', () => {
  it('exige JWT_SECRET longo o bastante', () => {
    expect(() => validarEnv({ ...BASE, JWT_SECRET: 'curto' })).toThrow(/JWT_SECRET/)
  })

  it('exige INGEST_TOKEN longo o bastante', () => {
    expect(() => validarEnv({ ...BASE, INGEST_TOKEN: 'curto' })).toThrow(/INGEST_TOKEN/)
  })

  it('lista todos os problemas de uma vez, não só o primeiro', () => {
    try {
      validarEnv({})
      expect.unreachable('deveria ter lançado')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('DATABASE_URL')
      expect(msg).toContain('JWT_SECRET')
      expect(msg).toContain('INGEST_TOKEN')
    }
  })
})

/**
 * CORS em produção.
 *
 * As duas recusas falham no BOOT, e não na primeira requisição do navegador —
 * onde o erro apareceria como problema de rede no console de outra pessoa, longe
 * de quem configurou.
 */
describe('CORS em produção', () => {
  it('recusa curinga', () => {
    expect(() => validarEnv({ ...PRODUCAO, CORS_ORIGIN: '*' })).toThrow(/curinga|Curinga/)
  })

  /**
   * `*` com `credentials: true` é recusado pelo próprio navegador. O risco não é
   * abrir a API: é o portal parar de funcionar sem explicação, e alguém
   * "consertar" removendo o `credentials` — que é o que guarda a sessão em cookie
   * httpOnly, imune a XSS.
   */
  it('recusa curinga com espaço em volta', () => {
    expect(() => validarEnv({ ...PRODUCAO, CORS_ORIGIN: '  *  ' })).toThrow(/curinga|Curinga/)
  })

  it('recusa o valor de desenvolvimento', () => {
    expect(() => validarEnv({ ...PRODUCAO, CORS_ORIGIN: 'http://localhost:5173' })).toThrow(
      /desenvolvimento/,
    )
    expect(() => validarEnv({ ...PRODUCAO, CORS_ORIGIN: 'http://127.0.0.1:5173' })).toThrow(
      /desenvolvimento/,
    )
  })

  it('aceita uma origem real', () => {
    const env = validarEnv({ ...PRODUCAO, CORS_ORIGIN: 'https://portal-gd.example.com' })
    expect(env.CORS_ORIGIN).toBe('https://portal-gd.example.com')
  })

  /** Fora de produção, localhost é justamente o que se quer. */
  it('não interfere em desenvolvimento', () => {
    const env = validarEnv({ ...BASE, NODE_ENV: 'development' })
    expect(env.CORS_ORIGIN).toBe('http://localhost:5173')
  })
})

/**
 * O COOKIE DE SESSÃO EM PRODUÇÃO — dois defeitos somados, e cada um sozinho
 * seria inofensivo.
 *
 * Achado da estação 5 em 12/09/2026:
 *
 *  1. `COOKIE_SECURE` não estava no `chart/values.yaml`, então produção caía no
 *     padrão do schema — `false`;
 *  2. a leitura era `z.coerce.boolean()`, que não lê a PALAVRA e sim se a
 *     string é vazia. Com isso `"false"` virava `true` e a ÚNICA forma de
 *     produzir `false` era omitir a variável, que é o que o chart fazia.
 *
 * Resultado: `gd_sessao` e o `gd_refresh` de 7 dias sem a marca `Secure` num
 * host com TLS. Sem sintoma nenhum — o portal funciona igual, e os dois cookies
 * passam a trafegar em claro em qualquer requisição `http://` para o mesmo host.
 */
describe('COOKIE_SECURE', () => {
  it('lê a palavra, e não se a string é vazia', () => {
    expect(validarEnv({ ...BASE, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false)
    expect(validarEnv({ ...BASE, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true)
  })

  it('produção sem ele derruba o boot', () => {
    expect(() =>
      validarEnv({ ...PRODUCAO, COOKIE_SECURE: 'false' }),
    ).toThrow(/COOKIE_SECURE/)
    const { COOKIE_SECURE: _omitido, ...semAFlag } = PRODUCAO
    expect(() => validarEnv(semAFlag)).toThrow(/COOKIE_SECURE/)
  })

  it('produção com ele passa', () => {
    expect(validarEnv({ ...PRODUCAO, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true)
  })
})

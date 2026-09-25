import { prepararBancoDeTeste, urlDeTeste } from './banco.js'

/**
 * `globalSetup` do Vitest: prepara o banco de teste antes do primeiro arquivo.
 *
 * Roda no processo principal, uma vez. Os arquivos de teste recebem a URL pelo
 * `test.env` do vitest.config.ts — variável definida aqui não atravessaria para
 * os workers, que são processos separados.
 */
export async function setup(): Promise<void> {
  const url = urlDeTeste()
  const inicio = Date.now()

  console.log(`\n[teste] preparando banco isolado: ${mascarar(url)}`)
  prepararBancoDeTeste(url)
  console.log(`[teste] banco pronto em ${((Date.now() - inicio) / 1000).toFixed(1)}s\n`)
}

/**
 * O banco NÃO é derrubado no fim de propósito: quando um teste falha, poder
 * abrir o banco e olhar o estado que causou a falha vale mais que a limpeza.
 * A próxima execução recria tudo do zero, então não há resíduo acumulando.
 */

/** Esconde a senha ao imprimir a URL no log. */
function mascarar(url: string): string {
  const u = new URL(url)
  u.password = '***'
  return u.toString()
}

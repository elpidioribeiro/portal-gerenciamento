import { cpSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Copia para `dist/` o que o `tsc` não emite mas o runtime executa.
 *
 * `src/fontes/` tem dois tipos de arquivo que o compilador ignora:
 *
 * - `fontes.mjs` — JavaScript puro. O `tsc` resolve o tipo pelo `.d.mts` ao lado
 *   e **não copia o `.mjs`**, porque `allowJs` é falso. O import compilado
 *   aponta para um arquivo que não existiria em `dist/`.
 * - `sql/*.sql` — as consultas de Perdas e Movimentação, lidas em tempo de
 *   execução por `lerSql()`.
 *
 * Sem este passo, `node dist/server.js` morre no boot com
 * `ERR_MODULE_NOT_FOUND`. Falha ruidosa e imediata, ao menos — mas só em
 * produção, porque em desenvolvimento o `tsx` lê direto de `src/`.
 *
 * Roda como parte do `npm run build`, não como passo separado que alguém precisa
 * lembrar de chamar.
 */

const AQUI = path.resolve(import.meta.dirname, '..')
const DE = path.join(AQUI, 'src', 'fontes')
const PARA = path.join(AQUI, 'dist', 'fontes')

if (!existsSync(DE)) {
  console.error(`Nao achei ${DE}. O build precisa rodar depois do tsc.`)
  process.exit(1)
}

cpSync(DE, PARA, { recursive: true })

/**
 * Confere que o essencial chegou, em vez de confiar no `cpSync`.
 *
 * O que falha aqui é o boot de producao, longe de quem rodou o build — e um
 * `dist/` incompleto que passa pelo CI e quebra no deploy custa muito mais que
 * esta checagem.
 */
const copiados = readdirSync(PARA)
const sql = existsSync(path.join(PARA, 'sql')) ? readdirSync(path.join(PARA, 'sql')) : []

for (const obrigatorio of ['fontes.mjs']) {
  if (!copiados.includes(obrigatorio)) {
    console.error(`FALTOU ${obrigatorio} em dist/fontes. O boot de producao falharia.`)
    process.exit(1)
  }
}
if (sql.length === 0) {
  console.error('FALTOU dist/fontes/sql. As cargas de Perdas e Movimentacao falhariam.')
  process.exit(1)
}

console.log(`assets: ${copiados.length} em dist/fontes (${sql.length} arquivos .sql)`)

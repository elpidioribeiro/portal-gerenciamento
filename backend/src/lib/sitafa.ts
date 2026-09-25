/**
 * Quem está trabalhando, no cadastro corporativo.
 *
 * **`sitafa <> 7`, e não `sitafa = 1`.** A correção é do analista (31/08/2026),
 * e o banco mostra o tamanho do erro anterior:
 *
 *   sitafa 1    5.219    <- o único que a regra antiga aceitava
 *   sitafa 2      212  ┐
 *   sitafa 3      126  │
 *   sitafa 4       15  ├─ 390 pessoas trabalhando que ficavam de fora
 *   sitafa 6       25  │
 *   sitafa 8        1  │
 *   sitafa 14      11  ┘
 *   sitafa 7      476    <- o único que deve sair
 *
 * `sitafa = 1` não dava erro: bloqueava o login de 390 pessoas com a mensagem
 * de "perfil não classificado", que manda procurar um cadastro que está certo.
 *
 * MORA AQUI porque três lugares perguntam a mesma coisa — a consulta de login,
 * a validação de perfil do admin e a carga de usuários. Três cópias seriam três
 * respostas para "esta pessoa trabalha aqui?", e a divergência não gera erro:
 * gera gente que entra num caminho e não no outro.
 *
 * `performance-vendedor.ts` já dizia o certo (`SITAFA_INATIVO = 7`) enquanto
 * `perfis-oracle.ts` dizia o contrário. Era essa a discordância.
 */
export const SITAFA_DESLIGADO = 7

/** Fragmento de `WHERE` para as consultas na `hr_vw_colaboradores`. */
export const TRABALHANDO = `sitafa <> ${String(SITAFA_DESLIGADO)}`

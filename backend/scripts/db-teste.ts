/**
 * Derruba o banco de teste. A próxima `npm test` o recria com migrations + seed.
 *
 *   npm run test:limpar
 *
 * Necessário só quando uma migration foi EDITADA no lugar em vez de somada — o
 * `migrate deploy` do globalSetup aplica migrations novas, mas não reaplica uma
 * que mudou de conteúdo. Fora esse caso, nunca precisa rodar isto.
 *
 * Um `DROP DATABASE` fica aqui, num script que o desenvolvedor chama de
 * propósito, e não no globalSetup: derrubar banco a cada execução de teste
 * seria uma arma apontada para o banco de desenvolvimento no dia em que a
 * derivação da URL falhasse.
 */
import { PrismaClient } from '@prisma/client'
import { urlDeTeste } from '../tests/setup/banco.js'

const alvo = new URL(urlDeTeste())
const nome = alvo.pathname.replace(/^\//, '')

// Conecta no banco de MANUTENÇÃO: não se derruba o banco em que se está
// conectado. `postgres` existe em qualquer cluster.
const manutencao = new URL(alvo)
manutencao.pathname = '/postgres'
manutencao.search = ''

const prisma = new PrismaClient({ datasources: { db: { url: manutencao.toString() } } })

try {
  // Confirmação em código do que o nome do banco já diz: se a derivação da URL
  // algum dia devolver o banco de desenvolvimento, o DROP não acontece.
  if (!nome.endsWith('_test')) {
    throw new Error(`"${nome}" não termina em _test — recusando derrubar.`)
  }

  // Sem `IF EXISTS` haveria erro quando o banco ainda não foi criado, e nesse
  // caso o resultado desejado já está satisfeito.
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${nome}" WITH (FORCE)`)
  console.log(`Banco de teste "${nome}" removido. A próxima \`npm test\` o recria.`)
} catch (e) {
  console.error('Falhou:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}

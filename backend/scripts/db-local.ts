/**
 * Postgres local em espaço de usuário, para quando o Docker não estiver
 * disponível (a máquina de dev não tem privilégio para atualizar o WSL, que é
 * pré-requisito do Docker Desktop).
 *
 * Sobe o mesmo Postgres 16 do `docker-compose.yml`, na mesma porta e com as
 * mesmas credenciais — a DATABASE_URL do .env funciona nos dois cenários sem
 * alteração. Quando o Docker voltar a funcionar, é só usar o compose e parar
 * de rodar este script; nada mais muda.
 *
 *   npm run db:start   sobe (mantém rodando)
 *   npm run db:stop    para
 *   npm run db:limpar  apaga o cluster e recomeça do zero
 *
 * O cluster hospeda DOIS bancos: `portalgd`, com o dado real carregado do Power
 * BI, e `portalgd_test`, que a suíte recria a cada execução. A separação existe
 * porque o teste de ingestão apaga a janela que declara, e já comeu 4 dias de
 * Vendas do banco de desenvolvimento. Ver tests/setup/banco.ts.
 */
import { rm } from 'node:fs/promises'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'

const DIR_DADOS = path.resolve(import.meta.dirname, '..', '.pgdata')

const pg = new EmbeddedPostgres({
  databaseDir: DIR_DADOS,
  user: 'portalgd',
  password: 'portalgd_dev',
  port: 5432,
  persistent: true,
  // Sem isso o initdb herda o locale do Windows (pt-BR) e cria o cluster em
  // WIN1252, enquanto o postgres:16-alpine de produção usa UTF8. A divergência
  // não aparece em desenvolvimento e estoura em produção no primeiro caractere
  // que WIN1252 não representa.
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--lc-collate=C', '--lc-ctype=C'],
  onLog: (msg) => {
    // O Postgres é verboso no boot; só o que importa para quem está olhando.
    if (/ready to accept connections|FATAL|ERROR|could not/i.test(msg)) {
      console.log(`[pg] ${msg.trim()}`)
    }
  },
})

const comando = process.argv[2] ?? 'start'

switch (comando) {
  case 'start': {
    await iniciar()
    break
  }
  case 'stop': {
    await pg.stop()
    console.log('Postgres parado.')
    break
  }
  case 'limpar': {
    try {
      await pg.stop()
    } catch {
      // já estava parado
    }
    await rm(DIR_DADOS, { recursive: true, force: true })
    console.log(`Cluster removido: ${DIR_DADOS}`)
    break
  }
  default:
    console.error(`Comando desconhecido: ${comando}. Use start | stop | limpar.`)
    process.exit(1)
}

async function iniciar() {
  const { existsSync } = await import('node:fs')
  const primeiraVez = !existsSync(DIR_DADOS)

  if (primeiraVez) {
    console.log('Inicializando cluster pela primeira vez...')
    await pg.initialise()
  }

  await pg.start()

  if (primeiraVez) {
    await pg.createDatabase('portalgd')
    console.log('Banco "portalgd" criado.')
  }

  console.log('Postgres 16 em postgresql://portalgd:***@localhost:5432/portalgd')
  console.log('Ctrl+C para parar.\n')

  // Sem isso o processo terminaria e derrubaria o banco junto.
  const encerrar = async () => {
    console.log('\nEncerrando Postgres...')
    await pg.stop()
    process.exit(0)
  }
  // `void` na frente: `encerrar` e' async e `process.on` espera void.
  process.on('SIGINT', () => void encerrar())
  process.on('SIGTERM', () => void encerrar())
  await new Promise(() => {})
}

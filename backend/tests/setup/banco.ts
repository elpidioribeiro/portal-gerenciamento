import { spawnSync } from 'node:child_process'

/**
 * Banco dedicado aos testes.
 *
 * Motivo: a ingestão funciona por SUBSTITUIÇÃO DE JANELA — apaga o período
 * declarado e grava o que chegou. É de propósito (uma correção na origem se
 * resolve recarregando, sem duplicar linha), mas significa que um teste de
 * carga apaga dados de verdade.
 *
 * Aconteceu: os testes declararam janela de 12 a 15/05/2025 com um payload de
 * uma filial só, e o portal fez o que foi mandado — apagou os 4 dias das 9
 * filiais e gravou `CEN = R$ 10.000`. Trinta e duas linhas do backfill do Power
 * BI sumiram, e o painel passou a mostrar aquele mês errado sem nenhum aviso.
 *
 * A separação é por BANCO, não por cluster: o `portalgd_test` mora no mesmo
 * Postgres que o `npm run db:start` já sobe. Um segundo cluster em outra porta
 * resolveria igual, custando outro processo e outro diretório de dados para
 * manter — sem ganho, porque o que precisava ficar isolado é o dado, não o
 * servidor.
 */

const NOME = 'portalgd_test'

/**
 * URL de teste: `DATABASE_URL_TEST` se houver, senão derivada da `DATABASE_URL`
 * trocando só o nome do banco.
 *
 * A derivação era o único caminho, e por um motivo bom: uma variável própria
 * esquecida no `.env` apontaria para o banco de desenvolvimento sem nada
 * reclamar, e a destruição de dado real voltaria calada.
 *
 * Ela deixou de bastar quando o desenvolvimento passou a usar um Postgres de
 * servidor. Derivar produz `portalgd_test` **naquele servidor**, e o usuário de
 * aplicação — corretamente — não tem CREATE DATABASE: medido, `permission
 * denied for database`. Não é limitação a contornar, é privilégio mínimo
 * funcionando. Rodar a suíte contra o servidor também seria lento: a mesma
 * consulta leva ~2 ms local e ~1.600 ms remota.
 *
 * O que a variável explícita NÃO abre mão: o nome do banco tem de ser
 * exatamente `portalgd_test`. Apontar para o de desenvolvimento é recusado —
 * garantia que a derivação nem oferecia, porque derivar de uma URL trocada
 * gerava um nome plausível e seguia em frente.
 */
export function urlDeTeste(base = process.env.DATABASE_URL): string {
  const explicita = process.env.DATABASE_URL_TEST?.trim()

  if (explicita) {
    const u = new URL(explicita)
    const nome = u.pathname.replace(/^\//, '')

    if (nome !== NOME) {
      throw new Error(
        `DATABASE_URL_TEST aponta para o banco "${nome}", e os testes só rodam em ` +
          `"${NOME}".\nA suíte APAGA janelas inteiras de dado — ver o comentário no topo ` +
          'de tests/setup/banco.ts.\nCorrija o nome do banco na URL ou remova a variável.',
      )
    }

    return u.toString()
  }

  if (!base) {
    throw new Error(
      'DATABASE_URL ausente. Sem DATABASE_URL_TEST, os testes derivam a URL de teste ' +
        'dela — confira o .env.',
    )
  }

  const u = new URL(base)
  const atual = u.pathname.replace(/^\//, '')

  if (atual === NOME) {
    throw new Error(
      `O banco de desenvolvimento se chama "${NOME}", o mesmo nome reservado aos ` +
        'testes. Renomeie o DATABASE_URL do .env — senão o teste apaga o dado real.',
    )
  }

  u.pathname = `/${NOME}`
  return u.toString()
}

/**
 * Recria o banco de teste do zero: migrations + seed.
 *
 * Roda uma vez por execução da suíte, não por arquivo de teste. Cada arquivo
 * partindo de um banco limpo seria mais rigoroso, mas multiplicaria o seed por
 * doze arquivos; e o isolamento que faltava era entre TESTE e DESENVOLVIMENTO,
 * que este banco já resolve.
 *
 * `migrate deploy`, não `migrate reset`: o `deploy` cria o banco se não existir
 * e aplica as migrations pendentes sem apagar nada, enquanto o `reset` DERRUBA
 * o banco inteiro. Quem limpa as tabelas é o seed, que já começa com um
 * `limpar()` — então o `reset` não acrescentaria nada além do poder de destruir
 * o banco errado no dia em que a URL vier trocada.
 *
 * Consequência aceita: uma migration EDITADA no lugar (em vez de uma nova) não
 * é reaplicada. Para esse caso existe o `npm run test:limpar`.
 */
export function prepararBancoDeTeste(url: string): void {
  const env = {
    ...process.env,
    DATABASE_URL: url,
    // O seed se recusa a rodar num banco com sinal de ingestão real, para não
    // apagar o que veio do Power BI. Aqui apagar é o objetivo: os testes de
    // ingestão deixam execuções gravadas de 127.0.0.1, que disparariam a
    // recusa a partir da segunda rodada. O escape vale só neste caminho —
    // quem digita `npm run db:seed` na mão continua barrado.
    SEED_FORCAR: '1',
  }

  executar('prisma migrate deploy', env)
  executar('tsx prisma/seed/index.ts', env)
}

/**
 * `shell: true` com o comando em string única, sem array de argumentos: no
 * Windows os binários do node_modules são `.cmd`, que o spawn direto não
 * executa. Passar array junto com shell dispara DEP0190 no Node 22, porque os
 * argumentos seriam concatenados sem escape — aqui não há nada de fora para
 * escapar, os comandos são constantes deste arquivo.
 */
function executar(comando: string, env: NodeJS.ProcessEnv): void {
  const r = spawnSync(comando, { shell: true, env, encoding: 'utf8' })

  if (r.status !== 0) {
    // A saída do Prisma/seed é a única pista útil quando isso falha; engoli-la
    // deixaria "preparação do banco falhou" sem dizer por quê.
    /**
     * `stdout`/`stderr` relidos como `string | null`, contra o que o tipo diz.
     *
     * Com `encoding` definido, `spawnSync` declara os dois como `string` — mas
     * quando o processo nem chega a nascer (binário ausente, ENOENT) eles voltam
     * nulos. Sem o `??`, a mensagem traria "null" no meio do texto, justamente
     * no caminho que existe para explicar a falha.
     */
    const saida = r as { stdout: string | null; stderr: string | null }
    throw new Error(
      `Falha ao preparar o banco de teste (${comando}):\n${saida.stdout ?? ''}${saida.stderr ?? ''}`,
    )
  }
}

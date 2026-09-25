import oracledb from 'oracledb'
import { env } from '../config/env.js'

/**
 * Leitura direta no Oracle — só consulta, nunca escrita.
 *
 * Reverte a decisão original de o portal não conhecer o Oracle. As duas razões
 * daquela decisão expiraram:
 *
 * - *"mantém a imagem sem binário nativo"* — o `node-oracledb` 6+ tem **modo
 *   Thin**, JavaScript puro. Não há Instant Client, e a imagem segue alpine limpa.
 * - *"mantém a credencial fora do portal"* — o padrão da área é o oposto:
 *   `<USUARIO_APP>` com secret do Kubernetes (`<app>-creds`, do DevOps). Ver
 *   `credenciais-seguras.md` da estação 2 da esteira.
 *
 * O que a mudança resolve, concretamente: **o login deixa de depender do n8n**.
 * A API da ERP valida a credencial mas não devolve perfil (`role` vem
 * `"UNKNOWN"` até para diretoria), então o nível sai de uma consulta no banco.
 * Resolvê-la por webhook faria o portal inteiro cair junto com o n8n.
 *
 * O que NÃO muda: Vendas, NPS e Perdas vêm do **Power BI**, não do Oracle, e
 * seguem pelo Power Automate no n8n.
 */

/** Só leitura. Ver `garantirSelect`. */
const PROIBIDO = /\b(insert|update|delete|merge|drop|truncate|alter|create|grant|revoke|commit)\b/i

/**
 * Recusa qualquer coisa que não seja `SELECT` ou `WITH`.
 *
 * O usuário do banco já deve ser de leitura, e essa é a defesa que vale. Esta
 * checagem é a segunda camada: protege contra o dia em que alguém apontar o
 * portal para uma conta com mais privilégio do que precisa, e contra erro de
 * digitação num script de manutenção. Custa uma expressão regular.
 */
function garantirSelect(sql: string): void {
  const limpo = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()

  if (!/^(select|with)\b/i.test(limpo)) {
    throw new Error('Consulta recusada: o portal só executa SELECT no Oracle.')
  }
  if (PROIBIDO.test(limpo)) {
    throw new Error('Consulta recusada: contém comando de escrita.')
  }
}

let pool: oracledb.Pool | null = null

/**
 * Pool preguiçoso, criado na primeira consulta.
 *
 * `poolMin: 0` é o que permite **o portal subir com o Oracle fora**. Com mínimo
 * maior, a criação do pool tentaria abrir conexão no boot e o processo morreria
 * — derrubando também o painel, que não precisa do Oracle para nada.
 */
async function obterPool(): Promise<oracledb.Pool> {
  if (pool) return pool

  if (!env.ORACLE_USER || !env.ORACLE_PASSWORD || !env.ORACLE_CONNECT_STRING) {
    throw new Error(
      'Oracle não configurado: faltam ORACLE_USER, ORACLE_PASSWORD ou ORACLE_CONNECT_STRING.',
    )
  }

  pool = await oracledb.createPool({
    user: env.ORACLE_USER,
    password: env.ORACLE_PASSWORD,
    connectString: env.ORACLE_CONNECT_STRING,
    poolMin: 0,
    poolMax: env.ORACLE_POOL_MAX,
    // Devolve conexão ociosa em vez de segurar. O portal consulta o Oracle em
    // rajadas curtas (login, recarga), não continuamente.
    poolTimeout: 60,
    /**
     * Espera por conexão livre — NÃO acompanha o timeout de consulta.
     *
     * Estes dois números pareciam o mesmo e não são. O timeout de consulta subiu
     * para 20 minutos por causa da carga de Perdas, que leva minutos; a espera
     * na fila continua curta, porque quem espera aqui é uma requisição HTTP que
     * ainda não começou nada. Amarrar os dois faria um login ficar pendurado 20
     * minutos quando o pool estivesse cheio — pior que falhar rápido e virar 500.
     */
    queueTimeout: env.ORACLE_FILA_TIMEOUT_S * 1000,
  })

  return pool
}

/**
 * O que pode ser bind.
 *
 * Deliberadamente estreito. `Record<string, unknown>` não compila contra o tipo
 * do driver, e afrouxar com `any` esconderia justamente o erro que interessa:
 * passar objeto ou array onde o Oracle espera escalar.
 */
export type Binds = Record<string, string | number | Date | null>

export interface ResultadoOracle<T> {
  linhas: T[]
  /**
   * `true` quando o resultado bateu no teto e pode estar incompleto.
   *
   * Quem consome **precisa** olhar isto. Exibir número parcial como se fosse o
   * total é o tipo de erro que não dá sintoma — e a estação 5 da esteira trata
   * corte silencioso como bloqueio de subida.
   */
  truncado: boolean
}

export interface OpcoesConsulta {
  /**
   * `'api'` (padrão) ou `'carga'`, e a escolha é o teto de tempo.
   *
   * Duas classes de consulta com necessidades opostas, e uma delas não pode
   * herdar o teto da outra:
   *
   * - **api**: o login resolve o nível em 15 ms, com uma requisição HTTP
   *   esperando. Teto curto, porque 500 rápido é melhor que página pendurada.
   * - **carga**: os indicadores. Perdas leva 60 a 104 segundos para um mês e já
   *   estourou o teto de 60. Roda por script ou agendamento, sem ninguém
   *   olhando.
   *
   * É parâmetro e não variável global porque as duas coexistem no mesmo processo:
   * o portal serve login enquanto uma carga corre.
   */
  perfil?: 'api' | 'carga'
}

/**
 * Executa um SELECT com bind parameters.
 *
 * `binds` é objeto nomeado (`{ usuario: 10001 }`) casando com `:usuario` no SQL.
 * Nunca interpole valor no texto da consulta: além da injeção, data interpolada
 * depende do `NLS_DATE_FORMAT` da sessão e pode trazer o período errado sem
 * falhar.
 */
export async function consultar<T = Record<string, unknown>>(
  sql: string,
  binds: Binds = {},
  opcoes: OpcoesConsulta = {},
): Promise<ResultadoOracle<T>> {
  garantirSelect(sql)

  const p = await obterPool()
  const conexao = await p.getConnection()
  try {
    // Teto de tempo por chamada, para uma consulta ruim não pendurar o pool.
    // É propriedade da CONEXÃO, não opção do `execute` — o driver não aceita
    // `callTimeout` em `ExecuteOptions`.
    const segundos =
      opcoes.perfil === 'carga' ? env.ORACLE_TIMEOUT_CARGA_S : env.ORACLE_TIMEOUT_S
    conexao.callTimeout = segundos * 1000

    const teto = env.ORACLE_MAX_ROWS
    const r = await conexao.execute<T>(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      // Pede UMA linha além do teto: se ela vier, sabemos que havia mais e
      // podemos avisar. Cortar exatamente no teto não distingue "cabia justo"
      // de "foi cortado".
      maxRows: teto + 1,
    })

    const todas = r.rows ?? []
    const truncado = todas.length > teto
    return { linhas: truncado ? todas.slice(0, teto) : todas, truncado }
  } finally {
    // `close` e não `release`: devolve ao pool, não fecha o socket.
    await conexao.close().catch(() => {})
  }
}

/** Uma linha ou `null`. Mais de uma é erro de consulta, não caso a tratar. */
export async function consultarUma<T = Record<string, unknown>>(
  sql: string,
  binds: Binds = {},
  opcoes: OpcoesConsulta = {},
): Promise<T | null> {
  const { linhas } = await consultar<T>(sql, binds, opcoes)
  if (linhas.length > 1) {
    throw new Error(
      `A consulta devolveu ${linhas.length} linhas onde se esperava no máximo uma. ` +
        'Confira a chave do WHERE.',
    )
  }
  return linhas[0] ?? null
}

/** Fecha o pool no encerramento. Sem isto o processo não termina. */
export async function encerrarOracle(): Promise<void> {
  if (!pool) return
  const p = pool
  pool = null
  // `drainTime` 0: não espera consulta em curso. No encerramento, derrubar é o
  // que se quer — esperar prenderia o shutdown por até o timeout de consulta.
  await p.close(0).catch(() => {})
}

/** Para o health check: responde se a conexão está de pé, sem lançar. */
export async function oracleRespondendo(): Promise<boolean> {
  try {
    const { linhas } = await consultar<{ UM: number }>('SELECT 1 AS UM FROM DUAL')
    return linhas.length === 1
  } catch {
    return false
  }
}

/**
 * Recarga sob demanda de uma janela.
 *
 * Duas origens, escolhidas pelo `tipo` da fonte em `fontes.mjs`:
 *
 * - `dax`  → Power Automate → Power BI → portal  (Vendas, NPS)
 * - `sql`  → Oracle direto → portal              (Perdas, Movimentação)
 *
 * O fluxo agendado do n8n tem janela FIXA — 60 dias em Vendas e NPS, contra
 * tabelas que guardam 2 anos. Tudo mais antigo que isso é território que o
 * agendamento nunca volta a tocar: se o dado de lá estiver errado, não existe
 * caminho automático de conserto. Este script é esse caminho.
 *
 * Quando serve:
 *
 * - A origem corrigiu o passado (devolução lançada com atraso, nota cancelada).
 * - O n8n falhou e ninguém viu; passados 60 dias, o buraco virou permanente.
 * - Backfill de indicador novo: o fluxo traz 60 dias, o resto vem por aqui.
 * - A DAX mudou. Conserta o futuro; o histórico já gravado exige recarga.
 *
 * A consulta e o mapeamento vêm de `src/fontes/fontes.mjs`, os MESMOS que geram o
 * fluxo do n8n. Duas cópias gravariam números calculados por regras diferentes
 * pelas duas rotas, sem erro nenhum — e o projeto já pagou esse preço duas
 * vezes (aritmética de percentual entre seed e produção; meta do período entre
 * painel e gráfico).
 *
 *   npm run recarregar vendas 2025-05-12 2025-05-15
 *   npm run recarregar vendas 2025-01-01 2025-12-31 --blocos=90
 *   npm run recarregar vendas --metas
 *   npm run recarregar nps 2025-01-01 2025-03-31 --seco
 */
import { acharFonte, expressaoData, type Fonte, type LinhaBruta } from '../src/fontes/fontes.mjs'
import { env } from '../src/config/env.js'
import { consultar, encerrarOracle } from '../src/lib/oracle.js'
import { consultarPowerBI, endpointDa } from '../src/lib/power-automate.js'

const ISO = /^\d{4}-\d{2}-\d{2}$/
const DIA_MS = 86_400_000

interface Opcoes {
  fonte: Fonte
  de?: string
  ate?: string
  metas: boolean
  /** Tamanho do bloco em dias; sem isso a janela vai numa chamada só. */
  blocos?: number
  /** Consulta o Power BI e mostra o que iria, mas não envia ao portal. */
  seco: boolean
}

function uso(erro?: string): never {
  if (erro) console.error(`\nErro: ${erro}\n`)
  console.error(
    [
      'uso: npm run recarregar <fonte> <de> <ate> [opções]',
      '     npm run recarregar <fonte> --metas',
      '',
      'opções:',
      '  --metas        carrega também as metas da fonte (ou só elas, sem janela)',
      '  --blocos=<N>   parte a janela em blocos de N dias, enviados em sequência',
      '  --seco         consulta o Power BI e mostra o resultado, sem enviar',
      '',
      'exemplos:',
      '  npm run recarregar vendas 2025-05-12 2025-05-15',
      '  npm run recarregar vendas 2025-01-01 2025-12-31 --blocos=90',
      '  npm run recarregar vendas --metas',
    ].join('\n'),
  )
  process.exit(erro ? 1 : 0)
}

function lerArgumentos(argv: string[]): Opcoes {
  const posicionais = argv.filter((a) => !a.startsWith('--'))
  const flags = argv.filter((a) => a.startsWith('--'))

  const [nome, de, ate] = posicionais
  if (!nome) uso('informe a fonte.')

  const metas = flags.includes('--metas')
  const seco = flags.includes('--seco')
  const blocoFlag = flags.find((f) => f.startsWith('--blocos='))
  const blocos = blocoFlag === undefined ? undefined : Number(blocoFlag.split('=')[1])

  const desconhecida = flags.find(
    (f) => !['--metas', '--seco'].includes(f) && !f.startsWith('--blocos='),
  )
  if (desconhecida) uso(`opção desconhecida: ${desconhecida}`)
  if (blocos !== undefined && (!Number.isInteger(blocos) || blocos < 1)) {
    uso('--blocos precisa ser inteiro positivo.')
  }

  // Sem janela só faz sentido com --metas, que não tem janela por natureza.
  if (de === undefined && !metas) uso('informe a janela (de e ate), ou use --metas.')
  if (de !== undefined && ate === undefined) uso('informe também a data final.')
  for (const d of [de, ate]) {
    if (d !== undefined && !ISO.test(d)) uso(`data inválida: "${d}". Use YYYY-MM-DD.`)
  }
  if (de !== undefined && ate !== undefined && de > ate) uso('`de` é depois de `ate`.')

  const fonte = acharFonte(nome)

  return {
    fonte,
    ...(de === undefined ? {} : { de }),
    ...(ate === undefined ? {} : { ate }),
    metas,
    ...(blocos === undefined ? {} : { blocos }),
    seco,
  }
}

/** Parte [de, ate] em blocos de `dias`, em UTC para não escorregar de fuso. */
function partir(de: string, ate: string, dias?: number): Array<{ de: string; ate: string }> {
  if (dias === undefined) return [{ de, ate }]

  const fim = Date.parse(`${ate}T00:00:00Z`)
  const blocos: Array<{ de: string; ate: string }> = []
  let inicio = Date.parse(`${de}T00:00:00Z`)

  while (inicio <= fim) {
    const cabe = inicio + (dias - 1) * DIA_MS
    const termina = Math.min(cabe, fim)
    blocos.push({
      de: new Date(inicio).toISOString().slice(0, 10),
      ate: new Date(termina).toISOString().slice(0, 10),
    })
    inicio = termina + DIA_MS
  }
  return blocos
}



/**
 * Executa a consulta de uma fonte `sql` no Oracle.
 *
 * `perfil: 'carga'` é o que faz funcionar: Perdas leva 60 a 104 segundos por mês
 * e estouraria o teto de 60 s do caminho da API. Ver `OpcoesConsulta` em
 * `lib/oracle.ts`.
 *
 * `truncado` é erro e não aviso. Um lote cortado no teto de linhas SUBSTITUIRIA
 * a janela por um subconjunto — o dia ficaria com menos filiais do que tem, sem
 * nada avisando. É o mesmo raciocínio da recusa de resposta malformada do Power
 * Automate, logo acima.
 */
async function consultarOracle(
  sql: string,
  janela: { de: string; ate: string },
): Promise<LinhaBruta[]> {
  /*
   * Só passa a janela para consulta que a USA.
   *
   * Fonte de CADASTRO não tem janela -- `vendedor-area` responde "quem existe
   * hoje", não "o que aconteceu no período", e o SQL dela não declara `:de`.
   * Mandar bind que a consulta não referencia é erro do driver (NJS-098), e
   * declarar um bind inerte só para calar o carregador seria pior: alguém
   * depois leria a janela no SQL e suporia que ela filtra alguma coisa.
   */
  const usaJanela = sql.includes(':de')
  const { linhas, truncado } = await consultar(
    sql,
    usaJanela ? { de: janela.de, ate: janela.ate } : {},
    { perfil: 'carga' },
  )

  if (truncado) {
    throw new Error(
      `A consulta bateu no teto de ${env.ORACLE_MAX_ROWS} linhas e voltou truncada. ` +
        'Abortado antes de enviar: um lote parcial substituiria a janela por menos ' +
        'dado do que existe. Parta a janela com --blocos ou aumente ORACLE_MAX_ROWS.',
    )
  }

  return linhas
}

/**
 * Para ONDE este script envia.
 *
 * Nasceu com `http://localhost:${PORT}` cravado, e isso bastava enquanto o
 * portal só existia na máquina de quem rodava. Com o portal em producao o
 * backfill continua saindo daqui — a janela do agendamento é curta (60 dias na
 * maioria das fontes) e o histórico antigo não tem outro caminho —, então o
 * destino virou `PORTAL_URL`.
 *
 * O padrão continua sendo localhost: quem já usava o script não precisa mudar
 * nada, e esquecer a variável não manda dado para lugar nenhum inesperado --
 * falha na conexão, alto.
 *
 * VALIDADA AQUI, e não na hora do `fetch`: um endereço sem esquema faz o
 * `fetch` falhar com "Failed to parse URL", que não diz qual variável está
 * errada. `new URL` acusa na partida, antes de consultar o Oracle por minutos.
 */
function baseDoPortal(): string {
  const bruto = process.env.PORTAL_URL
  if (bruto === undefined || bruto.trim() === '') {
    return `http://localhost:${process.env.PORT ?? '3001'}`
  }
  let url: URL
  try {
    url = new URL(bruto.trim())
  } catch {
    throw new Error(
      `PORTAL_URL não é um endereço válido: "${bruto}". ` +
        'Esperado algo como https://portal-gd.example.com',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`PORTAL_URL precisa ser http ou https, e veio "${url.protocol}".`)
  }
  // Sem barra no fim: o caminho é montado com `/api/v1/...` e duas barras
  // seguidas viram rota diferente em alguns proxies.
  return url.origin + url.pathname.replace(/\/+$/, '')
}

async function enviarAoPortal(
  caminho: string,
  corpo: unknown,
): Promise<Record<string, unknown>> {
  const token = process.env.INGEST_TOKEN
  if (!token) throw new Error('INGEST_TOKEN ausente no .env.')

  const r = await fetch(`${baseDoPortal()}/api/v1/ingest/${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ingest-Token': token },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(180_000),
  })

  const resposta = (await r.json().catch(() => ({}))) as Record<string, unknown>
  if (!r.ok) {
    throw new Error(`Portal recusou (HTTP ${r.status}): ${JSON.stringify(resposta).slice(0, 500)}`)
  }
  return resposta
}

/**
 * So' primitivo vira texto.
 *
 * `String()` sobre objeto da' "[object Object]", e as respostas do portal e das
 * origens chegam como `Record<string, unknown>` — o tipo diz `unknown` porque a
 * forma vem de fora e ninguem a verificou.
 */
const texto = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '?'

/** Filiais por dia — a conferência que revela janela incompleta de relance. */
function resumirPorDia(linhas: Array<Record<string, unknown>>): string[] {
  const porDia = new Map<string, Set<string>>()
  for (const l of linhas) {
    const dia = texto(l['data'])
    const filial = texto(l['filial'])
    if (!porDia.has(dia)) porDia.set(dia, new Set())
    porDia.get(dia)!.add(filial)
  }
  return [...porDia.keys()]
    .sort()
    .map((d) => `      ${d}: ${porDia.get(d)!.size} filiais`)
}

async function main() {
  const o = lerArgumentos(process.argv.slice(2))
  const { fonte } = o

  if (!fonte.pronta) {
    throw new Error(
      `A consulta de "${fonte.fonte}" ainda é esqueleto (com <sua medida> dentro) — ` +
        'defina a DAX real em src/fontes/fontes.mjs antes de recarregar. ' +
        'Executá-la devolveria zero linha, e zero linha numa substituição de janela ' +
        'apaga o período sem repor nada.',
    )
  }

  /**
   * Duas origens, dois caminhos.
   *
   * `dax` vai ao Power BI pelo gatilho do Power Automate. `sql` vai ao **Oracle
   * direto**, sem n8n — Perdas e Movimentação desde 22/08/2026, por decisão do
   * analista. A separação anterior existia para a credencial do banco viver só
   * no n8n; ela caiu quando o portal passou a ler o Oracle para resolver o nível
   * no login, e a credencial passou a ser do portal de todo jeito.
   */
  const endpoint = fonte.tipo === 'dax' ? endpointDa(fonte) : null

  console.log(
    `fonte: ${fonte.fonte} (${fonte.tipo === 'sql' ? 'Oracle direto' : 'Power BI'})` +
      (o.seco ? '   [SECO — não envia]' : ''),
  )

  /*
   * O DESTINO, impresso antes de qualquer consulta.
   *
   * Enquanto era sempre localhost não havia o que dizer. Agora que `PORTAL_URL`
   * aponta para onde quiserem, o destino virou a informação mais perigosa da
   * execução: uma recarga APAGA E REGRAVA a janela inteira, e mandar para o
   * ambiente errado não dá erro nenhum -- o portal aceita, grava, e o estrago
   * só aparece no quadro de alguém depois.
   *
   * Por isso o aviso é gritado quando não é a máquina local: quem digita o
   * comando lê isto antes dos minutos de Oracle, e ainda dá tempo de Ctrl-C.
   */
  if (!o.seco) {
    const destino = baseDoPortal()
    const local = destino.startsWith('http://localhost')
    console.log(`destino: ${destino}${local ? '' : '   *** NAO E A MAQUINA LOCAL ***'}`)
  }

  // ── Metas: sem janela, por competência (ano/mês), e sempre antes do fato ───
  // Se a meta falhar, o fato não sobe: o painel com valor novo contra meta velha
  // mostra percentual absurdo e ninguém sabe que a causa foi uma carga parcial.
  if (o.metas) {
    /*
     * Duas origens de META, escolhidas pela que a fonte declara.
     *
     * `daxMeta` vai ao Power BI; `sqlMeta` vai ao Oracle. A meta por ÁREA DE
     * VENDA só existe no Oracle (`ERP_META_COTA_VENDAS`) — o modelo do BI não a
     * expõe nesse grão —, e é por isso que a segunda existe.
     *
     * Nenhuma das duas recebe janela: meta é por competência, e reenviar a
     * mesma é operação normal. O portal faz upsert por (escopo, alvo, filial,
     * ano, mês).
     */
    const daBI = fonte.daxMeta !== null && endpoint !== null
    if (!fonte.montarMetas || (!fonte.sqlMeta && !daBI)) {
      throw new Error(`"${fonte.fonte}" não tem consulta de meta definida.`)
    }
    console.log('\nmetas:')
    const brutas = fonte.sqlMeta
      ? await consultarOracle(fonte.sqlMeta, { de: '', ate: '' })
      : await consultarPowerBI(endpoint!, fonte.daxMeta!(), {})
    console.log(`   ${brutas.length} linhas ${fonte.sqlMeta ? 'do Oracle' : 'do Power BI'}`)
    if (brutas.length === 0) throw new Error('a consulta de metas não devolveu nada.')

    // `montarMetas` recebe o LOTE: em NPS a consulta devolve uma constante que
    // precisa virar a grade filial × ano × mês, e um map por linha não daria.
    const linhas = fonte.montarMetas(brutas)
    console.log(`   ${linhas.length} metas montadas`)
    if (o.seco) {
      console.log(`   amostra: ${JSON.stringify(linhas[0])}`)
    } else {
      const r = await enviarAoPortal('metas', { linhas })
      console.log(`   gravadas: ${texto(r['gravadas'])}`)
    }
  }

  if (o.de === undefined || o.ate === undefined) return

  // ── Fato, bloco por bloco ─────────────────────────────────────────────────
  /**
   * Fonte `sql` parte em meses por padrão; `dax` vai numa chamada só.
   *
   * O custo das duas escala de forma diferente. A DAX é agregada no Power BI e
   * responde em segundos para qualquer janela. O SQL de Perdas leva 60 a 104
   * segundos para UM mês — um backfill de 2 anos numa chamada só bateria no teto
   * de 20 minutos e falharia depois de esperar 20 minutos, que é o pior dos
   * resultados. Trinta e um dias cabem com folga.
   *
   * `--blocos` explícito continua tendo precedência.
   */
  const blocoPadrao = fonte.tipo === 'sql' ? 31 : undefined
  const tamanhoBloco = o.blocos ?? blocoPadrao
  const blocos = partir(o.de, o.ate, tamanhoBloco)
  const porQue =
    o.blocos === undefined && blocoPadrao !== undefined
      ? ` de ${blocoPadrao} dias (padrão de fonte sql)`
      : ''
  console.log(
    `\njanela ${o.de} → ${o.ate}  ·  ${blocos.length} ${blocos.length === 1 ? 'bloco' : 'blocos'}${porQue}`,
  )

  let totalGravadas = 0
  let totalRemovidas = 0

  for (const [i, b] of blocos.entries()) {
    const rotulo = `[${i + 1}/${blocos.length}] ${b.de} → ${b.ate}`
    const t0 = Date.now()
    const brutas =
      fonte.tipo === 'sql'
        ? await consultarOracle(fonte.sql!, b)
        : await consultarPowerBI(
            endpoint!,
            fonte.dax!(expressaoData(b.de), expressaoData(b.ate)),
            b,
          )
    const seg = ((Date.now() - t0) / 1000).toFixed(1)

    // A trava mais importante do script. A ingestão SUBSTITUI a janela: apaga
    // o período e grava o que chegou. Zero linha apagaria o período e não
    // reporia nada — perda silenciosa de dado bom por causa de uma consulta que
    // falhou sem erro (nome de coluna trocado, filtro que não casa).
    if (brutas.length === 0) {
      throw new Error(
        `${rotulo}: a consulta não devolveu nenhuma linha. Abortado ANTES de enviar — ` +
          'enviar apagaria a janela sem repor nada.',
      )
    }

    const linhas = brutas.map(fonte.mapear)
    console.log(`   ${rotulo}  ${linhas.length} linhas em ${seg}s`)
    for (const l of resumirPorDia(linhas)) console.log(l)

    if (o.seco) continue

    const r = await enviarAoPortal(fonte.fonte, { periodo: { de: b.de, ate: b.ate }, linhas })
    totalGravadas += Number(r['gravadas'] ?? 0)
    totalRemovidas += Number(r['removidas'] ?? 0)
    const avisos = r['avisos']
    console.log(
      `      gravadas ${texto(r['gravadas'])} · removidas ${texto(r['removidas'])}`,
    )
    if (Array.isArray(avisos) && avisos.length > 0) {
      for (const a of avisos) console.log(`      aviso: ${String(a)}`)
    }
  }

  if (!o.seco) {
    console.log(`\ntotal: ${totalGravadas} gravadas, ${totalRemovidas} removidas`)
  }
}

main()
  .catch((e: unknown) => {
    console.error(`\nRecarga falhou: ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  })
  // Sem isto o processo não termina depois de uma fonte `sql`: o pool do Oracle
  // segura o event loop aberto. Inofensivo quando nenhum pool foi criado.
  .finally(() => encerrarOracle())

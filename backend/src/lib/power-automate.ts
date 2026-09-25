import { extrairLinhas, type Fonte, type LinhaBruta } from '../fontes/fontes.mjs'

/**
 * O gatilho do Power Automate, que executa a consulta DAX no Power BI.
 *
 * Morava dentro de `scripts/recarregar.ts`. Saiu quando o portal passou a
 * agendar Vendas e NPS por conta própria (§7.53): duas cópias desta função
 * gravariam os mesmos indicadores por caminhos que poderiam divergir -- e este
 * projeto já pagou esse preço duas vezes (aritmética de percentual entre seed e
 * produção; meta do período entre painel e gráfico).
 *
 * As três recusas abaixo não são zelo: cada uma corresponde a uma resposta que
 * já chegou de verdade, e todas terminariam substituindo a janela por menos
 * dado do que existe.
 */

/** Executa uma consulta DAX pelo gatilho do Power Automate. */
export async function consultarPowerBI(
  endpoint: string,
  consulta: string,
  contexto: { de?: string; ate?: string },
): Promise<LinhaBruta[]> {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consulta, ...contexto }),
    signal: AbortSignal.timeout(300_000),
  })

  const bruto: unknown = await r.json().catch(() => null)
  if (!r.ok || (bruto !== null && typeof bruto === 'object' && 'error' in bruto)) {
    throw new Error(`Power BI recusou (HTTP ${r.status}): ${JSON.stringify(bruto).slice(0, 500)}`)
  }

  // Corpo vazio ou `null` acontece de verdade — vi acontecer numa chamada que
  // repetida em seguida voltou com as 36 linhas. Precisa morrer aqui: caindo em
  // `extrairLinhas`, um `null` volta como `[null]`, um array de TAMANHO 1, que
  // passa pela trava de "zero linhas" e vira uma linha-lixo enviada ao portal —
  // substituindo a janela por nada.
  if (bruto === null || bruto === undefined) {
    throw new Error(
      'O Power Automate devolveu resposta vazia. Costuma ser intermitente; ' +
        'repita o comando. Abortado antes de enviar.',
    )
  }

  // A resposta vem em um de quatro formatos; `extrairLinhas` cobre três deles,
  // mas espera o envelope do n8n. Array cru precisa ser tratado antes, senão
  // ela o devolve aninhado.
  const linhas = Array.isArray(bruto) ? (bruto as unknown[]) : extrairLinhas([{ json: bruto }])

  // Toda linha tem que ser objeto. Uma resposta truncada traz `null` no meio, e
  // as duas saídas erradas aqui seriam estourar no mapeamento com erro
  // ininteligível, ou — pior — descartar as ruins em silêncio: a janela seria
  // substituída por um subconjunto, e o dia ficaria com menos filiais do que
  // tem de verdade, sem nada avisando. Recusar o lote inteiro é o certo.
  const ruins = linhas.filter((l) => l === null || typeof l !== 'object').length
  if (ruins > 0) {
    throw new Error(
      `Resposta malformada: ${ruins} de ${linhas.length} linhas não são objetos. ` +
        'Abortado antes de enviar — enviar substituiria a janela por um lote incompleto.',
    )
  }

  return linhas as LinhaBruta[]
}

/**
 * O endpoint da fonte, do `.env`.
 *
 * Uma variável por fonte (`endpointEnv` em `fontes.mjs`): o gatilho do Power
 * Automate é por consulta, não um só para tudo.
 */
export function endpointDa(fonte: Fonte): string {
  if (!fonte.endpointEnv) {
    throw new Error(`"${fonte.fonte}" é tipo dax mas não declara endpointEnv em fontes.mjs.`)
  }
  const endpoint = process.env[fonte.endpointEnv]
  if (!endpoint) {
    throw new Error(
      `${fonte.endpointEnv} ausente no ambiente — é o gatilho do Power Automate que ` +
        `executa a consulta no dataset de ${fonte.fonte}. Ver docs/n8n/POWER-AUTOMATE.md.`,
    )
  }
  return endpoint
}

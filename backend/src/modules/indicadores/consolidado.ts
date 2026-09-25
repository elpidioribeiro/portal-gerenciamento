import { casasDoIndicador } from './calculos.js'
import { montarCelula, FAIXA_POR_INDICADOR } from './status.js'

/**
 * O CONSOLIDADO da rede, por indicador.
 *
 * SOMA numerador e denominador; NUNCA promedia percentuais. Perdas é
 * `perdas / movimento` e NPS é `(promotores − detratores) / respondentes`:
 * mediar os nove percentuais pesaria uma loja de R$ 13 mi igual a uma de
 * R$ 50 mi, e o número da diretoria deixaria de ser o da rede.
 *
 * É a mesma regra do rolo da gerência (§7.14) e do consolidado da loja, agora
 * um nível acima.
 *
 * A META do consolidado segue a mesma lógica: somada quando o indicador é
 * SOMA, e PONDERADA PELO DENOMINADOR quando é razão.
 *
 *     meta_rede = Σ(meta_i × denominador_i) ÷ Σ denominador_i
 *
 * É o espelho de como o realizado consolida, e é o que garante a única
 * propriedade que importa: **se cada filial bater exatamente a própria meta, a
 * rede bate exatamente a meta da rede.** Com média simples isso não vale.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ E NÃO É DECORATIVA. Este comentário já disse o contrário: que as metas    │
 * │ eram iguais em todas as filiais e a ponderação existia "para o dia em que │
 * │ alguma tivesse patamar próprio". É falso. Medido em set/2026, Perdas tem  │
 * │ CINCO metas distintas, de -0,15% (CEN, CAM) a -0,35% (NOR):              │
 * │                                                                          │
 * │   realizado consolidado          -0,2293%                                │
 * │   meta ponderada pelo movimento  -0,2552%                                │
 * │   meta por media simples         -0,2278%                                │
 * │                                                                          │
 * │ O realizado cai ENTRE as duas: trocar a ponderação por média simples      │
 * │ inverteria o farol da rede.                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * O desvio e o farol saem de `montarCelula`, a MESMA função das células: assim
 * o consolidado não tem como discordar da linha que ele resume.
 */
export function consolidar(p: {
  agregacao: 'SOMA' | 'RAZAO'
  sentido: 'MAIOR_MELHOR' | 'MENOR_MELHOR'
  codigo: string
  itens: Array<{ resultado: { valor: number | null; partes?: { numerador: number; denominador: number } } | null; meta: number | null }>
}) {
  const comDado = p.itens.filter((i) => i.resultado?.valor !== null && i.resultado !== null)
  if (comDado.length === 0) return null

  const opcoes = {
    casasDecimais: casasDoIndicador(p.codigo),
    ...(FAIXA_POR_INDICADOR[p.codigo] === undefined
      ? {}
      : { faixa: FAIXA_POR_INDICADOR[p.codigo] }),
  }

  if (p.agregacao === 'SOMA') {
    const valor = comDado.reduce((a, i) => a + (i.resultado?.valor ?? 0), 0)
    const metas = comDado.filter((i) => i.meta !== null)
    const meta = metas.length === 0 ? null : metas.reduce((a, i) => a + (i.meta ?? 0), 0)
    return { ...montarCelula(valor, meta, p.sentido, opcoes), filiais: comDado.length }
  }

  /*
   * Sem as partes não dá para consolidar uma razão, e o certo é não responder:
   * qualquer média aqui seria um número plausível e errado.
   */
  const comPartes = comDado.filter((i) => i.resultado?.partes !== undefined)
  if (comPartes.length === 0) return null

  const numerador = comPartes.reduce((a, i) => a + (i.resultado?.partes?.numerador ?? 0), 0)
  const denominador = comPartes.reduce((a, i) => a + (i.resultado?.partes?.denominador ?? 0), 0)
  const valor = denominador === 0 ? null : (numerador / denominador) * 100

  const comMeta = comPartes.filter((i) => i.meta !== null)
  const pesoTotal = comMeta.reduce((a, i) => a + (i.resultado?.partes?.denominador ?? 0), 0)
  const meta =
    comMeta.length === 0 || pesoTotal === 0
      ? null
      : comMeta.reduce((a, i) => a + (i.meta ?? 0) * (i.resultado?.partes?.denominador ?? 0), 0) /
        pesoTotal

  return { ...montarCelula(valor, meta, p.sentido, opcoes), filiais: comPartes.length }
}

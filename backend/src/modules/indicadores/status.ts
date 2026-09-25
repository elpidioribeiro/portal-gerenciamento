import { desvioPercentual } from '../../lib/percentual.js'

/**
 * Situação de uma célula: a filial está melhor ou pior que a meta.
 *
 * A regra padrão é **binária** — pior que a meta é vermelho, melhor é verde.
 * O handoff previa três faixas por limiar percentual (−10% crítico, etc.), e
 * elas foram descartadas.
 *
 * Duas exceções, cada uma com a regra da sua área — ver `FAIXA_POR_INDICADOR`:
 *
 * - **NPS**: ≥ meta verde · até 5 pontos abaixo amarelo · além disso vermelho.
 * - **Perdas**: quatro faixas, incluindo AZUL para quem está bem acima da meta.
 *   É a regra de cor do dashboard que a área já usa.
 *
 * **O sentido do indicador decide o sinal**, não o sinal do desvio. Em Custo
 * menor é melhor, então desvio negativo é BOM; em Perdas o valor é negativo por
 * convenção da origem e o sentido é MAIOR_MELHOR. Pintar "abaixo da meta" de
 * vermelho nos quatro mostraria Custo em vermelho justamente quando a filial
 * está gastando menos que o orçado.
 */

export type Situacao = 'otimo' | 'acima' | 'atencao' | 'abaixo'

export type Sentido = 'MAIOR_MELHOR' | 'MENOR_MELHOR'

/** Casas decimais do desvio exibido. */
export const CASAS_DESVIO = 2

/**
 * Faixas de cor por indicador, sobre a **folga em pontos** — não em percentual.
 *
 * A distinção não é cosmética. NPS 71 contra meta 75 são 4 pontos abaixo, e pela
 * regra pedida é amarelo; em desvio percentual isso é −5,33%, que num limiar de
 * "5" cairia em vermelho. Duas cores para o mesmo número, e a errada seria a
 * mais alarmante.
 *
 * Cada regra é escrita como está na fonte, em vez de derivada de uma abstração
 * comum, porque os limites NÃO coincidem: em NPS, estar exatamente na meta é
 * VERDE (bateu o alvo); em Perdas, estar exatamente no limite é AMARELO (está
 * no teto). Uma convenção única de borda faria uma das duas mentir.
 *
 * Indicador ausente aqui usa a regra binária de `situacaoDoDesvio`.
 */
export const FAIXA_POR_INDICADOR: Record<string, (folga: number) => Situacao> = {
  /** ≥ meta verde · até 5 pontos abaixo amarelo · além disso vermelho. */
  nps: (folga) => (folga >= 0 ? 'acima' : folga >= -5 ? 'atencao' : 'abaixo'),

  /**
   * Quatro faixas, da regra de cor do dashboard de Perdas. Os limiares de lá
   * estão em FRAÇÃO (0,0005); aqui em pontos percentuais (0,05), a mesma
   * unidade do valor e da meta.
   *
   * A regra original é um `SWITCH(TRUE(), ...)` cuja segunda condição diz
   * `> -0,005` — um dígito a menos, inofensivo só porque a primeira condição
   * (`<= -0,0005`) já capturou a faixa e o `SWITCH` avalia em ordem. Aqui vale
   * o comportamento EFETIVO: a fronteira do amarelo é 0,05 ponto.
   */
  perdas: (folga) =>
    folga > 0.05 ? 'otimo' : folga > 0 ? 'acima' : folga > -0.05 ? 'atencao' : 'abaixo',
}

export function situacaoDoDesvio(desvio: number, sentido: Sentido): Situacao {
  if (sentido === 'MAIOR_MELHOR') return desvio >= 0 ? 'acima' : 'abaixo'
  return desvio <= 0 ? 'acima' : 'abaixo'
}

/**
 * Situação pela faixa do indicador, medindo a folga em pontos absolutos.
 *
 * `folga` positiva significa MELHOR que a meta, nos dois sentidos — é o que
 * permite escrever cada regra sem repetir a inversão de sinal.
 */
export function situacaoPorPontos(
  valor: number,
  meta: number,
  sentido: Sentido,
  faixa: (folga: number) => Situacao,
): Situacao {
  const folga = sentido === 'MAIOR_MELHOR' ? valor - meta : meta - valor
  return faixa(folga)
}

export interface Celula {
  valor: number | null
  meta: number | null
  desvio: number | null
  situacao: Situacao | null
}

/**
 * Monta a célula. Sem valor ou sem meta, tudo fica nulo — a tela mostra `—`
 * em vez de inventar um zero que pareceria medição.
 *
 * `desvioDaOrigem` tem precedência quando existe: é o caso de Vendas, onde o
 * desvio é calculado na fonte oficial. Recalcular no portal produziria um
 * número ligeiramente diferente, e a divergência apareceria como "o portal
 * discorda do relatório".
 */
export function montarCelula(
  valorBruto: number | null,
  meta: number | null,
  sentido: Sentido,
  opcoes: {
    desvioDaOrigem?: number
    casasDecimais?: number
    faixa?: (folga: number) => Situacao
  } = {},
): Celula {
  if (valorBruto === null) return { valor: null, meta, desvio: null, situacao: null }

  // O valor é arredondado para a precisão exibida ANTES do desvio. Ver
  // CASAS_DECIMAIS em calculos.ts: sem isso, a tela mostra 3,5% contra meta
  // 4,0% e informa -12%, enquanto a conta com os números visíveis dá -13%.
  const casas = opcoes.casasDecimais ?? 1
  const valor = Number(valorBruto.toFixed(casas))

  const bruto = opcoes.desvioDaOrigem ?? (meta === null ? null : desvioPercentual(valor, meta))
  if (bruto === null) return { valor, meta, desvio: null, situacao: null }

  const desvio = Number(bruto.toFixed(CASAS_DESVIO))

  // Com tolerância, a cor sai da distância em PONTOS — inclusive quando existe
  // desvio da origem. O desvio continua sendo o número exibido; ele só não
  // decide mais a cor, porque percentual e pontos discordam perto do limiar.
  const situacao =
    opcoes.faixa !== undefined && meta !== null
      ? situacaoPorPontos(valor, meta, sentido, opcoes.faixa)
      : situacaoDoDesvio(desvio, sentido)

  return { valor, meta, desvio, situacao }
}

/**
 * Quantas filiais NÃO estão confortavelmente na meta — alimenta o "X de 9 fora
 * da meta".
 *
 * Amarelo conta: a faixa do meio é "no limite ou logo abaixo dele", e deixá-la
 * de fora faria o painel anunciar "0 de 9 fora da meta" com células amarelas
 * visíveis na mesma linha. Azul e verde não contam — as duas estão melhor que
 * a meta.
 */
export function contarAbaixo(situacoes: Array<Situacao | null>): number {
  return situacoes.filter((s) => s === 'abaixo' || s === 'atencao').length
}

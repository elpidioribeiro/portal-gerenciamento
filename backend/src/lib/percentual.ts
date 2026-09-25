/**
 * Aritmética de desvio percentual — implementação canônica.
 *
 * Usada tanto pelo cálculo de produção quanto pelo seed. Ter duas cópias faria
 * os testes do seed passarem enquanto a tela mostra outro número.
 *
 * Três armadilhas, todas confirmadas contra as 36 células da matriz do handoff:
 *
 * 1. `valor / meta - 1` subtrai 1 de um quociente próximo de 1 — cancelamento
 *    catastrófico. NPS PRA (86 sobre meta 80) daria 7,499999999999996 e a
 *    célula sairia 7% onde o handoff diz 8%.
 *
 * 2. Nem a forma correta basta: 5,1 não é representável exato em binário, então
 *    Perdas SER (5,1 sobre 4,0) dá 27,499999999999993 e sairia 27% em vez de
 *    28%. O `toFixed` limpa ruído da ordem de 1e-14 sem alterar valor legítimo.
 *
 * 3. `Math.round` arredonda para +∞: `Math.round(-2.5)` é -2, mas o handoff
 *    mostra -3 para Perdas OES. O correto é meio-para-longe-do-zero.
 *
 * Só 3 das 36 células caem nessas armadilhas — que é exatamente o que faria o
 * erro passar despercebido numa conferência visual contra o protótipo.
 */

/** Arredondamento meio-para-longe-do-zero. */
export function arredondar(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n))
}

/** Desvio percentual do valor sobre a meta, sem ruído de ponto flutuante. */
export function desvioPercentual(valor: number, meta: number): number {
  if (meta === 0) return 0
  // Denominador em MÓDULO. Com meta negativa — o caso de Perdas, cuja convenção
  // na origem é perda negativa — dividir pela meta assinada inverte o sinal do
  // desvio: valor −0,2 contra meta −4,0 está 3,8 pontos MELHOR, e a divisão por
  // −4 devolveria −95%, que a regra de cor leria como "abaixo da meta". O módulo
  // preserva a direção da diferença, que é o que o desvio significa.
  // Para meta positiva não muda nada.
  return Number((((valor - meta) * 100) / Math.abs(meta)).toFixed(9))
}

/** Divisão que devolve `null` em vez de Infinity/NaN quando não há denominador. */
export function razao(numerador: number, denominador: number): number | null {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador) || denominador === 0) return null
  return numerador / denominador
}

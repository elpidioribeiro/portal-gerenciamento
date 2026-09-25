/**
 * QUAL Gerenciamento Diário a tela do N3 está mostrando.
 *
 * Função pura, e fora do componente, porque ela decide uma coisa que erra em
 * SILÊNCIO: cair no primeiro GD quando o pedido não existe abre a reunião de
 * Vendas com a aba de Vendas marcada, e nada na tela diz que o pedido foi NPS.
 * A matriz do N2 passou a mandar o código da célula clicada (§7.63), então o
 * caso deixou de ser hipotético.
 *
 * As três respostas são diferentes de propósito:
 *
 *   sem pedido           o primeiro GD   abrir a tela sem escolha mostra algo
 *   pedido que existe    ele             o clique da matriz
 *   pedido inexistente   `null`          a tela avisa, em vez de trocar
 */
export function gdEscolhido<T extends { codigo: string }>(
  gds: readonly T[],
  pedido: string | null,
): T | null {
  if (pedido === null) return gds[0] ?? null
  return gds.find((g) => g.codigo === pedido) ?? null
}

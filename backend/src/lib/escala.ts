/**
 * Conversão valor → coordenada Y do gráfico.
 *
 * O eixo do handoff **não é linear**. Em Vendas, 5 pontos acima da meta ocupam
 * 40px, mas 10 pontos abaixo ocupam os mesmos 40px — o desenho dá mais
 * resolução ao lado positivo de propósito. Uma régua linear entre o topo e a
 * base achataria metade do gráfico, que é exatamente o defeito que o handoff
 * alerta ("não usar curvas fixas deslocadas, isso achatava o gráfico no
 * limite").
 *
 * A conversão interpola entre as âncoras vizinhas, respeitando o espaçamento
 * declarado em cada trecho.
 */

export interface AncoraEixo {
  valor: number
  rotulo: string
  y: number
  meta?: boolean
}

/** Altura do viewBox do SVG, conforme o handoff. */
export const ALTURA_VIEWBOX = 200

/**
 * Converte um valor para a coordenada Y, interpolando entre âncoras.
 * Valores fora da faixa são fixados na âncora extrema — a linha encosta na
 * borda em vez de sair do gráfico.
 */
export function valorParaY(valor: number, ancoras: readonly AncoraEixo[]): number {
  if (ancoras.length === 0) return ALTURA_VIEWBOX / 2

  // Ordena por valor decrescente: a primeira âncora é o topo do gráfico.
  const ord = [...ancoras].sort((a, b) => b.valor - a.valor)

  const topo = ord[0]!
  const base = ord[ord.length - 1]!
  if (valor >= topo.valor) return topo.y
  if (valor <= base.valor) return base.y

  for (let i = 0; i < ord.length - 1; i++) {
    const acima = ord[i]!
    const abaixo = ord[i + 1]!
    if (valor <= acima.valor && valor >= abaixo.valor) {
      const faixa = acima.valor - abaixo.valor
      if (faixa === 0) return acima.y
      const proporcao = (valor - abaixo.valor) / faixa
      return abaixo.y + (acima.y - abaixo.y) * proporcao
    }
  }

  return base.y
}

/** Y da linha de meta — a âncora marcada, ou o meio se não houver. */
export function yDaMeta(ancoras: readonly AncoraEixo[]): number {
  return ancoras.find((a) => a.meta)?.y ?? ALTURA_VIEWBOX / 2
}

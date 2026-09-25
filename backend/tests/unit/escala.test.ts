import { describe, expect, it } from 'vitest'
import { valorParaY, yDaMeta, type AncoraEixo } from '../../src/lib/escala.js'

/**
 * O eixo Y do handoff não é linear, e é aí que mora o defeito que o próprio
 * handoff alerta: "não usar curvas fixas deslocadas, isso achatava o gráfico
 * no limite".
 */

/** Escala de Vendas: 5 pontos acima da meta ocupam 40px; 10 abaixo, os mesmos 40px. */
const VENDAS: AncoraEixo[] = [
  { valor: 10, rotulo: '+10%', y: 20 },
  { valor: 5, rotulo: '+5%', y: 60 },
  { valor: 0, rotulo: '0% · meta', y: 100, meta: true },
  { valor: -10, rotulo: '−10%', y: 140 },
  { valor: -20, rotulo: '−20%', y: 180 },
]

const PERDAS: AncoraEixo[] = [
  { valor: 6.0, rotulo: '6,0%', y: 20 },
  { valor: 5.0, rotulo: '5,0%', y: 73 },
  { valor: 4.0, rotulo: '4,0% · meta', y: 127, meta: true },
  { valor: 3.0, rotulo: '3,0%', y: 180 },
]

describe('escala não linear de Vendas', () => {
  it('as âncoras caem exatamente na posição declarada', () => {
    for (const a of VENDAS) expect(valorParaY(a.valor, VENDAS), a.rotulo).toBe(a.y)
  })

  it('interpola dentro do trecho, não sobre a faixa inteira', () => {
    // +2,5% está no meio do trecho [0, +5], que vai de y=100 a y=60.
    expect(valorParaY(2.5, VENDAS)).toBe(80)
    // −5% está no meio do trecho [−10, 0], que vai de y=140 a y=100.
    expect(valorParaY(-5, VENDAS)).toBe(120)
  })

  it('o mesmo passo de valor ocupa alturas diferentes conforme o lado', () => {
    // Esta é a propriedade que uma régua linear destruiria: 5 pontos acima da
    // meta valem 40px, enquanto 5 pontos abaixo valem apenas 20px.
    const acima = valorParaY(0, VENDAS) - valorParaY(5, VENDAS)
    const abaixo = valorParaY(-5, VENDAS) - valorParaY(0, VENDAS)
    expect(acima).toBe(40)
    expect(abaixo).toBe(20)
    expect(acima).not.toBe(abaixo)
  })

  it('valores fora da faixa encostam na borda em vez de sair do gráfico', () => {
    expect(valorParaY(50, VENDAS)).toBe(20)
    expect(valorParaY(-99, VENDAS)).toBe(180)
  })
})

describe('escala de Perdas', () => {
  it('respeita o espaçamento irregular entre âncoras', () => {
    // 6,0→5,0 ocupa 53px; 5,0→4,0 ocupa 54px. Não é o mesmo passo.
    expect(valorParaY(5.5, PERDAS)).toBeCloseTo(46.5, 1)
    expect(valorParaY(4.5, PERDAS)).toBeCloseTo(100, 1)
  })

  it('o valor da matriz de NOR (5,8%) cai perto do topo', () => {
    const y = valorParaY(5.8, PERDAS)
    expect(y).toBeGreaterThan(20)
    expect(y).toBeLessThan(35)
  })
})

describe('linha de meta', () => {
  it('encontra a âncora marcada', () => {
    expect(yDaMeta(VENDAS)).toBe(100)
    expect(yDaMeta(PERDAS)).toBe(127)
  })

  it('sem âncora de meta, usa o meio do viewBox', () => {
    expect(yDaMeta([{ valor: 1, rotulo: 'a', y: 10 }])).toBe(100)
  })
})

describe('casos degenerados', () => {
  it('escala vazia não quebra', () => {
    expect(valorParaY(5, [])).toBe(100)
  })

  it('âncoras fora de ordem são normalizadas', () => {
    const bagunçada = [...VENDAS].reverse()
    expect(valorParaY(2.5, bagunçada)).toBe(80)
  })
})

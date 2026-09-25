import { describe, expect, it } from 'vitest'
import { desvioPercentual } from '../../src/lib/percentual.js'
import {
  contarAbaixo,
  FAIXA_POR_INDICADOR,
  montarCelula,
  situacaoPorPontos,
  type Situacao,
} from '../../src/modules/indicadores/status.js'

/**
 * As faixas de cor de NPS e Perdas.
 *
 * O que estes testes protegem não é a aritmética — é a UNIDADE e as BORDAS. A
 * faixa é medida em pontos do indicador, e a tentação de quem mexer aqui depois
 * é reaproveitar o desvio percentual, que já está calculado na mesma função.
 *
 * E as bordas das duas regras NÃO coincidem: em NPS, estar exatamente na meta é
 * verde; em Perdas, estar exatamente no limite é amarelo. Cada `it` abaixo fixa
 * o lado certo de cada fronteira.
 */

// ─────────────────────────────────────────────────────────────────────────────
// NPS — meta 75, três faixas
// ─────────────────────────────────────────────────────────────────────────────

const nps = FAIXA_POR_INDICADOR['nps']!
const META_NPS = 75

describe('NPS: três faixas, meta 75', () => {
  const casos: Array<[number, Situacao, string]> = [
    [85, 'acima', 'bem acima'],
    [76, 'acima', 'um ponto acima'],
    [75, 'acima', 'exatamente na meta — bater o alvo é verde, não amarelo'],
    [74.99, 'atencao', 'um centésimo abaixo já sai do verde'],
    [70, 'atencao', 'exatamente 5 pontos abaixo — "até 5" inclui o 5'],
    [69.99, 'abaixo', 'passou da tolerância por um centésimo'],
    [40, 'abaixo', 'muito abaixo'],
  ]

  for (const [valor, esperado, porque] of casos) {
    it(`${valor} → ${esperado} (${porque})`, () => {
      expect(situacaoPorPontos(valor, META_NPS, 'MAIOR_MELHOR', nps)).toBe(esperado)
    })
  }

  it('nunca produz azul — a faixa de NPS tem três cores', () => {
    for (const v of [200, 100, 75, 0, -100]) {
      expect(situacaoPorPontos(v, META_NPS, 'MAIOR_MELHOR', nps)).not.toBe('otimo')
    }
  })
})

/**
 * O motivo de a faixa ser em pontos, escrito como teste.
 *
 * NPS 71 está 4 pontos abaixo de 75 — amarelo. Em desvio percentual isso é
 * −5,33%, e um limiar de "5" aplicado ao percentual devolveria vermelho: duas
 * cores para o mesmo número, e a errada seria a mais alarmante.
 */
describe('pontos ≠ percentual', () => {
  it('71 é amarelo por pontos, mas o percentual passaria de 5', () => {
    expect(situacaoPorPontos(71, META_NPS, 'MAIOR_MELHOR', nps)).toBe('atencao')
    expect(Math.abs(desvioPercentual(71, META_NPS))).toBeGreaterThan(5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Perdas — quatro faixas, valor e meta NEGATIVOS
// ─────────────────────────────────────────────────────────────────────────────

const perdas = FAIXA_POR_INDICADOR['perdas']!

/**
 * Meta de CEN em 2026: −0,0015 na origem, −0,15 ponto percentual aqui.
 *
 * As fronteiras da regra da área estão em fração (0,0005) e valem 0,05 ponto.
 */
const META_PERDAS = -0.15

describe('Perdas: quatro faixas, meta −0,15%', () => {
  const casos: Array<[number, Situacao, string]> = [
    [-0.05, 'otimo', 'folga de 0,10 ponto — azul, bem melhor que a meta'],
    [-0.099, 'otimo', 'folga de 0,051 — ainda azul'],
    [-0.1, 'acima', 'folga de exatamente 0,05 — verde, não azul'],
    [-0.14, 'acima', 'melhor que a meta por pouco'],
    [-0.15, 'atencao', 'exatamente NO limite — amarelo, porque está no teto'],
    [-0.19, 'atencao', 'furou o limite em 0,04'],
    [-0.2, 'abaixo', 'furou em exatamente 0,05 — vermelho'],
    [-0.73, 'abaixo', 'muito acima do limite de perda'],
  ]

  for (const [valor, esperado, porque] of casos) {
    it(`${valor}% → ${esperado} (${porque})`, () => {
      expect(situacaoPorPontos(valor, META_PERDAS, 'MAIOR_MELHOR', perdas)).toBe(esperado)
    })
  }

  it('perda MENOR em módulo é melhor — o sentido não pode estar invertido', () => {
    // Com valor negativo, MENOR_MELHOR mentiria: −0,73 é menor que −0,05 e é
    // MUITO pior. Este teste quebra se alguém trocar o sentido de volta.
    const pior = situacaoPorPontos(-0.73, META_PERDAS, 'MAIOR_MELHOR', perdas)
    const melhor = situacaoPorPontos(-0.05, META_PERDAS, 'MAIOR_MELHOR', perdas)
    expect(pior).toBe('abaixo')
    expect(melhor).toBe('otimo')
  })

  it('a meta é por filial e por ano — a faixa acompanha a meta, não um número fixo', () => {
    // NOR em 2026 tem meta −0,35, mais folgada que a de CEN (−0,15). O MESMO
    // valor de −0,20% é vermelho em CEN e azul em NOR.
    expect(situacaoPorPontos(-0.2, -0.15, 'MAIOR_MELHOR', perdas)).toBe('abaixo')
    expect(situacaoPorPontos(-0.2, -0.35, 'MAIOR_MELHOR', perdas)).toBe('otimo')
  })
})

describe('regra binária onde não há faixa', () => {
  it('vendas e custo não têm faixa definida', () => {
    for (const codigo of ['vendas', 'custo']) {
      expect(FAIXA_POR_INDICADOR[codigo]).toBeUndefined()
    }
  })

  it('sem faixa, vendas abaixo da meta é vermelho, sem meio-termo', () => {
    const c = montarCelula(940_000, 1_000_000, 'MAIOR_MELHOR', { casasDecimais: 0 })
    expect(c.situacao).toBe('abaixo')
    expect(c.desvio).toBe(-6)
  })

  /**
   * Desvio que arredonda para zero é VERDE, e isso é proposital.
   *
   * R$ 1 abaixo de R$ 1 milhão dá −0,0001%, que na precisão exibida vira
   * `0,00%`. Pintar de vermelho uma célula que mostra `0,00%` seria o painel
   * contradizendo o próprio número.
   *
   * Fica registrado porque parece defeito para quem topar com isso depois: em
   * JS `-0 >= 0` é verdadeiro, e é esse comportamento que sustenta a regra.
   */
  it('desvio que arredonda para 0,00% conta como na meta', () => {
    const c = montarCelula(999_999, 1_000_000, 'MAIOR_MELHOR', { casasDecimais: 0 })
    expect(c.desvio).toBe(-0)
    expect(c.situacao).toBe('acima')
  })
})

describe('montarCelula com faixa', () => {
  it('usa pontos para a cor e mantém o percentual no número exibido', () => {
    const c = montarCelula(71, META_NPS, 'MAIOR_MELHOR', { casasDecimais: 0, faixa: nps })
    expect(c.situacao).toBe('atencao')
    expect(c.desvio).toBeCloseTo(-5.33, 2)
  })

  it('a cor vem de pontos mesmo quando a origem manda desvio pronto', () => {
    // Vendas manda `delta_meta` da origem. Se um indicador com faixa passar a
    // mandar também, a cor não pode voltar a sair do percentual sem ninguém ver.
    const c = montarCelula(71, META_NPS, 'MAIOR_MELHOR', {
      casasDecimais: 0,
      faixa: nps,
      desvioDaOrigem: -5.33,
    })
    expect(c.situacao).toBe('atencao')
  })

  it('sem meta não há faixa — nem cor', () => {
    const c = montarCelula(71, null, 'MAIOR_MELHOR', { casasDecimais: 0, faixa: nps })
    expect(c.situacao).toBeNull()
    expect(c.desvio).toBeNull()
  })

  it('Perdas: duas casas decimais, e a cor sai do valor arredondado', () => {
    const c = montarCelula(-0.2049, META_PERDAS, 'MAIOR_MELHOR', {
      casasDecimais: 2,
      faixa: perdas,
    })
    expect(c.valor).toBe(-0.2)
    expect(c.situacao).toBe('abaixo')
  })
})

describe('contagem de "fora da meta"', () => {
  it('amarelo conta como fora; azul e verde não', () => {
    expect(contarAbaixo(['otimo', 'acima', 'atencao', 'abaixo', null])).toBe(2)
  })

  it('só azul e verde dá zero', () => {
    expect(contarAbaixo(['otimo', 'acima', 'otimo'])).toBe(0)
  })
})

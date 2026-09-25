import { describe, expect, it } from 'vitest'
import { montarCelula, situacaoDoDesvio } from '../../src/modules/indicadores/status.js'
import { desvioPercentual } from '../../src/lib/percentual.js'

/**
 * Os números de uma célula têm que ser consistentes entre si.
 *
 * Alguém da diretoria olha "3,50%" contra "meta 4,0%", faz a conta de cabeça e
 * chega perto de −12,5%. Se o painel disser outro número porque calculou sobre
 * 3,50012 (ruído do arredondamento diário na origem), o portal perde
 * credibilidade num número que qualquer um confere.
 *
 * Por isso o valor é arredondado para a precisão EXIBIDA antes do desvio.
 */

describe('coerência entre valor exibido e desvio', () => {
  it.each([
    // [valor bruto, meta, casas do valor]
    [3.50012, 4.0, 1],
    [5.09987, 4.0, 1],
    [4.20001, 4.0, 1],
  ])('valor bruto %s com %s casas: desvio bate com o valor exibido', (bruto, meta, casas) => {
    const c = montarCelula(bruto, meta, 'MENOR_MELHOR', { casasDecimais: casas })

    // O desvio tem que ser reproduzível a partir do valor que a tela mostra.
    const esperado = Number(desvioPercentual(c.valor!, meta).toFixed(2))
    expect(c.desvio).toBe(esperado)
  })

  it('o desvio sai com duas casas decimais', () => {
    const c = montarCelula(3.5, 4.0, 'MENOR_MELHOR', { casasDecimais: 1 })
    expect(c.desvio).toBe(-12.5)
  })

  it('desvio vindo da origem tem precedência sobre o recalculado', () => {
    // Vendas: o desvio é calculado na fonte oficial. Recalcular aqui produziria
    // um número ligeiramente diferente do relatório — e a divergência
    // apareceria como "o portal discorda".
    const c = montarCelula(14_090_974, 15_890_000, 'MAIOR_MELHOR', {
      desvioDaOrigem: -11.3245,
      casasDecimais: 0,
    })
    expect(c.desvio).toBe(-11.32)
    expect(c.situacao).toBe('abaixo')
  })

  it('sem valor, tudo fica nulo — nunca zero', () => {
    const c = montarCelula(null, 4.0, 'MENOR_MELHOR', { casasDecimais: 1 })
    expect(c.valor).toBeNull()
    expect(c.desvio).toBeNull()
    expect(c.situacao).toBeNull()
  })

  it('sem meta e sem desvio da origem, não inventa desvio', () => {
    const c = montarCelula(3.5, null, 'MENOR_MELHOR', { casasDecimais: 1 })
    expect(c.valor).toBe(3.5)
    expect(c.desvio).toBeNull()
    expect(c.situacao).toBeNull()
  })
})

/**
 * A cor segue o SENTIDO do indicador, não o sinal do desvio.
 *
 * Em Perdas e Custo menor é melhor: desvio negativo é bom. Pintar "abaixo da
 * meta" de vermelho nos quatro indicadores mostraria Perdas em vermelho
 * justamente quando a filial está indo bem — e o quadro perderia o sentido.
 */
describe('cor pelo sentido do indicador', () => {
  it('o mesmo desvio dá cores opostas conforme o sentido', () => {
    const maior = montarCelula(4.6, 4.0, 'MAIOR_MELHOR', { casasDecimais: 1 })
    const menor = montarCelula(4.6, 4.0, 'MENOR_MELHOR', { casasDecimais: 1 })

    expect(maior.desvio).toBe(15)
    expect(menor.desvio).toBe(15)
    expect(maior.situacao).toBe('acima') // superar a meta é bom
    expect(menor.situacao).toBe('abaixo') // superar a meta é ruim
  })

  it('exatamente na meta conta como acima, nos dois sentidos', () => {
    expect(situacaoDoDesvio(0, 'MAIOR_MELHOR')).toBe('acima')
    expect(situacaoDoDesvio(0, 'MENOR_MELHOR')).toBe('acima')
  })

  it('maior é melhor: positivo verde, negativo vermelho', () => {
    expect(situacaoDoDesvio(0.01, 'MAIOR_MELHOR')).toBe('acima')
    expect(situacaoDoDesvio(-0.01, 'MAIOR_MELHOR')).toBe('abaixo')
  })

  it('menor é melhor: negativo verde, positivo vermelho', () => {
    expect(situacaoDoDesvio(-0.01, 'MENOR_MELHOR')).toBe('acima')
    expect(situacaoDoDesvio(0.01, 'MENOR_MELHOR')).toBe('abaixo')
  })
})

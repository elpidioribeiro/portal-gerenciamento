import { describe, expect, it } from 'vitest'
import {
  consolidar,
  fatorDeProjecao,
  performanceVendas,
  type AreaNoMes,
} from '../../src/modules/variaveis/performance-vendas.js'

/**
 * Performance Vendas — um teste por regra, com o nome da regra.
 *
 * Conta errada aqui **não gera exceção**: gera um percentual plausível na tela,
 * que alguém leva para a reunião e usa para decidir onde atacar. É o tipo de
 * defeito que só teste pega.
 *
 * O que mais importa é a última garantia: a soma das áreas tem de dar a
 * projeção da filial. É ela que impede o sintoma que a decisão de calcular no
 * portal poderia causar — "as áreas não fecham com o total", numa tela onde os
 * dois números aparecem juntos.
 */

const area = (id: string, vendido: number, meta: number | null): AreaNoMes => ({
  areaVendaId: id,
  vendido,
  meta,
})

describe('fator de projeção', () => {
  it('sai da tendência que o BI já entrega para a filial', () => {
    // Vendido 4 mi no mês, o BI projeta 10 mi no fechamento.
    expect(fatorDeProjecao(4_000_000, 10_000_000)).toBe(2.5)
  })

  it('filial sem venda no mês devolve 1, não infinito', () => {
    expect(fatorDeProjecao(0, 10_000_000)).toBe(1)
    expect(Number.isFinite(fatorDeProjecao(0, 10_000_000))).toBe(true)
  })
})

describe('performance da área', () => {
  const fator = 2.5

  it('projeta o vendido e compara com a meta do mês', () => {
    const [r] = performanceVendas([area('a', 400_000, 1_000_000)], fator)
    expect(r?.numerador).toBe(1_000_000)
    expect(r?.percentual).toBe(100)
  })

  /**
   * Meta ausente devolve `null` — nunca zero nem 100.
   *
   * Zero seria lido como "não vendeu nada" e 100 como "está na meta". Os dois
   * afirmam algo sobre o desempenho; o que se sabe é que ninguém cadastrou a
   * meta. Ausência de meta não é desempenho.
   */
  it('sem meta cadastrada o percentual é nulo, e o realizado continua visível', () => {
    const [r] = performanceVendas([area('a', 400_000, null)], fator)
    expect(r?.percentual).toBeNull()
    expect(r?.numerador).toBe(1_000_000)
  })

  it('meta zero também é nulo — dividir por zero não vira 100%', () => {
    const [r] = performanceVendas([area('a', 400_000, 0)], fator)
    expect(r?.percentual).toBeNull()
  })
})

describe('consolidação da gerência', () => {
  const fator = 2

  /**
   * A regra que estava errada no protótipo e foi pega olhando a tela: a média
   * dos percentuais pesa uma área pequena igual a uma grande.
   */
  it('soma numerador e denominador, NUNCA promedia percentuais', () => {
    const itens = performanceVendas(
      [
        area('grande', 1_000_000, 2_500_000), //  80% — 2 mi projetado
        area('pequena', 100_000, 100_000), // 200% — 200 mil projetado
      ],
      fator,
    )

    const g = consolidar(itens)
    // Somado: 2,2 mi projetado sobre 2,6 mi de meta = 84,6%.
    expect(g?.percentual).toBeCloseTo(84.6, 1)
    // Promediando os percentuais daria 140% — a área pequena dominaria.
    expect(g?.percentual).not.toBeCloseTo(140, 0)
  })

  it('área sem meta fica fora dos dois lados da conta', () => {
    const itens = performanceVendas(
      [area('com', 500_000, 1_000_000), area('sem', 500_000, null)],
      fator,
    )
    const g = consolidar(itens)
    expect(g?.numerador).toBe(1_000_000)
    expect(g?.denominador).toBe(1_000_000)
    expect(g?.percentual).toBe(100)
  })

  it('nenhuma área com meta devolve nulo, não zero', () => {
    expect(consolidar(performanceVendas([area('a', 500_000, null)], fator))).toBeNull()
  })
})

/**
 * A garantia que justifica calcular no portal em vez de pedir ao BI.
 *
 * O fator é o mesmo para todas as áreas, e a soma do vendido das áreas é igual
 * ao da filial — a ingestão valida isso a cada carga. Logo a soma das projeções
 * das áreas é a projeção da filial, por construção.
 */
describe('a soma das áreas fecha com a filial', () => {
  it('exatamente, para qualquer repartição do vendido', () => {
    const vendidoFilial = 4_137_211.53
    const tendenciaFilial = 14_217_827 // o valor real de CEN em 18/08, do plano
    const fator = fatorDeProjecao(vendidoFilial, tendenciaFilial)

    const repartir = [0.5123, 0.2811, 0.1444, 0.0622]
    const areas = repartir.map((p, i) => area(`a${i}`, vendidoFilial * p, 1))
    const soma = performanceVendas(areas, fator).reduce((a, r) => a + r.numerador, 0)

    expect(soma).toBeCloseTo(tendenciaFilial, 6)
  })

  it('inclusive quando uma área não vendeu nada no mês', () => {
    const fator = fatorDeProjecao(1_000_000, 3_000_000)
    const areas = [area('a', 1_000_000, 1), area('b', 0, 1)]
    const soma = performanceVendas(areas, fator).reduce((a, r) => a + r.numerador, 0)
    expect(soma).toBe(3_000_000)
  })
})

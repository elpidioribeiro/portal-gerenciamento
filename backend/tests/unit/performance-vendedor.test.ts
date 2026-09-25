import { HouveVenda as HouveVendaDoBanco } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  type HouveVenda,
  bateuMeta,
  consolidarVendedor,
  contaNoDenominador,
  performanceVendedor,
  type VendedorNoMes,
} from '../../src/modules/variaveis/performance-vendedor.js'

/**
 * Performance Vendedor — um teste por regra, com o nome da regra.
 *
 * A regra de **quem entra no denominador** é a que erra em silêncio: ela não
 * gera exceção, gera um percentual plausível. Uma área com 18 vendedores e 4 no
 * denominador dá um número bonito e errado, e ninguém percebe olhando a tela.
 *
 * A CLASSIFICAÇÃO (`houveVenda`) não é testada aqui, e não é esquecimento: ela
 * vem pronta de `vendedor-situacao.sql` desde 27/08/2026. Testá-la aqui exigiria
 * reproduzi-la, que é exatamente a segunda cópia que se quis eliminar.
 */

const v = (over: Partial<VendedorNoMes> = {}): VendedorNoMes => ({
  codVendedor: '1',
  matricula: '1001',
  nome: 'Fulano',
  areaVenda: 'Pisos e Revestimentos',
  ano: 2026,
  mes: 7,
  meta: 100_000,
  realizado: 120_000,
  sitafa: 1,
  houveVenda: 'COM_VENDA',
  ...over,
})

describe('quem entra no denominador', () => {
  it('as três condições do analista, todas necessárias', () => {
    expect(contaNoDenominador(v())).toBe(true)
    expect(contaNoDenominador(v({ houveVenda: 'SEM_VENDA' }))).toBe(false)
    expect(contaNoDenominador(v({ sitafa: 7 }))).toBe(false)
    expect(contaNoDenominador(v({ meta: 0 }))).toBe(false)
  })

  /**
   * Supervisor tem categoria própria e ENTRA, desde que tenha cota.
   *
   * A regra é `<> 'SEM_VENDA'`, não `= 'COM_VENDA'` — a diferença aparece em
   * SUPERVISOR e MÊS EM VIGOR, e trocar uma pela outra esvaziaria o denominador
   * do mês corrente inteiro.
   */
  it('MÊS EM VIGOR e SUPERVISOR contam — a regra é "não é SEM VENDA"', () => {
    expect(contaNoDenominador(v({ houveVenda: 'MES_EM_VIGOR' }))).toBe(true)
    expect(contaNoDenominador(v({ houveVenda: 'SUPERVISOR' }))).toBe(true)
  })

  /**
   * A condição mais fácil de esquecer, e a que mais muda o número.
   *
   * Vendedor sem meta não tem o que cumprir. Contá-lo como "não bateu"
   * afundaria a área por um cadastro em branco; como "bateu", inflaria.
   */
  it('cota zero fica de fora, e não como "não bateu"', () => {
    const [r] = performanceVendedor([
      v(),
      v({ codVendedor: '2', meta: 0, realizado: 0, houveVenda: 'COM_VENDA' }),
    ])
    expect(r?.denominador).toBe(1)
    expect(r?.numerador).toBe(1)
    expect(r?.percentual).toBe(100)
    expect(r?.foraDaConta.semMeta).toBe(1)
  })
})

describe('a conta da área', () => {
  it('bater é alcançar a própria meta — igual conta como batida', () => {
    expect(bateuMeta(v({ realizado: 100_000, meta: 100_000 }))).toBe(true)
    expect(bateuMeta(v({ realizado: 99_999, meta: 100_000 }))).toBe(false)
  })

  it('agrupa por área de venda', () => {
    const r = performanceVendedor([
      v({ codVendedor: '1', areaVenda: 'Pisos', realizado: 120_000 }),
      v({ codVendedor: '2', areaVenda: 'Pisos', realizado: 50_000 }),
      v({ codVendedor: '3', areaVenda: 'Metais', realizado: 120_000 }),
    ])
    expect(r).toHaveLength(2)
    expect(r.find((x) => x.areaVenda === 'Pisos')?.percentual).toBe(50)
    expect(r.find((x) => x.areaVenda === 'Metais')?.percentual).toBe(100)
  })

  it('ninguém no denominador devolve nulo, não zero', () => {
    const [r] = performanceVendedor([v({ meta: 0 })])
    expect(r?.percentual).toBeNull()
  })

  /**
   * O que a tela precisa para o número ser crível.
   *
   * Uma área com 18 vendedores mostrando "8 de 9" parece erro de cálculo. É
   * honesto — os outros nove não tinham meta ou estavam inativos —, mas só é
   * crível se a tela puder dizer isso.
   */
  it('conta quantos ficaram de fora, e por quê', () => {
    const [r] = performanceVendedor([
      v({ codVendedor: '1' }),
      v({ codVendedor: '2', meta: 0 }),
      v({ codVendedor: '3', sitafa: 7 }),
      // SEM VENDA, mas com meta e ativo: fica fora, e por um terceiro motivo.
      v({ codVendedor: '4', realizado: 0, houveVenda: 'SEM_VENDA' }),
    ])
    expect(r?.denominador).toBe(1)
    expect(r?.foraDaConta).toEqual({ semMeta: 1, inativos: 1, outros: 1 })
  })
})

describe('consolidação da gerência', () => {
  /** Mesma regra de Performance Vendas: soma, nunca média dos percentuais. */
  it('soma numerador e denominador, NUNCA promedia percentuais', () => {
    const grande = Array.from({ length: 18 }, (_, i) =>
      v({
        codVendedor: `g${i}`,
        areaVenda: 'Grande',
        realizado: i < 9 ? 120_000 : 0,
        houveVenda: i < 9 ? 'COM_VENDA' : 'SEM_VENDA',
      }),
    )
    const pequena = Array.from({ length: 2 }, (_, i) =>
      v({ codVendedor: `p${i}`, areaVenda: 'Pequena', realizado: 120_000 }),
    )

    const g = consolidarVendedor(performanceVendedor([...grande, ...pequena]))

    // Os 9 SEM VENDA de "Grande" caem fora: o denominador dela é 9, não 18.
    expect(g?.denominador).toBe(11)
    expect(g?.numerador).toBe(11)
  })

  it('a média dos percentuais daria outro número — este é o caso que separa', () => {
    const areas = performanceVendedor([
      // Grande: 4 de 10 bateram = 40%
      ...Array.from({ length: 10 }, (_, i) =>
        v({ codVendedor: `g${i}`, areaVenda: 'Grande', realizado: i < 4 ? 120_000 : 90_000 }),
      ),
      // Pequena: 1 de 1 bateu = 100%
      v({ codVendedor: 'p1', areaVenda: 'Pequena', realizado: 120_000 }),
    ])

    const g = consolidarVendedor(areas)
    // Somado: 5 de 11 = 45,5%. Promediando: (40 + 100) / 2 = 70%.
    expect(g?.percentual).toBeCloseTo(45.45, 1)
    expect(g?.percentual).not.toBeCloseTo(70, 0)
  })

  it('lista vazia devolve nulo', () => {
    expect(consolidarVendedor([])).toBeNull()
  })
})

/**
 * A GRAFIA, e ela já custou o número uma vez.
 *
 * Até 03/09/2026 este módulo dizia `'SEM VENDA'` e o Prisma entregava
 * `'SEM_VENDA'`. Os pontos de chamada reconciliavam com um `as`, que não
 * converte nada -- a comparação de `contaNoDenominador` nunca casava e **todo
 * vendedor "sem venda" entrava no denominador**. Este arquivo estava verde o
 * tempo todo, porque passava a grafia à mão.
 *
 * A anotação de tipo é metade do teste: se as duas listas divergirem de novo, o
 * `tsc` recusa antes de o vitest rodar.
 */
describe('a grafia do estado', () => {
  it('é a mesma que o banco entrega', () => {
    const doBanco: HouveVenda[] = Object.values(HouveVendaDoBanco)
    expect([...doBanco].sort()).toEqual(['COM_VENDA', 'MES_EM_VIGOR', 'SEM_VENDA', 'SUPERVISOR'])
  })
})

import { describe, expect, it } from 'vitest'
import { gdEscolhido } from '../src/lib/gd-escolhido.js'

/**
 * A escolha do GD na tela do N3.
 *
 * O que estes testes protegem falha em SILÊNCIO. A matriz do N2 abre esta tela
 * com `?gd=<codigo>` da célula clicada; se um código inexistente caísse no
 * primeiro GD, clicar em NPS abriria a reunião de VENDAS com a aba de Vendas
 * marcada — número certo, reunião errada, e nada na tela dizendo isso.
 *
 * Hoje só o GD de Vendas tem variável de controle cadastrada, então o caso do
 * pedido inexistente é o caso COMUM, não a borda.
 */

const GDS = [
  { codigo: 'vendas', nome: 'Vendas' },
  { codigo: 'perdas', nome: 'Perdas' },
]

describe('gdEscolhido', () => {
  it('sem pedido, abre no primeiro — é a tela aberta pelo menu', () => {
    expect(gdEscolhido(GDS, null)?.codigo).toBe('vendas')
  })

  it('pedido que existe vence o primeiro', () => {
    expect(gdEscolhido(GDS, 'perdas')?.codigo).toBe('perdas')
  })

  /**
   * O caso da mudança: NÃO cai no primeiro.
   *
   * Era `?? gds[0]`, e com ele este teste passaria devolvendo 'vendas' — que é
   * exatamente o defeito.
   */
  it('pedido que NÃO existe devolve null, e não o primeiro', () => {
    expect(gdEscolhido(GDS, 'nps')).toBeNull()
  })

  it('lista vazia devolve null nos dois casos', () => {
    expect(gdEscolhido([], null)).toBeNull()
    expect(gdEscolhido([], 'vendas')).toBeNull()
  })

  /**
   * String vazia é PEDIDO, não ausência.
   *
   * `?gd=` na URL dá `''`, e `'' === null` é falso — então cai na busca e não
   * acha nada. É o certo: alguém montou o link errado, e mostrar o primeiro GD
   * esconderia isso.
   */
  it('string vazia é pedido inexistente, não ausência de pedido', () => {
    expect(gdEscolhido(GDS, '')).toBeNull()
  })
})

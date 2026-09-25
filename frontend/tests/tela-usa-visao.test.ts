import { describe, expect, it } from 'vitest'
import { telaUsaVisao } from '../src/lib/tela-usa-visao.js'

/**
 * O DEFEITO QUE ESTE ARQUIVO GUARDA (11/09/2026).
 *
 * A faixa laranja dizia *"você está vendo como N3 · NOR"* na tela de Ações, e
 * dois centímetros abaixo o selo da lista dizia `N2` — com as ações do N2. A
 * lista é pessoal desde §7.70: mostra o que passou pela minha mão, e a visão
 * simula um nível numa loja, não uma pessoa. A faixa prometia um recorte que
 * aquela tela não aplica.
 */
describe('tela usa visão', () => {
  it('as telas de recorte mostram a faixa', () => {
    for (const rota of ['/painel', '/reuniao', '/reuniao-n3', '/indicador/vendas/NOR', '/']) {
      expect(telaUsaVisao(rota), rota).toBe(true)
    }
  })

  it('as telas PESSOAIS não mostram: nelas a visão não recorta nada', () => {
    expect(telaUsaVisao('/acoes')).toBe(false)
    expect(telaUsaVisao('/contramedida/AC-0311')).toBe(false)
  })

  /*
   * A comparação é por segmento, e não por prefixo solto: uma rota futura
   * chamada `/acoes-do-time` não é `/acoes`, e herdaria a exceção em silêncio.
   */
  it('não confunde uma rota que só COMEÇA igual', () => {
    expect(telaUsaVisao('/acoes-do-time')).toBe(true)
    expect(telaUsaVisao('/contramedidas-antigas')).toBe(true)
  })
})

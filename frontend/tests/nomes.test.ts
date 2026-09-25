import { describe, expect, it } from 'vitest'
import { acoes, areas } from '../src/lib/nomes.js'

/**
 * A CONCORDÂNCIA das contagens que a reunião lê em voz alta.
 *
 * Existe por causa de dois erros que chegaram à tela, e o segundo é o motivo
 * deste arquivo:
 *
 *  - "1 áreas na meta", nos cabeçalhos do N3 e do N4;
 *  - **"6 açãoões"**, no bloco "O que já está sendo feito" do N3 — o plural era
 *    montado grudando o sufixo (`ação{n > 1 ? 'ões' : ''}`), e plural de *-ão*
 *    troca a terminação em vez de acrescentar uma.
 *
 * Os dois passaram por revisão sem ninguém ver, porque o caso singular é raro
 * na base de teste e o plural quebrado só aparece com dado real. Teste é mais
 * barato que uma reunião perguntando se o portal sabe contar.
 */
describe('concordância das contagens', () => {
  it('área: singular e plural', () => {
    expect(areas(1)).toBe('1 área')
    expect(areas(2)).toBe('2 áreas')
    expect(areas(13)).toBe('13 áreas')
  })

  it('ação: o plural TROCA o -ão, não acrescenta', () => {
    expect(acoes(1)).toBe('1 ação')
    expect(acoes(6)).toBe('6 ações')
    // A regressão exata: nunca mais "açãoões".
    expect(acoes(6)).not.toContain('ãoõ')
  })

  /*
   * ZERO é plural em português — "0 ações", não "0 ação".
   *
   * Vale checar porque o caso real existe: uma gerência sem contramedida
   * aberta. A tela hoje troca esse bloco por "Nenhuma ação aberta nesta
   * gerência" antes de contar, mas o helper é público e a próxima tela pode
   * chamá-lo com zero.
   */
  it('zero é plural', () => {
    expect(acoes(0)).toBe('0 ações')
    expect(areas(0)).toBe('0 áreas')
  })
})

import { describe, expect, it } from 'vitest'
import { dataDoCalendario, dataEHora } from '../src/lib/formato.js'

/**
 * As DATAS da linha do tempo da contramedida.
 *
 * O teste que importa aqui é o do fuso. `dataDoCalendario` existe porque o
 * prazo chega como `YYYY-MM-DD` e `new Date('2026-09-07').toLocaleDateString()`
 * em UTC−3 devolve **06/09** — o prazo aparecendo um dia mais cedo numa tela de
 * cobrança. É um erro que não quebra nada, não aparece em log, e só é notado
 * por quem for cobrado no dia errado.
 */
describe('datas da contramedida', () => {
  it('prazo: corta a string, sem passar pelo fuso', () => {
    expect(dataDoCalendario('2026-09-07')).toBe('07/09/2026')
    // O caso que o `new Date` erraria: dia 1º volta como último dia do mês anterior.
    expect(dataDoCalendario('2026-09-01')).toBe('01/09/2026')
    expect(dataDoCalendario('2026-01-01')).toBe('01/01/2026')
  })

  /*
   * Entrada estranha não pode virar data inventada: devolver o texto como veio
   * deixa o defeito VISÍVEL na tela, e um "—" ou um `Invalid Date` esconderia
   * de onde ele vem.
   */
  it('prazo: entrada fora do formato volta intacta', () => {
    expect(dataDoCalendario('')).toBe('')
    expect(dataDoCalendario('07/09/2026')).toBe('07/09/2026')
  })

  it('movimentação: data E hora, com separador', () => {
    // ISO com offset explícito: o instante é o mesmo em qualquer máquina.
    const t = dataEHora('2026-09-06T14:32:00-03:00')
    expect(t).toMatch(/^\d{2}\/\d{2}\/\d{4} · \d{2}:\d{2}$/)
    expect(t).toContain('06/09/2026')
  })
})

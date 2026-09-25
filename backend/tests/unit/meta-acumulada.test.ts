import { describe, expect, it } from 'vitest'
import { limiteDeMesesDaMeta, type Janela } from '../../src/modules/indicadores/calculos.js'

/**
 * Quais meses entram na meta do período.
 *
 * No modo anual do ano corrente, apenas os decorridos. Somar as 12 metas contra
 * um realizado de 8 meses dava −85% de desvio sem nada estar errado — é o mesmo
 * erro de comparar parcial com total que já apareceu no mês, e voltou aqui.
 */

const HOJE = new Date(2026, 7, 20) // 20/08/2026

const janelaAno = (ano: number): Janela => ({
  de: new Date(Date.UTC(ano, 0, 1)),
  ate: new Date(Date.UTC(ano, 11, 31)),
  ano,
})

const janelaMes = (ano: number, mes: number): Janela => ({
  de: new Date(Date.UTC(ano, mes - 1, 1)),
  ate: new Date(Date.UTC(ano, mes, 0)),
  ano,
  mes,
})

describe('meses da meta no período', () => {
  it('ano corrente: limita ao mês corrente', () => {
    expect(limiteDeMesesDaMeta(janelaAno(2026), HOJE)).toEqual({ lte: 8 })
  })

  it('ano anterior: entra inteiro, sem limite', () => {
    expect(limiteDeMesesDaMeta(janelaAno(2025), HOJE)).toEqual({})
  })

  it('ano futuro: entra inteiro (não há realizado com que comparar)', () => {
    expect(limiteDeMesesDaMeta(janelaAno(2027), HOJE)).toEqual({})
  })

  it('modo mês: sem limite, porque o filtro já é o próprio mês', () => {
    expect(limiteDeMesesDaMeta(janelaMes(2026, 3), HOJE)).toEqual({})
    expect(limiteDeMesesDaMeta(janelaMes(2026, 8), HOJE)).toEqual({})
  })

  it('em janeiro do ano corrente, o limite é o mês 1', () => {
    expect(limiteDeMesesDaMeta(janelaAno(2026), new Date(2026, 0, 5))).toEqual({ lte: 1 })
  })

  it('em dezembro, o limite é 12 — igual a não limitar', () => {
    expect(limiteDeMesesDaMeta(janelaAno(2026), new Date(2026, 11, 31))).toEqual({ lte: 12 })
  })
})

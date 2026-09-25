import { describe, expect, it } from 'vitest'
import {
  bateuCotaAcumulada,
  corteDaSemana,
  corteDe,
  cotaAcumulada,
} from '../../src/modules/variaveis/cota-acumulada.js'

/**
 * Rateio da cota mensal pelos dias úteis. PLANO §7.15.
 *
 * O teste que mais importa aqui não é o da conta — é o do **zero**. Com nenhum
 * dia útil decorrido, a cota rateada dá zero, e `realizado >= 0` é sempre
 * verdadeiro: a tela mostraria 100% dos vendedores na meta no primeiro dia útil
 * do mês, todo mês, sem erro nenhum.
 */

describe('o corte é D-1', () => {
  it('devolve ontem, à meia-noite', () => {
    expect(corteDe(new Date('2026-08-27T14:30:00Z')).toISOString()).toBe('2026-08-26T00:00:00.000Z')
  })

  it('atravessa o começo do mês', () => {
    expect(corteDe(new Date('2026-08-01T09:00:00Z')).toISOString()).toBe('2026-07-31T00:00:00.000Z')
  })

  /**
   * No dia 1º não há o que comparar, e a resposta é `null` — não zero.
   *
   * Com o corte no mês anterior, o acumulado do mês corrente é zero: a cota
   * rateada daria zero e todo mundo "bateria" com venda nenhuma.
   */
  it('no dia 1º o mês corrente tem zero decorridos, e a cota é nula', () => {
    expect(cotaAcumulada(100_000, { acumulado: 0, doMes: 26 })).toBeNull()
  })

  /**
   * O erro que a invariante evita, com número.
   *
   * Somar a venda até D-1 e o dia útil até D infla a cota em um dia. No 20º de
   * 26 dias úteis são **5% a mais** exigidos de todo mundo — o bastante para
   * mudar quem está na meta, sem erro e sem sintoma.
   */
  it('cortar o calendário um dia depois do realizado exige mais de todos', () => {
    const certo = cotaAcumulada(100_000, { acumulado: 20, doMes: 26 })!
    const errado = cotaAcumulada(100_000, { acumulado: 21, doMes: 26 })!

    // Um dia a mais no divisor: um vinte avos a mais exigido de cada vendedor.
    expect((errado - certo) / certo).toBeCloseTo(1 / 20, 4)

    // Quem está exatamente na meta pelo corte certo fica fora pelo errado.
    expect(certo >= certo).toBe(true)
    expect(certo >= errado).toBe(false)
  })
})

describe('a cota proporcional aos dias úteis', () => {
  it('metade dos dias úteis, metade da cota', () => {
    expect(cotaAcumulada(100_000, { acumulado: 11, doMes: 22 })).toBe(50_000)
  })

  it('no último dia útil, a cota rateada É a cota do mês', () => {
    expect(cotaAcumulada(100_000, { acumulado: 22, doMes: 22 })).toBe(100_000)
  })

  /**
   * O divisor vem do calendário DA FILIAL.
   *
   * Feriado municipal derruba um dia útil numa loja e não na outra. Ratear por
   * dia corrido faria a mesma cota parecer mais dura onde houve feriado.
   */
  it('o mesmo dia rende cotas diferentes em filiais com calendários diferentes', () => {
    const comFeriado = cotaAcumulada(100_000, { acumulado: 10, doMes: 21 })
    const sem = cotaAcumulada(100_000, { acumulado: 10, doMes: 22 })
    expect(comFeriado).toBeGreaterThan(sem!)
  })
})

describe('quando a pergunta não se aplica', () => {
  it('nenhum dia útil decorrido devolve nulo, NÃO zero', () => {
    expect(cotaAcumulada(100_000, { acumulado: 0, doMes: 22 })).toBeNull()
  })

  it('mês sem dia útil devolve nulo, e não divide por zero', () => {
    expect(cotaAcumulada(100_000, { acumulado: 0, doMes: 0 })).toBeNull()
    expect(cotaAcumulada(100_000, { acumulado: 3, doMes: 0 })).toBeNull()
  })

  /** O caso que o zero esconderia: ninguém bate meta antes de o mês começar. */
  it('sem dia útil decorrido, NINGUÉM bateu — nem quem vendeu zero', () => {
    expect(bateuCotaAcumulada(0, 100_000, { acumulado: 0, doMes: 22 })).toBeNull()
    expect(bateuCotaAcumulada(999_999, 100_000, { acumulado: 0, doMes: 22 })).toBeNull()
  })
})

describe('bater a meta é acompanhar o acumulado', () => {
  it('igual conta como batida, como em bateuMeta', () => {
    expect(bateuCotaAcumulada(50_000, 100_000, { acumulado: 11, doMes: 22 })).toBe(true)
    expect(bateuCotaAcumulada(49_999, 100_000, { acumulado: 11, doMes: 22 })).toBe(false)
  })

  /**
   * A semana ruim seguida de uma boa.
   *
   * Medir a semana ISOLADA marcaria vermelho em quem já se recuperou, e
   * responderia "como foi esta semana" em vez de "dá para virar o mês?" — que é
   * a pergunta do GD.
   */
  it('quem foi mal na S1 e bem na S2 está na meta na S2', () => {
    const cota = 100_000
    // S1: 5 dias úteis de 22. Cota rateada 22.727; vendeu 10.000.
    expect(bateuCotaAcumulada(10_000, cota, { acumulado: 5, doMes: 22 })).toBe(false)
    // S2: 10 dias úteis. Cota rateada 45.454; o ACUMULADO chegou a 50.000.
    expect(bateuCotaAcumulada(50_000, cota, { acumulado: 10, doMes: 22 })).toBe(true)
  })

  it('cota zero: qualquer venda basta, e é o filtro de quem conta que resolve', () => {
    // Vendedor sem meta não deveria chegar aqui — `contaNoDenominador` o tira
    // antes. Se chegar, a conta não inventa exigência.
    expect(bateuCotaAcumulada(0, 0, { acumulado: 11, doMes: 22 })).toBe(true)
  })
})

/**
 * O corte de uma semana — o dia até onde a conta vai.
 *
 * Escolher a semana MOVE o ponto no tempo; a conta é a mesma. Por isso Vendas e
 * Vendedor compartilham esta função: se cada uma escolhesse o próprio corte,
 * duas telas responderiam sobre instantes diferentes com o mesmo rótulo "S3".
 */
describe('corteDaSemana', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

  it('sem semana, é D-1 — o comportamento de sempre', () => {
    expect(corteDaSemana({ ano: 2026, mes: 8, hoje: d('2026-08-28') })).toEqual(d('2026-08-27'))
  })

  it('semana passada corta no fim dela, não em D-1', () => {
    // S2 de agosto/2026 vai de 10 a 16; hoje é 28.
    const c = corteDaSemana({
      ano: 2026, mes: 8, semana: 2, fimDaSemana: d('2026-08-16'), hoje: d('2026-08-28'),
    })
    expect(c).toEqual(d('2026-08-16'))
  })

  /** Na semana em curso o fim ainda não chegou: manda D-1. */
  it('semana corrente corta em D-1', () => {
    const c = corteDaSemana({
      ano: 2026, mes: 8, semana: 4, fimDaSemana: d('2026-08-30'), hoje: d('2026-08-28'),
    })
    expect(c).toEqual(d('2026-08-27'))
  })

  /**
   * A janela da carga vence quando ficou para trás. Sem isso a cota é rateada
   * por dias úteis que o realizado ainda não tem — medido em 28/08/2026: cinco
   * pontos de queda sem ninguém ter vendido menos.
   */
  it('a carga atrasada puxa o corte para trás', () => {
    const c = corteDaSemana({
      ano: 2026, mes: 8, semana: 4, fimDaSemana: d('2026-08-30'),
      hoje: d('2026-08-28'), ateACarga: d('2026-08-25'),
    })
    expect(c).toEqual(d('2026-08-25'))
  })

  it('a carga adiantada NÃO empurra o corte para a frente', () => {
    const c = corteDaSemana({
      ano: 2026, mes: 8, semana: 2, fimDaSemana: d('2026-08-16'),
      hoje: d('2026-08-28'), ateACarga: d('2026-08-27'),
    })
    expect(c).toEqual(d('2026-08-16'))
  })

  /**
   * **Semana que ainda não começou não tem número.**
   *
   * Sem esta trava o `min` devolveria D-1 para ela, e a semana futura apareceria
   * com o MESMO valor da corrente — na faísca, um segmento reto que parece dado
   * e não é. Medido em 29/08/2026: a S5 de agosto (31/08) vinha com 58,5%,
   * igual à S4.
   */
  it('semana que ainda não começou devolve null', () => {
    const c = corteDaSemana({
      ano: 2026, mes: 8, semana: 5,
      deDaSemana: d('2026-08-31'), fimDaSemana: d('2026-08-31'),
      hoje: d('2026-08-29'),
    })
    expect(c).toBeNull()
  })

  it('semana em curso NÃO é futura: corta em D-1', () => {
    const c = corteDaSemana({
      ano: 2026, mes: 8, semana: 4,
      deDaSemana: d('2026-08-24'), fimDaSemana: d('2026-08-30'),
      hoje: d('2026-08-29'),
    })
    expect(c).toEqual(d('2026-08-28'))
  })

  it('mês passado usa o mês inteiro, não o D-1 de hoje', () => {
    expect(corteDaSemana({ ano: 2026, mes: 7, hoje: d('2026-08-28') })).toEqual(d('2026-07-31'))
  })

  /** Semana que ainda não começou: não é zero, é "não há o que comparar". */
  it('mês inteiramente no futuro devolve null', () => {
    expect(corteDaSemana({ ano: 2026, mes: 12, hoje: d('2026-08-28') })).toBeNull()
  })

  it('no dia 1º do mês o corte cai no mês anterior — null', () => {
    expect(corteDaSemana({ ano: 2026, mes: 8, hoje: d('2026-08-01') })).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { ehMesCorrente, mesesDoAno, semanasDoMes } from '../../src/lib/semanas.js'

/**
 * Semanas do mês — **a definição única do quadro**.
 *
 * KPI, faísca, grade de marcação e Pareto leem daqui. Enquanto só o gráfico do
 * indicador usava semanas, uma segunda definição podia conviver em silêncio:
 * a tela contava `Math.ceil(dia / 7)` e ninguém cruzava as duas. Cruzam agora,
 * e "S3" tem de significar a mesma coisa nas quatro.
 *
 * Regra (analista, 28/08/2026): segunda a domingo, a S1 abrindo no DIA 1 —
 * salvo quando ele cai em sábado ou domingo —, e a última cortada no fim do
 * mês.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10)
const diaDaSemana = (data: string) => new Date(`${data}T00:00:00Z`).getUTCDay()

describe('a S1 abre no dia 1 do mês', () => {
  it('setembro/2026 começa numa terça — S1 é dia 01, com 6 dias', () => {
    expect(diaDaSemana('2026-09-01')).toBe(2) // terça
    const s = semanasDoMes(2026, 9)
    expect(iso(s[0]!.de)).toBe('2026-09-01')
    expect(iso(s[0]!.ate)).toBe('2026-09-06') // o domingo daquela semana
  })

  it('quando o dia 1 já é segunda, nada de especial acontece', () => {
    expect(diaDaSemana('2026-06-01')).toBe(1)
    expect(iso(semanasDoMes(2026, 6)[0]!.de)).toBe('2026-06-01')
  })

  /**
   * A única exceção, e é deliberada: uma semana que começasse no sábado teria o
   * fim de semana na frente, e o primeiro dia útil dela — de onde sai a
   * fotografia — cairia só na segunda, já dentro da semana seguinte.
   */
  it('sábado e domingo NÃO abrem semana: agosto/2026 começa no dia 03', () => {
    expect(diaDaSemana('2026-08-01')).toBe(6) // sábado
    const s = semanasDoMes(2026, 8)
    expect(iso(s[0]!.de)).toBe('2026-08-03')
    expect(s.some((w) => iso(w.de) <= '2026-08-01' && iso(w.ate) >= '2026-08-01')).toBe(false)
  })

  it('fevereiro/2026 começa num domingo — S1 é dia 02', () => {
    expect(diaDaSemana('2026-02-01')).toBe(0)
    expect(iso(semanasDoMes(2026, 2)[0]!.de)).toBe('2026-02-02')
  })
})

/**
 * **Nenhum dia de venda some do mês** — que é a razão de a regra ter mudado.
 *
 * Antes a S1 era a primeira segunda-feira, e o que viesse antes não aparecia em
 * semana nenhuma: medido em 2026, sete dos doze meses perdiam dias assim, e
 * setembro e dezembro perdiam seis cada.
 */
describe('cobertura do mês', () => {
  const diasCobertos = (ano: number, mes: number) => {
    const cobertos = new Set<number>()
    for (const w of semanasDoMes(ano, mes)) {
      for (const d = new Date(w.de); d <= w.ate; d.setUTCDate(d.getUTCDate() + 1)) {
        cobertos.add(d.getUTCDate())
      }
    }
    return cobertos
  }

  it.each([
    [2026, 1], [2026, 4], [2026, 5], [2026, 6], [2026, 7],
    [2026, 9], [2026, 10], [2026, 12],
  ])('%s/%s: todo dia do mês está em alguma semana', (ano, mes) => {
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
    const cobertos = diasCobertos(ano, mes)
    const faltando = Array.from({ length: ultimo }, (_, i) => i + 1).filter((d) => !cobertos.has(d))
    expect(faltando).toEqual([])
  })

  /** Os meses que começam no fim de semana perdem esses um ou dois dias. */
  it.each([
    [2026, 2, [1]],
    [2026, 3, [1]],
    [2026, 8, [1, 2]],
    [2026, 11, [1]],
  ])('%s/%s começa no fim de semana e deixa %j de fora', (ano, mes, esperado) => {
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
    const cobertos = diasCobertos(ano, mes)
    const faltando = Array.from({ length: ultimo }, (_, i) => i + 1).filter((d) => !cobertos.has(d))
    expect(faltando).toEqual(esperado)
  })

  /**
   * Sem o corte no fim do mês, agosto/2026 teria S5 de 31/08 a 06/09 e setembro
   * teria S1 em 01/09 — os mesmos seis dias contados em dois meses.
   */
  it('nenhuma semana passa do fim do mês', () => {
    for (let mes = 1; mes <= 12; mes++) {
      const ultimo = new Date(Date.UTC(2026, mes, 0))
      for (const w of semanasDoMes(2026, mes)) {
        expect(w.ate.getTime(), `${w.rotulo} de ${String(mes)}/2026`).toBeLessThanOrEqual(
          ultimo.getTime(),
        )
      }
    }
  })

  it('as semanas são contíguas: cada uma começa no dia seguinte à anterior', () => {
    for (let mes = 1; mes <= 12; mes++) {
      const s = semanasDoMes(2026, mes)
      for (let i = 1; i < s.length; i++) {
        const diaSeguinte = new Date(s[i - 1]!.ate)
        diaSeguinte.setUTCDate(diaSeguinte.getUTCDate() + 1)
        expect(iso(s[i]!.de)).toBe(iso(diaSeguinte))
      }
    }
  })
})

describe('consequências aceitas da regra', () => {
  /**
   * As pontas podem ser parciais. A objeção antiga a isso era peso desigual na
   * média — mas o valor da semana é FOTOGRAFIA, a projeção do primeiro dia útil
   * dela, e fotografia não depende de quantos dias a semana tem.
   */
  it('só a primeira e a última podem ter menos de 7 dias', () => {
    for (let mes = 1; mes <= 12; mes++) {
      const s = semanasDoMes(2026, mes)
      s.forEach((w, i) => {
        const dias = (w.ate.getTime() - w.de.getTime()) / 86_400_000 + 1
        const naPonta = i === 0 || i === s.length - 1
        if (!naPonta) expect(dias, `${w.rotulo} de ${String(mes)}/2026`).toBe(7)
        expect(dias).toBeGreaterThan(0)
        expect(dias).toBeLessThanOrEqual(7)
      })
    }
  })

  /** A grade de marcação tem cinco colunas fixas — nenhum mês pode pedir seis. */
  it('nenhum mês tem mais de 5 semanas', () => {
    for (let ano = 2025; ano <= 2030; ano++) {
      for (let mes = 1; mes <= 12; mes++) {
        expect(semanasDoMes(ano, mes).length, `${String(mes)}/${String(ano)}`).toBeLessThanOrEqual(5)
      }
    }
  })

  it('o miolo sempre começa na segunda', () => {
    for (let mes = 1; mes <= 12; mes++) {
      const s = semanasDoMes(2026, mes)
      for (const w of s.slice(1)) expect(w.de.getUTCDay(), w.rotulo).toBe(1)
    }
  })
})

describe('mesesDoAno', () => {
  it('devolve os doze, do dia 1 ao último', () => {
    const m = mesesDoAno(2026)
    expect(m).toHaveLength(12)
    expect(iso(m[1]!.de)).toBe('2026-02-01')
    expect(iso(m[1]!.ate)).toBe('2026-02-28')
  })
})

describe('ehMesCorrente', () => {
  it('compara ano e mês, não o dia', () => {
    const hoje = new Date('2026-08-28T12:00:00Z')
    expect(ehMesCorrente(2026, 8, hoje)).toBe(true)
    expect(ehMesCorrente(2026, 7, hoje)).toBe(false)
    expect(ehMesCorrente(2025, 8, hoje)).toBe(false)
  })
})

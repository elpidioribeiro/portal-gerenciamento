import { TZDate } from '@date-fns/tz'
import {
  differenceInCalendarDays,
  endOfMonth,
  endOfYear,
  format,
  startOfMonth,
  startOfYear,
} from 'date-fns'
import { env } from '../config/env.js'

/**
 * Todo cálculo de período usa o fuso da aplicação (America/Recife), nunca o do
 * servidor. Um contêiner em UTC viraria o dia três horas antes da loja, e o
 * "acumulado do mês" mudaria de valor à meia-noite errada.
 */
export const TZ = env.TZ_APP

export function agora(): Date {
  return new TZDate(new Date(), TZ)
}

export function hoje(): Date {
  const d = agora()
  d.setHours(0, 0, 0, 0)
  return d
}

/** Ano corrente. O portal nunca crava 2026 — o handoff faz isso por ser protótipo. */
export function anoCorrente(): number {
  return agora().getFullYear()
}

export interface Periodo {
  modo: 'mes' | 'ano'
  ano: number
  /** 1–12. Ausente no modo 'ano'. */
  mes?: number
}

export function intervaloDoPeriodo(p: Periodo): { de: Date; ate: Date } {
  if (p.modo === 'ano') {
    const base = new TZDate(p.ano, 0, 1, TZ)
    return { de: startOfYear(base), ate: endOfYear(base) }
  }
  const base = new TZDate(p.ano, (p.mes ?? 1) - 1, 1, TZ)
  return { de: startOfMonth(base), ate: endOfMonth(base) }
}

/**
 * Fração do período já decorrida, usada para pró-rata da meta de Vendas.
 * Retorna 1 para períodos já encerrados.
 *
 * Sem isso, uma meta de mês cheio comparada com o acumulado até o dia 10
 * mostraria −67% sem nada estar errado. Só se aplica a medida que ACUMULA:
 * NPS, Perdas e Custo são razões e já são comparáveis em qualquer ponto do mês.
 */
export function fracaoDecorrida(p: Periodo): number {
  const { de, ate } = intervaloDoPeriodo(p)
  const agoraTz = hoje()
  if (agoraTz > ate) return 1
  if (agoraTz < de) return 0
  const total = differenceInCalendarDays(ate, de) + 1
  const decorridos = differenceInCalendarDays(agoraTz, de) + 1
  return decorridos / total
}

export function formatarData(d: Date): string {
  return format(new TZDate(d, TZ), 'dd/MM/yyyy')
}

export function formatarHora(d: Date): string {
  return format(new TZDate(d, TZ), 'HH:mm')
}

export function isoData(d: Date): string {
  return format(new TZDate(d, TZ), 'yyyy-MM-dd')
}

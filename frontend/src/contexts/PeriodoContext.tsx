import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * Período global. Um único estado alimenta o subtítulo do painel, o eixo dos
 * dois gráficos e o filtro por data de abertura das contramedidas.
 *
 * O ano NUNCA é constante: o handoff crava "2026" por ser protótipo estático.
 * Aqui ele vem da data corrente, e em 01/01/2027 o portal passa a mostrar 2027
 * sem deploy.
 */

export type ModoPeriodo = 'mes' | 'ano'

export interface Periodo {
  modo: ModoPeriodo
  ano: number
  /** 1–12. Ignorado no modo 'ano'. */
  mes: number
}

export const MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const

interface ContextoPeriodo {
  periodo: Periodo
  definir: (p: Periodo) => void
  /** "Agosto" ou "Ano inteiro" — usado no seletor e nos subtítulos. */
  rotulo: string
  /** "agosto de 2026" ou "2026" — usado em frases corridas. */
  rotuloLongo: string
}

const PeriodoContext = createContext<ContextoPeriodo | null>(null)

function periodoInicial(): Periodo {
  const hoje = new Date()
  return { modo: 'mes', ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 }
}

export function PeriodoProvider({ children }: { children: ReactNode }) {
  const [periodo, definir] = useState<Periodo>(periodoInicial)

  const valor = useMemo<ContextoPeriodo>(() => {
    const nomeMes = MESES[periodo.mes - 1] ?? ''
    return {
      periodo,
      definir,
      rotulo: periodo.modo === 'ano' ? 'Ano inteiro' : nomeMes,
      rotuloLongo:
        periodo.modo === 'ano' ? String(periodo.ano) : `${nomeMes.toLowerCase()} de ${periodo.ano}`,
    }
  }, [periodo])

  return <PeriodoContext.Provider value={valor}>{children}</PeriodoContext.Provider>
}

export function usePeriodo(): ContextoPeriodo {
  const ctx = useContext(PeriodoContext)
  if (!ctx) throw new Error('usePeriodo precisa estar dentro de <PeriodoProvider>')
  return ctx
}

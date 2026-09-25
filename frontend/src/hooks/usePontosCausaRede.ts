import { useQuery } from '@tanstack/react-query'
import { usePeriodo } from '../contexts/PeriodoContext.js'
import { comVisao, useVisao } from '../contexts/VisaoContext.js'
import { api } from '../lib/api.js'

/** Ver o comentário de `situacaoSemana` no backend: três estados, não um booleano. */
export type SituacaoSemana = 'APURADA' | 'EM_ANDAMENTO' | 'FUTURA'

export interface PontosCausaRede {
  visao: { nivel: 'N2' | 'N3' | 'N4' | 'CROSS'; filiais: number; simulada: boolean }
  ciclo: { ano: number; mes: number; semana: number | null; semanasApuradas: number }
  resumo: {
    total: number
    /** Ritmo das semanas FECHADAS. Nulo se nenhuma fechou, ou se pediu uma só. */
    porSemanaApurada: number | null
    /** O que as fechadas marcaram — menor que `total` enquanto o mês corre. */
    totalApurado: number
    pontosDistintos: number
    filiaisQueMarcaram: number
  }
  semanas: Array<{ semana: number; quantidade: number; situacao: SituacaoSemana }>
  pontos: Array<{
    pontoCausaId: string
    nome: string
    gd: string
    quantidade: number
    percentual: number
    porSemana: number[]
    filiais: number
    gds: number
  }>
  porFilial: Array<{
    sigla: string
    quantidade: number
    maisMarcado: { nome: string; quantidade: number } | null
  }>
  gds: Array<{ codigo: string; nome: string; quantidade: number; filiais: number }>
}

/**
 * Os pontos de causa da rede no ciclo do cabeçalho.
 *
 * `mes` é obrigatório na rota, e o período global pode estar em modo ano — aí
 * vale o mês corrente, a mesma escolha que a reunião do N4 faz: esta tela é de
 * um CICLO, e o ciclo do GD é o mês.
 */
export function usePontosCausaRede(opcoes: { semana: number | null; gd: string | null }) {
  const { periodo } = usePeriodo()
  const visao = useVisao()

  const mes = periodo.modo === 'mes' ? periodo.mes : new Date().getMonth() + 1
  const params = new URLSearchParams({ ano: String(periodo.ano), mes: String(mes) })
  if (opcoes.semana !== null) params.set('semana', String(opcoes.semana))
  if (opcoes.gd !== null) params.set('gd', opcoes.gd)

  const query = comVisao(params, visao.params)

  return useQuery({
    queryKey: ['pontos-causa-rede', periodo.ano, mes, opcoes.semana, opcoes.gd, visao.chave],
    queryFn: () => api.get<PontosCausaRede>(`/pontos-causa/rede?${query}`),
  })
}

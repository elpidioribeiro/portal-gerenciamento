import { useQuery } from '@tanstack/react-query'
import { usePeriodo } from '../contexts/PeriodoContext.js'
import { comVisao, useVisao } from '../contexts/VisaoContext.js'
import { api } from '../lib/api.js'
import type { Situacao } from './usePainel.js'

export interface AncoraEixo {
  valor: number
  rotulo: string
  y: number
  meta?: boolean
}

export interface Indicador {
  indicador: {
    codigo: string
    nome: string
    unidade: string
    sentido: 'MAIOR_MELHOR' | 'MENOR_MELHOR'
    /** Casas decimais com que exibir o valor. Vem do backend; ver formato.ts. */
    casasDecimais: number
  }
  filial: { sigla: string; nome: string }
  periodo: { modo: 'mes' | 'ano'; ano: number; mes: number | null; rotulo: string }
  realizado: number | null
  meta: number | null
  desvio: number | null
  situacao: Situacao | null
  aderencia: number | null
  grafico: {
    /** A escala que a série TEM — o backend decide, a tela obedece. */
    escala: 'semanal' | 'mensal'
    plota: 'desvio' | 'valor'
    escalaY: AncoraEixo[]
    yMeta: number
    pontos: Array<{
      rotulo: string
      /** Desvio do ponto sobre a meta — rótulo discreto no gráfico. */
      desvio: number | null
      valor: number | null
      valorIndicador: number | null
      y: number | null
      de: string
      ate: string
    }>
  }
  variaveis: Array<{ id: string; nome: string; unidade: string }>
}

/**
 * O ESCOPO do desdobramento, em três estados:
 *
 *   `'NOR'`     uma filial
 *   `null`      a REDE — as filiais da visão, somadas (o chip "Visão geral")
 *   `undefined` ainda não se sabe; a consulta fica desligada
 *
 * `null` e não um `Symbol`, e a diferença custou um defeito: o Symbol vinha do
 * módulo, e o Vite recarregando este arquivo criava um NOVO enquanto o estado
 * da tela ainda guardava o antigo. A comparação `filial === REDE` passava a
 * dar falso, o código caía no `encodeURIComponent` e estourava com "Cannot
 * convert a Symbol value to a string" — só depois de um hot reload, que é o
 * pior momento para um defeito aparecer.
 *
 * `null` tem identidade estável em qualquer recarga, e continua não podendo
 * colidir com sigla de filial.
 */
export function useIndicador(
  codigo: string | undefined,
  filial: string | null | undefined,
  opcoes: { escala?: 'mensal' } = {},
) {
  const { periodo } = usePeriodo()
  const visao = useVisao()

  const params = new URLSearchParams({ modo: periodo.modo, ano: String(periodo.ano) })
  if (periodo.modo === 'mes') params.set('mes', String(periodo.mes))
  if (opcoes.escala) params.set('escala', opcoes.escala)

  const query = comVisao(params, visao.params)

  const escopo = filial === null ? 'consolidado/rede' : encodeURIComponent(filial ?? '')

  return useQuery({
    queryKey: [
      'indicador',
      codigo,
      filial ?? 'rede',
      periodo.modo,
      periodo.ano,
      periodo.mes,
      opcoes.escala ?? 'auto',
      visao.chave,
    ],
    queryFn: () =>
      api.get<Indicador>(`/indicadores/${encodeURIComponent(codigo!)}/${escopo}?${query}`),
    // `null` é a rede, e É um pedido válido. Só `undefined` desliga.
    enabled: Boolean(codigo) && filial !== undefined,
  })
}

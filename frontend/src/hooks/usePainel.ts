import { useQuery } from '@tanstack/react-query'
import { usePeriodo } from '../contexts/PeriodoContext.js'
import { comVisao, useVisao } from '../contexts/VisaoContext.js'
import { api, type VisaoAplicada } from '../lib/api.js'

/**
 * A cor segue o SENTIDO do indicador: em Perdas e Custo, ficar abaixo da meta
 * e' bom, entao desvio negativo e' 'acima'.
 *
 * Quem decide e' o BACKEND, em pontos absolutos e nao em percentual: NPS 71
 * contra meta 75 e' amarelo, mas os mesmos 4 pontos dao -5,33%, que num limiar
 * percentual de 5 viraria vermelho.
 *
 * 'atencao' (amarelo) aparece em NPS e Perdas; 'otimo' (azul) so' em Perdas, que
 * tem quatro faixas vindas do dashboard da area. Vendas e Custo sao binarios.
 */
export type Situacao = 'otimo' | 'acima' | 'atencao' | 'abaixo'

export interface Painel {
  periodo: { modo: 'mes' | 'ano'; ano: number; mes: number | null; rotulo: string }
  filiais: Array<{ sigla: string; nome: string }>
  /** Recorte que o servidor aplicou — não necessariamente o que o seletor pediu. */
  visao: VisaoAplicada
  indicadores: Array<{
    codigo: string
    nome: string
    unidade: string
    sentido: 'MAIOR_MELHOR' | 'MENOR_MELHOR'
    metaRotulo: string | null
    /** Casas decimais com que exibir o valor. Vem do backend; ver formato.ts. */
    casasDecimais: number
    foraDaMeta: number
    /**
     * Alguma gerência acompanha variável de controle deste indicador.
     *
     * Falso = não existe reunião de N3 dele, e a célula da matriz **não leva a
     * lugar nenhum** (§7.63). Hoje só `vendas` é verdadeiro; NPS e Perdas
     * aparecem no quadro do N2 e ainda não têm reunião cadastrada.
     *
     * Vem do servidor pela mesma razão de `situacao`: é a mesma pergunta que o
     * quadro do N3 responde, e uma lista cravada aqui passaria a discordar dele
     * no dia em que NPS fosse cadastrado.
     */
    temReuniao: boolean
    /**
     * O número DA REDE. `null` quando nenhuma filial tem dado, ou quando o
     * indicador é razão e falta a base para somá-la -- ver `consolidar` no
     * backend, que se recusa a mediar percentuais.
     */
    consolidado: {
      valor: number | null
      meta: number | null
      desvio: number | null
      situacao: Situacao | null
      filiais: number
    } | null
    celulas: Array<{
      filial: string
      valor: number | null
      meta: number | null
      desvio: number | null
      situacao: Situacao | null
    }>
  }>
}

/** Matriz do painel para o período global corrente. */
export function usePainel() {
  const { periodo } = usePeriodo()
  const visao = useVisao()

  const params = new URLSearchParams({ modo: periodo.modo, ano: String(periodo.ano) })
  if (periodo.modo === 'mes') params.set('mes', String(periodo.mes))

  const query = comVisao(params, visao.params)

  return useQuery({
    // A visão entra na chave: sem ela, trocar de N2 para N4 devolveria o cache
    // do recorte anterior e a tela não mudaria.
    queryKey: [
      'painel',
      periodo.modo,
      periodo.ano,
      periodo.modo === 'mes' ? periodo.mes : null,
      visao.chave,
    ],
    queryFn: () => api.get<Painel>(`/painel?${query}`),
  })
}

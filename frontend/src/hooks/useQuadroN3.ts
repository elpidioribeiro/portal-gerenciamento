import { useQueries } from '@tanstack/react-query'
import {
  variaveisApi,
  type AreaPerformance,
  type AreaVendedor,
  type Gerencia,
  type PerformanceVendas,
  type PerformanceVendedor,
} from '../lib/api.js'

/**
 * Os números de TODAS as gerências, no componente pai.
 *
 * Existe porque três coisas da tela do N3 só podem ser calculadas com a loja
 * inteira em mãos, e nenhuma delas cabia enquanto cada cartão buscava o próprio
 * KPI (§7.38):
 *
 *   1. o CONSOLIDADO da loja — quanto falta em R$ para a meta da semana;
 *   2. a ordem PIORES PRIMEIRO, que é o que faz o olho começar onde dói;
 *   3. a contagem de áreas fora da meta, que atravessa as gerências.
 *
 * `useQueries` e não um `useQuery` por gerência num `.map`: o número de
 * gerências varia por filial, e chamar hook dentro de laço quebra a regra dos
 * hooks na primeira loja com um número diferente. Ele também compartilha o
 * cache com `usePerformanceVendas`/`Vendedor` — mesma `queryKey`, então abrir a
 * tela do N4 depois não refaz as consultas.
 */

export interface NumerosDaGerencia {
  gerencia: Gerencia
  /*
   * Os tipos vêm das respostas, e não redigitados: `percentual` é anulável no
   * Vendedor ("ninguém na conta") e a `foraDaConta` viaja junto -- redeclarar a
   * forma aqui criaria uma segunda versão dela para envelhecer sozinha.
   */
  vendedor: PerformanceVendedor['gerencia']
  vendas: PerformanceVendas['gerencia']
  areasVendedor: AreaVendedor[]
  areasVendas: AreaPerformance[]
  /** Série semanal de Vendas, para a faísca e para o delta contra a semana anterior. */
  serieVendas: Array<number | null>
  serieVendedor: Array<number | null>
  carregando: boolean
}

export function useQuadroN3(
  gerencias: Gerencia[],
  ano: number,
  mes: number,
  semana: number,
): NumerosDaGerencia[] {
  const vendedor = useQueries({
    queries: gerencias.map((g) => ({
      queryKey: ['performance-vendedor', g.id, ano, mes, semana],
      queryFn: () => variaveisApi.performanceVendedor(g.id, { ano, mes, semana }),
    })),
  })
  const vendas = useQueries({
    queries: gerencias.map((g) => ({
      queryKey: ['performance-vendas', g.id, ano, mes, semana],
      queryFn: () => variaveisApi.performanceVendas(g.id, { ano, mes, semana }),
    })),
  })
  const series = useQueries({
    queries: gerencias.map((g) => ({
      queryKey: ['serie-semanal', g.id, ano, mes],
      queryFn: () => variaveisApi.serieSemanal(g.id, { ano, mes }),
      staleTime: 10 * 60_000,
    })),
  })

  return gerencias.map((g, i) => ({
    gerencia: g,
    vendedor: vendedor[i]?.data?.gerencia ?? null,
    vendas: vendas[i]?.data?.gerencia ?? null,
    areasVendedor: vendedor[i]?.data?.areas ?? [],
    areasVendas: vendas[i]?.data?.areas ?? [],
    serieVendas: series[i]?.data?.vendas.gerencia ?? [],
    serieVendedor: series[i]?.data?.vendedor.gerencia ?? [],
    carregando: (vendedor[i]?.isPending ?? true) || (vendas[i]?.isPending ?? true),
  }))
}

/**
 * O que falta em R$ para a meta — o número acionável.
 *
 * `null` quando não há meta: "faltam R$ 0" e "não sei quanto falta" são
 * respostas diferentes, e a primeira encerraria a conversa.
 *
 * Nunca negativo: quem passou da meta não tem o que faltar, e um número
 * negativo ali seria lido como dívida.
 */
export function quantoFalta(
  v: { numerador: number; denominador: number | null } | null | undefined,
): number | null {
  if (!v || v.denominador === null) return null
  return Math.max(0, v.denominador - v.numerador)
}

/**
 * Quanto o indicador andou desde a semana passada, em pontos percentuais.
 *
 * `null` na primeira semana do mês, e quando falta qualquer uma das duas
 * pontas: comparar contra o vazio produziria um delta gigante na estreia do
 * mês, que se lê como salto e é só ausência de histórico.
 */
export function deltaSemanal(serie: Array<number | null>, semana: number): number | null {
  const atual = serie[semana - 1]
  const anterior = serie[semana - 2]
  if (atual == null || anterior == null) return null
  return atual - anterior
}

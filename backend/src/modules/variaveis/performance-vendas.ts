/**
 * Performance Vendas — % de cumprimento da meta do mês, por área de venda.
 *
 * Módulo **puro**: recebe números, devolve números, não toca banco. É o que
 * permite testar a regra pelo nome dela, e é onde uma conta errada precisa ser
 * pega — ela não gera exceção, só um percentual plausível na tela.
 *
 * Ver PLANO §7.10.
 */

/** O que a variável precisa saber de uma área de venda no mês. */
export interface AreaNoMes {
  areaVendaId: string
  /** Vendido no mês até hoje, somado de `fato_venda_linha`. */
  vendido: number
  /** Meta do MÊS da área (`meta`, escopo `AREA_VENDA`). Nula = não cadastrada. */
  meta: number | null
}

export interface PerformanceVendas {
  areaVendaId: string
  /** Projeção de fechamento do mês. */
  numerador: number
  /** A meta do mês. */
  denominador: number | null
  /** `numerador / denominador` em %. Nulo quando não há meta. */
  percentual: number | null
}

/**
 * O fator que transforma vendido-até-hoje em projeção de fechamento.
 *
 * **Não reimplementamos a fórmula do BI.** Ela é
 * `(vendido no mês ÷ dias úteis decorridos) × dias úteis do mês`, e depende de
 * um calendário de dias úteis que o portal não tem — reimplementá-la exigiria
 * inventar esse calendário, e passaria a existir uma SEGUNDA fórmula de
 * projeção no sistema. Duas fórmulas divergem, e a divergência apareceria como
 * "a soma das áreas não bate com a filial" numa tela onde os dois números
 * aparecem lado a lado.
 *
 * Em vez disso, extraímos o fator da projeção que o BI já entrega para a
 * filial. Como o fator é o mesmo para todas as áreas e a soma do vendido das
 * áreas é igual ao da filial — a ingestão valida isso a cada carga —, a soma
 * das projeções das áreas dá **exatamente** a projeção da filial. Por
 * construção, não por conferência.
 *
 * A suposição que isso faz é explícita: **a área mantém a fatia que teve até
 * aqui pelo resto do mês.** É a melhor estimativa disponível sem calendário, e
 * é a mesma que o BI faz implicitamente ao projetar a filial inteira por média
 * de dia útil.
 */
export function fatorDeProjecao(vendidoFilial: number, tendenciaFilial: number): number {
  /*
   * Sem venda no mês não há fatia a projetar, e dividir daria infinito. Um
   * fator 1 diz "a projeção é o que já foi vendido", que com vendido zero é
   * zero — verdadeiro, e não contamina a soma.
   */
  if (vendidoFilial <= 0) return 1
  return tendenciaFilial / vendidoFilial
}

export function performanceVendas(areas: AreaNoMes[], fator: number): PerformanceVendas[] {
  return areas.map((a) => {
    const numerador = a.vendido * fator
    return {
      areaVendaId: a.areaVendaId,
      numerador,
      denominador: a.meta,
      /*
       * Meta ausente ou zero devolve `null`, não zero nem 100.
       *
       * Zero seria lido como "não vendeu nada" e 100 como "está na meta" — os
       * dois são afirmações sobre o desempenho, e o que se sabe é que a meta
       * não foi cadastrada. Ausência de meta não é desempenho.
       */
      percentual: a.meta === null || a.meta === 0 ? null : (numerador / a.meta) * 100,
    }
  })
}

/**
 * O rolo da gerência, e depois o da filial: soma numerador e denominador.
 *
 * **Nunca a média dos percentuais.** Promediar pesa uma área de R$ 200 mil
 * igual a uma de R$ 2 milhões, e o número da gerência deixa de ser o
 * cumprimento dela — vira a média de coisas de tamanhos diferentes.
 *
 * Áreas sem meta ficam de fora do denominador E do numerador: incluir a venda
 * de uma área cuja meta não existe inflaria o cumprimento da gerência com
 * realizado que não tem contra o que ser comparado.
 */
export function consolidar(itens: PerformanceVendas[]): PerformanceVendas | null {
  const comMeta = itens.filter((i) => i.denominador !== null && i.denominador > 0)
  if (comMeta.length === 0) return null

  const numerador = comMeta.reduce((a, i) => a + i.numerador, 0)
  const denominador = comMeta.reduce((a, i) => a + (i.denominador ?? 0), 0)

  return {
    areaVendaId: '',
    numerador,
    denominador,
    percentual: (numerador / denominador) * 100,
  }
}

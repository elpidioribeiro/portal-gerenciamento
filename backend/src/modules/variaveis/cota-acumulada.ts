/**
 * Rateio da cota mensal até um dia — ou até o fim de uma semana.
 *
 * Módulo **puro**. Ver PLANO §7.15.
 *
 * O problema que resolve: a cota do vendedor é MENSAL (`COTA_MENSAL`), a venda
 * dele é DIÁRIA, e a tela do N4 é SEMANAL. Comparar a venda de uma semana com a
 * cota do mês inteiro não responde nada.
 *
 *     cota até o dia D = COTA_MENSAL × dias úteis até D ÷ dias úteis do mês
 *
 * O divisor vem do calendário da própria filial (`dias-uteis.sql`), não de uma
 * contagem inventada aqui: feriado municipal derruba um dia útil em Gustavo e
 * não em Litoral, e ratear por dia corrido faria a mesma cota parecer mais
 * dura numa loja que na outra.
 */

/**
 * O último dia que entra na conta: **D-1**.
 *
 * Três razões, e a primeira é a que manda — as outras duas apenas concordam:
 *
 * - **A ORIGEM JÁ É D-1.** A tabela de vendas fecha o dia anterior; o dia
 *   corrente não está lá (analista, 27/08/2026). Cortar em D pediria ao
 *   calendário um dia que o realizado não tem — não é escolha de exibição, é o
 *   dado que existe.
 * - **A venda de hoje estaria pela metade.** A loja ainda está aberta. Meio dia
 *   de venda contra uma cota que já conta o dia inteiro deixa todo mundo
 *   atrasado, e o quadro fica vermelho por construção toda manhã.
 * - **A reunião pergunta pelo que aconteceu ontem.** É a sequência do GD: o que
 *   aconteceu → por quê → o que fazer hoje. Hoje é o que se decide, não o que
 *   se mede.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ A INVARIANTE: realizado e calendário usam O MESMO CORTE.                │
 * │                                                                         │
 * │ Somar a venda até D-1 e o dia útil até D infla a cota em um dia e       │
 * │ derruba o percentual de todo mundo -- sem erro e sem sintoma. No 20º de │
 * │ 26 dias úteis são 5% a mais exigidos de cada vendedor: o bastante para  │
 * │ mudar quem está na meta e quem não está.                                │
 * │                                                                         │
 * │ É um erro fácil de cometer justamente porque a origem já entrega D-1:   │
 * │ o realizado "parece" ser de hoje, e o calendário é lido com a data de   │
 * │ hoje. Os dois cortes têm de ser o MESMO, e é `corteDe` que o define.    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * No dia 1º do mês o corte cai no mês anterior, o acumulado do mês corrente é
 * zero, e `cotaAcumulada` devolve `null` — "ainda não há o que comparar", que é
 * a resposta certa.
 */
export function corteDe(hoje: Date): Date {
  const d = new Date(hoje)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - 1)
  return d
}

/** O calendário de dias úteis da filial, no dia em questão. */
export interface DiasUteis {
  /** Dias úteis decorridos no mês até e inclusive este dia. */
  acumulado: number
  /** Dias úteis do mês inteiro. */
  doMes: number
}

/**
 * A cota proporcional aos dias úteis já trabalhados.
 *
 * **Devolve `null` quando a pergunta não se aplica**, e são dois casos:
 *
 * - `doMes <= 0` — mês sem dia útil no calendário. Não há por que dividir, e o
 *   zero viraria divisão por zero ou `Infinity` conforme o caminho.
 * - `acumulado <= 0` — nenhum dia útil decorrido ainda. Aqui o cuidado é outro
 *   e mais sutil: a cota rateada daria **zero**, e qualquer realizado (inclusive
 *   zero) passaria em `realizado >= cota`. A tela mostraria 100% dos vendedores
 *   na meta no primeiro dia útil de janeiro, todo ano, sem erro nenhum.
 */
export function cotaAcumulada(cotaMensal: number, dias: DiasUteis): number | null {
  if (dias.doMes <= 0 || dias.acumulado <= 0) return null
  /*
   * Sem teto no acumulado, de propósito: se ele passar de `doMes`, o calendário
   * está inconsistente, e limitar em silêncio esconderia isso. A ingestão
   * confere `UTEIS_CALCULADOS` contra `QTUTIL` justamente para não chegar aqui.
   */
  return (cotaMensal * dias.acumulado) / dias.doMes
}

/**
 * Bateu quem alcançou a cota PROPORCIONAL até aquele ponto.
 *
 * O realizado é ACUMULADO no mês, não o da semana isolada — e a diferença é de
 * significado, não de conta. Um vendedor que foi mal na S1 e muito bem na S2
 * está *na meta* na S2 se o acumulado alcançou o acumulado da cota. É o que a
 * pergunta do GD quer saber: **dá para virar o mês?**
 *
 * Medir a semana isolada responderia outra coisa — "como foi esta semana" —, e
 * marcaria vermelho em quem já se recuperou.
 *
 * `null` quando a cota rateada não se aplica: não é "não bateu", é "ainda não
 * há o que comparar".
 */
export function bateuCotaAcumulada(
  realizadoAcumulado: number,
  cotaMensal: number,
  dias: DiasUteis,
): boolean | null {
  const cota = cotaAcumulada(cotaMensal, dias)
  if (cota === null) return null
  return realizadoAcumulado >= cota
}

/**
 * O corte de uma SEMANA do mês — o dia até onde a conta vai.
 *
 * Performance Vendas e Performance Vendedor respondem "como estamos" num
 * ponto do tempo: uma projeta o mês a partir do acumulado, a outra compara o
 * acumulado com a cota rateada. Escolher a semana é **mover esse ponto**, não
 * trocar a conta — é por isso que existe uma função só, e não duas.
 *
 * Quatro limites, e vence o menor:
 *
 *  1. o **fim da semana** pedida;
 *  2. **D-1**, porque a origem fecha o dia anterior (ver `corteDe`);
 *  3. o **fim do mês**, para um mês passado usar o mês inteiro;
 *  4. a **janela da carga**, quando ela ficou para trás — senão a cota é
 *     rateada por dias úteis que o realizado ainda não tem.
 *
 * Devolve `null` em dois casos, e os dois são "ainda não há o que comparar":
 *
 *  - o corte cai antes do começo do mês — o mês não começou;
 *  - **a semana pedida ainda não começou** — o primeiro dia dela é posterior ao
 *    corte. Sem esta segunda, o `min` acima devolveria D-1 para uma semana
 *    futura, e ela apareceria com o MESMO número da semana corrente: na faísca,
 *    um segmento reto que parece dado e não é. Medido em 29/08/2026 — a S5 de
 *    agosto (31/08) vinha com 58,5%, igual à S4.
 *
 * **Sem semana, o corte é o de sempre.** É o mesmo caminho de antes, e é o que
 * mantém a tela mensal respondendo igual.
 */
export function corteDaSemana(p: {
  ano: number
  mes: number
  /** 1–5. Ausente = o mês até o corte, como antes. */
  semana?: number | undefined
  /** Fim da semana pedida, de `semanasDoMes`. Ausente quando `semana` é. */
  fimDaSemana?: Date | undefined
  /** Começo da semana pedida. É ele que diz se ela já aconteceu. */
  deDaSemana?: Date | undefined
  hoje: Date
  /** Último dia coberto pela carga. Ausente = sem limite (testes, ambiente novo). */
  ateACarga?: Date | undefined
}): Date | null {
  const primeiroDoMes = new Date(Date.UTC(p.ano, p.mes - 1, 1))
  const ultimoDoMes = new Date(Date.UTC(p.ano, p.mes, 0))

  const candidatos = [corteDe(p.hoje), ultimoDoMes]
  if (p.fimDaSemana) candidatos.push(p.fimDaSemana)
  if (p.ateACarga) candidatos.push(p.ateACarga)

  const corte = candidatos.reduce((menor, d) => (d < menor ? d : menor))
  if (corte < primeiroDoMes) return null
  // A semana ainda não começou: nada aconteceu nela para medir.
  if (p.deDaSemana && p.deDaSemana > corte) return null
  return corte
}

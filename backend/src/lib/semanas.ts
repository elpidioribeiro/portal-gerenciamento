import { addDays } from 'date-fns'

/**
 * Módulo puro de propósito: só aritmética de calendário, sem depender de
 * configuração. Antes ele importava o fuso de `datas.ts`, que carrega `env.ts`
 * — e aí calcular semanas exigia DATABASE_URL definida, o que quebra qualquer
 * teste ou script que só queira as datas.
 *
 * Quem precisa de "hoje" passa a data como parâmetro.
 */

/**
 * Semanas do mês. **É a definição única do quadro** — KPI, faísca, grade de
 * marcação e Pareto leem daqui, e as quatro têm de concordar sobre o que é S3.
 *
 * A semana vai de **segunda a domingo**. Três regras, decisão do analista
 * (28/08/2026), e as duas últimas existem para nenhum dia de venda sumir:
 *
 *  1. **A S1 começa no DIA 1**, quando ele é dia útil. Antes ela começava na
 *     primeira segunda-feira, e os dias anteriores não apareciam em semana
 *     nenhuma — medido em 2026: sete dos doze meses perdiam dias assim, e
 *     setembro e dezembro perdiam seis cada.
 *  2. **Salvo se o dia 1 cair em sábado ou domingo.** Aí a S1 começa na segunda
 *     seguinte, e esses um ou dois dias ficam de fora mesmo. É o único caso, e
 *     é deliberado: uma semana que começasse no sábado teria o fim de semana na
 *     frente, e o primeiro dia útil dela — de onde sai a fotografia — seria a
 *     segunda, já dentro da semana seguinte.
 *  3. **A última semana é cortada no fim do mês.** Sem o corte, agosto/2026
 *     teria S5 de 31/08 a 06/09 e setembro teria S1 em 01/09: os mesmos seis
 *     dias contados em dois meses.
 *
 * **Consequência aceita: a primeira e a última semana podem ter menos de 7
 * dias.** A objeção antiga a isso era peso desigual na média — mas o valor da
 * semana não é média, é FOTOGRAFIA: a projeção registrada no primeiro dia útil
 * dela (ver `modules/indicadores/serie.ts`). Uma fotografia não depende de
 * quantos dias a semana tem.
 */

export interface SemanaDoMes {
  /** 1-based, na ordem em que aparecem no eixo X. */
  numero: number
  /** Segunda-feira, início da semana. */
  de: Date
  /** Domingo, fim da semana. */
  ate: Date
  rotulo: string
}

/** Dia da semana com segunda = 0 … domingo = 6. */
function diaDaSemanaSegundaZero(d: Date): number {
  return (d.getUTCDay() + 6) % 7
}

export function semanasDoMes(ano: number, mes: number): SemanaDoMes[] {
  const primeiroDia = new Date(Date.UTC(ano, mes - 1, 1))
  const ultimoDia = new Date(Date.UTC(ano, mes, 0))
  const dia1 = diaDaSemanaSegundaZero(primeiroDia)

  /*
   * O dia 1 abre a S1, a não ser que caia em sábado (5) ou domingo (6) — aí a
   * S1 começa na segunda seguinte. Ver a regra 2 no comentário do módulo.
   */
  const fimDeSemana = dia1 >= 5
  let inicio = fimDeSemana ? addDays(primeiroDia, (7 - dia1) % 7) : primeiroDia

  const semanas: SemanaDoMes[] = []
  while (inicio <= ultimoDia) {
    /*
     * O fim é o domingo daquela semana, cortado no último dia do mês. As duas
     * pontas podem ser parciais: a S1 quando o mês começa no meio da semana, a
     * última sempre que o mês não termina num domingo.
     */
    const domingo = addDays(inicio, 6 - diaDaSemanaSegundaZero(inicio))
    const fim = domingo > ultimoDia ? ultimoDia : domingo
    semanas.push({
      numero: semanas.length + 1,
      de: inicio,
      ate: fim,
      rotulo: `Sem ${semanas.length + 1}`,
    })
    inicio = addDays(fim, 1)
  }

  return semanas
}

/** Meses do ano, para o eixo X no modo anual. */
export function mesesDoAno(ano: number): Array<{ numero: number; de: Date; ate: Date; rotulo: string }> {
  const rotulos = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return rotulos.map((rotulo, i) => ({
    numero: i + 1,
    de: new Date(Date.UTC(ano, i, 1)),
    ate: new Date(Date.UTC(ano, i + 1, 0)),
    rotulo,
  }))
}

/**
 * Verdadeiro quando o mês/ano informado é o corrente.
 * `hoje` é parâmetro para o chamador decidir o fuso — e para o teste poder
 * fixar a data em vez de depender de quando roda.
 */
export function ehMesCorrente(ano: number, mes: number | undefined, hoje: Date): boolean {
  if (mes === undefined) return false
  return hoje.getFullYear() === ano && hoje.getMonth() + 1 === mes
}

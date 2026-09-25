/**
 * AS CORES DOS GRÁFICOS — uma fonte, para os três níveis desenharem igual.
 *
 * **Por que hex e não classe do Tailwind:** SVG pinta por `stroke` e `fill`, e
 * barras posicionadas pintam por `style` — nenhum dos dois aceita classe. Os
 * valores são os mesmos de `ok.ponto`, `risco.ponto`, `critico.ponto` e
 * `otimo.ponto` do `tailwind.config.ts`.
 *
 * **Por que num arquivo só:** estavam em DOIS lugares, e o segundo nem sabia
 * que era uma paleta — o gráfico do N2 tinha `COR_SITUACAO` com esta mesma
 * explicação no comentário, e o histórico do N3 e do N4 tinha `'#27ae60'` e
 * `'#e74c3c'` escritos soltos no meio do JSX, em minúsculas.
 *
 * Funcionava porque os valores coincidiam. Coincidência não é identidade: a
 * primeira mudança de paleta feita num lado só deixaria o verde do N2 diferente
 * do verde do N4, e ninguém veria até comparar as duas telas lado a lado —
 * que é o que o analista fez em 14/09/2026.
 */

/** O farol de um ponto, na mesma escala das células do quadro. */
export const COR_SITUACAO = {
  otimo: '#3581D8',
  acima: '#27AE60',
  atencao: '#F39C12',
  abaixo: '#E74C3C',
} as const

export type SituacaoDoGrafico = keyof typeof COR_SITUACAO

/**
 * A RÉGUA DA META — laranja fixo, e não a cor do status.
 *
 * A meta é uma referência, não um resultado: ela não muda de cor com o que
 * aconteceu. Pintá-la de verde quando o mês fecha acima faria a linha dizer
 * duas coisas ao mesmo tempo.
 */
export const COR_META = '#F0A020'

/**
 * SÉRIE SEM PATAMAR — cinza, e a escolha é do §7.37.
 *
 * Performance Vendedor é "% do quadro apto que bateu a cota", e **ninguém
 * definiu um alvo**. Pintar de verde ou vermelho exigiria um patamar que não
 * existe, e a cor afirmaria um julgamento que o indicador não faz.
 *
 * É `texto.ter` — o mesmo cinza dos rótulos, de propósito: a série tem peso de
 * informação, não de veredito.
 */
export const COR_SEM_PATAMAR = '#8592A8'

/** A linha da série no gráfico do N2 — navy da marca. */
export const COR_SERIE = '#001F3F'

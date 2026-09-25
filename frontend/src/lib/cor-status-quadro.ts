import type { CSSProperties } from 'react'
import type { StatusAcao } from './api.js'

/**
 * A cor do status DENTRO das telas de reunião — em variáveis CSS, não em
 * classes do Tailwind.
 *
 * É o mesmo significado do `COR_STATUS` de `api.ts`, noutra moeda: a lista de
 * Ações é feita de utilitárias, e as reuniões do N3 e do N4 são feitas de CSS
 * próprio, portado do protótipo (`docs/demo-n4.html`). Traduzir um no outro
 * seria inventar aproximações dos valores que o protótipo fixa.
 *
 * Morava dentro do `ReuniaoN4.tsx`. Saiu de lá em 11/09/2026, quando o bloco
 * "o que já está sendo feito" virou componente para servir as duas reuniões:
 * o mapa foi junto, senão a segunda tela teria a própria cópia — e de duas
 * cópias é sempre a segunda que fica para trás.
 *
 * `Record<StatusAcao, …>` e não `Record<string, …>`: era string, e por isso o
 * compilador não avisou nada quando `REJEITADA` nasceu. O status novo apareceu
 * na tela sem cor e sem rótulo, e a descoberta foi visual.
 */
export const COR_STATUS_QUADRO: Record<StatusAcao, CSSProperties> = {
  ATRASADA: {
    background: 'var(--cri-bg)',
    borderColor: 'var(--cri-borda)',
    color: 'var(--cri-texto)',
  },
  EM_ANDAMENTO: {
    background: 'var(--and-bg)',
    borderColor: 'var(--and-borda)',
    color: 'var(--and-texto)',
  },
  /*
   * Paleta de ESCALAÇÃO, a mesma do `CardAcao`: rejeitar não é erro, é a cadeia
   * de ajuda devolvendo. O vermelho aqui é do prazo vencido, e os dois andam
   * juntos com frequência.
   */
  REJEITADA: {
    background: 'var(--esc-bg)',
    borderColor: 'var(--esc-borda)',
    color: 'var(--esc-texto)',
  },
  AGUARDANDO_FEEDBACK: {
    background: 'var(--ris-bg)',
    borderColor: 'var(--ris-borda)',
    color: 'var(--ris-texto)',
  },
  CONCLUIDA: {
    background: 'var(--ok-bg)',
    borderColor: 'var(--ok-borda)',
    color: 'var(--ok-texto)',
  },
}

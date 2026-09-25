/**
 * O vocabulário que mais de uma tela usa para dizer QUEM está olhando.
 *
 * Saiu de dentro de `QuadroIndicadores` quando a tela de pontos de causa
 * passou a precisar da mesma linha ("N2 · DIRETORIA · 9 FILIAIS"). Copiar três
 * linhas teria sido mais rápido e é exatamente o erro que o PLANO registra em
 * §7.19: duas cópias da mesma regra não dão erro quando divergem — uma tela
 * simplesmente passa a chamar a pessoa de outra coisa.
 */

/**
 * Como cada nível se chama por extenso, para quem não fala em siglas.
 *
 * **O N2 não é só a diretoria** (12/09/2026). Os perfis mapeados nesse nível
 * incluem gerências corporativas — Prevenção de Perdas, Integração de Estoques,
 * Operações —, e chamar tudo de "Diretoria" descrevia errado a
 * maior parte de quem entra por lá.
 */
export const ROTULO_NIVEL: Record<string, string> = {
  N2: 'Diretoria e Gerência Corporativa',
  N3: 'Gerência geral',
  N4: 'Gerência adjunta',
}

/** `1 filial` · `9 filiais` — o plural num lugar só. */
export function contar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

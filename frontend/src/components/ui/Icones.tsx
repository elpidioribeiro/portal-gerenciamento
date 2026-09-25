/**
 * Ícones do handoff — SVG inline, viewBox 24×24, stroke 1.8, caps e joins
 * redondos. Os paths são literais da spec (`spec-header-portal-gd.md`,
 * seção "Ícones"). Sem emoji em lugar nenhum do produto.
 */

interface PropsIcone {
  /** Tamanho em px (o handoff usa 12–20). */
  tamanho?: number
  cor?: string
  espessura?: number
  className?: string
}

function Base({
  tamanho = 15,
  cor = 'currentColor',
  espessura = 1.8,
  className,
  children,
}: PropsIcone & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={tamanho}
      height={tamanho}
      fill="none"
      stroke={cor}
      strokeWidth={espessura}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function IconeCalendario(p: PropsIcone) {
  return (
    <Base {...p}>
      <rect x={3} y={4.5} width={18} height={16} rx={2.5} />
      <path d="M3 9.5h18" />
      <path d="M8 2.8v3.4" />
      <path d="M16 2.8v3.4" />
    </Base>
  )
}

export function IconeChevronBaixo(p: PropsIcone) {
  return (
    <Base espessura={2} {...p}>
      <path d="M6 9.5 12 15.5 18 9.5" />
    </Base>
  )
}

export function IconeChevronDireita(p: PropsIcone) {
  return (
    <Base espessura={2} {...p}>
      <path d="M9 5l7 7-7 7" />
    </Base>
  )
}

export function IconeRelogio(p: PropsIcone) {
  return (
    <Base {...p}>
      <circle cx={12} cy={12} r={9} />
      <path d="M12 7v5.2l3.3 2" />
    </Base>
  )
}

/** Seta de retorno — pílula de instrução do painel. */
export function IconeRetorno(p: PropsIcone) {
  return (
    <Base {...p}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 5 5v6" />
    </Base>
  )
}

/** Escudo — área de administração. Controle de acesso, não configuração geral. */
export function IconeEscudo(p: PropsIcone) {
  return (
    <Base {...p}>
      <path d="M12 3l7.5 3v6c0 4.2-3 7.8-7.5 9-4.5-1.2-7.5-4.8-7.5-9V6z" />
    </Base>
  )
}

/** Lupa — busca no catálogo de perfis. */
export function IconeBusca(p: PropsIcone) {
  return (
    <Base {...p}>
      <circle cx={10.5} cy={10.5} r={6.5} />
      <path d="M15.5 15.5 21 21" />
    </Base>
  )
}

/** Confere — item selecionado, salvo com sucesso. */
export function IconeConfere(p: PropsIcone) {
  return (
    <Base espessura={2.2} {...p}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Base>
  )
}

/**
 * Triângulo de atenção — faixa de visão simulada.
 *
 * Distinto do escudo de propósito: o escudo é "você está na área de
 * administração", este é "o que você está vendo não é o seu".
 */
export function IconeAtencao(p: PropsIcone) {
  return (
    <Base {...p}>
      <path d="M12 4.2 21 19.5H3z" />
      <path d="M12 9.8v4.2" />
      <path d="M12 16.6h.01" />
    </Base>
  )
}

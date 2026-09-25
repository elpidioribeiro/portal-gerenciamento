import { Link } from 'react-router-dom'
import { COR_STATUS, ROTULO_STATUS, type ResumoAcao, type StatusAcao } from '../../lib/api.js'
import type { Relacao } from '../../hooks/useAcoes.js'

/**
 * A cor do status. Atrasada é a única vermelha: prioridade Alta não é problema,
 * é classificação — pintar as duas de vermelho apaga a diferença.
 */
const PONTO_STATUS: Record<StatusAcao, string> = {
  EM_ANDAMENTO: 'bg-risco-ponto',
  ATRASADA: 'bg-critico-ponto',
  REJEITADA: 'bg-escala-ponto',
  AGUARDANDO_FEEDBACK: 'bg-risco-ponto',
  CONCLUIDA: 'bg-ok-ponto',
}

const COR_PRIORIDADE = {
  ALTA: 'bg-critico-bg border-critico-borda text-critico-texto',
  MEDIA: 'bg-risco-bg border-risco-borda text-risco-texto',
  BAIXA: 'bg-superficie border-borda text-texto-sec',
} as const

const ROTULO_PRIORIDADE = { ALTA: 'Alta', MEDIA: 'Média', BAIXA: 'Baixa' } as const

/**
 * O marcador de RELAÇÃO — o que a ação é para mim.
 *
 * Forma deliberadamente diferente da pílula de status (barra à esquerda, caixa
 * alta, acima do título) porque os dois eixos já se confundiram uma vez: status
 * e relação disputavam o mesmo badge, e o atraso ficava escondido atrás de
 * "escalada". Ver PLANO §7.5.
 */
function Relacional({ relacao, acao }: { relacao: Relacao; acao: ResumoAcao }) {
  if (relacao === 'concluida') return null

  if (relacao === 'afazer') {
    const feedback = acao.status === 'AGUARDANDO_FEEDBACK'
    return (
      <span className="self-start border-l-[3px] border-brand-btn pl-2 text-eyebrow uppercase text-brand-btn">
        A fazer{feedback ? ' · dar feedback' : ''}
      </span>
    )
  }

  if (relacao === 'escalada') {
    const onde = acao.trilha.at(-1)
    return (
      <span className="self-start border-l-[3px] border-escala-ponto pl-2 text-eyebrow uppercase text-escala-texto">
        ↑ Escalada{onde ? ` · no ${onde.nivel}` : ''}
      </span>
    )
  }

  /*
   * REJEITADA precisa de linha própria, e a falta dela era um defeito de
   * FALLBACK: o último `return` desta função é o rótulo de "Nível abaixo", e
   * toda relação nova cai nele sem avisar. A ação rejeitada apareceu no quadro
   * rotulada como se fosse do nível de baixo.
   *
   * O compilador não pega isto: `Relacao` ganhou um valor e a função continuou
   * válida, porque o `return` final atende qualquer coisa. Um `switch` com
   * `never` no default pegaria -- fica anotado como a forma certa no dia em que
   * aparecer a quarta relação.
   *
   * ↓ e não ↑: escalar sobe, rejeitar devolve. A seta é a mesma gramática do
   * rótulo de escalada, no sentido contrário.
   */
  if (relacao === 'rejeitada') {
    /*
     * SEM SUFIXO, ao contrário do rótulo de escalada.
     *
     * Chegou a dizer "devolvida ao N4", lendo o último passo da trilha. O dado
     * estava certo e o texto era ruim por duas razoes: "devolvida ao N2" se lê
     * tão facilmente como "devolvida PELO N2", e a trilha completa aparece dois
     * centímetros abaixo, no próprio card -- o sufixo repetia o que ela mostra
     * melhor.
     *
     * O "no N3" da escalada continua fazendo falta ali porque aquela ação está
     * VIVA em outro nível: dizer onde ela está agora é a informação. Esta está
     * fechada; onde ela parou é histórico, e histórico é trilha.
     */
    return (
      <span className="self-start border-l-[3px] border-escala-ponto pl-2 text-eyebrow uppercase text-escala-texto">
        ↓ Rejeitada
      </span>
    )
  }

  /**
   * DIRECIONADA — a ação está no meu nível, e na mão de outra pessoa.
   *
   * Duas portas levam aqui, e são a mesma coisa vista do lado de quem entrega:
   * `direcionar` (do N2, troca o dono e mantém o nível) e abrir ação para um
   * par (§7.72). Palavra do analista: *"é a mesma coisa do direcionar"*.
   *
   * → e não ↑ nem ↓: não subiu nem voltou, andou de lado. Com o nome de quem
   * está com ela, que é o que falta saber -- diferente da rejeitada, cuja
   * história já está na trilha logo abaixo.
   */
  if (relacao === 'direcionada') {
    return (
      <span className="self-start border-l-[3px] border-andamento-borda pl-2 text-eyebrow uppercase text-andamento-texto">
        → Direcionada · {acao.responsavel}
      </span>
    )
  }

  /*
   * NÍVEL ABAIXO é o último, e agora é o último POR SER O QUE SOBROU — não por
   * ser um `else` que atende qualquer coisa.
   *
   * O comentário da rejeitada, acima, anotava o `never` como "a forma certa no
   * dia em que aparecer a quarta relação". O dia chegou com `direcionada`. Com
   * todas as relações tratadas explicitamente, o TypeScript já estreita
   * `relacao` a `'nivelAbaixo'` aqui — e uma relação nova passa a quebrar a
   * compilação nesta linha, em vez de aparecer no card com o rótulo de outra
   * coisa, que foi o defeito da rejeitada.
   */
  const sobrou: 'nivelAbaixo' = relacao
  void sobrou
  return (
    <span className="self-start border-l-[3px] border-texto-off pl-2 text-eyebrow uppercase text-texto-ter">
      Nível abaixo
    </span>
  )
}

/**
 * Por onde a ação passou, com o tempo em cada nível.
 *
 * O tempo é o que faz a trilha valer: sem ele seria organograma. Com ele o card
 * responde a pergunta 2 da reunião — o que foi tentado e por que não resolveu —
 * cujo propósito é verificar se a cadeia de ajuda funcionou.
 *
 * Um passo só significa que nunca foi escalada, e aí a trilha é ruído.
 */
const DIAS_PARADA = 10

function Trilha({ trilha }: { trilha: ResumoAcao['trilha'] }) {
  if (trilha.length < 2) return null
  const ultimo = trilha.length - 1

  return (
    <span className="flex flex-wrap items-center gap-1.5 rounded-controle bg-superficie-header px-2.5 py-2">
      <span className="mr-0.5 text-eyebrow uppercase text-texto-ter">Passou por</span>
      {trilha.map((p, i) => (
        <span key={`${p.nivel}-${i}`} className="flex items-baseline gap-1.5">
          {i > 0 && <span className="text-micro text-texto-off">→</span>}
          <span
            className={`inline-flex items-center rounded px-1.5 text-badge ${
              i === ultimo ? 'bg-navy-medio text-white' : 'bg-borda-hover/40 text-navy-medio'
            }`}
          >
            {p.nivel}
          </span>
          <span className={`text-micro ${i === ultimo ? 'font-bold text-texto' : 'text-texto-sec'}`}>
            {p.quem}
          </span>
          <span
            className={`text-micro ${
              i === ultimo && p.dias >= DIAS_PARADA
                ? 'font-bold text-critico-texto'
                : i === ultimo
                  ? 'font-bold text-texto-ter'
                  : 'text-texto-ter'
            }`}
          >
            {p.dias}d
          </span>
        </span>
      ))}
    </span>
  )
}

export function CardAcao({ acao, relacao }: { acao: ResumoAcao; relacao: Relacao }) {
  return (
    <Link
      to={`/contramedida/${acao.codigo}`}
      className="flex gap-2.5 border-t border-borda-sutil px-5 py-4 text-left hover:bg-superficie-hover"
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PONTO_STATUS[acao.status]}`} />
      <span className="flex min-w-0 flex-grow flex-col gap-2">
        <Relacional relacao={relacao} acao={acao} />
        <span className="text-corpo-forte">{acao.titulo}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {/*
            O CHIP DE STATUS SOME quando o rótulo de cima já disse a mesma
            palavra -- *"pode tirar o nome Rejeitada que tem embaixo, já tem em
            cima"*.

            Só acontece com a rejeitada: `Relacional` devolve "A fazer",
            "↑ Escalada" e "↓ Rejeitada", e destes três apenas o último é o
            próprio nome do status. Numa ação concluída o rótulo de cima nem
            existe (devolve `null`), e o chip é a única coisa que diz o estado --
            por isso a regra é esta, e não "esconder o chip quando há rótulo".
          */}
          {relacao !== 'rejeitada' && (
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-badge ${COR_STATUS[acao.status]}`}
            >
              {ROTULO_STATUS[acao.status]}
            </span>
          )}
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-badge ${COR_PRIORIDADE[acao.prioridade]}`}
          >
            {ROTULO_PRIORIDADE[acao.prioridade]}
          </span>
          <span className="text-legenda font-bold text-navy-medio">{acao.codigo}</span>
        </span>
        <Trilha trilha={acao.trilha} />
        <span className="text-legenda text-texto-ter">
          {acao.filial} · {acao.responsavel} · {acao.diasEmAberto} dias
        </span>
      </span>
    </Link>
  )
}

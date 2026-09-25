import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSessao } from '../contexts/SessaoContext.js'
import { acoesApi, type NivelAcao, type ResumoAcao } from '../lib/api.js'

/**
 * A RELAÇÃO do usuário com a ação — o outro eixo, ao lado do status.
 *
 * Status é da ação e vem do servidor. Isto é de quem olha, e por isso é
 * calculado aqui: depende de quem está logado, não da ação.
 *
 *  - `afazer`     — exige algo de você: é seu, ou você abriu e falta seu feedback
 *  - `escalada`   — está num nível acima do seu
 *  - `nivelAbaixo`— visão gerencial do nível de baixo
 *  - `rejeitada`  — foi devolvida e está FECHADA: ninguém mais age nela
 *  - `concluida`  — o ciclo fechou
 *
 * Ver PLANO §7.5.
 */
export type Relacao =
  | 'afazer'
  | 'direcionada'
  | 'escalada'
  | 'nivelAbaixo'
  | 'rejeitada'
  | 'concluida'

/** A escada, da base ao topo. CROSS fica fora: é eixo de apoio, não degrau. */
const ESCADA: NivelAcao[] = ['N4', 'N3', 'N2']

/**
 * O degrau logo abaixo do seu — `N3` → `N4`.
 *
 * A aba dizia só "Nível abaixo", que é a relação e não o lugar: quem olha sabe
 * em que nível está, e precisa saber de qual nível são aquelas ações. `null` na
 * base da escada e no CROSS, que não é degrau.
 */
export function nivelAbaixoDe(meuNivel: NivelAcao): NivelAcao | null {
  const i = ESCADA.indexOf(meuNivel)
  return i > 0 ? (ESCADA[i - 1] ?? null) : null
}

/**
 * O DEGRAU DECIDE PRIMEIRO, e agora por CONSTRUÇÃO.
 *
 * Esta função era uma escada de `return` cedo, e produziu **três vezes o mesmo
 * defeito**: um estado novo escrito no topo atravessava a comparação de nível e
 * mandava a ação para o quadro de outra pessoa. Não dá erro, não quebra teste —
 * só aparece quando alguém olha a tela de outro usuário e estranha.
 *
 *   §7.39  `AGUARDANDO_FEEDBACK` atravessava; a correção foi a guarda `criadoPorMim`
 *   §7.69  `REJEITADA` atravessava; a correção foi descer a linha
 *   14/09  `CONCLUIDA` atravessava; a correção foi descer a linha OUTRA VEZ
 *
 * Descer a linha conserta o caso e não a causa — a quarta vez estava escrita no
 * arquivo antes de acontecer. O analista: *"não podemos ter mais esses erros"*.
 *
 * **O que mudou:** o degrau é resolvido ANTES de qualquer estado, e cada degrau
 * tem a sua função, com o tipo de retorno ESTREITO. Escrever `'concluida'`
 * dentro de `abaixoDeMim` não compila — a relação errada deixou de ser um
 * descuido possível e virou erro de tipo.
 *
 * As regras não mudaram; só pararam de depender da ordem das linhas.
 */

/** A ação está num degrau abaixo do meu: eu ACOMPANHO, não respondo por ela. */
type RelacaoAbaixo = 'nivelAbaixo' | 'afazer'
/** No meu degrau: pode ser minha, de um par, ou já encerrada. */
type RelacaoNoMeu = 'afazer' | 'direcionada' | 'rejeitada' | 'concluida'
/** Acima: subiu, ou voltou rejeitada, ou fechou. */
type RelacaoAcima = 'escalada' | 'rejeitada' | 'concluida'

/**
 * ABAIXO DE MIM — visão gerencial (§7.5, §7.70).
 *
 * A ação do nível de baixo **nunca é minha**, esteja em que estado estiver. A
 * única exceção é a do §7.39, e ela é sobre a MINHA obrigação, não sobre a
 * ação: eu abri, ela foi executada, e o feedback é meu (§7.3). Por isso a
 * guarda é `criadoPorMim`, e não o estado sozinho.
 *
 * O tipo proíbe o resto: `concluida`, `rejeitada` e `escalada` não cabem aqui.
 */
function abaixoDeMim(a: ResumoAcao): RelacaoAbaixo {
  if (a.status === 'AGUARDANDO_FEEDBACK' && a.criadoPorMim) return 'afazer'
  return 'nivelAbaixo'
}

/**
 * NO MEU DEGRAU.
 *
 * `direcionada` existe porque ação no meu nível deixou de ser sempre minha:
 * `direcionar` troca o dono e MANTÉM o nível, e desde §7.72 abrir para um par
 * faz o mesmo. Relatado pelo analista — *"o n2-teste abriu a atividade para
 * Andre Pontes e no usuário dele tá 'a fazer'"*.
 */
function noMeuDegrau(a: ResumoAcao): RelacaoNoMeu {
  if (a.status === 'CONCLUIDA') return 'concluida'
  if (a.status === 'REJEITADA') return 'rejeitada'
  if (a.status === 'AGUARDANDO_FEEDBACK' && a.criadoPorMim) return 'afazer'
  return a.souOResponsavel ? 'afazer' : 'direcionada'
}

/**
 * ACIMA DE MIM — eu escalei, e continuo respondendo (§7.34).
 *
 * `REJEITADA` vence `escalada`: quem devolveu precisa ver "rejeitada". A ação
 * está acima dele porque ele a mandou de volta a quem abriu (§7.42), não porque
 * subiu.
 */
function acimaDeMim(a: ResumoAcao): RelacaoAcima {
  if (a.status === 'REJEITADA') return 'rejeitada'
  if (a.status === 'CONCLUIDA') return 'concluida'
  return 'escalada'
}

export function relacaoDa(a: ResumoAcao, meuNivel: NivelAcao): Relacao {
  /*
   * CROSS sai antes de tudo porque NÃO É DEGRAU -- é eixo de apoio, e
   * `ESCADA.indexOf` devolveria -1 para ele, que comparado a qualquer índice
   * mente. Para quem está no CROSS a ação é sua; para o N2 que a mandou para
   * lá, ela subiu.
   */
  if (a.nivelAtual === 'CROSS') return meuNivel === 'CROSS' ? 'afazer' : 'escalada'
  if (meuNivel === 'CROSS') return 'nivelAbaixo'

  const dela = ESCADA.indexOf(a.nivelAtual)
  const meu = ESCADA.indexOf(meuNivel)

  if (dela < meu) return abaixoDeMim(a)
  if (dela > meu) return acimaDeMim(a)
  return noMeuDegrau(a)
}

export const FILTROS = [
  { chave: 'todas', rotulo: 'Todas' },
  { chave: 'afazer', rotulo: 'A fazer' },
  { chave: 'direcionada', rotulo: 'Direcionadas' },
  { chave: 'escalada', rotulo: 'Escaladas' },
  { chave: 'rejeitada', rotulo: 'Rejeitadas' },
  { chave: 'concluida', rotulo: 'Concluídas' },
] as const

export type Filtro = (typeof FILTROS)[number]['chave']

/**
 * As ações do usuário, já separadas por relação.
 *
 * A lista vem inteira do servidor — ele já aplicou a visibilidade. O que se faz
 * aqui é só agrupar por relação, que é informação de quem olha.
 */
export function useAcoes() {
  const { usuario } = useSessao()
  const query = useQuery({
    queryKey: ['acoes'],
    queryFn: () => acoesApi.lista(),
  })

  const nivel = usuario?.nivel ?? 'N3'
  const todas = query.data?.contramedidas ?? []
  const comRelacao = todas.map((a) => ({ acao: a, relacao: relacaoDa(a, nivel) }))

  return {
    ...query,
    /**
     * As suas: tudo menos o que está no nível de baixo.
     *
     * A lista de `nivelAbaixo` deixou de ser devolvida em 11/09/2026, junto com
     * a aba que a mostrava -- a visão gerencial foi para dentro do GD. A
     * RELAÇÃO continua existindo, e é ela que faz o filtro aqui: sem ela, a
     * ação do adjunto de Construção voltaria a aparecer no quadro pessoal do N3.
     */
    minhas: comRelacao.filter((x) => x.relacao !== 'nivelAbaixo'),
    contar: (f: Filtro, escopo: { relacao: Relacao }[]) =>
      f === 'todas' ? escopo.length : escopo.filter((x) => x.relacao === f).length,
  }
}

export function useAcao(codigo: string) {
  return useQuery({
    queryKey: ['acao', codigo],
    queryFn: () => acoesApi.detalhe(codigo),
  })
}

/**
 * Um movimento na ação. Invalida a lista E o detalhe.
 *
 * As duas, porque todo movimento muda os dois: concluir troca o status no card
 * e acrescenta uma linha na cronologia. Invalidar só o detalhe deixaria o
 * quadro mostrando o estado anterior até a próxima navegação.
 */
export function useMovimento<T>(codigo: string, fn: (dados: T) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['acoes'] }),
        qc.invalidateQueries({ queryKey: ['acao', codigo] }),
      ])
    },
  })
}

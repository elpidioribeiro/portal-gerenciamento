import { useNavigate } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import { useVisao } from '../../contexts/VisaoContext.js'
import { useSessao } from '../../contexts/SessaoContext.js'
import { quadroDoNivel } from '../../lib/quadro-do-nivel.js'
import { telaUsaVisao } from '../../lib/tela-usa-visao.js'
import { IconeAtencao } from '../ui/Icones.js'

/**
 * O AVISO DE VISÃO SIMULADA, agora dentro da barra navy (12/09/2026).
 *
 * Era uma faixa de largura inteira no topo do conteúdo. Ela cumpria o papel —
 * ninguém tira um print sem ela aparecer —, e cobrava caro por isso: empurrava
 * a tela inteira para baixo e competia com o cabeçalho da página logo abaixo.
 * Na reunião do N3 chegou a haver quatro camadas dizendo onde a pessoa estava,
 * e esta era uma delas.
 *
 * O desenho do analista a traz para o cabeçalho como PASTILHA, ao lado do
 * seletor de período. O aviso continua permanente e continua saindo no print
 * — o cabeçalho é fixo —, e para de roubar a primeira dobra do conteúdo.
 *
 * **Âmbar sobre navy, e não o laranja da escala.** Sobre o fundo escuro o
 * laranja de "escalada/rejeitada" some; e é bom que a cor seja outra: esta
 * pastilha não fala de ação nenhuma, fala de quem você está fingindo ser.
 *
 * A regra de ONDE aparecer não mudou: `telaUsaVisao`, pelo mesmo motivo de
 * sempre — em `/acoes` e `/contramedida` a visão não recorta nada, e o aviso
 * prometia um recorte que aquelas telas não aplicam.
 */
export function PastilhaVisao() {
  const { usuario } = useSessao()
  const { pedido, definir } = useVisao()
  const navegar = useNavigate()
  const { pathname } = useLocation()

  if (!pedido || !usuario) return null
  if (!telaUsaVisao(pathname)) return null

  /*
   * Voltar à MINHA visão leva à MINHA tela: a tela em que se está é, por
   * construção, a do outro nível, e sem a visão que a sustentava ela quebra.
   * Mesma decisão que o seletor já tomava na ida.
   */
  const voltar = () => {
    definir(null)
    void navegar(quadroDoNivel(usuario.nivel))
  }

  const onde = [pedido.nivel, pedido.filial, pedido.gerencia].filter(Boolean).join(' · ')

  return (
    <PastilhaAviso
      acao={
        <button type="button" onClick={voltar} className={ACAO_DA_PASTILHA}>
          Voltar à minha visão
        </button>
      }
    >
      Vendo como <strong className="font-bold text-white">{onde}</strong>
    </PastilhaAviso>
  )
}

/** O botão/link da pastilha — a mesma forma nos dois avisos. */
export const ACAO_DA_PASTILHA =
  'whitespace-nowrap rounded-botaoPequeno bg-white/[.14] px-[10px] py-[5px] text-micro font-bold text-white transition-colors duration-hover hover:bg-white/[.22]'

/**
 * A CASCA das pastilhas de aviso do cabeçalho.
 *
 * Existe pela mesma razão que `FaixaAviso` existia para as faixas: são dois
 * avisos com o mesmo papel — *"esta tela não é a sua tela de sempre, e por aqui
 * se volta"* —, e quando cada um tinha a própria caixa eles divergiram. O
 * analista viu as duas lado a lado: *"por que esse tá azul e do N2 pro N3 é
 * outra cor? preciso que o layout seja padronizado"*. Com a casca
 * compartilhada não há como divergirem de novo.
 */
export function PastilhaAviso({
  children,
  acao,
}: {
  children: React.ReactNode
  acao: React.ReactNode
}) {
  return (
    <span className="flex items-center gap-[11px] rounded-controle border border-risco-ponto/45 bg-risco-ponto/[.14] py-[6px] pl-[13px] pr-[8px]">
      <IconeAtencao tamanho={14} cor="#F39C12" />
      <span className="whitespace-nowrap text-legenda text-risco-borda">{children}</span>
      {acao}
    </span>
  )
}

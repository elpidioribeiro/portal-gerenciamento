import type { ReactNode } from "react";
import { useAlturaDaFaixa } from "../../hooks/useAlturaDaFaixa.js";
import { IconeAtencao } from "../ui/Icones.js";

/**
 * A CASCA DAS FAIXAS DE AVISO — uma peça, um desenho.
 *
 * Existe por pedido do analista, 10/09/2026: *"por que esse tá azul e do N2 pro
 * N3 é outra cor? preciso que o layout seja padronizado"*. Eu tinha dado à
 * faixa nova do N4 a paleta azul, com o argumento de que laranja é risco e
 * aquela faixa é só navegação. O argumento não sobrevive ao que ele viu: duas
 * caixas com a mesma função — avisar onde você está e como sair — em duas cores.
 *
 * A padronização mora AQUI, e não numa combinação repetida de classes em duas
 * telas: com a casca compartilhada, mudar a cor, o raio ou o respiro muda as
 * duas ao mesmo tempo. Duas cópias das mesmas utilitárias divergem na primeira
 * vez que alguém mexe numa delas — foi exactamente o que acabou de acontecer.
 *
 * Fica no FLUXO do conteúdo, não flutuando: ela tem de sair no print junto com
 * o número que está sendo lido.
 *
 * **FIXA, e abaixo da faixa de identidade da tela** (pedido do analista,
 * 10/09/2026: *"o aviso do N3 no N4 precisa ficar fixado também"*). O `top` é a
 * soma de duas alturas medidas em tempo de execução: o cabeçalho do portal
 * (`AppHeader`) e a faixa `N4 · VENDAS · NOR` (`useAlturaDaFaixa`). Em tela sem
 * faixa de identidade — o painel do N2, as Ações — a segunda vale zero, e o
 * aviso gruda direto no cabeçalho; é por isso que o hook APAGA a variável ao
 * sair da tela.
 *
 * `z-index: 19` fica abaixo do 20 da faixa de identidade e do 30 do cabeçalho:
 * quando as três se encontram na rolagem, quem cobre quem é de cima para baixo.
 *
 * `order: -1` é o que põe o aviso ABAIXO da faixa de identidade sem mexer na
 * estrutura: as telas de reunião devolvem fragmento, então a faixa delas e este
 * aviso são irmãos diretos do `<main>`, que é `flex-col`. A faixa leva `-2`
 * (regra no CSS de cada tela) e o conteúdo fica no `0` padrão.
 */
export function FaixaAviso({
  children,
  acao,
  /**
   * Classe extra do lado de fora — hoje só a margem inferior no N4.
   *
   * Ela vem por aqui, e NÃO num `<div>` em volta, e a razão é o defeito que
   * isso causou: um elemento `sticky` gruda dentro do PAI, e um invólucro com a
   * altura exata do aviso não deixa espaço nenhum para ele grudar. Media -678px
   * de topo com 900px de rolagem — rolava junto com a página.
   */
  className = "",
}: {
  children: ReactNode;
  acao: ReactNode;
  className?: string;
}) {
  /*
   * A altura vai para o CSS porque a peça solta do seletor do N4 é `fixed` e
   * pousa abaixo das duas faixas. Sem publicar esta, ela pousaria EM CIMA do
   * aviso — duas coisas fixas no mesmo lugar.
   */
  const caixa = useAlturaDaFaixa("--altura-faixa-aviso");

  return (
    <div
      ref={caixa}
      className={`faixa-aviso flex flex-wrap items-center gap-3 rounded-card border border-escala-borda bg-escala-bg px-5 py-3 ${className}`}
    >
      <IconeAtencao tamanho={16} cor="#C4501B" />
      <p className="text-corpo text-escala-texto">{children}</p>
      {/*
        `ml-auto` na ação, e não `justify-between` no pai: com `flex-wrap`, o
        `between` empurraria o botão para a borda oposta da segunda linha quando
        o texto quebra, e ele apareceria sozinho, longe do que explica.
      */}
      <span className="ml-auto">{acao}</span>
    </div>
  );
}

/**
 * O botão/link da direita, no desenho único das faixas.
 *
 * Exportado como classe, e não como componente, porque as duas faixas usam
 * elementos diferentes: a de visão é `<button>` (troca estado) e a do N4 é
 * `<Link>` (navega). Um componente que aceitasse os dois viraria um `as` prop
 * para economizar uma linha.
 */
export const ACAO_DA_FAIXA =
  "inline-flex items-center gap-1.5 rounded-botaoPequeno border border-escala-borda " +
  "bg-superficie px-3 py-[6px] text-legenda font-semibold text-escala-texto no-underline " +
  "transition-colors duration-hover hover:bg-escala-bg";

/**
 * A porta de entrada de cada nível — uma definição só.
 *
 * O quadro de cada um é OUTRA TELA, e não a mesma tela com outro recorte: o N4
 * abre a reunião da área de venda, o N3 a da gerência, o N2 o quadro da
 * diretoria. Mandar todo mundo para `/painel` fazia o N4 e o N3 caírem na tela
 * do N2 — que o servidor recusa pelo escopo do N4, e que para o N3 mostra o
 * quadro errado com a cara de certo.
 *
 * Existe porque a regra estava escrita em três arquivos com três graus de
 * acerto: o `Inicio` sabia dos três níveis, o cabeçalho também, o login mandava
 * todo mundo para `/painel` e o seletor de visão só conhecia o N4. Três cópias
 * de uma regra são três chances de ela sair errada, e foi o que aconteceu.
 *
 * ## QUAL nível passar — a pergunta que errou quatro vezes
 *
 * A função é uma só; o argumento é que muda, e o critério é **se você está
 * lendo o estado atual ou trocando de estado**:
 *
 *   LENDO o estado atual    →  `pedido?.nivel ?? usuario?.nivel`
 *     A aba "Indicadores", a raiz do breadcrumb, a rota `/`. Com uma visão
 *     ativa, o quadro "de agora" é o dela. Passar `usuario.nivel` aqui manda o
 *     N2 para o painel da diretoria enquanto a visão diz `N3 · CEN` — a tela
 *     da rede com uma coluna só, sob o título de outra reunião.
 *
 *   TROCANDO de estado      →  o nível ESCOLHIDO, explícito
 *     `SeletorVisao.escolher(nivel)` passa o nível que se acabou de escolher;
 *     "Voltar à minha visão" limpa o pedido e passa `usuario.nivel`, porque o
 *     destino é justamente o quadro próprio. Ler o pedido nesses dois seria
 *     ler o estado que se está descartando.
 *
 * Registrado assim porque a troca errada aconteceu em `VisaoContext`, no bloco
 * de ações do N4, na aba do cabeçalho e na rota `/` — todas no mesmo dia, e
 * todas silenciosas: a tela abre, só não é a tela certa.
 */
export function quadroDoNivel(nivel: string | null | undefined): string {
  if (nivel === 'N4') return '/reuniao'
  if (nivel === 'N3') return '/reuniao-n3'
  return '/painel'
}

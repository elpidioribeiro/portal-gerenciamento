/**
 * Esta tela muda de conteúdo quando a visão muda?
 *
 * A visão simulada recorta por **nível e filial**: o painel, as reuniões e o
 * desdobramento pedem os números daquele recorte, e a faixa laranja avisa que
 * o que está na tela não é da pessoa que está logada.
 *
 * **Duas telas não têm recorte nenhum, e a faixa mentia nelas.** A lista de
 * Ações é PESSOAL desde §7.70 — ela mostra o que passou pela minha mão —, e a
 * visão não tem como responder "quem sou eu": ela simula um nível numa loja,
 * não uma pessoa. O detalhe de uma contramedida é a mesma coisa, para uma só.
 *
 * O sintoma, relatado pelo analista em 11/09/2026: a faixa dizia *"você está
 * vendo como N3 · NOR"* e, dois centímetros abaixo, o selo da lista dizia `N2`
 * — com as ações do N2. Uma das duas frases estava errada, e era a faixa: ela
 * prometia um recorte que aquela tela não aplica.
 *
 * **Esconder a faixa é a correção, e não o contrário.** Fazer a lista seguir a
 * visão a transformaria noutra coisa: "as ações de quem for N3 em NOR" não é
 * uma pergunta que alguém faz — quem quer ver o que está em pé numa loja abre o
 * GD dela, que é exatamente para onde o acompanhamento foi (§7.70).
 *
 * Lista de exceções, e não de inclusões: tela nova nasce respeitando a visão,
 * que é o caso comum. Esquecer de incluir aqui não esconde aviso nenhum.
 */
const SEM_RECORTE_DE_VISAO = ['/acoes', '/contramedida']

export function telaUsaVisao(caminho: string): boolean {
  return !SEM_RECORTE_DE_VISAO.some((r) => caminho === r || caminho.startsWith(`${r}/`))
}

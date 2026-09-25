/**
 * Quanto do topo da tela está OCUPADO por faixas fixas, neste instante.
 *
 * São até três, empilhadas, e cada uma publica a própria altura numa variável
 * CSS porque todas mudam de tamanho com a largura da janela:
 *
 *   `--altura-cabecalho`            o cabeçalho do portal (`AppHeader`)
 *   `--altura-faixa-identidade`     `N4 · VENDAS · NOR  Construção` (`useAlturaDaFaixa`)
 *   `--altura-faixa-aviso`          a faixa laranja de visão, ou a de procedência
 *
 * **Quem esquece uma delas produz um defeito que só aparece numa visão.** Foi o
 * que aconteceu: a conta somava as duas primeiras, e na visão simulada do N2 a
 * faixa de aviso entra no meio — o seletor de variável ficava escondido atrás
 * dela e o código continuava achando que estava à vista, então a peça flutuante
 * não aparecia. Nenhum seletor na tela. Palavra do analista: *"visão do N4 pelo
 * N2 tá bugando o filtro de contador de causa"*.
 *
 * Zero é o padrão de cada uma, e não um chute: a faixa que não existe na tela
 * não ocupa nada, e as que existem publicam antes de qualquer rolagem.
 */
export function alturaDasFaixasFixas(raiz: CSSStyleDeclaration): number {
  const px = (nome: string) => Number.parseInt(raiz.getPropertyValue(nome), 10) || 0
  return (
    px('--altura-cabecalho') + px('--altura-faixa-identidade') + px('--altura-faixa-aviso')
  )
}

/**
 * O elemento ainda aparece abaixo das faixas fixas?
 *
 * `bottom > teto`: conta como visível enquanto sobrar QUALQUER parte dele
 * abaixo delas. Comparar pelo `top` faria a peça flutuante aparecer com o
 * seletor do cabeçalho ainda meio à mostra — dois seletores à vista, que é o
 * que o par existe para evitar.
 */
export function apareceAbaixoDasFaixas(base: { bottom: number }, teto: number): boolean {
  return base.bottom > teto
}

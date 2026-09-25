import { useCallback, useEffect, useState } from 'react'

/**
 * Mede uma faixa fixa e publica a altura dela numa variável CSS.
 *
 * As telas de reunião têm uma faixa embaixo do cabeçalho do portal — `N4 ·
 * VENDAS · NOR  Construção` no N4, a mesma linha com as abas no N3. Tudo o que
 * gruda ABAIXO dela precisa saber quanto ela mede: a faixa de aviso, e a peça
 * solta do seletor de variável.
 *
 * **Medida em tempo de execução, e não cravada**, pelo mesmo motivo que o
 * `AppHeader` mede a dele: as faixas quebram linha, então a altura muda com a
 * largura da tela, com o nome da gerência e com a quantidade de abas. Um valor
 * fixo poria o aviso por baixo da faixa justamente na largura em que ela quebra
 * em duas linhas.
 *
 * **DEVOLVE UM `ref` DE FUNÇÃO, e não recebe um `useRef`.** A primeira versão
 * recebia o objeto de ref e media dentro de um `useEffect` — e não funcionava,
 * com um sintoma que parecia outra coisa: *"não fixou"*.
 *
 * O motivo é que um objeto de ref NÃO MUDA DE IDENTIDADE, então o efeito rodava
 * uma única vez, na montagem. Nesse instante a faixa ainda não existe: no N3 ela
 * está dentro de `{gds.length > 0 && …}` e só aparece quando a resposta chega.
 * O efeito via `null`, saía sem observar nada, e nunca mais era chamado — a
 * variável ficava sem valor, o `calc` caía no zero de fallback, e o aviso
 * grudava em 124px, ATRÁS da faixa de identidade, que gruda no mesmo lugar com
 * `z-index` maior. Fixava; ficava escondido.
 *
 * O `ref` de função é chamado pelo React quando o elemento ENTRA e quando SAI da
 * árvore. É o que torna a medição correta para um elemento que depende de dado.
 *
 * **A LIMPEZA NÃO É ZELO, É CORREÇÃO.** A variável mora no `documentElement`,
 * que sobrevive à troca de rota: sem apagá-la ao sair, o painel do N2 — que não
 * tem faixa nenhuma — herdaria os 57px do N4 e mostraria a faixa de aviso
 * flutuando, com um vão vazio entre ela e o cabeçalho.
 */
export function useAlturaDaFaixa(
  /**
   * O nome da variável CSS. São duas hoje: `--altura-faixa-identidade`, da
   * faixa `N4 · VENDAS · NOR`, e `--altura-faixa-aviso`, da faixa laranja —
   * quem gruda abaixo das duas (a peça solta do seletor) soma as duas.
   */
  variavel: string,
): (el: HTMLElement | null) => void {
  const [faixa, setFaixa] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (faixa === null) {
      /*
       * Sem faixa na tela a variável não pode ficar com o valor de antes: é o
       * caso do N3 enquanto a resposta não chega, e o do N4 ao trocar de
       * gerência. Um valor velho aqui empurra o aviso para baixo de nada.
       */
      document.documentElement.style.removeProperty(variavel)
      return
    }
    const medir = () => {
      document.documentElement.style.setProperty(
        variavel,
        `${String(Math.round(faixa.getBoundingClientRect().height))}px`,
      )
    }
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(faixa)
    return () => {
      observador.disconnect()
      document.documentElement.style.removeProperty(variavel)
    }
  }, [faixa, variavel])

  /* Estável entre renderizações: um `ref` novo a cada uma faria o React
     desmontar e remontar a medição a cada quadro. */
  return useCallback((el: HTMLElement | null) => {
    setFaixa(el)
  }, [])
}

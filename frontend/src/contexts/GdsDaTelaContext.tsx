import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * Os GDs que a TELA ATUAL oferece — lidos pelo cabeçalho global.
 *
 * A escolha do GD (Vendas, NPS, Perdas, Custo) subiu da faixa fixa da reunião
 * para a barra branca do cabeçalho, no desenho que o analista trouxe em
 * 12/09/2026. E aí aparece o problema: **quem conhece os GDs é a tela, não o
 * cabeçalho.** A lista vem da gerência carregada, e o cabeçalho não carrega
 * nada.
 *
 * Por isso um contexto, e não uma consulta no cabeçalho: duas telas pedindo o
 * mesmo dado por caminhos diferentes é como as duas passam a discordar sobre
 * qual GD está ativo — e o sintoma seria a aba marcada em cima e o conteúdo de
 * outro GD embaixo.
 *
 * **Nulo é o caso comum, não a exceção.** `/painel`, `/acoes` e
 * `/pontos-causa` não têm GD; o cabeçalho mostra o nome da tela no lugar. Tela
 * que não publica nada cai nesse caminho sozinha — é o que impede um slot
 * vazio numa rota nova.
 */
export interface GdDaTela {
  codigo: string
  nome: string
}

interface Publicacao {
  lista: GdDaTela[]
  ativo: string | null
  trocar: (codigo: string) => void
}

interface Contexto {
  publicado: Publicacao | null
  /** A tela chama no efeito de montagem e passa `null` ao sair. */
  publicar: (p: Publicacao | null) => void
}

const GdsDaTelaContext = createContext<Contexto | null>(null)

/**
 * Duas publicações dizem a mesma coisa?
 *
 * `trocar` fica de fora da comparação de propósito: a função é recriada a cada
 * render da tela e o COMPORTAMENTO dela é o mesmo. Compará-la por identidade
 * faria toda publicação parecer nova, que é exatamente o que esta função
 * existe para evitar.
 */
function mesmaPublicacao(a: Publicacao | null, b: Publicacao | null): boolean {
  if (a === null || b === null) return a === b
  if (a.ativo !== b.ativo || a.lista.length !== b.lista.length) return false
  //  Os comprimentos já foram comparados acima, então o índice sempre existe.
  return a.lista.every((g, i) => {
    const outro = b.lista[i] as GdDaTela
    return g.codigo === outro.codigo && g.nome === outro.nome
  })
}

export function GdsDaTelaProvider({ children }: { children: ReactNode }) {
  const [publicado, setPublicado] = useState<Publicacao | null>(null)

  /**
   * PUBLICAR O MESMO NÃO MUDA ESTADO — e é isso que impede o laço.
   *
   * A tela monta a lista a cada render (`gds.map(...)`), então o objeto é novo
   * sempre. Sem esta comparação, um `useEffect` que publique causa
   * **`Maximum update depth exceeded`**: publica, o provider re-renderiza a
   * árvore, a tela publica de novo. Aconteceu em 12/09/2026, no primeiro dia
   * deste contexto -- 497 erros no console, e o sintoma na tela era outro: o
   * cabeçalho CONGELAVA ao sair da reunião, porque o laço travava o render.
   *
   * A guarda mora AQUI, e não no efeito de quem chama, porque aqui ela vale
   * para todas as telas -- inclusive a próxima, escrita por alguém que não leu
   * isto. Devolver o estado ANTERIOR faz o React desistir da re-renderização.
   */
  const publicar = useCallback((p: Publicacao | null) => {
    setPublicado((atual) => (mesmaPublicacao(atual, p) ? atual : p))
  }, [])

  const valor = useMemo<Contexto>(() => ({ publicado, publicar }), [publicado, publicar])
  return <GdsDaTelaContext.Provider value={valor}>{children}</GdsDaTelaContext.Provider>
}

export function useGdsDaTela(): Contexto {
  const ctx = useContext(GdsDaTelaContext)
  if (!ctx) throw new Error('useGdsDaTela precisa do GdsDaTelaProvider')
  return ctx
}

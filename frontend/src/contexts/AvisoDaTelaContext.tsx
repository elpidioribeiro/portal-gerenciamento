import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * O aviso de PROCEDÊNCIA que a tela atual quer no cabeçalho.
 *
 * Uma tela aberta a partir de outra precisa dizer de onde veio e como voltar.
 * Isso era uma faixa dentro do conteúdo, e em 12/09/2026 o analista pediu o
 * mesmo tratamento que o aviso de visão simulada acabara de receber: *"o aviso
 * deveria ficar no header, igual acontece quando o N2 vai pro GD do N3 e N4"*.
 *
 * **Só campos simples, nenhum nó de React.** O cabeçalho monta o link; a tela
 * diz o texto e o destino. É o que permite comparar duas publicações por
 * conteúdo — e essa comparação é o que impede o laço de render descrito em
 * `GdsDaTelaContext`, que já custou 497 erros de console num dia.
 */
export interface AvisoDaTela {
  /** A parte em negrito, no começo da frase. */
  forte: string
  /** O resto da frase, logo depois. */
  resto: string
  /** Para onde o botão leva. */
  para: string
  rotulo: string
}

interface Contexto {
  aviso: AvisoDaTela | null
  /** A tela chama no efeito de montagem e passa `null` ao sair. */
  publicarAviso: (a: AvisoDaTela | null) => void
}

const AvisoDaTelaContext = createContext<Contexto | null>(null)

function mesmoAviso(a: AvisoDaTela | null, b: AvisoDaTela | null): boolean {
  if (a === null || b === null) return a === b
  return a.forte === b.forte && a.resto === b.resto && a.para === b.para && a.rotulo === b.rotulo
}

export function AvisoDaTelaProvider({ children }: { children: ReactNode }) {
  const [aviso, setAviso] = useState<AvisoDaTela | null>(null)

  /* Publicar o mesmo não muda estado — ver `GdsDaTelaContext`, onde o laço que
     isto evita está descrito com o sintoma que ele produziu. */
  const publicarAviso = useCallback((a: AvisoDaTela | null) => {
    setAviso((atual) => (mesmoAviso(atual, a) ? atual : a))
  }, [])

  const valor = useMemo<Contexto>(() => ({ aviso, publicarAviso }), [aviso, publicarAviso])
  return <AvisoDaTelaContext.Provider value={valor}>{children}</AvisoDaTelaContext.Provider>
}

export function useAvisoDaTela(): Contexto {
  const ctx = useContext(AvisoDaTelaContext)
  if (!ctx) throw new Error('useAvisoDaTela precisa do AvisoDaTelaProvider')
  return ctx
}

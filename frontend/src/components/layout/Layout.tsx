import type { ReactNode } from 'react'
import { AvisoSessaoDesenvolvimento } from '../AuthGuard.js'
import { AppHeader } from './AppHeader.js'

/**
 * Casca das telas internas: faixa de aviso (quando houver) + header fixo +
 * conteúdo com os gutters do handoff (32px horizontais, 34px no topo, 40px na
 * base).
 *
 * Coluna flex com `min-h-screen` num nível só. Empilhar `min-h-screen` em dois
 * elementos faria a página passar de 100vh pela altura da faixa de aviso, e
 * apareceria barra de rolagem numa tela que cabe inteira.
 */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-fundo">
      <AvisoSessaoDesenvolvimento />
      <AppHeader />
      <main className="flex flex-1 flex-col gap-5 px-gutter pb-10 pt-[34px]">
        {children}
      </main>
    </div>
  )
}

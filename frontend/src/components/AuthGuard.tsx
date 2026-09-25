import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useSessao } from '../contexts/SessaoContext.js'

/**
 * Portão de entrada das telas internas.
 *
 * Não decide nada por conta própria: se `/auth/me` respondeu com um usuário,
 * há sessão; se respondeu 401, não há. Com AUTH_DEV_BYPASS ligado no backend,
 * `/auth/me` sempre responde, então a tela de login simplesmente não aparece —
 * sem nenhum código condicional aqui.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { usuario, carregando } = useSessao()
  const local = useLocation()

  if (carregando) return <Carregando />

  if (!usuario) {
    // `state` preserva o destino para voltar a ele depois do login.
    return <Navigate to="/login" replace state={{ de: local.pathname }} />
  }

  return <>{children}</>
}

function Carregando() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-corpo text-texto-sec">Carregando…</p>
    </div>
  )
}

/**
 * Faixa de aviso quando a sessão veio do bypass de desenvolvimento.
 *
 * Fica visível de propósito: uma sessão sem autenticação real não pode passar
 * despercebida, ou alguém acaba demonstrando o sistema achando que fez login.
 */
export function AvisoSessaoDesenvolvimento() {
  const { usuario } = useSessao()
  if (!usuario?.sessaoDeDesenvolvimento) return null

  return (
    <div className="flex items-center justify-center gap-2 bg-escala-bg px-4 py-[6px] text-center text-micro font-semibold text-escala-texto">
      <span>
        Sessão de desenvolvimento — autenticado automaticamente como {usuario.nome} ({usuario.nivel}).
        Desligue com <code className="font-mono">AUTH_DEV_BYPASS=false</code>.
      </span>
    </div>
  )
}

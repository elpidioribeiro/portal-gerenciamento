import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, type ReactNode } from 'react'
import { authApi, FalhaApi, type UsuarioSessao } from '../lib/api.js'
import { esquecerVisao } from '../lib/visao-guardada.js'

interface Sessao {
  usuario: UsuarioSessao | null
  carregando: boolean
  sair: () => Promise<void>
  recarregar: () => Promise<void>
}

const SessaoContext = createContext<Sessao | null>(null)

export function SessaoProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  const { data, isPending } = useQuery({
    queryKey: ['sessao'],
    queryFn: async () => {
      try {
        return await authApi.me()
      } catch (e) {
        // 401 é resposta esperada de quem não está logado, não uma falha:
        // devolvemos null para o AuthGuard redirecionar em vez de deixar o
        // React Query tentar de novo e piscar tela de erro.
        if (e instanceof FalhaApi && e.naoAutenticado) return null
        throw e
      }
    },
    retry: false,
    staleTime: Infinity,
  })

  const sessao: Sessao = {
    usuario: data ?? null,
    carregando: isPending,
    /**
     * Sair sempre sai, mesmo que o servidor não responda.
     *
     * O `catch` vazio é deliberado: falhar em avisar o servidor não pode
     * prender a pessoa numa sessão aberta na máquina dela. O cookie é
     * httpOnly, então quem o apaga é o servidor — mas o recarregamento abaixo
     * garante que, servidor respondendo ou não, nada do usuário anterior
     * sobrevive em memória.
     */
    sair: async () => {
      await authApi.logout().catch(() => undefined)

      // Limpa tudo, não só a sessão: os dados em cache pertencem ao usuário
      // que saiu, e reaproveitá-los para o próximo mostraria dados de outra
      // pessoa por um instante.
      queryClient.clear()

      /*
       * A VISÃO SIMULADA TAMBÉM É DO USUÁRIO QUE SAIU.
       *
       * Ela mora no `sessionStorage`, que sobrevive ao recarregamento abaixo —
       * então o cache limpo não bastava. Sem isto, quem entrasse na mesma aba
       * herdava o recorte de quem saiu: relatado em 10/09/2026, com um N4 de
       * NOR abrindo a tela como "N4 · CEN · CONSTRUÇÃO" e recebendo "nenhuma
       * gerência atribuída a você".
       */
      esquecerVisao()

      /**
       * Recarrega em vez de navegar pelo router.
       *
       * `queryClient.clear()` esvazia o cache, mas não obriga o observador
       * montado a buscar de novo: a tela ficava com o usuário antigo e o botão
       * parecia não funcionar. Recarregar resolve isso e mais um: estado em
       * memória de qualquer componente — filtros, seleção, período — morre
       * junto, que é o que se espera de um logout.
       */
      window.location.assign('/login')
    },
    recarregar: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sessao'] })
    },
  }

  return <SessaoContext.Provider value={sessao}>{children}</SessaoContext.Provider>
}

export function useSessao(): Sessao {
  const ctx = useContext(SessaoContext)
  if (!ctx) throw new Error('useSessao precisa estar dentro de <SessaoProvider>')
  return ctx
}

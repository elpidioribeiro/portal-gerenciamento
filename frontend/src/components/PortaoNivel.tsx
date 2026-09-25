import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useSessao } from '../contexts/SessaoContext.js'

/**
 * Cada nível tem sua própria tela, e este portão decide se a do nível de quem
 * entrou já existe.
 *
 *   N2  quadro da diretoria (`/painel`)
 *   N3  quadro da reunião de loja (`/reuniao-n3`), por gerência
 *   N4  quadro da reunião de área (`/reuniao`)
 *
 * O backend é quem decide quem ENTRA: CROSS, e os reservados N1 e N5, nem
 * chegam aqui, porque a resolução de nível recusa o login. Este componente só
 * escolhe qual tela mostrar entre os níveis que já passaram.
 */
export function PortaoNivel({ children }: { children: ReactNode }) {
  const { usuario } = useSessao()
  const { pathname } = useLocation()
  if (!usuario) return null

  /**
   * **A administração fica FORA do portão**, e isso não é exceção de
   * conveniência: é o que impede uma classificação errada de ser irreversível.
   *
   * O nível vem do `id_perfil`, e o `id_perfil` é o que se conserta na tela de
   * administração. Barrar o administrador ali por causa do nível dele o tranca
   * fora justamente da tela que consertaria o nível — e não há como sair disso
   * de dentro da aplicação.
   *
   * Não abre nada: `/admin` é guardada pela coluna `admin`, na própria tela e
   * em **toda** rota `/api/v1/admin` do servidor. Nível e administração são
   * duas perguntas diferentes — o administrador é N2, mas nem todo N2
   * administra, e quem administra não precisa ser de nível nenhum em especial.
   */
  if (pathname.startsWith('/admin') && usuario.admin) return <>{children}</>

  /*
   * Os três níveis com tela passam. O aviso abaixo sobreviveu para o que possa
   * chegar do banco sem tela — CROSS, ou os reservados N1 e N5 — e para o dia
   * em que um nível novo entrar antes da tela dele.
   */
  if (usuario.nivel === 'N2' || usuario.nivel === 'N3' || usuario.nivel === 'N4') {
    return <>{children}</>
  }

  return <NivelIndisponivel nivel={usuario.nivel} nome={usuario.nome} />
}

function NivelIndisponivel({ nivel, nome }: { nivel: string; nome: string }) {
  const { sair } = useSessao()
  const { usuario } = useSessao()

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="flex max-w-[520px] flex-col gap-4 rounded-card border border-borda bg-superficie px-8 py-7 shadow-card">
        <p className="text-eyebrow uppercase text-texto-ter">Portal GD</p>
        <h1 className="text-titulo-tela">A tela do seu nível ainda não está disponível</h1>
        <p className="prosa text-corpo text-texto-sec">
          {nome}, seu perfil corresponde ao nível <strong className="text-texto">{nivel}</strong>. O
          portal atende N2, N3 e N4; a tela do {nivel} entra numa próxima entrega.
        </p>
        {/*
          O caminho de saída, para quem pode tomá-lo: quase sempre o nível está
          errado, não a tela é que falta — e o conserto é reclassificar o perfil
          ou cadastrar a matrícula. Sem este atalho a pessoa lê "volte depois" e
          não descobre que a correção estava a um clique.
        */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void sair()}
            className="rounded-controle border border-borda px-4 py-2 text-corpo font-semibold text-texto-sec transition-colors duration-hover hover:bg-superficie-hover"
          >
            Sair
          </button>
          {usuario?.admin && (
            <a
              href="/admin"
              className="rounded-controle bg-navy px-4 py-2 text-corpo font-semibold text-white transition-colors duration-hover hover:bg-navy-hover"
            >
              Abrir a administração
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

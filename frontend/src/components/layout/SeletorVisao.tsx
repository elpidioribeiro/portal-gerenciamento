import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessao } from '../../contexts/SessaoContext.js'
import { useVisao } from '../../contexts/VisaoContext.js'
import { adminApi, variaveisApi, type NivelComAcesso } from '../../lib/api.js'
import { quadroDoNivel } from '../../lib/quadro-do-nivel.js'
import { IconeChevronDireita } from '../ui/Icones.js'

/**
 * Seletor de visão — só para o administrador.
 *
 * O que ele resolve: o portal tem uma tela por nível, e quem administra precisa
 * ver o que cada nível vê. Sem isto, conferir a configuração de um N4 exigiria
 * pedir a senha de alguém.
 *
 * **Escolher um nível LEVA para a tela dele**, e não só filtra o que já estava
 * aberto:
 *
 *     N2   /painel       todas as filiais
 *     N3   /reuniao-n3   a filial escolhida
 *     N4   /reuniao      a filial e a GERÊNCIA escolhidas
 *
 * A tabela acima é DESCRIÇÃO, não a regra: quem decide é `quadroDoNivel`. Ela
 * já ficou errada uma vez -- dizia `N3 → /painel`, de quando o N3 não tinha
 * tela própria, e era a próxima cópia da regra a sair de sincronia (§7.45).
 *
 * Sem a navegação, escolher N4 deixava você na tela do N2 com os parâmetros do
 * N4 — que o servidor recusa pelo escopo. O que aparecia era um erro, e não o
 * quadro do N4.
 *
 * A regra de qual nível exige filial **vem do servidor** (`/admin/visoes`), não
 * está escrita aqui. Duplicá-la faria a tela e o backend divergirem no dia em
 * que a regra mudasse, e o sintoma seria um 403 sem explicação na cara de quem
 * escolheu.
 *
 * A gerência é a exceção: ela não é recorte que o servidor valida, é qual
 * quadro a tela do N4 abre dentro da filial. Por isso vem de `/gerencias` — a
 * lista real daquela loja — e não de constante nenhuma.
 */
export function SeletorVisao() {
  const { usuario } = useSessao()
  const { pedido, definir } = useVisao()
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  const navegar = useNavigate()

  const { data } = useQuery({
    queryKey: ['admin', 'visoes'],
    queryFn: adminApi.visoes,
    // Níveis e filiais mudam em escala de mês, não de minuto.
    staleTime: 30 * 60_000,
    enabled: Boolean(usuario?.admin),
  })

  useEffect(() => {
    if (!aberto) return
    function fora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    function esc(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [aberto])

  if (!usuario?.admin) return null

  const rotulo = pedido
    ? `${pedido.nivel}${pedido.filial ? ` · ${pedido.filial}` : ''}${
        pedido.gerencia ? ` · ${pedido.gerencia}` : ''
      }`
    : `${usuario.nivel} · meu perfil`

  function escolher(nivel: NivelComAcesso, filial: string | null, gerencia: string | null = null) {
    definir({ nivel, filial, gerencia })
    setAberto(false)
    // A tela do nível, não a que estava aberta. Ver o comentário do módulo.
    void navegar(quadroDoNivel(nivel))
  }

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-haspopup="menu"
        className={[
          'flex items-center gap-2 rounded-controle border px-3 py-[8px] text-legenda font-semibold transition-colors duration-hover',
          pedido
            ? 'border-escala-ponto/70 bg-escala-ponto/20 text-white hover:bg-escala-ponto/30'
            : 'border-white/[.28] text-white hover:bg-white/[.12]',
        ].join(' ')}
        title="Escolher a visão que você está olhando"
      >
        <span className="text-eyebrow uppercase text-sobreNavy-sec">Visão</span>
        <span className="tabular">{rotulo}</span>
        <span className={`transition-transform duration-hover ${aberto ? 'rotate-90' : ''}`}>
          <IconeChevronDireita tamanho={11} cor="#C7D6EA" />
        </span>
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-40 w-[268px] overflow-hidden rounded-card border border-borda bg-superficie shadow-modal"
        >
          <ItemMenu
            selecionado={pedido === null}
            onClick={() => {
              definir(null)
              setAberto(false)
              // De volta à tela do nível de quem está logado, pelo mesmo
              // motivo: o N4 não abre o painel da diretoria.
              void navegar(quadroDoNivel(usuario.nivel))
            }}
          >
            <span className="font-semibold">Meu perfil</span>
            <span className="text-micro text-texto-ter">{usuario.nivel} · visão real</span>
          </ItemMenu>

          {data?.niveis.map((n) =>
            n.exigeFilial ? (
              <GrupoFilial
                key={n.nivel}
                nivel={n.nivel}
                filiais={data.filiais}
                selecionada={pedido?.nivel === n.nivel ? pedido.filial : null}
                gerenciaSelecionada={pedido?.nivel === n.nivel ? pedido.gerencia : null}
                /* Só o N4 tem gerência: o N3 é o gerente geral e vê a loja inteira. */
                comGerencia={n.nivel === 'N4'}
                onEscolher={(sigla, gerencia) => escolher(n.nivel, sigla, gerencia)}
              />
            ) : (
              <ItemMenu
                key={n.nivel}
                selecionado={pedido?.nivel === n.nivel}
                onClick={() => escolher(n.nivel, null)}
              >
                <span className="font-semibold">{n.nivel}</span>
                <span className="text-micro text-texto-ter">todas as filiais</span>
              </ItemMenu>
            ),
          )}
        </div>
      )}
    </div>
  )
}

function ItemMenu({
  selecionado,
  onClick,
  children,
}: {
  selecionado: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selecionado}
      onClick={onClick}
      className={[
        'flex w-full items-center justify-between gap-3 border-b border-borda-sutil px-4 py-[10px] text-left text-corpo transition-colors duration-hover last:border-b-0',
        selecionado ? 'bg-andamento-bg text-andamento-texto' : 'text-texto hover:bg-superficie-hover',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/**
 * Nível de filial exige escolher uma, então o item vira uma lista. Quem exige
 * vem do SERVIDOR, em `exigeFilial` — repetir a lista aqui é como a tela deixou
 * de acompanhar a mudança de 27/08 que tirou o N3 dos corporativos.
 *
 * No **N4** a escolha tem dois passos, porque o quadro dele é de UMA gerência:
 * primeiro a loja, depois a gerência daquela loja. As gerências são buscadas
 * quando a filial é aberta — são por (filial, nome), e uma lista fixa aqui
 * ficaria errada na primeira gerência operacional que entrar.
 *
 * Colapsada por padrão: nove filiais abertas empurrariam o resto do menu fora
 * da tela, e o caso comum é escolher o N2.
 */
function GrupoFilial({
  nivel,
  filiais,
  selecionada,
  gerenciaSelecionada,
  comGerencia,
  onEscolher,
}: {
  nivel: NivelComAcesso
  filiais: Array<{ sigla: string; nome: string }>
  selecionada: string | null
  gerenciaSelecionada: string | null
  /** N4 escolhe gerência depois da filial; N3 fecha na filial. */
  comGerencia: boolean
  onEscolher: (sigla: string, gerencia: string | null) => void
}) {
  const [aberto, setAberto] = useState(selecionada !== null)
  /** A filial cuja lista de gerências está aberta. Só no N4. */
  const [emAberto, setEmAberto] = useState<string | null>(comGerencia ? selecionada : null)

  return (
    <div className="border-b border-borda-sutil last:border-b-0">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className={[
          'flex w-full items-center justify-between gap-3 px-4 py-[10px] text-left text-corpo transition-colors duration-hover',
          selecionada ? 'bg-andamento-bg text-andamento-texto' : 'text-texto hover:bg-superficie-hover',
        ].join(' ')}
      >
        <span className="font-semibold">{nivel}</span>
        <span className="flex items-center gap-2 text-micro text-texto-ter">
          {selecionada
            ? `${selecionada}${gerenciaSelecionada ? ` · ${gerenciaSelecionada}` : ''}`
            : comGerencia
              ? 'filial e gerência'
              : 'escolha a filial'}
          <span className={`transition-transform duration-hover ${aberto ? 'rotate-90' : ''}`}>
            <IconeChevronDireita tamanho={10} cor="#A9B4C6" />
          </span>
        </span>
      </button>

      {aberto && (
        <div className="max-h-[280px] overflow-y-auto border-t border-borda-clara bg-superficie-alt">
          {filiais.map((f) => (
            <div key={f.sigla}>
              <button
                type="button"
                role={comGerencia ? undefined : 'menuitemradio'}
                aria-checked={comGerencia ? undefined : selecionada === f.sigla}
                aria-expanded={comGerencia ? emAberto === f.sigla : undefined}
                onClick={() => {
                  /*
                   * No N4 a filial só ABRE a lista de gerências. Escolher a loja
                   * e parar por aí abriria o quadro da primeira gerência da
                   * lista — que não foi o que ninguém pediu.
                   */
                  if (comGerencia) setEmAberto((atual) => (atual === f.sigla ? null : f.sigla))
                  else onEscolher(f.sigla, null)
                }}
                className={[
                  'flex w-full items-center justify-between gap-3 px-4 py-[7px] text-left text-legenda transition-colors duration-hover',
                  selecionada === f.sigla
                    ? 'bg-andamento-bg font-semibold text-andamento-texto'
                    : 'text-texto-sec hover:bg-superficie-hover hover:text-texto',
                ].join(' ')}
              >
                <span className="tabular font-semibold">{f.sigla}</span>
                <span className="truncate text-micro text-texto-ter">{f.nome}</span>
              </button>

              {comGerencia && emAberto === f.sigla && (
                <Gerencias
                  filial={f.sigla}
                  nivel={nivel}
                  selecionada={selecionada === f.sigla ? gerenciaSelecionada : null}
                  onEscolher={(g) => onEscolher(f.sigla, g)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * As gerências de uma filial, buscadas na hora.
 *
 * Pede a rota **na visão que está sendo montada** (`visaoNivel`/`visaoFilial`),
 * e não na do administrador: é a mesma resposta que a tela do N4 vai receber
 * depois da escolha. Perguntar de outro jeito abriria a porta para o menu
 * listar uma gerência que a tela seguinte não mostra.
 */
function Gerencias({
  filial,
  nivel,
  selecionada,
  onEscolher,
}: {
  filial: string
  nivel: NivelComAcesso
  selecionada: string | null
  onEscolher: (gerencia: string) => void
}) {
  const { data, isPending, error } = useQuery({
    queryKey: ['gerencias', `${nivel}:${filial}:`],
    queryFn: () =>
      variaveisApi.gerencias({
        visao: new URLSearchParams({ visaoNivel: nivel, visaoFilial: filial }),
      }),
    staleTime: 5 * 60_000,
  })

  if (isPending) return <p className="px-8 py-2 text-micro text-texto-ter">Carregando…</p>
  if (error) {
    return (
      <p className="px-8 py-2 text-micro text-critico-texto">
        Não deu para listar as gerências desta loja.
      </p>
    )
  }
  if (data.gerencias.length === 0) {
    return (
      <p className="px-8 py-2 text-micro text-texto-ter">
        Nenhuma gerência nesta loja — é cadastro, não erro.
      </p>
    )
  }

  return (
    <div className="border-y border-borda-clara bg-fundo">
      {data.gerencias.map((g) => (
        <button
          key={g.id}
          type="button"
          role="menuitemradio"
          aria-checked={selecionada === g.nome}
          onClick={() => onEscolher(g.nome)}
          className={[
            'flex w-full items-center justify-between gap-3 py-[6px] pl-8 pr-4 text-left text-legenda transition-colors duration-hover',
            selecionada === g.nome
              ? 'bg-andamento-bg font-semibold text-andamento-texto'
              : 'text-texto-sec hover:bg-superficie-hover hover:text-texto',
          ].join(' ')}
        >
          <span>{g.nome}</span>
          <span className="text-micro text-texto-ter">
            {g.areasVenda.length} {g.areasVenda.length === 1 ? 'área' : 'áreas'}
          </span>
        </button>
      ))}
    </div>
  )
}

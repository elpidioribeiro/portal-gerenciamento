import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useSessao } from '../../contexts/SessaoContext.js'
import { useVisao } from '../../contexts/VisaoContext.js'
import { useAvisoDaTela } from '../../contexts/AvisoDaTelaContext.js'
import { useGdsDaTela } from '../../contexts/GdsDaTelaContext.js'
import { api, fonteDaFoto } from '../../lib/api.js'
import { quadroDoNivel } from '../../lib/quadro-do-nivel.js'
import { tituloDaTela } from '../../lib/titulo-da-tela.js'
import { IconeEscudo, IconeRelogio } from '../ui/Icones.js'
import { SeletorPeriodo } from './SeletorPeriodo.js'
import { ACAO_DA_PASTILHA, PastilhaAviso, PastilhaVisao } from './PastilhaVisao.js'
import { SeletorVisao } from './SeletorVisao.js'

/**
 * Header de duas faixas — `docs/handoff/spec-header-portal-gd.md`.
 * Fixo no topo: nada nele rola com o conteúdo.
 */
export function AppHeader() {
  /**
   * A ALTURA DO CABEÇALHO vira `--altura-cabecalho`, para outras faixas
   * grudarem embaixo dele (10/09/2026).
   *
   * A reunião do N4 precisa de uma segunda faixa fixa -- o recorte "N4 · Vendas
   * · NOR · Construção", que rolava para fora da vista. Uma faixa `sticky` só
   * sabe onde parar se souber onde este cabeçalho termina.
   *
   * MEDIDO, e não cravado em 124px (72 + 52). Os dois `min-h` são MÍNIMOS e as
   * duas barras têm `flex-wrap`: num painel estreito o bloco da direita quebra
   * para a segunda linha e o cabeçalho passa de 200px. Com o número fixo, a
   * faixa de baixo grudaria no meio do cabeçalho -- e só nas larguras em que
   * ninguém testa.
   *
   * `ResizeObserver` e não `window.resize`: a altura muda também sem a janela
   * mudar -- ao entrar numa visão simulada (o nome da filial alonga o seletor),
   * ao carregar a foto do usuário, ao aparecer o selo de atualização.
   *
   * Na raiz do documento porque quem consome é CSS de outra tela, e as duas não
   * se conhecem. É uma variável, não um estado de React: escrever num `useState`
   * re-renderizaria a árvore inteira a cada pixel de resize.
   */
  const caixa = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = caixa.current
    if (!el) return
    const medir = () => {
      document.documentElement.style.setProperty(
        '--altura-cabecalho',
        `${String(Math.round(el.getBoundingClientRect().height))}px`,
      )
    }
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(el)
    return () => {
      observador.disconnect()
    }
  }, [])

  return (
    <header ref={caixa} className="sticky top-0 z-30">
      <BarraIdentificacao />
      <BarraContexto />
    </header>
  )
}

/**
 * Barra 1 — identificação (navy), 72px de altura MÍNIMA.
 *
 * `flex-wrap` e `min-h` em vez de `h` fixa: com altura travada e sem wrap, o
 * bloco da direita (período + usuário + Sair) media 313px num painel de 393 e
 * empurrava a PÁGINA inteira para o lado — rolagem horizontal em todas as
 * telas, não só numa. A altura fixa é o que impedia a segunda linha de existir.
 */
function BarraIdentificacao() {
  const { usuario, sair } = useSessao()

  return (
    <div className="flex min-h-[72px] flex-wrap items-center gap-x-5 gap-y-2 bg-navy px-gutter py-2">
      <img
        src="/assets/logo-mark.svg"
        alt="Acme Varejo"
        className="h-[26px] w-auto"
      />

      <div className="h-[34px] w-px bg-white/[.18]" />

      <div className="flex flex-col gap-[2px]">
        <span className="text-[18px] font-bold leading-none tracking-[-0.2px] text-white">
          Portal GD
        </span>
        <span className="text-[10px] font-semibold uppercase leading-none tracking-[0.16em] text-sobreNavy-sec">
          Gerenciamento Diário{usuario ? ` · ${usuario.nivel}` : ''}
        </span>
      </div>

      <div className="ml-auto flex flex-wrap items-center justify-end gap-[14px]">
        {/* O aviso de visão simulada subiu para cá em 12/09/2026 — ver
            `PastilhaVisao`, onde está o motivo. Fica ANTES do seletor: é ele
            que explica por que a tela não é a sua. */}
        <AvisoDoCabecalho />
        <SeletorVisao />
        <SeletorPeriodo />

        {usuario && (
          <div className="flex items-center gap-[10px]">
            {fonteDaFoto(usuario.foto) ? (
              /*
               * `onError` cai para as iniciais: a foto vem da API de login como
               * URL ou base64, e URL que deixou de responder deixaria um
               * quadrado quebrado no cabecalho de todas as telas.
               */
              <img
                src={fonteDaFoto(usuario.foto) ?? ''}
                alt=""
                className="h-[34px] w-[34px] rounded-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  e.currentTarget.nextElementSibling?.classList.remove('hidden')
                }}
              />
            ) : null}
            <span
              className={`h-[34px] w-[34px] items-center justify-center rounded-full bg-navy-medio text-[12px] font-bold text-white ${fonteDaFoto(usuario.foto) ? 'hidden' : 'flex'}`}
            >
              {usuario.iniciais}
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-corpo font-semibold text-white">{usuario.nome}</span>
              <span className="text-[11px] font-medium text-sobreNavy-sec">{usuario.cargo}</span>
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={() => void sair()}
          className="rounded-controle border border-white/[.28] px-4 py-[9px] text-legenda font-semibold text-white transition-colors duration-hover hover:bg-white/[.12]"
        >
          Sair
        </button>
      </div>
    </div>
  )
}

/**
 * A PASTILHA DE AVISO — a da visão simulada, ou a que a tela publicou.
 *
 * As duas dizem a mesma coisa em casos diferentes: *"esta tela não é a sua de
 * sempre, e por aqui se volta"*. Nunca aparecem juntas -- a de procedência do
 * N4 só existe quando `pedido === null`, ou seja, quando ninguém está
 * simulando --, e por isso dividem um slot só em vez de empilhar.
 *
 * A da visão vem primeiro: ela descreve um estado mais forte (você está vendo
 * como outra pessoa) do que ter chegado por outra tela.
 */
function AvisoDoCabecalho() {
  const { pedido } = useVisao()
  const { aviso } = useAvisoDaTela()

  if (pedido) return <PastilhaVisao />
  if (!aviso) return null

  return (
    <PastilhaAviso
      acao={
        <Link to={aviso.para} className={ACAO_DA_PASTILHA}>
          <span aria-hidden>←</span> {aviso.rotulo}
        </Link>
      }
    >
      <strong className="font-bold text-white">{aviso.forte}</strong>
      {aviso.resto}
    </PastilhaAviso>
  )
}

/** Barra 2 — contexto e navegação (branca), 52px. */
function BarraContexto() {
  const { pathname } = useLocation()
  const { usuario } = useSessao()
  const { pedido } = useVisao()

  // "Indicadores" cobre painel, drill-down E a reunião do N4 — são o quadro de
  // cada nível. "Ações" cobre lista e detalhe.
  const abaAtiva: 'indicadores' | 'acoes' | 'pontos' | 'admin' | null = pathname.startsWith('/admin')
    ? 'admin'
    : pathname.startsWith('/pontos-causa')
      ? 'pontos'
      : pathname.startsWith('/acoes')
        ? 'acoes'
        : pathname.startsWith('/contramedida')
          ? 'acoes'
          : pathname.startsWith('/painel') ||
              pathname.startsWith('/indicador') ||
              pathname.startsWith('/reuniao')
            ? 'indicadores'
            : null

  /**
   * A aba leva ao quadro do nível que se está VENDO, não do que está no
   * cadastro. Ver `quadro-do-nivel.ts`.
   *
   * **O defeito** (relatado em 10/09/2026): um N2 abre a reunião do N3 de uma
   * loja pela matriz (§7.63), clica em "Ações" e depois em "Indicadores" — e
   * cai no `/painel` da diretoria, ainda com a visão `N3 · CEN` valendo. O
   * resultado é o quadro do N2 com uma coluna só, sob o título "Reunião
   * diária": nem a tela que ele pediu, nem a que a visão descreve.
   *
   * `pedido?.nivel` primeiro, e é a terceira vez que esta mesma troca aparece
   * hoje — no `VisaoContext`, no bloco de ações do N4, e aqui. O padrão é
   * sempre o mesmo: `usuario.nivel` é o CADASTRO, e o que a tela deve seguir é
   * o recorte em vigor.
   */
  const quadro = quadroDoNivel(pedido?.nivel ?? usuario?.nivel)

  /*
   * ALTURA MÍNIMA DE 64px, e não de 52.
   *
   * A barra media 59px nas telas sem GD e 92px nas de reunião: **33px de
   * salto**, e a página inteira descia ao entrar numa reunião. Quem esticava
   * eram as abas de GD, porque a ativa tem 20px.
   *
   * Com o piso em 64 a aba cabe DENTRO da barra (ela estica por
   * `items-stretch` e centra o texto) em vez de esticá-la. `min-h` e não `h`:
   * as duas barras têm `flex-wrap`, e num painel estreito a segunda linha ainda
   * precisa caber.
   */
  return (
    <div className="flex min-h-[64px] flex-wrap items-stretch gap-x-7 gap-y-1 border-b border-borda bg-white px-gutter shadow-headerInset">
      <LugarOuGds />

      <nav className="ml-auto flex flex-wrap gap-1" aria-label="Seções">
        <Aba para={quadro} ativa={abaAtiva === 'indicadores'}>
          Indicadores
        </Aba>
        <Aba para="/acoes" ativa={abaAtiva === 'acoes'}>
          Ações
        </Aba>
        {/*
          PONTOS DE CAUSA é leitura de REDE, e por isso só do N2.
          N3 e N4 já têm o Pareto dentro da própria reunião, sobre a variável
          que estão olhando -- a pergunta deles é "o que travou aqui". A desta
          tela é "o mesmo problema está travando quantas lojas", que só existe
          para quem enxerga mais de uma.

          Pelo nível EFETIVO (`pedido?.nivel`), como as outras decisões de tela:
          um administrador vendo como N4 não deve continuar com a aba da
          diretoria no menu. A rota não depende disto -- ela recorta pela visão
          de qualquer jeito --, então esconder a aba esconde só a aba.
        */}
        {(pedido?.nivel ?? usuario?.nivel) === 'N2' && (
          <Aba para="/pontos-causa" ativa={abaAtiva === 'pontos'}>
            Pontos de causa
          </Aba>
        )}
        {/* Pela coluna `admin` do servidor, não pelo nível: o administrador é
            N2, mas nem todo N2 administra. */}
        {usuario?.admin && (
          <Aba para="/admin" ativa={abaAtiva === 'admin'}>
            <span className="flex items-center gap-[6px]">
              <IconeEscudo tamanho={13} cor={abaAtiva === 'admin' ? '#0F1B2D' : '#8592A8'} />
              Administração
            </span>
          </Aba>
        )}
      </nav>

      <SeloAtualizacao />
    </div>
  )
}

/**
 * O NOME DA TELA — no lugar do breadcrumb (12/09/2026).
 *
 * O que estava aqui era uma trilha com UM item em cinco das oito rotas: um
 * rótulo com cara de link, que apontava para o mesmo lugar da aba
 * "Indicadores" ao lado. O canto esquerdo do cabeçalho passa a dizer ONDE VOCÊ
 * ESTÁ, com a mesma anatomia da faixa de identidade das reuniões — contexto em
 * caixa alta em cima, nome embaixo.
 *
 * A regra mora em `lib/titulo-da-tela.ts`, e o motivo de ser por ROTA (e não
 * cada tela se anunciar) está escrito lá.
 *
 * **Não é link.** O destino que o breadcrumb tinha já é o da aba ao lado, e um
 * título que às vezes navega e às vezes não é pior que um que nunca navega.
 */
/**
 * O CANTO ESQUERDO: o lugar SEMPRE, e as abas de GD ao lado quando a tela tem.
 *
 * Eram alternativas — título OU abas —, e o analista mostrou o custo com dois
 * prints da mesma tela: *"n3 quando abre, n3 quando carrega"*. Enquanto a
 * gerência carregava, a barra dizia `GD N3 · Gerência geral · NOR`; quando os
 * dados chegavam, isso **sumia** e davam lugar às abas. Dois defeitos numa
 * troca só: o conteúdo salta na frente de quem olha, e a tela carregada perde
 * a identidade que a vazia tinha.
 *
 * Agora convivem, e a divisão fica natural: o título diz ONDE você está, as
 * abas são A ESCOLHA que esta tela oferece. Um filete separa os dois.
 *
 * O rótulo "Gerenciamento diário de" saiu junto: o título já começa com
 * `GD N3`, e repetir a palavra ao lado era dizer duas vezes o que a sigla diz.
 */
function LugarOuGds() {
  const { publicado } = useGdsDaTela()

  /**
   * AS ABAS SÓ EXISTEM QUANDO HÁ ESCOLHA — a partir de DOIS.
   *
   * Era `> 0`, e com um GD só a barra mostrava o nome duas vezes: no título
   * (`GD N3 · Gerência geral · NOR · Vendas`) e numa aba "Vendas" ao lado, com
   * sublinhado de ativo. O analista: *"tá parecendo com um seletor"* — e é
   * exatamente isso, um seletor que não seleciona nada.
   *
   * É a mesma regra que matou o breadcrumb em 12/09: **trilha de um item não é
   * trilha**, é um rótulo com cara de controle. Aqui o custo era maior, porque
   * o rótulo prometia um clique que não leva a lugar nenhum.
   *
   * O N4 tem um GD por construção — a gerência pertence a um só, e Construção e
   * Não Construção são gerências DENTRO do GD de Vendas, não GDs. O N3 escolhe
   * de verdade, e hoje também tem um só porque apenas Vendas tem variáveis
   * cadastradas: as abas dele voltam sozinhas quando NPS, Perdas e Custo
   * entrarem, sem mexer aqui.
   */
  const temGds = publicado !== null && publicado.lista.length > 1

  return (
    <div className="flex items-stretch gap-[22px]">
      <TituloDaTela />
      {temGds && (
        <>
          <div className="my-[14px] w-px bg-borda-sutil" />
          <div className="flex items-stretch gap-[6px]">
            {publicado.lista.map((g) => {
              const ativo = g.codigo === publicado.ativo
              return (
                <button
                  key={g.codigo}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => {
                    publicado.trocar(g.codigo)
                  }}
                  /*
                   * O ATIVO É MAIOR, e não só mais escuro — 20px contra 15px.
                   *
                   * É o que o desenho do analista trouxe, e o motivo aparece na
                   * tela: as abas de GD dividem a barra com as de seção, e sem
                   * a diferença de TAMANHO as duas filas leem como uma só. O
                   * sublinhado sozinho não bastava.
                   */
                  className={[
                    'flex items-center whitespace-nowrap border-b-[4px] px-[14px] tracking-[-0.3px] transition-colors duration-hover',
                    ativo
                      ? 'border-escala-ponto text-[20px] font-extrabold text-texto'
                      : 'border-transparent text-[15px] font-semibold text-texto-ter hover:text-texto',
                  ].join(' ')}
                >
                  {g.nome}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function TituloDaTela() {
  const { pathname } = useLocation()
  const { usuario } = useSessao()
  const { pedido } = useVisao()
  const { publicado } = useGdsDaTela()

  /**
   * O GD VAI PARA O TÍTULO QUANDO HÁ UM SÓ; com vários, quem diz são as abas.
   *
   * É a mesma regra que matou o breadcrumb: **trilha de um item não é trilha**.
   * Uma fileira de abas com uma aba só é um rótulo com cara de controle — e o
   * GD, que é o recorte mais importante da reunião, ficava invisível no N4
   * justamente por isso.
   *
   * Com mais de um (o N3), repetir o ativo no título seria a mesma informação
   * duas vezes na mesma barra: o incômodo que o analista apontou em 12/09.
   */
  const gdUnico =
    publicado !== null && publicado.lista.length === 1 ? (publicado.lista[0]?.nome ?? null) : null

  const { partes, nome } = tituloDaTela(
    pathname,
    { nivel: usuario?.nivel ?? null, filial: usuario?.filial ?? null },
    pedido ?? null,
    gdUnico,
  )

  /**
   * SÓ O RECORTE — o nome da tela saiu em 12/09/2026.
   *
   * O bloco mostrava `N2 · DIRETORIA` sobre `Reunião diária`, e a segunda linha
   * repetia o `h1` da página três centímetros abaixo. Pedido do analista:
   * *"tire o 'Reunião diária', deixe só o título"*.
   *
   * A divisão fica limpa: o cabeçalho diz QUEM você é e ONDE está — o que vale
   * em toda tela e não rola —, e a página diz o que ela é.
   *
   * O `nome` sobrevive como RESERVA, e não por sobra: sem sessão carregada não
   * há recorte para mostrar, e o canto voltaria a ficar vazio — que foi o
   * defeito do breadcrumb órfão. Com a reserva, ele mostra o nome da tela até
   * a sessão chegar.
   */
  /**
   * O TÍTULO COM HIERARQUIA DENTRO DELE — e não um bloco em negrito.
   *
   * Primeiro foi 10px em caixa alta (tipografia de rótulo, de quando isto era
   * um breadcrumb de apoio). Depois virou 17px bold inteiro, e o analista:
   * *"não gostei dessa fonte em negrito, deixe algo mais sofisticado"*. Ele
   * está certo — negrito em tudo é ênfase em nada, e a frase tem duas partes
   * de peso diferente: `GD N2` é o que se procura, `Diretoria e Gerência
   * Corporativa` é a explicação dele.
   *
   * Então o peso separa as duas: o nível em semibold na tinta cheia, o resto em
   * regular no texto secundário, e os separadores mais apagados ainda. O
   * `tracking` negativo junta a linha; em 17px a fonte abre sozinha.
   *
   * 17px e não 22: 22 é a aba de GD ativa, que ocupa este mesmo canto nas
   * telas de reunião. Os dois nunca aparecem juntos, e dar o mesmo tamanho aos
   * dois faria a barra mudar de altura ao trocar de tela.
   */
  const pedacos = partes.length > 0 ? partes : [nome]

  return (
    <div className="flex flex-col justify-center py-2">
      <span className="flex items-baseline gap-[7px] text-[17px] leading-tight tracking-[-0.2px]">
        {pedacos.map((p, i) => (
          <span key={p} className="flex items-baseline gap-[7px]">
            {i > 0 && <span className="text-texto-off">·</span>}
            <span className={i === 0 ? 'font-semibold text-texto' : 'font-normal text-texto-sec'}>
              {p}
            </span>
          </span>
        ))}
      </span>
    </div>
  )
}

function Aba({ para, ativa, children }: { para: string; ativa: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={para}
      aria-current={ativa ? 'page' : undefined}
      className={[
        'flex items-center border-b-[3px] px-4 transition-colors duration-hover',
        ativa
          ? 'border-escala-ponto text-corpo font-bold text-texto'
          : 'border-transparent text-corpo font-medium text-texto-sec hover:text-texto',
      ].join(' ')}
    >
      {children}
    </Link>
  )
}

interface StatusSync {
  atualizadoEm: string | null
  algumaFonteAtrasada: boolean
  fontes: Array<{ fonte: string; atualizadoEm: string | null; atrasada: boolean }>
}

/**
 * Selo "ATUALIZADO".
 *
 * Mostra a data do dado que está na tela, não a de agora. Se a carga falhou, o
 * painel segue exibindo o último valor bom — e o selo precisa deixar claro que
 * ele é velho, senão a diretoria decide sobre número desatualizado achando que
 * é de hoje.
 */
function SeloAtualizacao() {
  const { data } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => api.get<StatusSync>('/sync/status'),
    staleTime: 5 * 60_000,
  })

  const quando = data?.atualizadoEm ? new Date(data.atualizadoEm) : null
  const deHoje = quando ? quando.toDateString() === new Date().toDateString() : false

  /*
   * COM A HORA nos dois casos.
   *
   * A data sozinha respondia "que dia", e não "há quanto tempo". Numa carga que
   * roda de madrugada, `03/09` pode ser 03h ou 23h -- e a diferença é entre um
   * atraso de um dia e de quase dois. Hoje a data some porque é hoje.
   */
  const hora = (d: Date) =>
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  const texto = !quando
    ? '—'
    : deHoje
      ? hora(quando)
      : `${quando.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora(quando)}`

  const atrasado = Boolean(quando) && !deHoje

  return (
    <div
      className="flex items-center gap-[7px] self-center border-l border-borda-divisor pl-5"
      title={
        data?.fontes
          .map((f) => `${f.fonte}: ${f.atualizadoEm ? new Date(f.atualizadoEm).toLocaleString('pt-BR') : 'sem carga'}`)
          .join('\n') ?? ''
      }
    >
      <IconeRelogio tamanho={14} cor={atrasado ? '#C4501B' : '#8592A8'} />
      <span
        className={`text-eyebrow uppercase ${atrasado ? 'text-escala-texto' : 'text-texto-ter'}`}
      >
        {/*
          "Atualizado em" nos dois casos, e não "Dado de" quando atrasa.
          O número é o mesmo nas duas situações -- `atualizadoEm`, a hora em que
          a carga rodou --, e trocar o rótulo sugeria estar trocando a medida
          junto: "dado de" se lê como a data do FATO, que é outra coisa. O que
          avisa do atraso é o âmbar e o relógio, não a palavra.
        */}
        {atrasado ? 'Atualizado em' : 'Atualizado'}
      </span>
      <span className={`tabular text-legenda font-semibold ${atrasado ? 'text-escala-texto' : 'text-texto'}`}>
        {texto}
      </span>
    </div>
  )
}

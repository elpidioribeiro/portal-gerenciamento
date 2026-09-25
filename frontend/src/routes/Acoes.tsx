import { useState } from 'react'
import { AbrirAcao } from '../components/acoes/AbrirAcao.js'
import { useSessao } from '../contexts/SessaoContext.js'
import { mensagemDeErro, type ResumoAcao } from '../lib/api.js'
import { FILTROS, useAcoes, type Filtro, type Relacao } from '../hooks/useAcoes.js'
import { CardAcao } from '../components/acoes/CardAcao.js'

type ComRelacao = { acao: ResumoAcao; relacao: Relacao }

/**
 * O quadro de ações — uma página, todas as suas contramedidas do ciclo.
 *
 * Não são janelas separadas: "A fazer", "Escaladas" e "Concluídas" FILTRAM o
 * mesmo quadro. As pílulas viravam telas antes, e isso obrigava a lembrar em
 * qual aba cada coisa morava, além de esconder o ciclo inteiro — nunca dava
 * para ver de uma vez o que anda, o que subiu e o que fechou. Ver PLANO §7.5.
 */
export function Acoes() {
  const [abrindo, setAbrindo] = useState(false)
  const { usuario } = useSessao()
  const { minhas, contar, isPending, error } = useAcoes()
  const [filtro, setFiltro] = useState<Filtro>('todas')

  const meuNivel = usuario?.nivel ?? 'N3'
  /*
   * A ABA "NÍVEL ABAIXO" SAIU (11/09/2026).
   *
   * Decisão do analista: *"pode tirar a aba nível abaixo das ações"*. A visão
   * gerencial não acabou -- ela **mudou de lugar**, para dentro do GD, onde o
   * contexto já é aquela gerência: *"o N3 ao clicar em Construção e entrar no
   * GD e descer vê as ações que estão pra aquele N4"*.
   *
   * É o bloco "o que já está sendo feito" (§7.61), que a reunião do N4 já
   * mostra para quem olha de cima. Esta tela volta a ser o que o nome diz: as
   * MINHAS ações -- o que passou pela minha mão.
   */
  const escopo = minhas
  const visiveis = filtro === 'todas' ? escopo : escopo.filter((x) => x.relacao === filtro)

  return (
    <div className="flex flex-col gap-5">
      {/* Sem pré-preenchimento: aqui a causa é escolhida no formulário. Do
          Pareto ela já vem, e travada — ver AbrirAcao. */}
      <AbrirAcao aberto={abrindo} onFechar={() => setAbrindo(false)} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-titulo-tela">Ações</h1>
          <p className="text-corpo text-texto-sec">Todas as suas contramedidas do ciclo</p>
        </div>
        <button
          type="button"
          onClick={() => setAbrindo(true)}
          className="flex items-center gap-2 rounded-controle bg-brand-btn px-4 py-2.5 text-corpo font-bold text-white hover:bg-brand-btnHover"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Abrir ação
        </button>
      </div>

      {/*
        O NÍVEL vira SELO, e não mais a primeira de duas abas.

        Com a segunda aba fora, um par de abas com um elemento só seria um
        controle que não controla nada -- e o nível continua valendo escrito: é
        o recorte de tudo o que está na lista.
      */}
      <div className="flex items-center gap-2 border-b border-borda pb-3">
        <span className="text-eyebrow uppercase text-texto-ter">{meuNivel}</span>
        <span className="inline-flex min-w-[18px] justify-center rounded-full bg-borda-clara px-1.5 text-micro text-texto-sec">
          {minhas.length}
        </span>
      </div>

      {(
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-0.5 text-eyebrow uppercase text-texto-ter">Filtrar</span>
          {/*
            SÓ O QUE TEM AÇÃO — pedido do analista em 11/09/2026.

            Uma fileira de pílulas zeradas faz o quadro parecer cheio de estados
            que não existem, e obriga a ler cinco números para descobrir que
            quatro são zero. É a mesma razão pela qual as COLUNAS já só aparecem
            quando têm ação ("o agrupamento organiza o que há, não lembra o que
            não há"); o filtro estava discordando da própria tela.

            Duas exceções, e as duas existem para a régua não sumir debaixo do
            dedo de quem está usando:

            - **"Todas" fica sempre.** É a volta para o quadro inteiro; some-la
              quando o ciclo está vazio deixaria a pessoa sem nada em que clicar.
            - **O filtro ESCOLHIDO fica**, mesmo zerando. Ele zera por ação de
              quem olha (concluir a última ação a fazer, por exemplo) e, sem
              isto, a pílula sob o cursor desapareceria no clique seguinte,
              levando junto a explicação de por que a lista ficou vazia.
          */}
          {FILTROS.filter(
            (f) => f.chave === 'todas' || f.chave === filtro || contar(f.chave, escopo) > 0,
          ).map((f) => (
            <button
              key={f.chave}
              type="button"
              onClick={() => setFiltro(f.chave)}
              className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-legenda font-bold ${
                filtro === f.chave
                  ? 'border-texto bg-texto text-white'
                  : 'border-borda bg-superficie text-texto-sec hover:border-borda-hover'
              }`}
            >
              {f.rotulo}
              <span
                className={`inline-flex min-w-[18px] justify-center rounded-full px-1.5 text-micro ${
                  filtro === f.chave ? 'bg-white/20 text-white' : 'bg-borda-clara text-texto-sec'
                }`}
              >
                {contar(f.chave, escopo)}
              </span>
            </button>
          ))}
        </div>
      )}

      {isPending && <Estado texto="Carregando ações…" />}
      {error && <Estado texto={mensagemDeErro(error, 'carregar as ações')} erro />}
      {!isPending && !error && <Colunas itens={visiveis} filtro={filtro} />}
    </div>
  )
}

/**
 * As colunas são os agrupamentos, e só aparecem as que têm ação.
 *
 * O agrupamento organiza o que há, não lembra o que não há — uma fileira de
 * colunas vazias faz o quadro parecer cheio de trabalho que não existe.
 *
 * A ordem sai dos dados, não de uma lista fixa aqui: `ordem` do agrupamento é
 * do banco, e repetir a sequência no frontend é como as duas passam a
 * discordar. A lista já vem ordenada pelo servidor.
 */
function Colunas({ itens, filtro }: { itens: ComRelacao[]; filtro: Filtro }) {
  const porColuna = new Map<string, { grupo: string | null; itens: ComRelacao[] }>()
  for (const x of itens) {
    const { nome, grupo } = x.acao.agrupamento
    const atual = porColuna.get(nome) ?? { grupo, itens: [] }
    atual.itens.push(x)
    porColuna.set(nome, atual)
  }

  if (porColuna.size === 0) return <Vazio filtro={filtro} />

  return (
    <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(330px,1fr))]">
      {[...porColuna].map(([nome, col]) => (
        <div
          key={nome}
          className="overflow-hidden rounded-card border border-borda bg-superficie shadow-card"
        >
          <div className="flex items-start gap-2.5 px-5 pb-3.5 pt-5">
            <div className="flex flex-grow flex-col gap-1.5">
              {col.grupo && <span className="text-eyebrow uppercase text-texto-ter">{col.grupo}</span>}
              <span className="text-titulo-secao">{nome}</span>
            </div>
            <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-critico-bg px-1.5 text-micro font-bold text-critico-texto">
              {col.itens.length}
            </span>
          </div>
          {col.itens.map((x) => (
            <CardAcao key={x.acao.codigo} acao={x.acao} relacao={x.relacao} />
          ))}
        </div>
      ))}
    </div>
  )
}

const MOTIVO_VAZIO: Record<Filtro, string> = {
  todas: 'Nenhuma ação no ciclo.',
  afazer: 'Nenhuma ação esperando algo de você.',
  direcionada: 'Você não pôs nenhuma ação na mão de outra pessoa do seu nível.',
  escalada: 'Você não tem ação escalada no momento.',
  rejeitada: 'Nenhuma ação devolvida neste ciclo — rejeitar fecha a ação.',
  concluida: 'Nenhuma ação concluída neste ciclo ainda.',
}

function Vazio({ filtro }: { filtro: Filtro }) {
  return (
    <div className="rounded-card border border-borda bg-superficie px-6 py-11 text-center shadow-card">
      <p className="text-corpo-forte">Nada neste filtro.</p>
      <p className="mt-1 text-corpo text-texto-sec">{MOTIVO_VAZIO[filtro]}</p>
    </div>
  )
}


function Estado({ texto, erro = false }: { texto: string; erro?: boolean }) {
  return (
    <div
      className={`rounded-card border px-6 py-11 text-center text-corpo shadow-card ${
        erro
          ? 'border-critico-borda bg-critico-bg text-critico-texto'
          : 'border-borda bg-superficie text-texto-sec'
      }`}
    >
      {texto}
    </div>
  )
}

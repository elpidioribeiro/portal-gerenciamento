import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CardGrafico } from '../components/grafico/CardGrafico.js'
import { GraficoLinha, type PontoGrafico } from '../components/grafico/GraficoLinha.js'
import { usePeriodo } from '../contexts/PeriodoContext.js'
import { useIndicador, type Indicador as DadosIndicador } from '../hooks/useIndicador.js'
import type { Situacao } from '../hooks/usePainel.js'
import { acoesApi, mensagemDeErro, ROTULO_STATUS, variaveisApi } from '../lib/api.js'
import { nomeLegivel } from '../lib/nomes.js'
import { formatarDesvio, formatarValorIndicador } from '../lib/formato.js'

/** Drill-down do indicador numa filial — handoff seção "3". */
export function Indicador() {
  const { indicador: codigo, filial } = useParams()
  const { rotulo: rotuloPeriodo } = usePeriodo()
  const { data, isPending, error } = useIndicador(codigo, filial)

  if (isPending) return <Aviso texto="Carregando indicador…" />
  if (error) return <Aviso texto={mensagemDeErro(error, 'carregar o indicador')} erro />

  return (
    <div className="flex flex-col gap-7">
      <Cabecalho dados={data} />
      <CardGrafico dados={data} rotuloPeriodo={rotuloPeriodo} />
      <SecaoVariaveis dados={data} />
    </div>
  )
}

function Cabecalho({ dados }: { dados: DadosIndicador }) {
  const { indicador, filial, situacao, realizado, meta, desvio, aderencia } = dados

  return (
    <div className="flex flex-wrap items-start justify-between gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-eyebrow uppercase text-texto-ter">Indicador</span>
        <h1 className="text-titulo-detalhe">
          {indicador.nome} · {filial.sigla}
        </h1>
        <p className="text-corpo text-texto-sec">Evolução do indicador no período</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <CardKpi
          rotulo="Realizado"
          valor={formatarValorIndicador(indicador.codigo, realizado, indicador.casasDecimais)}
          situacao={situacao}
          tingir
        />
        <CardKpi
          rotulo="Meta"
          valor={
            meta === null
              ? '—'
              : formatarValorIndicador(indicador.codigo, meta, indicador.casasDecimais)
          }
        />
        <CardKpi
          rotulo="Aderência"
          valor={aderencia === null ? '—' : `${aderencia.toLocaleString('pt-BR')}%`}
          detalhe={formatarDesvio(desvio)}
          situacao={situacao}
          tingirFundo
        />
      </div>
    </div>
  )
}

const CLASSE_SITUACAO: Record<Situacao, { texto: string; fundo: string }> = {
  // 'otimo' (azul) só aparece em Perdas: bem acima da meta.
  otimo: { texto: 'text-otimo-texto', fundo: 'bg-otimo-bg border-otimo-borda' },
  acima: { texto: 'text-ok-texto', fundo: 'bg-ok-bg border-ok-borda' },
  // 'atencao' só aparece em NPS: até 5 pontos abaixo da meta.
  atencao: { texto: 'text-risco-texto', fundo: 'bg-risco-bg border-risco-borda' },
  abaixo: { texto: 'text-critico-texto', fundo: 'bg-critico-bg border-critico-borda' },
}

function CardKpi({
  rotulo,
  valor,
  detalhe,
  situacao,
  tingir = false,
  tingirFundo = false,
}: {
  rotulo: string
  valor: string
  detalhe?: string
  situacao?: Situacao | null
  tingir?: boolean
  tingirFundo?: boolean
}) {
  const cor = situacao ? CLASSE_SITUACAO[situacao] : null

  return (
    <div
      className={`flex min-w-[150px] flex-col gap-1 rounded-card border px-5 py-4 shadow-card ${
        tingirFundo && cor ? cor.fundo : 'border-borda bg-superficie'
      }`}
    >
      <span className="text-eyebrow uppercase text-texto-ter">{rotulo}</span>
      <span className={`tabular text-kpi ${tingir && cor ? cor.texto : 'text-texto'}`}>{valor}</span>
      {detalhe && (
        <span className={`tabular text-legenda font-semibold ${cor ? cor.texto : 'text-texto-sec'}`}>
          {detalhe}
        </span>
      )}
    </div>
  )
}

/**
 * As variáveis de controle do indicador, e o que cada uma mostra.
 *
 * Os chips eram `<span>`: o primeiro pintado como selecionado, nenhum reagindo
 * a clique, e um cartão dizendo que o conteúdo "entra na próxima etapa". Ela
 * chegou (§7.43).
 *
 * Cada variável responde às duas perguntas seguintes do ciclo do GD, na loja
 * escolhida:
 *
 *   POR QUÊ        o Pareto de pontos de causa
 *   O QUE SE FAZ   as contramedidas abertas naquela variável
 *
 *   COMO ESTÁ INDO  a evolução semanal da variável na loja
 *
 * A evolução chegou depois das outras duas (§7.44), e por um engano meu: eu
 * dissera que era impossível porque "percentual não se soma". Não se soma
 * mesmo — mas o cálculo devolve numerador e denominador, e esses somam.
 */
function SecaoVariaveis({ dados }: { dados: DadosIndicador }) {
  const { periodo } = usePeriodo()
  /*
   * O Pareto é sempre de um MÊS: a marcação de ponto de causa é por (ano, mês,
   * semana). No modo "ano inteiro" o seletor não tem mês, e usar 1 seria
   * mostrar janeiro chamando de ano -- então cai no mês corrente, que é o
   * recorte da reunião.
   */
  const ano = periodo.ano
  const mes = periodo.modo === 'mes' ? periodo.mes : new Date().getMonth() + 1
  const [escolhida, setEscolhida] = useState<string | null>(null)

  /*
   * A primeira é o padrão, e a escolha é validada contra a lista: trocar de
   * indicador troca as variáveis, e um id guardado do anterior apontaria para
   * algo que não está mais na tela.
   */
  const valida = dados.variaveis.some((v) => v.id === escolhida) ? escolhida : null
  const atual = valida ?? dados.variaveis[0]?.id ?? null
  const nome = dados.variaveis.find((v) => v.id === atual)?.nome ?? ''

  if (dados.variaveis.length === 0) return null

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-titulo-secao">Variáveis de controle</h2>
      <div className="flex flex-wrap gap-2">
        {dados.variaveis.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setEscolhida(v.id)}
            className={`rounded-full border px-4 py-2 text-corpo font-semibold transition-colors ${
              v.id === atual
                ? 'border-navy bg-navy text-white'
                : 'border-borda bg-superficie text-texto-sec hover:border-borda-hover'
            }`}
          >
            {v.nome}
          </button>
        ))}
      </div>

      {atual && (
        <GraficoDaVariavel
          variavelId={atual}
          nome={nome}
          filial={dados.filial.sigla}
          ano={ano}
          mes={mes}
        />
      )}

      {atual && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ParetoDaVariavel
            variavelId={atual}
            nome={nome}
            filial={dados.filial.sigla}
            ano={ano}
            mes={mes}
          />
          <AcoesDaVariavel variavelId={atual} nome={nome} filial={dados.filial.sigla} />
        </div>
      )}
    </section>
  )
}

/**
 * A fração do resumo, na unidade CERTA.
 *
 * `38 de 68` são pessoas; os mesmos dígitos em Vendas são reais, e se leem
 * `R$ 41,42 mi`. Quem diz qual é o servidor (`conta`), porque as duas variáveis
 * têm unidade `%` -- o percentual é o RESULTADO, não o que se contou.
 */
function fracao(v: number, conta: 'PESSOAS' | 'REAIS'): string {
  if (conta === 'PESSOAS') return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
  if (v >= 1_000_000)
    return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`
  return `R$ ${Math.round(v / 1000).toLocaleString('pt-BR')} mil`
}

/**
 * COMO ESTÁ INDO — a evolução semanal da variável, no estilo do indicador.
 *
 * Mesmo componente de gráfico, para a leitura ser a mesma: quem desce a tela
 * vê a linha do indicador e a da variável desenhadas do mesmo jeito, e não
 * precisa reaprender a ler no meio do caminho.
 *
 * A linha é o PERCENTUAL contra a meta da variável, e a régua é a meta: a do
 * indicador plota desvio, esta plota cumprimento. São grandezas diferentes com
 * a mesma forma, e é por isso que a legenda diz qual é qual.
 */
function GraficoDaVariavel({
  variavelId,
  nome,
  filial,
  ano,
  mes,
}: {
  variavelId: string
  nome: string
  filial: string
  ano: number
  mes: number
}) {
  const { data, isPending, error } = useQuery({
    queryKey: ['serie-filial', variavelId, filial, ano, mes],
    queryFn: () => variaveisApi.serieDaFilial(variavelId, { ano, mes, filial }),
    /*
     * Sem repetir: o 422 de "esta variável não tem série" é resposta, não
     * falha de rede. Tentar de novo três vezes só atrasaria a mensagem.
     */
    retry: false,
  })

  if (isPending) {
    return (
      <div className="rounded-card border border-borda bg-superficie px-6 py-8 shadow-card">
        <p className="text-corpo text-texto-sec">Carregando a evolução…</p>
      </div>
    )
  }

  /*
   * SEM SÉRIE não é erro: a variável de controle é cadastro, e os fatos são por
   * indicador. Só Performance Vendedor e Vendas têm cálculo próprio -- dizer
   * isso é mais útil do que um gráfico vazio ou uma mensagem de falha.
   */
  if (error) {
    return (
      <div className="rounded-card border border-borda bg-superficie px-6 py-6 shadow-card">
        <p className="text-corpo text-texto-sec">

          {nome} não tem série própria — os fatos são por indicador, e esta variável não tem
          cálculo semanal.
        </p>
      </div>
    )
  }

  /*
   * Os pontos vêm PRONTOS do servidor, com o `y` já convertido. Ver o
   * comentário em `serieDaFilial`.
   */
  const pontos: PontoGrafico[] = data.pontos.map((p) => ({
    rotulo: p.rotulo,
    valor: p.valor,
    valorIndicador: p.valor,
    desvio: p.valor === null ? null : p.valor - 100,
    y: p.y,
  }))

  const ultimo = [...pontos].reverse().find((p) => p.valor !== null)?.valor ?? null
  const situacao = ultimo === null ? null : ultimo >= 100 ? 'acima' : ultimo >= 95 ? 'atencao' : 'abaixo'

  return (
    <>
      <section className="flex flex-col gap-5 rounded-card border border-borda bg-superficie p-6 shadow-card">
        {/*
        O RESUMO, condensado — o par do cartão do N3 numa linha só.
        
        O gráfico responde "como está indo" e não responde "quanto é": 92% de
        quê, de quantos. Lá o par ocupa um cartão porque é a leitura principal;
        aqui ele acompanha o título, porque a leitura principal é a linha.
      */}
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-titulo-secao">
            Evolução de {nome} · {filial} · semanal
          </h3>
          {data.resumo && (
            <span className="flex items-baseline gap-2">
              <strong className="text-[26px] font-extrabold leading-none tracking-[-0.5px]">
                {Math.round(data.resumo.percentual)}%
              </strong>
              <span className="text-legenda text-texto-sec">
                {fracao(data.resumo.numerador, data.resumo.conta)} de{' '}
                {fracao(data.resumo.denominador, data.resumo.conta)} · Sem {data.resumo.semana}
              </span>
              {data.resumo.delta !== null && (
                <span
                  className={`text-legenda font-bold ${
                    data.resumo.delta > 0
                      ? 'text-ok-texto'
                      : data.resumo.delta < 0
                        ? 'text-critico-texto'
                        : 'text-texto-ter'
                  }`}
                >
                  {data.resumo.delta > 0 ? '+' : ''}
                  {data.resumo.delta.toFixed(1).replace('.', ',')} p.p.
                </span>
              )}
            </span>
          )}
        </div>
        <GraficoLinha
          pontos={pontos}
          escalaY={data.escalaY}
          yMeta={data.yMeta}
          situacao={situacao}
          formatarPonto={(p) => (p.valor === null ? '—' : `${Math.round(p.valor)}%`)}
          legenda={`${nome} · ${filial} · % de cumprimento da meta, semana a semana`}
        />
      </section>

      {data.resumo && data.resumo.gerencias.length > 0 && (
        <AreasDaVariavel gerencias={data.resumo.gerencias} conta={data.resumo.conta} />
      )}
    </>
  )
}

/**
 * ONDE ATACAR — as áreas de venda da variável, agrupadas por gerência.
 *
 * Um cartão por gerência, lado a lado, e dentro dele uma linha por área com o
 * gestor embaixo do nome. Piores primeiro, como vem do servidor.
 *
 * Antes isto era uma lista rasa indentada debaixo do gráfico, e não dava para
 * ler: treze áreas de duas gerências numa coluna só, sem barra e sem peso
 * visual, obrigavam a comparar percentuais de cabeça. A comparação é o trabalho
 * da tela, não de quem olha -- a barra faz o olho ver a distância até a meta
 * antes de ler o número, e o nome do gestor ao lado diz de quem é a conversa.
 */
function AreasDaVariavel({
  gerencias,
  conta,
}: {
  gerencias: NonNullable<
    Awaited<ReturnType<typeof variaveisApi.serieDaFilial>>['resumo']
  >['gerencias']
  conta: 'PESSOAS' | 'REAIS'
}) {
  /*
   * O filtro é um ATALHO, não um modo: a lista inteira continua sendo o padrão.
   * Numa reunião curta às vezes só interessa quem está fora, e rolar treze
   * áreas para achar cinco custa o tempo que não há.
   */
  const [soFora, setSoFora] = useState(false)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-titulo-secao">Áreas de venda</h3>
          <span className="text-legenda text-texto-ter">
            Piores primeiro · gestor responsável ao lado
          </span>
        </span>
        <button
          type="button"
          onClick={() => setSoFora((v) => !v)}
          className="text-legenda font-bold text-critico-texto hover:underline"
        >
          {soFora ? 'Mostrar todas as áreas' : 'Mostrar só quem está fora da meta'}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {gerencias.map((g) => {
          /*
           * `!== null` explícito, e não `?? 0`: sem percentual não é 0%, e 0%
           * seria "fora da meta" -- a afirmação mais forte sobre quem ninguém
           * comparou. Hoje o servidor já descarta área sem denominador, então o
           * caminho é inalcançável; a expressão fica certa mesmo assim, porque
           * é lá que ela morde no dia em que aquele filtro mudar.
           */
          const visiveis = soFora
            ? g.areas.filter((a) => a.percentual !== null && a.percentual < 100)
            : g.areas
          const fora = g.denominador - g.numerador

          return (
            <div
              key={g.nome}
              className="flex flex-col rounded-card border border-borda bg-superficie shadow-card"
            >
              <div className="flex items-start justify-between gap-3 border-b border-borda-sutil px-5 py-4">
                <div className="min-w-0">
                  <h4 className="text-corpo-forte">{nomeLegivel(g.nome)}</h4>
                  {/*
                    A frase muda com a GRANDEZA, e não só a unidade.
                    
                    Em PESSOAS o numerador é quem bateu, e "27 de 50 vendedores
                    na meta" é literal. Em REAIS o numerador é o que se vendeu e
                    o denominador é a meta -- "R$ 41 mi de R$ 44 mi na meta"
                    lê-se como se 41 milhões estivessem dentro de um alvo, e o
                    que falta não está "fora da meta": está faltando. O resumo
                    do N4 já dizia certo ("faltam para a meta da semana"); aqui
                    a mesma grandeza tinha ganhado o nome da outra.
                  */}
                  <p className="text-legenda text-texto-ter">
                    {g.areas.length} área{g.areas.length === 1 ? '' : 's'} ·{' '}
                    {conta === 'PESSOAS'
                      ? `${fracao(g.numerador, conta)} de ${fracao(g.denominador, conta)}${unidade(conta, g.denominador)} na meta`
                      : `${fracao(g.numerador, conta)} de ${fracao(g.denominador, conta)} da meta`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={`text-[22px] font-extrabold leading-none ${corDoPercentual(g.percentual)}`}
                  >
                    {g.percentual === null ? '—' : `${Math.round(g.percentual)}%`}
                  </span>
                  {fora > 0 && (
                    <p className="text-micro text-texto-ter">
                      {conta === 'PESSOAS'
                        ? `${fracao(fora, conta)}${unidade(conta, fora)} fora da meta`
                        : `faltam ${fracao(fora, conta)}`}
                    </p>
                  )}
                </div>
              </div>

              {/*
                DUAS ausências, e elas não querem dizer a mesma coisa.
                
                Com o filtro ligado, lista vazia é "ninguém está fora" -- boa
                notícia. Sem o filtro, é "nenhuma área tem com o que comparar",
                e dizer "todas na meta" ali seria pintar de verde o que ninguém
                mediu: a gerência volta do servidor mesmo sem dado nenhum, com
                `areas: []` e percentual nulo. É a regra de §7.36 aplicada à
                frase em vez de à cor.
              */}
              {visiveis.length === 0 && (
                <p className="px-5 py-4 text-legenda text-texto-sec">
                  {soFora
                    ? 'Todas as áreas desta gerência estão na meta.'
                    : 'Nenhuma área desta gerência tem meta na competência.'}
                </p>
              )}

              {visiveis.map((a) => (
                <div
                  key={a.nome}
                  className="flex flex-col gap-1.5 border-b border-borda-sutil px-5 py-3 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-corpo font-semibold">{nomeLegivel(a.nome)}</p>
                      {a.supervisor && (
                        <p className="truncate text-micro text-texto-ter">
                          {nomeLegivel(a.supervisor)}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 text-corpo font-bold ${corDoPercentual(a.percentual)}`}
                    >
                      {a.percentual === null ? '—' : `${Math.round(a.percentual)}%`}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <Barrinha percentual={a.percentual} />
                    <span className="shrink-0 text-micro tabular-nums text-texto-ter">
                      {fracao(a.numerador, conta)} de {fracao(a.denominador, conta)}
                      {unidade(conta, a.denominador)}
                      {conta === 'REAIS' && ' da meta'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * A distância até a meta, em forma antes de em número.
 *
 * Corta em 100: passar da meta é bom, mas o que a barra mede é o quanto falta,
 * e uma barra mais longa que as outras por ter 130% competiria pelo olho com as
 * que estão em 40%.
 */
function Barrinha({ percentual }: { percentual: number | null }) {
  return (
    <span className="block h-[6px] flex-1 overflow-hidden rounded-full bg-fundo" aria-hidden>
      <span
        className="block h-full rounded-full"
        style={{
          width: `${Math.max(0, Math.min(100, percentual ?? 0))}%`,
          background:
            percentual === null
              ? '#c9d2e0'
              : percentual >= 100
                ? '#16a34a'
                : percentual >= 75
                  ? '#f0a020'
                  : '#c62828',
        }}
      />
    </span>
  )
}

/** O substantivo do que se conta — em reais o número já se explica sozinho. */
function unidade(conta: 'PESSOAS' | 'REAIS', n: number): string {
  if (conta === 'REAIS') return ''
  return n === 1 ? ' vendedor' : ' vendedores'
}

/**
 * A cor do percentual contra a meta de 100%.
 *
 * Três estados, e o do meio importa: `null` é CINZA, e não verde. É a mesma
 * correção de §7.36 -- pintar de verde o que ninguém comparou é a afirmação
 * mais forte da tela feita sobre o que não se mediu.
 */
function corDoPercentual(p: number | null): string {
  if (p === null) return 'text-texto-ter'
  if (p >= 100) return 'text-ok-texto'
  if (p >= 75) return 'text-andamento-texto'
  return 'text-critico-texto'
}

/** POR QUÊ — o Pareto da variável, somando as gerências da loja. */
function ParetoDaVariavel({
  variavelId,
  nome,
  filial,
  ano,
  mes,
}: {
  variavelId: string
  nome: string
  filial: string
  ano: number
  mes: number
}) {
  const { data, isPending } = useQuery({
    queryKey: ['pareto-filial', variavelId, filial, ano, mes],
    queryFn: () => variaveisApi.paretoDaFilial(variavelId, { ano, mes, filial }),
  })

  return (
    <div className="flex flex-col gap-3 rounded-card border border-borda bg-superficie px-5 py-4 shadow-card">
      <div>
        <h3 className="text-corpo-forte">Onde atacar primeiro</h3>
        <p className="text-legenda text-texto-ter">
          {nome} · {filial} · em vermelho, as causas que respondem por 80%
        </p>
      </div>

      {isPending && <p className="text-corpo text-texto-sec">Carregando…</p>}
      {!isPending && (data?.total ?? 0) === 0 && (
        <p className="text-corpo text-texto-sec">
          Nenhuma causa marcada nesta variável no período — a marcação acontece na reunião do N4.
        </p>
      )}

      {(data?.itens ?? []).map((i) => (
        <div key={i.pontoCausaId} className="flex flex-col gap-1">
          <span className="text-corpo font-semibold">{i.nome}</span>
          <div className="flex items-center gap-3">
            <span className="h-[6px] flex-1 overflow-hidden rounded-full bg-fundo">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${i.percentual}%`,
                  background: i.vital ? 'var(--cri-ponto, #c62828)' : '#a9b4c6',
                }}
              />
            </span>
            <span className="w-[74px] shrink-0 text-right text-legenda text-texto-sec">
              <strong className="text-texto">{i.quantidade}</strong> · {Math.round(i.percentual)}%
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

/** O QUE SE FAZ — as contramedidas abertas naquela variável, na loja. */
function AcoesDaVariavel({
  variavelId,
  nome,
  filial,
}: {
  variavelId: string
  nome: string
  filial: string
}) {
  const { data, isPending } = useQuery({
    queryKey: ['acoes', 'variavel', variavelId, filial],
    queryFn: () => acoesApi.lista({ variavelControleId: variavelId, filial }),
  })
  const lista = data?.contramedidas ?? []

  return (
    <div className="flex flex-col gap-3 rounded-card border border-borda bg-superficie px-5 py-4 shadow-card">
      <div>
        <h3 className="text-corpo-forte">O que já está sendo feito</h3>
        <p className="text-legenda text-texto-ter">
          {nome} · {filial} · contramedidas abertas nesta variável
        </p>
      </div>

      {isPending && <p className="text-corpo text-texto-sec">Carregando…</p>}
      {!isPending && lista.length === 0 && (
        <p className="text-corpo text-texto-sec">
          Nenhuma contramedida aberta nesta variável. A ação nasce de um ponto de causa, no quadro
          de quem marca.
        </p>
      )}

      {lista.map((a) => (
        <Link
          key={a.codigo}
          to={`/contramedida/${a.codigo}`}
          className="flex flex-col gap-1 rounded-controle border border-borda-sutil px-3 py-2 hover:border-borda-hover"
        >
          <span className="text-corpo font-semibold">{a.titulo}</span>
          <span className="text-legenda text-texto-ter">
            {a.codigo} · {a.nivelAtual} · {a.responsavel} · {ROTULO_STATUS[a.status]}
          </span>
        </Link>
      ))}
    </div>
  )
}

function Aviso({ texto, erro = false }: { texto: string; erro?: boolean }) {
  return (
    <div className="rounded-card border border-borda bg-superficie px-6 py-8 shadow-card">
      <p className={`text-corpo ${erro ? 'text-critico-texto' : 'text-texto-sec'}`}>{texto}</p>
    </div>
  )
}

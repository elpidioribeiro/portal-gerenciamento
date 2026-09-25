import { useState, type ReactNode } from 'react'
import { usePeriodo } from '../contexts/PeriodoContext.js'
import { formatarPercentual, formatarValorIndicador } from '../lib/formato.js'
import { CardGrafico } from '../components/grafico/CardGrafico.js'
import { useIndicador } from '../hooks/useIndicador.js'
import type { Painel } from '../hooks/usePainel.js'
import { mensagemDeErro } from '../lib/api.js'
import { contar, ROTULO_NIVEL } from '../lib/rotulos.js'
import { usePainel } from '../hooks/usePainel.js'
import { LegendaStatus, MatrizIndicadores } from '../components/painel/MatrizIndicadores.js'

/** Quadro de indicadores — handoff seção "2". */
export function QuadroIndicadores() {
  const { data, isPending, error } = usePainel()
  /*
   * VENDAS por padrão. É o indicador que abre a reunião, e o gráfico embaixo da
   * matriz existe para responder "e como foi chegando aí" sem sair da tela.
   */
  const [codigo, setCodigo] = useState('vendas')

  return (
    <div className="flex flex-col gap-7">
      <Cabecalho painel={data ?? null} />

      {isPending && <Estado texto="Carregando indicadores…" />}
      {error && <Estado texto={mensagemDeErro(error, "carregar os indicadores")} erro />}
      {data && (
        <>
          <FaixaResumo painel={data} />

          {/*
            "QUADRO DE INDICADORES", e não "O que aconteceu" (12/09/2026).

            No N4 a frase "O que aconteceu" está certa porque ela tem IRMÃ: ali
            ela e "O que já está sendo feito" são as perguntas 1 e 3 da reunião,
            uma embaixo da outra, e o título separa as duas.

            Aqui não há irmã. A tela inteira é a pergunta 1 -- e as outras duas
            mudaram de endereço: o "por que" virou a aba Pontos de causa, o "o
            que fazer" é Ações. O título repetia o que a aba já dizia.

            E ele chegava DEPOIS de metade do que nomeava: a faixa dos três
            consolidados vem acima, e ela também é "o que aconteceu".

            "Quadro" é a palavra do próprio método -- gestão à vista se faz em
            quadro --, e é como o handoff batizou esta seção. "Matriz" ficou de
            fora de propósito: numa rede de varejo matriz é o oposto de filial, e
            o título leria como "a sede" sobre nove colunas de lojas. O nome
            continua valendo no código (`MatrizIndicadores`), onde não há essa
            leitura.

            A descrição carrega as duas INTERAÇÕES, que é o que a pessoa precisa
            saber ao chegar -- e "interativo" ficou fora do título: a palavra
            descreve o software, e a linha de baixo já ensina o que fazer.

            "CLIQUE NUM NÚMERO", e não "numa filial" nem "numa célula".

            O analista corrigiu a primeira: quem abre a reunião é o cruzamento
            do indicador com a filial, e o cabeçalho da coluna não clica. E o
            clique leva à reunião daquela loja JÁ no GD daquele indicador -- as
            duas dimensões importam.

            "Célula" seria exato e ilegível: o PLANO já registra que é nome de
            quem construiu a tela ("ninguém numa reunião de diretoria pensa em
            células"). "Número" é o que a pessoa vê e o que ela aponta.
          */}
          <Secao
            titulo="Quadro de indicadores"
            descricao="Clique no indicador para ver a evolução; clique num número para abrir a reunião daquela filial"
            aoLado={<Selo>Percentual comparado à meta do ciclo</Selo>}
          />
          <MatrizIndicadores painel={data} selecionado={codigo} aoSelecionar={setCodigo} />
          <LegendaStatus />

          <Evolucao painel={data} codigo={codigo} />
        </>
      )}
    </div>
  )
}

/** O farol do chip da filial — o mesmo da célula dela na matriz. */
/**
 * A cor do NÚMERO, por situação. Par de texto do `COR_PONTO_CHIP` abaixo.
 *
 * As mesmas quatro situações e a mesma autoridade — `c.situacao`, do servidor —,
 * então o número em destaque e o ponto da filial na matriz nunca discordam.
 *
 * `atencao` em `risco.texto` (#8A5A05) e não no âmbar do ponto (#F0A020): âmbar
 * como texto de 30px sobre branco não tem contraste, e um número que é a
 * resposta do cartão não pode ser o mais difícil de ler dele.
 *
 * `sem` sem classe, e não em cinza: sem situação o número herda a cor do texto,
 * que é o certo -- cinza diria "desligado" sobre um valor que está apurado.
 */
const COR_NUMERO: Record<string, string> = {
  otimo: 'text-otimo-texto',
  acima: 'text-ok-texto',
  atencao: 'text-risco-texto',
  abaixo: 'text-critico-texto',
  sem: '',
}

/**
 * "36,85% melhor que a meta" ou "5,20% pior que a meta".
 *
 * **MELHOR e PIOR, e não "acima"/"abaixo"/"faltam".** Palavra do analista
 * (10/09/2026): *"como isso de perdas é complicado entender, coloque melhor e
 * pior"*. E ele tem razão pelo lado mais difícil da tela: Perdas vem em número
 * NEGATIVO, e `−0,16%` contra uma meta de `−0,25%` está melhor -- mas "acima da
 * meta" sobre dois números negativos exige que quem lê refaça a comparação de
 * cabeça, no meio de uma reunião.
 *
 * Um vocabulário SÓ para os quatro indicadores. A versão anterior tinha dois --
 * "faltam/passou" para `MAIOR_MELHOR` e "acima/abaixo" para `MENOR_MELHOR` --
 * e isso obrigava a saber o sentido de cada indicador para ler a linha. Melhor
 * e pior não precisam disso: eles já são a resposta.
 *
 * **O SENTIDO continua mandando**, só que dentro da palavra em vez de ao lado
 * dela. É ele que diz qual lado é o bom:
 *
 *   MAIOR_MELHOR   desvio > 0 e' melhor   Vendas, NPS, Perdas % Mov
 *   MENOR_MELHOR   desvio > 0 e' pior     Custo
 *
 * Perdas é `MAIOR_MELHOR` no cadastro, e isso PARECE errado até olhar o sinal:
 * a medida é negativa, então maior é menos perda. Conferido no banco.
 *
 * O empate é `< 0.005` e não `=== 0`: a frase mostra duas casas, e um desvio de
 * 0,001% escreveria "0,00% pior que a meta" -- uma cobrança de nada.
 */
function legendaDoDesvio(desvio: number, sentido: 'MAIOR_MELHOR' | 'MENOR_MELHOR'): string {
  if (Math.abs(desvio) < 0.005) return 'exatamente na meta'
  const n = `${Math.abs(desvio).toFixed(2).replace('.', ',')}%`
  const favoravel = sentido === 'MAIOR_MELHOR' ? desvio > 0 : desvio < 0
  return `${n} ${favoravel ? 'melhor' : 'pior'} que a meta`
}

const COR_PONTO_CHIP: Record<string, string> = {
  otimo: 'bg-[#2f5da8]',
  acima: 'bg-ok-ponto',
  atencao: 'bg-[#f0a020]',
  abaixo: 'bg-critico-ponto',
  sem: 'bg-borda',
}

/**
 * O GRÁFICO embaixo da matriz — sempre aberto, com filtro de filial.
 *
 * A matriz responde "como cada filial está AGORA"; ela não responde "como
 * chegou até aqui". Abrir a tela de desdobramento para ver isso tira o N2 do
 * quadro, e a comparação entre filiais é justamente o que ele veio olhar.
 *
 * É o MESMO cartão da tela de desdobramento (`CardGrafico`), com os mesmos
 * dados: uma segunda versão divergiria na primeira mudança feita num lado só.
 */
function Evolucao({ painel, codigo }: { painel: Painel; codigo: string }) {
  /*
   * A PRIMEIRA FILIAL da lista, e não uma fixa: em N4 o painel traz uma só, e
   * um padrão codificado ("CEN") mostraria uma loja que aquele usuário nem vê.
   */
  /*
   * A REDE por padrão, e não a primeira filial.
   *
   * A pergunta do N2 é "como está a rede"; a filial vem depois, quando ele já
   * viu o todo. Com uma filial só na visão — o caso do N3 e do N4 — a rede é
   * ela mesma, e o chip some por não haver o que consolidar.
   */
  const [filial, setFilial] = useState<string | null>(
    painel.filiais.length > 1 ? null : (painel.filiais[0]?.sigla ?? ''),
  )
  /*
   * MENSAL, sempre. A pergunta do quadro é a trajetória do ano; as semanas do
   * mês corrente são a leitura da reunião do N3 e do N4, que têm tela própria.
   */
  const { data, isPending, error } = useIndicador(codigo, filial, { escala: 'mensal' })
  const nome = painel.indicadores.find((i) => i.codigo === codigo)?.nome ?? codigo

  /*
   * O PONTO em cada chip é como a filial fechou o mês no indicador escolhido.
   *
   * É o que faz o seletor valer a pena numa reunião de diretoria: dá para ver
   * quais lojas estão vermelhas ANTES de abrir cada uma. Sem ele os chips
   * seriam nove siglas iguais, e a escolha viraria tentativa e erro.
   */
  const situacaoDe = new Map(
    (painel.indicadores.find((i) => i.codigo === codigo)?.celulas ?? []).map((c) => [
      c.filial,
      c.situacao,
    ]),
  )

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-[900px]">
          <h2 className="text-titulo-secao">Como viemos até aqui</h2>
          <p className="mt-[2px] text-legenda text-texto-ter">
            {nome} da filial escolhida, ao longo do período — o ponto em cada sigla mostra como ela
            fechou o ciclo corrente
          </p>
        </div>
        <div className="flex flex-col items-end gap-[7px]">
          <span className="text-eyebrow uppercase text-texto-ter">Filial</span>
          <div className="flex flex-wrap gap-[3px] rounded-[10px] border border-borda bg-superficie p-[3px]">
            {painel.filiais.length > 1 && (
              <button
                type="button"
                onClick={() => setFilial(null)}
                aria-pressed={filial === null}
                title={`As ${painel.filiais.length} filiais da sua visão, somadas`}
                className={`mr-[3px] flex min-w-[86px] items-center justify-center rounded-[7px] border-r border-borda-sutil px-3 py-[6px] transition-colors duration-hover ${
                  filial === null ? 'bg-navy' : 'hover:bg-superficie-hover'
                }`}
              >
                <span
                  className={`text-legenda font-extrabold ${
                    filial === null ? 'text-white' : 'text-texto-sec'
                  }`}
                >
                  Visão geral
                </span>
              </button>
            )}
            {painel.filiais.map((f) => {
              const on = f.sigla === filial
              return (
                <button
                  key={f.sigla}
                  type="button"
                  onClick={() => setFilial(f.sigla)}
                  aria-pressed={on}
                  title={f.nome === f.sigla ? f.sigla : `${f.sigla} · ${f.nome}`}
                  className={`flex min-w-[52px] flex-col items-center gap-[3px] rounded-[7px] px-2 py-[6px] transition-colors duration-hover ${
                    on ? 'bg-navy' : 'hover:bg-superficie-hover'
                  }`}
                >
                  <span
                    className={`text-legenda font-extrabold tracking-[.04em] ${
                      on ? 'text-white' : 'text-texto-sec'
                    }`}
                  >
                    {f.sigla}
                  </span>
                  <span
                    className={`h-[6px] w-[6px] rounded-full ${COR_PONTO_CHIP[situacaoDe.get(f.sigla) ?? 'sem']}`}
                  />
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {isPending && <Estado texto={`Carregando ${nome}…`} />}
      {error && <Estado texto={mensagemDeErro(error, 'carregar o gráfico')} erro />}
      {data && <CardGrafico dados={data} rotuloPeriodo={painel.periodo.rotulo} />}
    </section>
  )
}

/**
 * Quem está olhando o quadro.
 *
 * O painel não é exclusivo do N2: N3 e N4 chegam nele com a visão da própria
 * loja, e o rótulo tem de dizer isso.
 */
/**
 * O CABEÇALHO da reunião do N2 — quem, quantas filiais, e o estado do ciclo.
 *
 * SEM CONTAGEM DE DESVIO AQUI, e isso é deliberado.
 *
 * O subtítulo dizia *"5 de 27 células fora da meta"*. "Célula" é a casinha da
 * matriz — um indicador numa filial —, e é nome de quem construiu a tela, não
 * de quem a lê: ninguém numa reunião de diretoria pensa em células, e o 27
 * ainda obrigava a descobrir de onde saiu (3 indicadores com dado × 9 filiais).
 *
 * A mesma informação já está na faixa abaixo, por indicador e em FILIAIS —
 * "1 filial fora da meta · 8 filiais na meta" —, que é a unidade da conversa.
 * O cabeçalho repetia o total numa unidade inventada, e um número que precisa
 * ser explicado custa mais do que informa.
 */
function Cabecalho({ painel }: { painel: Painel | null }) {
  const { periodo, definir, rotuloLongo } = usePeriodo()

  const semDado = (painel?.indicadores ?? []).filter((i) => i.consolidado === null)

  return (
    <div className="flex flex-wrap items-start justify-between gap-6">
      <div className="flex flex-col gap-1">
        {/*
          QUEM ESTÁ OLHANDO, e não "Diretoria" fixo.

          O quadro não é só do N2: N3 e N4 chegam nele com a visão da própria
          loja. Com o rótulo cravado, um gerente adjunto de uma filial lia
          "Diretoria · 1 filial" — a tela dizendo a ele que era outra pessoa.
        */}
        <span className="text-eyebrow uppercase text-texto-ter">
          {/*
            O NÍVEL PRIMEIRO, e em sigla (10/09/2026).

            Dizia só "DIRETORIA · 9 FILIAIS". Pedido do analista: *"quero que
            esse N fique mais visível no N3 e N2 também"*. Quem trabalha aqui
            fala por nível -- é o vocabulário que o "← Voltar para o N3" e o
            "Abrir o N4" já usam --, e "Diretoria" exige traduzir.

            Sai de `painel.visao.nivel`, o recorte que o SERVIDOR aplicou, e não
            do cadastro de quem entrou: com uma visão simulada de N3, esta tela
            é a de um N3, e dizer "N2" descreveria a pessoa em vez da tela.
          */}
          {painel ? painel.visao.nivel : ''}
          {painel ? ` · ${ROTULO_NIVEL[painel.visao.nivel] ?? ''}` : ''}
          {painel ? ` · ${contar(painel.filiais.length, 'filial', 'filiais')}` : ''}
        </span>
        <h1 className="text-titulo-tela">Reunião diária</h1>
        <p className="text-corpo text-texto-sec">
          {rotuloLongo.charAt(0).toUpperCase() + rotuloLongo.slice(1)}
          {semDado.map((i) => ` · ${i.nome} aguardando fechamento`).join('')}
        </p>
      </div>

      {/*
        O CICLO lê e escreve no MESMO contexto do seletor do topo da página.

        Dois controles para a mesma decisão só viram problema quando guardam
        estados separados — foi o que aconteceu na tela do N3, onde dava para
        deixar "Setembro" em cima e "Agosto" no corpo ao mesmo tempo, sem nada
        avisando qual valia. Compartilhando o estado, não têm como discordar.
      */}
      <div className="flex flex-col items-end gap-[6px]">
        <span className="text-eyebrow uppercase text-texto-ter">Ciclo</span>
        <div className="flex items-center gap-[6px]">
          {(['mes', 'ano'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => definir({ ...periodo, modo: m })}
              aria-pressed={periodo.modo === m}
              className={`h-[34px] rounded-[9px] border px-[14px] text-legenda font-bold transition-colors duration-hover ${
                periodo.modo === m
                  ? 'border-navy bg-navy text-white'
                  : 'border-borda bg-superficie-alt text-texto-ter hover:border-borda-hover'
              }`}
            >
              {m === 'mes' ? 'Mensal' : 'Acumulado do ano'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * A FAIXA DE RESUMO — o número da rede, por indicador.
 *
 * É o que o N2 responde primeiro: não "como está a filial X", mas "como está a
 * rede". A matriz abaixo desdobra; esta faixa dá o total.
 *
 * O valor vem do `consolidado` do backend, que soma numerador e denominador e
 * se recusa a mediar percentuais. Indicador sem consolidado — Custo antes do
 * fechamento — fica de fora em vez de aparecer zerado.
 */
function FaixaResumo({ painel }: { painel: Painel }) {
  const comNumero = painel.indicadores.filter((i) => i.consolidado?.valor != null)
  if (comNumero.length === 0) return null

  const [destaque, ...resto] = comNumero

  return (
    <div className="flex flex-wrap overflow-hidden rounded-card border border-borda bg-superficie">
      {destaque && <CartaoResumo ind={destaque} filiais={painel.filiais.length} destaque />}
      {resto.map((i) => (
        <CartaoResumo key={i.codigo} ind={i} filiais={painel.filiais.length} />
      ))}
    </div>
  )
}

function CartaoResumo({
  ind,
  filiais,
  destaque = false,
}: {
  ind: Painel['indicadores'][number]
  filiais: number
  destaque?: boolean
}) {
  const c = ind.consolidado
  if (!c) return null
  const naMeta = filiais - ind.foraDaMeta

  /**
   * INDICADOR EM PONTOS mostra o VALOR no destaque, e não o percentual da meta.
   *
   * Decisão do analista: *"no NPS você bota o valor"*. E tem razão de ser, já
   * escrita no `usePainel.ts`: a meta do NPS é um **patamar em pontos**, e o
   * status sai da distância em pontos, não da razão. *"NPS 71 contra meta 75 é
   * amarelo, mas os mesmos 4 pontos dão −5,33%, que num limiar percentual de 5
   * viraria vermelho."* Destacar "94,7%" poria na tela justamente o número que
   * a regra de status recusa.
   *
   * Pela UNIDADE, e não por `codigo === 'nps'`: um segundo indicador em pontos
   * -- eNPS, pesquisa de clima -- entraria certo sem ninguém lembrar de vir
   * aqui. Cravar o código é o defeito que a busca da categoria desta tela já
   * teve (§7.11).
   */
  const emPontos = ind.unidade === 'pontos'

  /**
   * O percentual DA META — o número que passou para o destaque.
   *
   * `meta > 0` e não só `!== null`: meta zero daria divisão por zero, e
   * `Infinity` formatado sai como "∞%" no maior número da tela.
   *
   * **Não inverto nada para MENOR_MELHOR.** Em Custo, 105% da meta é ruim, e a
   * conta é a mesma: o que muda é a COR, e ela vem de `c.situacao`, que o
   * servidor já calcula respeitando o `sentido` (ver `usePainel.ts`). Recalcular
   * o farol aqui seria uma segunda regra de sentido, que envelhece sozinha e
   * discorda da matriz logo abaixo — onde a mesma `situacao` pinta os pontos.
   */
  const percentualDaMeta =
    !emPontos && c.valor !== null && c.meta !== null && c.meta > 0
      ? (c.valor / c.meta) * 100
      : null

  return (
    <div
      className={`flex min-w-[260px] flex-1 flex-col gap-[7px] px-[22px] py-[18px] ${
        destaque ? 'bg-superficie-alt' : 'border-l border-borda-sutil'
      }`}
    >
      {/*
        "Consolidado" só aparece quando HÁ o que consolidar. Com uma filial só
        — o caso do N4 — a palavra prometia uma soma de rede que não existe, e
        ainda saía como "consolidado 1 filiais".
      */}
      <span className="text-eyebrow uppercase text-texto-ter">
        {ind.nome}
        {destaque && filiais > 1 ? ` · consolidado ${filiais} filiais` : ''}
      </span>
      {/*
        O PERCENTUAL DA META NO DESTAQUE, e o valor logo abaixo (09/09/2026).

        O maior número do cartão era o total em reais -- "R$ 228,95 mi" --, que
        é o FATO e não o veredito: quem lê de longe não sabe se 228,95 mi é bom
        sem procurar a meta. O percentual responde a pergunta do quadro numa
        olhada, e é o mesmo número que o N3 e o N4 destacam nos cartões deles.

        Decisão do analista. Ver PLANO §7.62.

        Sem meta o percentual não existe, e aí o valor volta para o destaque:
        mostrar "—" grande gastaria o slot mais visível do cartão para anunciar
        uma ausência.
      */}
      {/*
        UM span só para os dois casos, e o farol nele em qualquer um: o número
        grande é a RESPOSTA do cartão, e a resposta é colorida seja ela um
        percentual (Vendas) ou um valor (NPS). Eram dois spans, e o do valor
        tinha ficado sem cor -- o cartão do NPS seria o único da faixa com o
        número em preto, sem que nada dissesse por quê.
      */}
      <span
        className={`tabular text-[30px] font-extrabold leading-[1.05] tracking-[-1px] ${
          COR_NUMERO[c.situacao ?? 'sem'] ?? ''
        }`}
      >
        {percentualDaMeta === null
          ? formatarValorIndicador(ind.codigo, c.valor, ind.casasDecimais)
          : formatarPercentual(percentualDaMeta, 1)}
      </span>

      {/*
        "<INDICADOR> valor │ META meta", o MESMO padrão dos cartões do N3 e do
        N4 -- rótulo pequeno em maiúscula, valores em corpo de texto, régua de
        1px entre os dois.

        O farol fica SÓ no valor apurado. A meta é a régua: não está boa nem
        ruim, e pintar as duas poria duas afirmações de estado numa linha que
        tem uma.

        Em Tailwind e não nas classes `.n4-comp-*`: aquele CSS mora nos arquivos
        das telas de reunião, e importá-lo aqui traria as ~1100 linhas dele
        junto. São seis utilitários; a duplicação é o par de tokens, não a
        regra.
      */}
      {c.meta !== null && c.valor !== null ? (
        <span className="text-corpo text-texto">
          {/*
            O VALOR só entra aqui quando NÃO é ele o número grande. No NPS ele
            é, e repetir "NPS 72" logo abaixo de um "72" de 30px diria a mesma
            coisa duas vezes em duas linhas -- sobra a régua, que é o que
            faltava.
          */}
          {percentualDaMeta !== null && (
            <>
              <span className="mr-px text-[10px] font-bold uppercase tracking-[0.06em] text-texto-ter">
                {ind.nome}
              </span>{' '}
              <span className={COR_NUMERO[c.situacao ?? 'sem'] ?? ''}>
                {formatarValorIndicador(ind.codigo, c.valor, ind.casasDecimais)}
              </span>
              <span
                className="mx-[10px] inline-block h-[11px] w-px translate-y-px bg-borda align-middle"
                aria-hidden
              />
            </>
          )}
          <span className="mr-px text-[10px] font-bold uppercase tracking-[0.06em] text-texto-ter">
            Meta
          </span>{' '}
          {formatarValorIndicador(ind.codigo, c.meta, ind.casasDecimais)}
        </span>
      ) : null}

      {/*
        QUANTO FALTA, OU QUANTO PASSOU. Pedido do analista, 09/09/2026.

        Era `−5,20% sobre a meta do ciclo`: fatual e mudo sobre a direção. "Sobre
        a meta" com um número negativo obriga a ler o sinal para saber o
        sentido, e num quadro de parede o sinal é a menor coisa da linha.

        A frase é de `legendaDoDesvio`, que respeita o SENTIDO do indicador --
        em Perdas, abaixo da meta é bom, e "faltam" seria elogio virado
        cobrança.

        Fica DEPOIS da composição: o percentual em cima é o estado, a composição
        é de onde ele vem, e esta linha é a consequência.
      */}
      <span className="text-legenda text-texto-sec">
        {c.desvio === null
          ? `${c.filiais} de ${contar(filiais, 'filial', 'filiais')} com dado`
          : legendaDoDesvio(c.desvio, ind.sentido)}
      </span>
      <div className="mt-[3px] flex flex-wrap gap-2">
        {ind.foraDaMeta > 0 && (
          <span className="rounded-full bg-critico-bg px-[9px] py-[3px] text-legenda font-bold text-critico-texto">
            {contar(ind.foraDaMeta, 'filial', 'filiais')} fora da meta
          </span>
        )}
        {naMeta > 0 && (
          <span className="rounded-full bg-ok-bg px-[9px] py-[3px] text-legenda font-bold text-ok-texto">
            {contar(naMeta, 'filial', 'filiais')} na meta
          </span>
        )}
      </div>
    </div>
  )
}

/** Título de seção com a explicação embaixo e um selo à direita. */
function Secao({
  titulo,
  descricao,
  aoLado,
}: {
  titulo: string
  descricao: string
  aoLado?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-6">
      <div className="max-w-[900px]">
        <h2 className="text-titulo-secao">{titulo}</h2>
        <p className="mt-[2px] text-legenda text-texto-ter">{descricao}</p>
      </div>
      {aoLado}
    </div>
  )
}

function Selo({ children }: { children: ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded-full border border-borda bg-superficie px-3 py-[6px] text-legenda font-bold text-texto-sec">
      {children}
    </span>
  )
}

function Estado({ texto, erro = false }: { texto: string; erro?: boolean }) {
  return (
    <div className="rounded-card border border-borda bg-superficie px-6 py-8 shadow-card">
      <p className={`text-corpo ${erro ? 'text-critico-texto' : 'text-texto-sec'}`}>{texto}</p>
    </div>
  )
}

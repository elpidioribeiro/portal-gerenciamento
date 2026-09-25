import { useNavigate } from 'react-router-dom'
import { useSessao } from '../../contexts/SessaoContext.js'
import { useVisao } from '../../contexts/VisaoContext.js'
import { formatarDesvio, formatarValorIndicador, milhoesNaMatriz } from '../../lib/formato.js'
import type { Painel, Situacao } from '../../hooks/usePainel.js'

/**
 * Matriz do quadro de indicadores — handoff seção "2. Quadro de indicadores".
 * Grid `190px repeat(9, minmax(0,1fr))`, cabeçalho navy, linhas alternadas.
 */

/**
 * Duas cores: verde quando a filial está melhor que a meta, vermelho quando
 * pior. Não há faixa intermediária.
 *
 * A situação vem calculada do backend justamente porque depende do SENTIDO do
 * indicador — em Perdas e Custo, desvio negativo é bom. Decidir a cor aqui pelo
 * sinal do número pintaria Perdas de vermelho quando a filial vai bem.
 */
/**
 * `sem` é a AUSÊNCIA DE META, e não uma quinta faixa de desempenho.
 *
 * Existe porque a célula caía em `?? 'acima'` quando a situação vinha nula:
 * havia valor, não havia meta cadastrada, e a matriz pintava de VERDE --
 * afirmando "na meta" por uma decisão que ninguém tomou. É o mesmo defeito que
 * §7.37 corrigiu no N4 (`naMeta` devolve `null`, e o número sai cinza); a
 * matriz do N2 tinha ficado para trás.
 *
 * Cinza, e não uma cor de alerta: não saber não é estar mal.
 */
type Farol = Situacao | 'sem'

const COR_PONTO: Record<Farol, string> = {
  otimo: 'bg-otimo-ponto',
  acima: 'bg-ok-ponto',
  atencao: 'bg-risco-ponto',
  abaixo: 'bg-critico-ponto',
  sem: 'bg-borda',
}

const COR_TEXTO: Record<Farol, string> = {
  otimo: 'text-otimo-texto',
  acima: 'text-ok-texto',
  atencao: 'text-risco-texto',
  abaixo: 'text-critico-texto',
  sem: 'text-texto-ter',
}

/*
 * O MÍNIMO DA COLUNA é o que o VALOR precisa, e não zero.
 *
 * Era `minmax(0,1fr)`: as nove colunas dividiam o que sobrava e ficavam com
 * 71px cada, então `R$ 13,76 mi` quebrava em três linhas com o "mi" sozinho
 * embaixo.
 *
 * 105px = 89 do texto em 16px + os 8px de padding de cada lado. A tabela toda
 * fica em 1135px, que cabe num notebook de 1366 sem rolagem; abaixo disso o
 * container rola na horizontal, como já fazia.
 */
const COLUNAS = 'grid-cols-[190px_repeat(9,minmax(105px,1fr))]'

/**
 * A legenda da linha: unidade e meta.
 *
 * A unidade sai quando o próprio valor já a traz -- hoje só Vendas, que usa
 * `dinheiro` e escreve `R$` em toda célula. Repetir no cabeçalho não informa
 * nada e ocupa a linha que sobra para a meta.
 */
function legenda(ind: { codigo: string; unidade: string; metaRotulo?: string | null }): string {
  /*
   * A célula de Vendas mostra `13,76 mi`, sem símbolo, então o `R$` é dito aqui
   * -- uma vez na linha, e não nove. Sem ele o número seria lido como treze.
   */
  const unidade = ind.unidade
  return [unidade, ind.metaRotulo].filter((x) => x).join(' · ')
}

export function MatrizIndicadores({
  painel,
  selecionado,
  aoSelecionar,
}: {
  painel: Painel
  /** O indicador que o gráfico abaixo está mostrando. */
  selecionado: string
  aoSelecionar: (codigo: string) => void
}) {
  const navegar = useNavigate()
  const { usuario } = useSessao()
  const { definir } = useVisao()

  /**
   * A CÉLULA ABRE A REUNIÃO DO N3 daquela filial, no GD daquele indicador.
   *
   * Decisão do analista (10/09/2026, §7.63): *"cliquei na célula CEN/Vendas,
   * vai pra N3 de Vendas de Centro"*, e de lá o cartão da gerência segue
   * para o N4 dela. Antes abria `/indicador/:codigo/:filial`, o desdobramento —
   * uma tela de consulta. A reunião é onde se decide, e é ela que a célula deve
   * alcançar.
   *
   * SEM PORTÃO DE `admin` aqui. A primeira versão só navegava para
   * administradores, porque `resolverVisao` exigia isso para qualquer troca de
   * visão — e medindo na tela apareceu que o N2 do portal **não é
   * administrador** (`n2-teste`, `admin: false`): a mudança nascia morta
   * justamente para quem usa esta tela.
   *
   * A regra do servidor virou **estreitar é livre** (§7.63), e é ela que decide.
   * A tela não repete a checagem: duas cópias de uma regra de autorização é
   * como elas passam a discordar, e a que vale é sempre a de lá.
   */
  const aberturaDaCelula = (codigo: string, filial: string) => () => {
    /*
     * A visão só é trocada quando a filial da célula NÃO é a de quem olha --
     * um N3 clicando na própria loja já está nela, e `definir` acenderia a
     * faixa de "visão simulada" sem nada ter mudado.
     *
     * `gerencia: null`: o N3 é a reunião da LOJA, e as gerências são as linhas
     * do quadro dele. Nomear uma aqui escolheria por ele qual abrir.
     */
    if (usuario?.filial !== filial) definir({ nivel: 'N3', filial, gerencia: null })
    /*
     * O GD vai na URL porque a aba ativa do N3 lê dali (§7.63). Sem ele a tela
     * abriria sempre no primeiro GD -- clicar em NPS levaria a Vendas.
     */
    void navegar(`/reuniao-n3?gd=${encodeURIComponent(codigo)}`)
  }

  return (
    <div className="overflow-hidden rounded-card bg-superficie shadow-card">
      <div className="overflow-x-auto">
        <div className="min-w-[1135px]">
          {/* Cabeçalho navy */}
          <div className={`grid ${COLUNAS} bg-navy`}>
            <div className="px-5 py-[14px] text-coluna uppercase text-sobreNavy-icone">Indicador</div>
            {painel.filiais.map((f) => (
              <div
                key={f.sigla}
                className="px-2 py-[14px] text-center text-legenda font-bold text-white"
                title={f.nome === f.sigla ? f.sigla : `${f.sigla} · ${f.nome}`}
              >
                {f.sigla}
              </div>
            ))}
          </div>

          {painel.indicadores.map((ind, i) => (
            <div
              key={ind.codigo}
              className={`grid ${COLUNAS} ${i % 2 === 1 ? 'bg-superficie-alt' : 'bg-superficie'}`}
            >
              {/*
                Primeira coluna: nome, unidade+meta, contagem fora da meta.

                O NOME É BOTÃO, e troca o indicador do gráfico lá embaixo. A
                célula abre a REUNIÃO daquela filial (§7.63) -- são duas perguntas
                diferentes ("como esse indicador vem indo" e "o que fazer nesta
                filial"), e uma não pode roubar o gesto da outra.

                A barra à esquerda é o único sinal de qual está no gráfico: um
                fundo inteiro competiria com as faixas alternadas das linhas.
              */}
              <button
                type="button"
                onClick={() => aoSelecionar(ind.codigo)}
                aria-pressed={selecionado === ind.codigo}
                title={`Ver a evolução de ${ind.nome} no gráfico abaixo`}
                className={`flex flex-col justify-center gap-[3px] border-l-[3px] py-4 pl-[17px] pr-5 text-left transition-colors duration-hover hover:bg-superficie-hover ${
                  selecionado === ind.codigo ? 'border-l-navy' : 'border-l-transparent'
                }`}
              >
                <span className="text-titulo-card">{ind.nome}</span>
                {/* Vazio em Vendas, que não repete a unidade: sem linha, sem vinco. */}
                {legenda(ind) !== '' && (
                  <span className="text-legenda text-texto-ter">{legenda(ind)}</span>
                )}
                <span className={`text-legenda font-bold ${COR_TEXTO[ind.foraDaMeta > 0 ? 'abaixo' : 'acima']}`}>
                  {ind.foraDaMeta} de {painel.filiais.length} fora da meta
                </span>
              </button>

              {ind.celulas.map((c) => (
                <Celula
                  key={c.filial}
                  codigo={ind.codigo}
                  indicador={ind.nome}
                  casasDecimais={ind.casasDecimais}
                  celula={c}
                  aoAbrir={aberturaDaCelula(ind.codigo, c.filial)}
                  temReuniao={ind.temReuniao}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Celula({
  codigo,
  indicador,
  casasDecimais,
  celula,
  aoAbrir,
  temReuniao,
}: {
  codigo: string
  indicador: string
  /** Vem da API para painel e gráfico não discordarem. Ver formato.ts. */
  casasDecimais: number
  celula: Painel['indicadores'][number]['celulas'][number]
  aoAbrir: () => void
  /**
   * Este indicador TEM reunião de N3. Vem do servidor (§7.63).
   *
   * Falso deixa a célula SEM CLIQUE -- o número continua lá, e não há para onde
   * ir. Palavra do analista: *"não deveria ir pra lugar nenhum, pq não temos
   * ainda GD de NPS e GD de Perdas"*.
   */
  temReuniao: boolean
}) {
  const semDado = celula.valor === null

  if (semDado) {
    return (
      <div
        className="m-1 flex flex-col items-center justify-center gap-[6px] rounded-celula border border-transparent px-2 py-5"
        title={
          codigo === 'custo'
            ? `${indicador} · ${celula.filial}: aguardando fechamento do mês`
            : `${indicador} · ${celula.filial}: sem dado no período`
        }
      >
        <span className="tabular text-celula text-texto-off">—</span>
        <span className="text-micro font-semibold text-texto-off">
          {codigo === 'custo' ? 'aguardando fechamento' : 'sem dado'}
        </span>
      </div>
    )
  }

  /* Sem meta cadastrada não há farol -- ver `Farol` acima. */
  const situacao: Farol = celula.situacao ?? 'sem'

  const numero = (
    <>
      <span className="tabular whitespace-nowrap text-celula text-texto">
        {codigo === 'vendas' && celula.valor !== null
          ? milhoesNaMatriz(celula.valor)
          : formatarValorIndicador(codigo, celula.valor, casasDecimais)}
      </span>

      <span className="flex items-center gap-[6px]">
        <span className={`h-[7px] w-[7px] rounded-full ${COR_PONTO[situacao]}`} />
        <span className={`tabular text-micro font-semibold ${COR_TEXTO[situacao]}`}>
          {celula.desvio === null ? 'sem meta' : formatarDesvio(celula.desvio)}
        </span>
      </span>
    </>
  )

  /*
    SEM REUNIÃO, SEM CLIQUE -- e sem `<button>` (§7.63).

    `<div>` e não botão desabilitado: um botão desabilitado promete uma ação que
    está temporariamente fora, e o teclado passa por ele. Aqui não existe ação
    nenhuma -- o número é leitura, como a célula sem dado logo acima.

    O `title` diz o motivo. Sem ele, a célula de NPS ficaria indistinguível de
    uma que deveria clicar e não clica.
  */
  if (!temReuniao) {
    return (
      <div
        className="m-1 flex flex-col items-center justify-center gap-[6px] rounded-celula border border-transparent px-2 py-5"
        title={`${indicador} · ${celula.filial}: ainda não há reunião de ${indicador} cadastrada`}
      >
        {numero}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={aoAbrir}
      title={`Abrir a reunião do N3 de ${indicador} · ${celula.filial}`}
      className="group m-1 flex flex-col items-center justify-center gap-[6px] rounded-celula border border-transparent px-2 py-5 transition-[background-color,border-color] duration-hover hover:border-borda-hover hover:bg-superficie-hover"
    >
      {numero}

      {/* "ABRIR ›" só na passagem do mouse, como no handoff. */}
      <span className="text-eyebrow uppercase text-navy-medio opacity-0 transition-opacity duration-hover group-hover:opacity-100">
        Abrir ›
      </span>
    </button>
  )
}

/** Legenda dos status + nota sobre o cálculo do desvio. */
export function LegendaStatus() {
  // O amarelo é rotulado como exclusivo de NPS de propósito: sem isso, quem
  // olha a linha de Vendas procura a faixa intermediária e não encontra.
  // Os rótulos dizem a QUE indicador cada faixa pertence: sem isso, quem olha a
  // linha de Vendas procura o amarelo e o azul e não encontra.
  const itens: Array<{ situacao: Farol; rotulo: string }> = [
    { situacao: 'otimo', rotulo: 'Bem acima da meta (só Perdas)' },
    { situacao: 'acima', rotulo: 'Na meta ou acima' },
    { situacao: 'atencao', rotulo: 'No limite ou pouco abaixo (NPS e Perdas)' },
    { situacao: 'abaixo', rotulo: 'Abaixo da meta' },
    // Última porque é ausência, não desempenho: não fecha a escala, sai dela.
    { situacao: 'sem', rotulo: 'Sem meta cadastrada' },
  ]

  return (
    <div className="flex flex-wrap items-center gap-5">
      {itens.map((i) => (
        <span key={i.situacao} className="flex items-center gap-2">
          <span className={`h-[7px] w-[7px] rounded-full ${COR_PONTO[i.situacao]}`} />
          <span className="text-legenda text-texto-sec">{i.rotulo}</span>
        </span>
      ))}
      <span className="ml-auto text-legenda text-texto-ter">
        Desvio calculado sobre a meta do ciclo
      </span>
    </div>
  )
}

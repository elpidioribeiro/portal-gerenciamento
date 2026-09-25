/** Formatação de valores da matriz e dos cards, conforme o handoff. */

/**
 * R$ 280.000 → "280.000" (sem símbolo; a unidade fica no cabeçalho da linha).
 *
 * Negativo sai com o menos TIPOGRÁFICO (−), não com hífen, como o handoff pede.
 * `toLocaleString` devolve hífen, e isso ficou visível quando Perdas passou a
 * exibir valor negativo: na mesma célula, `-0,20%` com hífen ao lado de
 * `+95,00%` de `formatarDesvio`, que já usava o menos correto. Numa matriz de 36
 * células a diferença de largura do glifo salta.
 */
export function formatarNumero(v: number, casas = 0): string {
  const texto = Math.abs(v).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })
  // `v < 0` e não `Object.is(v, -0)`: -0 formatado como "−0" seria ruído, e o
  // desvio que arredonda para zero já é tratado como "na meta".
  return v < 0 ? `−${texto}` : texto
}

/** 5.8 → "5,8%" */
export function formatarPercentual(v: number, casas = 1): string {
  return `${formatarNumero(v, casas)}%`
}

/**
 * O valor da célula da matriz do N2: milhões com a escala, SEM o símbolo —
 * `13,76 mi`.
 *
 * O `R$` sai da célula e fica no cabeçalho da linha, dito uma vez. Numa matriz
 * de nove filiais ele apareceria nove vezes na mesma linha sem distinguir nada:
 * o que muda de coluna para coluna é o número, e é ele que tem de ocupar o
 * espaço.
 *
 * SEMPRE em milhões, mesmo abaixo de um. `dinheiro` desce para "mil" conforme a
 * faixa, e numa coluna de nove filiais isso misturaria escalas: `950 mil`
 * embaixo de `13,76 mi` são dois números que o olho compara errado.
 *
 * Duas casas fixas, pela mesma razão de `formatarDesvio`: largura igual mantém
 * a coluna alinhada.
 */
export function milhoesNaMatriz(v: number): string {
  return `${formatarNumero(v / 1_000_000, 2)} mi`
}

/**
 * Valor de célula conforme o indicador: Vendas em reais ABREVIADOS, NPS em
 * pontos inteiros, os demais em percentual.
 *
 * VENDAS USA `dinheiro`, a mesma função do N3 e do N4. Escrevia o valor cheio
 * -- `13.757.877` --, e a mesma venda aparecia como `R$ 13,76 mi` na reunião do
 * N4 e como oito dígitos no quadro do N2. É o mesmo número em duas formas, e
 * numa cadeia de ajuda que sobe do N4 para o N2 isso obriga a reaprender a
 * leitura a cada nível -- sem contar que oito dígitos lado a lado, em nove
 * filiais, só se comparam contando casas.
 *
 * `casas` vem da API (`indicador.casasDecimais`), não de uma tabela local. Era
 * uma tabela local, e ela discordava do backend: Perdas passou a ter duas casas
 * e o painel continuava mostrando uma, enquanto o gráfico mostrava duas — duas
 * telas com números diferentes para o mesmo mês. A precisão é a MESMA com que o
 * backend arredonda o valor antes de calcular o desvio, então servir o número
 * pela API é o que impede as duas pontas de divergirem.
 */
export function formatarValorIndicador(
  codigo: string,
  valor: number | null,
  casas?: number,
): string {
  if (valor === null) return '—'
  switch (codigo) {
    case 'vendas':
      return dinheiro(valor)
    case 'nps':
      return formatarNumero(Math.round(valor))
    default:
      return formatarPercentual(valor, casas)
  }
}

/**
 * -13.04 → "−13,04%" · +2.5 → "+2,50%"
 *
 * Sempre duas casas e sempre com sinal, usando o menos tipográfico (−) como no
 * handoff. Duas casas fixas mantêm as colunas alinhadas: "−4,00%" e "−13,04%"
 * ocupam a mesma largura, o que importa numa matriz de 36 células.
 */
export function formatarDesvio(desvio: number | null): string {
  if (desvio === null) return '—'
  const abs = formatarNumero(Math.abs(desvio), 2)
  if (desvio === 0) return `0,00%`
  return `${desvio > 0 ? '+' : '−'}${abs}%`
}

/**
 * R$ em milhões, milhares, ou reais — "R$ 3,66 mi", "R$ 34 mil", "R$ 499".
 *
 * Existia duas vezes, e uma das cópias estava errada. O `milhar` do N4 dividia
 * por mil e arredondava SEMPRE: faltar R$ 499 aparecia como **"R$ 0 mil"**, do
 * mesmo jeito que não faltar nada. E a legenda ao lado dizia "faltam para a
 * meta" — uma frase se contradizendo com o número.
 *
 * Hoje é raro, porque a diferença costuma ser de milhares. Mordia exatamente na
 * semana em que a gerência chega colada na meta, que é quando o número mais
 * importa.
 *
 * A versão certa era a do N3, que já tinha a faixa dos reais. Aqui, uma vez.
 */
export function dinheiro(v: number): string {
  const n = (x: number) => x.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
  if (v >= 1_000_000) {
    /*
     * DUAS CASAS FIXAS nos milhões, e não "até duas".
     *
     * Era `maximumFractionDigits: 2` sozinho, e o zero final sumia: na linha de
     * Vendas do quadro do N2, `R$ 50,4 mi` ficava ao lado de `R$ 13,76 mi` em
     * nove filiais. É a mesma razão que `formatarDesvio` já registra -- largura
     * igual mantém a coluna alinhada, e numa matriz o olho compara por
     * posição, não contando casas.
     */
    return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} mi`
  }
  if (v >= 1_000) return `R$ ${n(v / 1_000)} mil`
  return `R$ ${n(v)}`
}

/**
 * O que o cartão "Projeção × meta" diz sobre a meta — e ele dizia errado.
 *
 * Escrevia *"faltam para a meta da semana"* e *"a meta da semana está batida"*.
 * Errado em duas dimensões, e as duas confundem quem lê:
 *
 *   PERÍODO   é a meta do MÊS. A janela da conta começa sempre no dia 1º; a
 *             semana move o CORTE, não o período. Escolher S3 é perguntar
 *             "olhando o mês até o fim da S3, como estaria o fechamento?" --
 *             não "as vendas da semana 3".
 *
 *   NATUREZA  o numerador é PROJEÇÃO de fechamento, não realizado. "Está
 *             batida" afirma fato consumado sobre uma previsão, que pode
 *             deixar de valer na semana seguinte sem ninguém errar nada.
 *
 * Aqui e não em cada tela porque o texto estava nas duas — N3 e N4 — e de duas
 * cópias é sempre a segunda que fica para trás.
 */
export function legendaDaMeta(alcancada: boolean, emCurso: boolean): string {
  /*
   * "acima da meta" / "abaixo da meta" — o LADO, e só ele.
   *
   * Forma dada pelo analista em 10/09/2026, junto com o rótulo fixo
   * "Projeção vs. meta" e uma segunda linha para o percentual
   * (`percentualComSinal`). Cada linha do cartão diz uma coisa: o rótulo nomeia
   * a comparação, o número dá o tamanho em reais, esta linha dá o lado, e a
   * última dá o tamanho relativo.
   *
   * O TEMPO VERBAL segue o período, e não o texto — e isto é anterior ao
   * pedido, mantido de propósito. Sem ele, olhando junho em setembro o cartão
   * falaria no presente sobre um mês que fechou há três; o mesmo na S1 vista da
   * S3, cuja projeção já foi substituída por duas semanas de venda real.
   *
   * "estava", e não "ficou": `emCurso` falso cobre os dois casos -- mês fechado
   * E semana passada do mês corrente. "Ficou acima" afirmaria fechamento sobre
   * uma semana que ainda vai ser sucedida por outras. Ver `periodoEmCurso`.
   */
  if (emCurso) return alcancada ? 'acima da meta' : 'abaixo da meta'
  return alcancada ? 'estava acima da meta' : 'estava abaixo da meta'
}

/**
 * O percentual com SINAL EXPLÍCITO — "+10,9%", "−5,5%".
 *
 * O `+` importa tanto quanto o `−`: a linha fica ao lado do rótulo
 * "Projeção de fechamento", e sem sinal "10,9%" leria como *a projeção é 10,9%
 * da meta* -- um décimo dela -- em vez de *passa a meta em 10,9%*.
 *
 * O menos é o TIPOGRÁFICO (−), de `formatarNumero`, e não o hífen: é a mesma
 * escolha de `formatarDesvio`, e as duas aparecem na mesma tela.
 *
 * Uma casa, e não duas: aqui não há coluna para alinhar -- o número fica sozinho
 * à direita de uma linha -- e a segunda casa de um percentual de projeção é
 * precisão que o dado não tem.
 */
export function percentualComSinal(v: number): string {
  return `${v > 0 ? '+' : ''}${formatarNumero(v, 1)}%`
}

/**
 * "06/09/2026 · 14:32" — data e hora SEMPRE, para a linha do tempo.
 *
 * A hora entra porque a trilha da cadeia de ajuda se mede em horas, não em
 * dias: escalar de manhã e receber resposta à tarde é o GD funcionando;
 * `06/09` nas duas pontas fazia os dois parecerem simultâneos, e uma ação
 * escalada às 08h e devolvida às 18h ficava indistinguível de uma que
 * atravessou o dia parada.
 *
 * NÃO é a regra de `AppHeader`/`PainelCargas`, que escondem a data quando é
 * hoje. Ali há um instante só e "hoje" é o contexto; aqui há uma sequência, e
 * um nó sem data obriga quem lê a inferir de qual dia ele é a partir dos
 * vizinhos. Numa lista de escalações entre níveis, é a inferência mais fácil
 * de errar.
 */
export function dataEHora(iso: string): string {
  const d = new Date(iso)
  const data = d.toLocaleDateString('pt-BR')
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `${data} · ${hora}`
}

/**
 * "2026-09-07" → "07/09/2026", CORTANDO A STRING.
 *
 * Sem `new Date`, e é o ponto todo desta função. O prazo chega como data de
 * calendário (`YYYY-MM-DD`, sem hora); `new Date('2026-09-07')` interpreta
 * isso como meia-noite **UTC**, e `toLocaleDateString` de volta em UTC−3
 * devolve **06/09** — o prazo aparece um dia mais cedo, e um prazo que vence
 * antes da hora é o pior erro possível numa tela de cobrança.
 *
 * O mesmo corte de string está em `PainelCargas`, por este mesmo motivo.
 */
export function dataDoCalendario(iso: string): string {
  const [ano, mes, dia] = iso.split('-')
  if (!ano || !mes || !dia) return iso
  return `${dia}/${mes}/${ano}`
}

/**
 * O alvo de Performance Vendas é 100%, POR DEFINIÇÃO — não é patamar cadastrado.
 *
 * O percentual de Performance Vendas já é `projeção ÷ meta em R$` (ver
 * `performance-vendas.ts` no backend): 84% quer dizer "projeta fechar 84% da
 * meta". Então "na meta" é atingir 100% dela — o alvo é intrínseco, não uma
 * decisão de negócio a guardar em `meta` escopo VARIAVEL.
 *
 * NÃO é o `meta ?? 100` que a §7.37 removeu. Aquele chutava patamar para
 * QUALQUER variável, inclusive as de valor absoluto (Ticket médio R$ 155,
 * Avaria 1,5%), onde 100 não significa nada. Aqui vale só para a variável cujo
 * valor JÁ É % da meta — e para ela 100 é a régua, não um palpite.
 *
 * Mora aqui, e não numa cópia em cada tela, DE PROPÓSITO: o veredito de Vendas
 * é o mesmo no N3 e no N4, e uma segunda cópia é sempre a que fica para trás —
 * foi exatamente o que aconteceu (a linha do N3 seguia a meta cadastrada, a do
 * N4 não). Decisão do analista em 21/09/2026, ao ver "sem resposta" em produção.
 */
export const ALVO_PERFORMANCE = 100

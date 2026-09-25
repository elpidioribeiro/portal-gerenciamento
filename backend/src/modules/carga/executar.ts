import type { PrismaClient } from '@prisma/client'
import { acharFonte, expressaoData, type Fonte } from '../../fontes/fontes.mjs'
import { env } from '../../config/env.js'
import { DadosInvalidos } from '../../lib/erros.js'
import { consultar } from '../../lib/oracle.js'
import { falhaJaRegistrada, registrarFalhaDeCarga } from '../ingestao/service.js'
import { consultarPowerBI, endpointDa } from '../../lib/power-automate.js'
import {
  gravarMovimentacao,
  gravarPerdas,
  gravarVendasLinha,
  gravarVendedorDia,
} from '../ingestao/gravar.js'
import { gravarNps, gravarVendas } from '../ingestao/gravar.js'
import { gravarMetas, type LinhaMeta } from '../ingestao/gravar-metas.js'
import {
  gravarAreaSupervisor,
  gravarDiasUteis,
  gravarVendedorArea,
  gravarVendedorSituacao,
} from '../ingestao/gravar-cadastro.js'

/**
 * Carga de uma fonte `sql`: Oracle → mapeamento → `fato_*`.
 *
 * Um único executor para os dois gatilhos — o agendamento interno e a carga
 * manual da tela de administração. Dois caminhos separados teriam a mesma
 * consulta e o mesmo mapeamento em duas cópias, e o projeto já pagou esse preço
 * duas vezes (aritmética de percentual entre seed e produção; meta do período
 * entre painel e gráfico). Ver o cabeçalho de `src/fontes/fontes.mjs`.
 *
 * Quem NÃO passa por aqui: Vendas, NPS e vendas-linha, que continuam vindo do
 * Power BI pelo n8n.
 */

/**
 * As fontes de JANELA que este módulo carrega. Vendas e NPS não são `sql`.
 *
 * Cresceu de duas para quatro em 01/09/2026. O que segurava as outras não era
 * o Oracle -- o servidor já sabia consultá-lo -- era a gravação morar DENTRO da
 * rota `/ingest/*`. Com os gravadores extraídos, entrar aqui é uma linha.
 *
 * Só as que têm `periodo`: `vendedor-area`, `area-supervisor`,
 * `vendedor-situacao` e `dias-uteis` são retrato de cadastro, não janela de
 * datas, e um controle de "últimos N dias" mentiria sobre elas. Ver
 * `FONTES_CADASTRO`.
 */
export const FONTES_SQL = [
  'perdas',
  'movimentacao',
  'vendas-linha',
  'vendedor-dia',
] as const
export type FonteSql = (typeof FONTES_SQL)[number]

/**
 * Quais o portal AGENDA sozinho — subconjunto de `FONTES_SQL`.
 *
 * A distinção nasceu em 01/09/2026 achando que `vendas-linha` e `vendedor-dia`
 * continuavam agendadas no n8n, e **estava errada**: o fluxo delas foi apagado
 * do repositório quando viraram consulta Oracle, e o log de `sync_execucao`
 * confirma -- nenhuma execução delas partiu do IP do n8n. Ficaram sem
 * agendador nenhum, rodando só quando alguém disparava à mão.
 *
 * Hoje a lista é TUDO que o portal carrega do Oracle, janela e cadastro. A
 * distinção continua existindo porque nem toda fonte que se sabe carregar
 * precisa ser agendada -- e é onde uma fonte nova entra enquanto se decide.
 */
export const FONTES_AGENDADAS = [
  'perdas',
  'movimentacao',
  'vendas-linha',
  'vendedor-dia',
  'vendedor-area',
  'area-supervisor',
  'vendedor-situacao',
  'dias-uteis',
  'vendas',
  'nps',
] as const satisfies readonly (FonteSql | FonteCadastro | FonteDax)[]

/** O que o agendamento aceita: janela de Oracle, cadastro, ou Power BI. */
export type FonteAgendavel = (typeof FONTES_AGENDADAS)[number]

/**
 * Quem grava cada fonte.
 *
 * Um registro em vez do ternário que havia aqui (`nome === 'perdas' ? ... :
 * ...`): com duas fontes o ternário passava, com quatro ele erra em silêncio na
 * primeira que alguém esquecer.
 *
 * O que o `Record<FonteSql, _>` compra: **exaustividade**. Entrar em
 * `FONTES_SQL` sem gravador não compila.
 *
 * O que ele NÃO compra, e é bom dizer: o tipo de `linhas`. O `as never` abaixo
 * é o mesmo `as unknown as LinhaPerdas[]` que estava aqui antes, e existe
 * porque `fonte.mapear`, em `fontes.mjs`, devolve forma não tipada. A garantia
 * de que o mapeamento casa com o gravador segue sendo o teste, não o
 * compilador -- e é por isso que cada fonte nova precisa de um.
 */
const GRAVADORES: Record<
  FonteSql,
  (
    prisma: PrismaClient,
    entrada: {
      periodo: { de: string; ate: string }
      linhas: never[]
      origem: string
      iniciadoEm: Date
    },
  ) => Promise<{ gravadas: number; removidas: number }>
> = {
  perdas: gravarPerdas,
  movimentacao: gravarMovimentacao,
  'vendas-linha': gravarVendasLinha,
  'vendedor-dia': gravarVendedorDia,
}

export function ehFonteSql(v: string): v is FonteSql {
  return (FONTES_SQL as readonly string[]).includes(v)
}

export interface ResultadoBloco {
  de: string
  ate: string
  linhas: number
  gravadas: number
  removidas: number
  segundos: number
}

export interface ResultadoCarga {
  fonte: FonteSql
  de: string
  ate: string
  blocos: ResultadoBloco[]
  totalGravadas: number
  totalRemovidas: number
  segundos: number
}

/**
 * Tamanho do bloco, em dias — POR FONTE, porque o que limita muda com ela.
 *
 * Em Perdas o limite é TEMPO: o SQL leva 60 a 104 segundos por mês, e uma
 * janela de dois anos numa consulta só bateria no teto de 20 minutos e falharia
 * **depois** de esperar os 20 minutos, o pior resultado possível. Trinta e um
 * dias cabem com folga.
 *
 * Em `vendas-linha` o limite é VOLUME, e 31 dias não cabem: são ~5.350 linhas
 * por dia (medido em 03/09/2026), então um mês passa de 165 mil contra o teto
 * de `ORACLE_MAX_ROWS`, que é 50 mil. A carga não erra o número — ela ABORTA na
 * trava de truncamento, e aborta o bloco inteiro.
 *
 * Isso não era visível enquanto a fonte só rodava pelo script, um dia por vez.
 * Passou a ser quando ela entrou no agendamento (§7.53): a janela padrão dela é
 * de 60 dias, ou seja dois blocos de 31 -- e os dois abortariam, toda noite.
 *
 * Sete dias e não nove (o que caberia): a margem é para o dia em que o
 * movimento crescer, e o custo de um bloco a mais é uma ida ao Oracle.
 */
const DIAS_POR_BLOCO_PADRAO = 31

const DIAS_POR_BLOCO: Partial<Record<FonteSql, number>> = {
  'vendas-linha': 7,
  // `vendedor-dia` é ~440 linhas/dia: 31 dias dão ~13 mil, folgado no teto.
}

function diasPorBloco(nome: FonteSql): number {
  return DIAS_POR_BLOCO[nome] ?? DIAS_POR_BLOCO_PADRAO
}

/**
 * Uma carga por vez, no processo.
 *
 * O pool do Oracle tem 4 conexões e a consulta é pesada: duas cargas
 * simultâneas competem por conexão e por plano de execução, e a segunda pode
 * esperar mais que o próprio teto. Além disso o gatilho manual existe justamente
 * para quem está olhando a tela — enfileirar é melhor que degradar as duas.
 *
 * **Limite conhecido:** isto é por PROCESSO. Com mais de uma réplica, duas podem
 * carregar a mesma janela ao mesmo tempo. Não corrompe — a ingestão é
 * substituição de janela em transação, com o mesmo SQL nas duas — mas gasta o
 * dobro e pode registrar um erro de chave única espúrio. Quando houver réplica,
 * trocar por `pg_advisory_lock`.
 */
let emAndamento: Promise<unknown> | null = null

/**
 * QUAL carga está rodando, desde quando, e em que janela.
 *
 * **O defeito que isto conserta** (10/09/2026): a linha em `sync_execucao` só
 * nasce DEPOIS que o Oracle responde — a consulta é o que leva minutos, e
 * `executarCarga` só é chamada com as linhas na mão. Durante a consulta existia
 * apenas o booleano acima, e a tela mostrava um ponto laranja escrito "carga em
 * andamento" sem dizer o quê, de quando, nem desde quando.
 *
 * Medido no uso real: um disparo às 14:07:53 ficou 13 minutos sem produzir
 * linha nenhuma no histórico. Não havia como distinguir "está trabalhando" de
 * "travou", e o teto do Oracle é de 20 minutos (`ORACLE_TIMEOUT_CARGA_S`).
 *
 * **Em memória, e não uma linha `EM_ANDAMENTO` criada antes da consulta.** A
 * outra saída era criar a linha primeiro e `executarCarga` adotá-la, o que
 * exigiria passar o `syncId` por dez gravadores — e um único que esquecesse de
 * repassar deixaria a linha presa em `EM_ANDAMENTO` para sempre, que é
 * exatamente o defeito que se está eliminando. Há uma dessas presa desde
 * 28/08 no banco de desenvolvimento, de um caminho antigo.
 *
 * O preço de ser memória: reiniciar o processo esquece. É aceitável porque a
 * carga morre junto com ele — o estado esquecido descreveria algo que não está
 * mais rodando.
 */
export interface CargaEmAndamento {
  fonte: string
  /** Ausente nas fontes de CADASTRO, que são retrato e não janela. */
  de: string | null
  ate: string | null
  desde: string
}

let descritor: CargaEmAndamento | null = null

export function cargaEmAndamento(): boolean {
  return emAndamento !== null
}

/** O descritor da carga em curso, ou `null`. Ver `CargaEmAndamento`. */
export function cargaAtual(): CargaEmAndamento | null {
  return emAndamento === null ? null : descritor
}

/**
 * A FILA do agendamento — espera a vez em vez de desistir.
 *
 * O disparo manual e o agendado querem coisas opostas quando há outra carga
 * rodando, e por isso são caminhos diferentes:
 *
 *   manual    RECUSA na hora (409). Quem clicou está olhando a tela, e
 *             enfileirar por meia hora sem dizer nada é pior que dizer não.
 *   agendado  ESPERA. Ninguém está olhando, e "às 3h40" significa uma vez por
 *             dia -- não "às 3h40, se estiver livre".
 *
 * Era só o primeiro comportamento, para os dois. Perdas roda com janela de 730
 * dias: 24 blocos de ~80 s, uns 32 minutos a partir das 3h15. Movimentação, às
 * 3h20, caía dentro disso e era **descartada até o dia seguinte** -- com erro no
 * log, mas sem ninguém para ler o log às 3h20. Com oito fontes agendadas entre
 * 3h15 e 3h55, seis nunca rodariam.
 *
 * A fila é uma corrente de promessas: cada trabalho começa quando o anterior
 * termina, dando certo ou errado. `catch` na cauda porque uma carga que falha
 * não pode quebrar a corrente das seguintes.
 */
let fila: Promise<unknown> = Promise.resolve()

export function enfileirar<T>(trabalho: () => Promise<T>): Promise<T> {
  const proximo = fila.then(trabalho, trabalho)
  fila = proximo.catch(() => undefined)
  return proximo
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * A janela: `janelaDias` dias terminando em **D-1**, contando inclusive.
 *
 * D-1 porque o registro de venda é D-1 na origem — o movimento de um dia só
 * existe no dia seguinte. Não é contorno: é onde o dado termina. Incluir o dia
 * corrente traz um dia com valor parcial que ainda assim conta como dia decorrido.
 *
 * `dias - 1` no cálculo, e isto corrige um fora-por-um herdado do fluxo do n8n,
 * que fazia `de = D-1 − dias` e portanto abrangia `dias + 1` datas. Lá era
 * invisível: uma janela de reescrita com um dia extra não muda resultado nenhum.
 * Aqui não dá: o administrador digita "3 dias" e tem de receber três.
 */
export function janelaPadrao(fonte: Pick<Fonte, 'janelaDias'>, hoje: Date): {
  de: string
  ate: string
} {
  const ate = new Date(hoje.getTime() - 86_400_000)
  const de = new Date(ate.getTime() - (fonte.janelaDias - 1) * 86_400_000)
  return { de: iso(de), ate: iso(ate) }
}

/** Parte [de, ate] em blocos de `dias`, em UTC para não escorregar de fuso. */
function partir(de: string, ate: string, dias: number): Array<{ de: string; ate: string }> {
  const fim = Date.parse(`${ate}T00:00:00Z`)
  const blocos: Array<{ de: string; ate: string }> = []
  let inicio = Date.parse(`${de}T00:00:00Z`)

  while (inicio <= fim) {
    const termina = Math.min(inicio + (dias - 1) * 86_400_000, fim)
    blocos.push({ de: iso(new Date(inicio)), ate: iso(new Date(termina)) })
    inicio = termina + 86_400_000
  }
  return blocos
}

export async function executarCargaSql(
  prisma: PrismaClient,
  nome: FonteSql,
  janela: { de: string; ate: string },
  origem: string,
): Promise<ResultadoCarga> {
  if (emAndamento) {
    throw new DadosInvalidos(
      'Já existe uma carga em andamento. Ela consulta o Oracle e leva minutos; ' +
        'espere terminar antes de disparar outra.',
    )
  }

  const trabalho = rodar(prisma, nome, janela, origem)
  emAndamento = trabalho
  descritor = { fonte: nome, de: janela.de, ate: janela.ate, desde: new Date().toISOString() }
  try {
    return await trabalho
  } finally {
    /*
     * Os dois juntos, no `finally`. Limpar so' o `emAndamento` deixaria o
     * descritor descrevendo uma carga que acabou -- e `cargaAtual` le' os dois,
     * de proposito, para que esquecer um deles nao produza uma tela que mente.
     */
    emAndamento = null
    descritor = null
  }
}

/**
 * A META da fonte, quando ela tem origem de meta.
 *
 * ENTROU EM 18/09/2026, e a ausência era um buraco de verdade: a carga sabia
 * gravar FATO e não sabia gravar META. O único caminho para a meta era um POST
 * em `/ingest/metas`, feito pelo n8n ou pelo script `recarregar`.
 *
 * Como o buraco nasceu: no desenho antigo o n8n carregava os dois no mesmo
 * fluxo. Quando Vendas e NPS passaram para o agendador interno (§7.53), a
 * metade do fato veio junto e a da meta ficou para trás. Em desenvolvimento
 * ninguém notou -- o seed cria as metas. Em produção o quadro subiu com "sem
 * meta" em todas as células.
 *
 * ANTES DO FATO, de propósito. É a mesma ordem do `recarregar`, e o motivo está
 * lá: com valor novo contra meta velha o painel mostra percentual absurdo, e
 * ninguém descobre que a causa foi uma carga pela metade.
 *
 * FALHA DA META DERRUBA A CARGA. Deixar seguir gravaria o fato e deixaria a
 * meta para trás -- exatamente o estado que esta função existe para impedir.
 *
 * Fonte SEM origem de meta simplesmente não entra aqui: Perdas e Custo têm
 * `daxMeta: null` e `montarMetas: null`, e a meta deles não vem de lugar
 * nenhum. É decisão de negócio pendente, não esquecimento.
 */
async function carregarMeta(
  prisma: PrismaClient,
  fonte: Fonte,
  origem: string,
): Promise<number> {
  if (!fonte.montarMetas) return 0

  const endpoint = fonte.tipo === 'dax' && fonte.daxMeta !== null ? endpointDa(fonte) : null
  if (!fonte.sqlMeta && endpoint === null) return 0

  const brutas = fonte.sqlMeta
    ? (await consultar(fonte.sqlMeta, {}, { perfil: 'carga' })).linhas
    : await consultarPowerBI(endpoint!, fonte.daxMeta!(), {})

  if (brutas.length === 0) {
    throw new Error(
      `A consulta de metas de ${fonte.fonte} não devolveu nenhuma linha. Abortado antes de ` +
        'gravar o fato: valor novo contra meta velha mostra percentual absurdo no painel.',
    )
  }

  /*
   * O `as` é o mesmo caso do `as never` em `gravar.ts`, e pela mesma razão:
   * `montarMetas` mora em `fontes.mjs`, que é JavaScript. A declaração só pode
   * prometer `Record<string, unknown>[]` -- ela não conhece a forma que cada
   * mapeador produz.
   *
   * Quem confere de verdade é o `gravarMetas`: indicador desconhecido, filial
   * que não existe e meta de área sem cadastro são recusas dele, em tempo de
   * execução. O tipo aqui não substituiria isso nem se fosse exato, porque o
   * dado vem de fora.
   */
  const linhas = fonte.montarMetas(brutas) as unknown as LinhaMeta[]
  const r = await gravarMetas(prisma, { linhas, origemIp: origem })
  return r.gravadas
}

async function rodar(
  prisma: PrismaClient,
  nome: FonteSql,
  janela: { de: string; ate: string },
  origem: string,
): Promise<ResultadoCarga> {
  const fonte = acharFonte(nome)
  if (fonte.tipo !== 'sql' || !fonte.sql) {
    throw new Error(`"${nome}" não é fonte de origem Oracle. Ver src/fontes/fontes.mjs.`)
  }

  // A META PRIMEIRO. Ver `carregarMeta` -- se ela falhar, o fato nao sobe.
  await carregarMeta(prisma, fonte, origem)

  const t0 = Date.now()
  const blocos: ResultadoBloco[] = []

  for (const b of partir(janela.de, janela.ate, diasPorBloco(nome))) {
    // Marcado ANTES da consulta: e' ela que leva minutos, e e' o que a tela de
    // administracao mostra como duracao.
    const inicioBloco = new Date()
    const tb = inicioBloco.getTime()

    try {
      blocos.push(
        await rodarBloco(prisma, nome, fonte.sql, fonte.mapear, b, origem, inicioBloco, tb),
      )
    } catch (erro) {
      /**
       * TODA FALHA DEIXA LINHA NO HISTÓRICO. Ver `registrarFalhaDeCarga`.
       *
       * Este `try` abraça o bloco inteiro porque a carga morre em cinco lugares
       * diferentes, e só UM deles já registrava:
       *
       *   Oracle fora do ar / consulta com erro   não registrava
       *   teto de linhas atingido                 não registrava
       *   zero linha devolvida                    não registrava
       *   validação de cadastro (vendedor, etc.)  não registrava
       *   a transação de gravação                 registrava (`executarCarga`)
       *
       * Medido em 10/09/2026: duas cargas manuais de `vendedor-dia` recusadas
       * por cadastro faltando, e zero linha em `sync_execucao` naquele dia. A
       * tela dizia "carga em andamento" e voltava ao normal.
       *
       * `falhaJaRegistrada` evita a linha dobrada quando a morte foi na
       * transação -- lá o registro é melhor, porque tem a contagem de linhas
       * recebidas.
       *
       * Relança sempre: quem chamou decide o que fazer. O que muda aqui é só
       * que a falha passa a ter rastro.
       */
      if (!falhaJaRegistrada(erro)) {
        await registrarFalhaDeCarga(prisma, {
          fonte: nome,
          periodo: { de: b.de, ate: b.ate },
          origemIp: origem,
          iniciadoEm: inicioBloco,
          erro,
        })
      }
      throw erro
    }
  }

  return {
    fonte: nome,
    de: janela.de,
    ate: janela.ate,
    blocos,
    totalGravadas: blocos.reduce((a, b) => a + b.gravadas, 0),
    totalRemovidas: blocos.reduce((a, b) => a + b.removidas, 0),
    segundos: Number(((Date.now() - t0) / 1000).toFixed(1)),
  }
}

/**
 * UM bloco: consulta, valida e grava.
 *
 * Extraído do laço de `rodar` para o `try/catch` do registro de falha ter um
 * corpo só, em vez de envolver metade de um `for`.
 */
async function rodarBloco(
  prisma: PrismaClient,
  nome: FonteSql,
  /** Já conferido não-nulo por `rodar`: fonte sem SQL não chega aqui. */
  sql: string,
  mapear: (l: Record<string, unknown>) => unknown,
  b: { de: string; ate: string },
  origem: string,
  inicioBloco: Date,
  tb: number,
): Promise<ResultadoBloco> {
    /**
     * A janela vai como TEXTO 'YYYY-MM-DD'. As consultas usam
     * `TO_DATE(:de, 'YYYY-MM-DD')` — sem máscara, a leitura dependeria do
     * `NLS_DATE_FORMAT` da sessão e uma sessão com formato diferente traria o
     * período errado SEM FALHAR.
     */
    const { linhas: brutas, truncado } = await consultar(
      sql,
      { de: b.de, ate: b.ate },
      { perfil: 'carga' },
    )

    if (truncado) {
      throw new Error(
        `A consulta de ${nome} bateu no teto de ${env.ORACLE_MAX_ROWS} linhas em ` +
          `${b.de} → ${b.ate}. Abortado antes de gravar: um lote parcial substituiria a ` +
          'janela por menos dado do que existe.',
      )
    }

    /**
     * Zero linha aborta. A ingestão SUBSTITUI a janela — apaga o período e grava
     * o que chegou — então enviar lote vazio apagaria dado bom e não reporia
     * nada. Uma consulta que falha sem erro (coluna renomeada na origem, filtro
     * que deixou de casar) tem exatamente esse sintoma.
     */
    if (brutas.length === 0) {
      throw new Error(
        `A consulta de ${nome} não devolveu nenhuma linha em ${b.de} → ${b.ate}. ` +
          'Abortado antes de gravar — gravar apagaria a janela sem repor nada.',
      )
    }

    const linhas = brutas.map(mapear)
    const periodo = { de: b.de, ate: b.ate }

    const r = await GRAVADORES[nome](prisma, {
      periodo,
      linhas: linhas as never[],
      origem,
      iniciadoEm: inicioBloco,
    })

    return {
      ...periodo,
      linhas: linhas.length,
      gravadas: r.gravadas,
      removidas: r.removidas,
      segundos: Number(((Date.now() - tb) / 1000).toFixed(1)),
    }
}

/**
 * As fontes de CADASTRO — retrato, não janela.
 *
 * O SQL delas não recebe `:de` nem `:ate` (`janelaDias: null` em
 * `fontes.mjs`): uma consulta devolve o estado atual e a carga substitui o que
 * havia. "Últimos N dias" não significa nada aqui, e oferecer o controle
 * mentiria sobre o que o botão faz.
 *
 * Também não são agendadas pelo portal — continuam no n8n, pelo mesmo motivo
 * de `FONTES_AGENDADAS`. O que faltava era poder disparar à mão, que é o caso
 * real: alguém entra no cadastro corporativo, muda o supervisor de uma área, e
 * quer ver no quadro sem esperar as 3h42 do dia seguinte.
 */
export const FONTES_CADASTRO = [
  'vendedor-area',
  'area-supervisor',
  'vendedor-situacao',
  'dias-uteis',
] as const
export type FonteCadastro = (typeof FONTES_CADASTRO)[number]

export function ehFonteCadastro(v: string): v is FonteCadastro {
  return (FONTES_CADASTRO as readonly string[]).includes(v)
}

const GRAVADORES_CADASTRO: Record<
  FonteCadastro,
  (
    prisma: PrismaClient,
    entrada: { linhas: never[]; origem: string },
  ) => Promise<{ gravadas: number; removidas: number }>
> = {
  'vendedor-area': gravarVendedorArea,
  'area-supervisor': gravarAreaSupervisor,
  'vendedor-situacao': gravarVendedorSituacao,
  'dias-uteis': gravarDiasUteis,
}

export interface ResultadoCadastro {
  fonte: FonteCadastro
  linhas: number
  gravadas: number
  removidas: number
  segundos: number
}

/**
 * Carrega uma fonte de cadastro: uma consulta, uma gravação.
 *
 * Sem blocos e sem janela, ao contrário de `executarCargaSql` — não há o que
 * partir. Divide com ela a MESMA trava `emAndamento`: as duas competem pelo
 * pool de 4 conexões do Oracle, e deixar um retrato passar na frente de uma
 * carga de dois anos degradaria as duas.
 */
export async function executarCargaCadastro(
  prisma: PrismaClient,
  nome: FonteCadastro,
  origem: string,
): Promise<ResultadoCadastro> {
  if (emAndamento) {
    throw new DadosInvalidos(
      'Já existe uma carga em andamento. Ela consulta o Oracle e leva minutos; ' +
        'espere terminar antes de disparar outra.',
    )
  }
  const inicio = new Date()
  const trabalho = rodarCadastro(prisma, nome, origem)
  emAndamento = trabalho
  // Cadastro e' retrato: nao tem janela, e a tela nao deve inventar uma.
  descritor = { fonte: nome, de: null, ate: null, desde: inicio.toISOString() }
  try {
    return await trabalho
  } catch (erro) {
    /*
     * A MESMA trava da carga de janela, e aqui ela já tinha faltado uma vez: o
     * comentário de `rodarCadastro` conta que duas fontes falhavam sem o painel
     * mostrar erro *"porque não havia linha em `sync_execucao` para mostrar"*.
     * Aquilo foi corrigido no bind da consulta; o registro da falha, não.
     *
     * Sem `periodo`: cadastro é retrato, e a linha fica com a data de hoje.
     */
    if (!falhaJaRegistrada(erro)) {
      await registrarFalhaDeCarga(prisma, {
        fonte: nome,
        origemIp: origem,
        iniciadoEm: inicio,
        erro,
      })
    }
    throw erro
  } finally {
    emAndamento = null
    descritor = null
  }
}

/**
 * Do 1º do mês ANTERIOR ao último dia do mês corrente.
 *
 * É o que a nota de `vendedor-situacao` pede: *"recarregar o mês CORRENTE todo
 * dia e o mês anterior ao menos uma vez depois de fechado"*. O motivo está no
 * dado: `HOUVE_VENDA` é calculada com `SYSDATE` na origem — enquanto o mês
 * corre todo mundo é MÊS EM VIGOR, e quando fecha a MESMA linha vira COM VENDA
 * ou SEM VENDA. Recarregar só o mês corrente congelaria o anterior no rótulo
 * provisório, e o denominador nunca mais mudaria.
 *
 * Dois meses e não seis: a substituição é dos meses PRESENTES no lote, então
 * cada mês a mais é reescrita de dado que já está fechado e não muda.
 */
function competenciaCorrente(hoje: Date): { de: string; ate: string } {
  const ano = hoje.getUTCFullYear()
  const mes = hoje.getUTCMonth()
  const de = new Date(Date.UTC(ano, mes - 1, 1))
  // Dia 0 do mês SEGUINTE é o último dia deste. Evita a tabela de 28/30/31.
  const ate = new Date(Date.UTC(ano, mes + 1, 0))
  return { de: iso(de), ate: iso(ate) }
}

async function rodarCadastro(
  prisma: PrismaClient,
  nome: FonteCadastro,
  origem: string,
): Promise<ResultadoCadastro> {
  const fonte = acharFonte(nome)
  if (fonte.tipo !== 'sql' || !fonte.sql) {
    throw new Error(`"${nome}" não é fonte de origem Oracle. Ver src/fontes/fontes.mjs.`)
  }

  const t0 = Date.now()

  /*
   * NEM TODA fonte sem `janelaDias` dispensa parâmetro.
   *
   * `janelaDias: null` foi lido aqui como "não tem janela", e não é isso que
   * ele diz. O comentário de `vendedor-situacao` em `fontes.mjs` é explícito:
   * *"por COMPETÊNCIA, não por dia"* -- a janela existe, só não se mede em
   * dias. As consultas de `vendedor-situacao` e `dias-uteis` recebem `:de` e
   * `:ate` como qualquer outra.
   *
   * Chamar com `{}` fazia o Oracle recusar com `NJS-098: 2 bind placeholders
   * were used but 0 bind values were provided` -- **antes** de a execução ser
   * registrada. Por isso o painel não mostrava nem erro: não havia linha em
   * `sync_execucao` para mostrar. As duas fontes sem bind (`vendedor-area`,
   * `area-supervisor`) funcionavam, e escondiam o defeito nas outras duas.
   *
   * O critério agora é o SQL, não o metadado: se o texto tem `:de`, manda a
   * competência. Ler a verdade da própria consulta é o que impede esta
   * classificação de errar de novo quando entrar uma fonte nova.
   */
  const binds = fonte.sql.includes(':de') ? competenciaCorrente(new Date()) : {}
  const { linhas: brutas, truncado } = await consultar(fonte.sql, binds, { perfil: 'carga' })

  if (truncado) {
    throw new Error(
      `A consulta de ${nome} bateu no teto de ${env.ORACLE_MAX_ROWS} linhas. Abortado antes ` +
        'de gravar: um retrato parcial substituiria o cadastro por menos do que existe.',
    )
  }

  /*
   * Zero linha aborta, pela mesma razão da carga de janela: a gravação
   * SUBSTITUI o que havia. Um retrato vazio apagaria o cadastro inteiro -- e
   * uma consulta que falha sem erro tem exatamente esse formato.
   */
  if (brutas.length === 0) {
    throw new Error(
      `A consulta de ${nome} não devolveu nenhuma linha. Abortado antes de gravar — ` +
        'gravar apagaria o cadastro sem repor nada.',
    )
  }

  const linhas = brutas.map(fonte.mapear)
  const r = await GRAVADORES_CADASTRO[nome](prisma, { linhas: linhas as never[], origem })

  return {
    fonte: nome,
    linhas: linhas.length,
    gravadas: r.gravadas,
    removidas: r.removidas,
    segundos: Number(((Date.now() - t0) / 1000).toFixed(1)),
  }
}

/**
 * As fontes que vêm do Power BI, pelo gatilho do Power Automate.
 *
 * Têm janela como as de Oracle — `janelaDias: 60`, e o DAX recebe `de`/`ate` —
 * então para a TELA são iguais. O que muda é de onde o dado vem, e isso é
 * assunto do executor, não do controle.
 *
 * Ficaram no n8n até 01/09/2026 por um motivo que deixou de valer: o portal não
 * sabia falar com o Power Automate. Agora sabe (`lib/power-automate.ts`), e
 * manter dois agendadores para dez fontes era manter dois lugares para
 * investigar quando um número não chegasse.
 */
export const FONTES_DAX = ['vendas', 'nps'] as const
export type FonteDax = (typeof FONTES_DAX)[number]

export function ehFonteDax(v: string): v is FonteDax {
  return (FONTES_DAX as readonly string[]).includes(v)
}

const GRAVADORES_DAX: Record<
  FonteDax,
  (
    prisma: PrismaClient,
    entrada: {
      periodo: { de: string; ate: string }
      linhas: never[]
      origem: string
      iniciadoEm: Date
    },
  ) => Promise<{ gravadas: number; removidas: number }>
> = {
  vendas: gravarVendas,
  nps: gravarNps,
}

/**
 * Carrega uma fonte do Power BI, em blocos, como as de Oracle.
 *
 * A diferença está numa linha: `consultarPowerBI` no lugar de `consultar`. As
 * travas são as mesmas e pelas mesmas razões — lote vazio aborta antes de
 * gravar, porque a ingestão substitui a janela e gravaria o apagamento.
 */
export async function executarCargaDax(
  prisma: PrismaClient,
  nome: FonteDax,
  janela: { de: string; ate: string },
  origem: string,
): Promise<ResultadoCarga> {
  if (emAndamento) {
    throw new DadosInvalidos(
      'Já existe uma carga em andamento. Ela consulta a origem e leva minutos; ' +
        'espere terminar antes de disparar outra.',
    )
  }
  const inicio = new Date()
  const trabalho = rodarDax(prisma, nome, janela, origem)
  emAndamento = trabalho
  descritor = { fonte: nome, de: janela.de, ate: janela.ate, desde: inicio.toISOString() }
  try {
    return await trabalho
  } catch (erro) {
    /*
     * A mesma trava das outras duas. Aqui os modos de falha são o Power
     * Automate fora do ar, o DAX devolvendo zero linha, e a gravação -- e só o
     * último registrava.
     *
     * O `periodo` é a janela do DISPARO, e não o do bloco que falhou: neste
     * caminho o guarda-chuva é um só, por disparo. A carga de Oracle tem um por
     * bloco justamente porque ela quebra a janela em pedaços de 31 dias e saber
     * QUAL pedaço falhou muda a investigação.
     */
    if (!falhaJaRegistrada(erro)) {
      await registrarFalhaDeCarga(prisma, {
        fonte: nome,
        periodo: janela,
        origemIp: origem,
        iniciadoEm: inicio,
        erro,
      })
    }
    throw erro
  } finally {
    emAndamento = null
    descritor = null
  }
}

async function rodarDax(
  prisma: PrismaClient,
  nome: FonteDax,
  janela: { de: string; ate: string },
  origem: string,
): Promise<ResultadoCarga> {
  const fonte = acharFonte(nome)
  if (fonte.tipo !== 'dax' || !fonte.dax) {
    throw new Error(`"${nome}" não é fonte do Power BI. Ver src/fontes/fontes.mjs.`)
  }
  const endpoint = endpointDa(fonte)

  // A META PRIMEIRO, pelo mesmo motivo do caminho de Oracle.
  await carregarMeta(prisma, fonte, origem)

  const t0 = Date.now()
  const blocos: ResultadoBloco[] = []

  // Vendas e NPS são 9 linhas por dia (uma por filial): volume nunca é o
  // limite aqui, só o tempo da consulta no Power BI.
  for (const b of partir(janela.de, janela.ate, DIAS_POR_BLOCO_PADRAO)) {
    const inicioBloco = new Date()
    const tb = inicioBloco.getTime()

    /*
     * `fonte.dax` é FUNÇÃO, não texto: a expressão de data do DAX é montada por
     * `expressaoData`, e a mesma para as duas pontas -- é o que garante que o
     * portal e o script pedem exatamente o mesmo período.
     */
    const brutas = await consultarPowerBI(
      endpoint,
      fonte.dax(expressaoData(b.de), expressaoData(b.ate)),
      { de: b.de, ate: b.ate },
    )

    // Mesma trava da carga de Oracle, e pela mesma razão.
    if (brutas.length === 0) {
      throw new Error(
        `A consulta de ${nome} não devolveu nenhuma linha em ${b.de} → ${b.ate}. ` +
          'Abortado antes de gravar — gravar apagaria a janela sem repor nada.',
      )
    }

    const linhas = brutas.map(fonte.mapear)
    const periodo = { de: b.de, ate: b.ate }
    const r = await GRAVADORES_DAX[nome](prisma, {
      periodo,
      linhas: linhas as never[],
      origem,
      iniciadoEm: inicioBloco,
    })

    blocos.push({
      ...periodo,
      linhas: linhas.length,
      gravadas: r.gravadas,
      removidas: r.removidas,
      segundos: Number(((Date.now() - tb) / 1000).toFixed(1)),
    })
  }

  return {
    fonte: nome as unknown as FonteSql,
    de: janela.de,
    ate: janela.ate,
    blocos,
    totalGravadas: blocos.reduce((a, b) => a + b.gravadas, 0),
    totalRemovidas: blocos.reduce((a, b) => a + b.removidas, 0),
    segundos: Number(((Date.now() - t0) / 1000).toFixed(1)),
  }
}

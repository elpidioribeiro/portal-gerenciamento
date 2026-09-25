import type { Prisma, PrismaClient } from '@prisma/client'
import { env } from '../../config/env.js'
import { DadosInvalidos } from '../../lib/erros.js'

/**
 * Motor da ingestão: substituição de janela em transação única.
 *
 * `UPDATE`/`upsert` sozinho nunca apaga. Se um lançamento sumir da origem
 * (quebra rejeitada depois de aprovada, estorno, correção), o upsert atualiza o
 * que veio e **deixa a linha antiga viva para sempre** — o número fica alto sem
 * sintoma nenhum, e ninguém desconfia de um dado que só existe.
 *
 * Por isso a carga substitui a janela inteira:
 *
 *   BEGIN
 *     DELETE  WHERE data BETWEEN :de AND :ate    -- SEMPRE limitado à janela
 *     INSERT  …
 *     expurgo da retenção
 *   COMMIT
 *
 * O DELETE nunca varre a tabela toda: a carga diária de 60 dias não pode apagar
 * o histórico de 2025, ou o gráfico anual nasce vazio.
 */

/** Anos-calendário retidos além do corrente. 1 = ano corrente + anterior. */
export const ANOS_RETIDOS = 1

export interface ResultadoIngestao {
  syncId: string
  recebidas: number
  gravadas: number
  removidas: number
  expurgadas: number
  avisos: string[]
}

/** Resolve siglas de filial para id, recusando as desconhecidas. */
/**
 * Traduz o código do indicador para o id, e **recusa** se não existir.
 *
 * Toda linha de fato aponta para um indicador desde 24/08/2026 — antes o
 * vínculo estava no nome da tabela. Como a coluna é obrigatória, o id precisa
 * ser resolvido antes de gravar.
 *
 * Não cria indicador implicitamente, pelo mesmo motivo de `mapearFiliais`: um
 * código novo é quase sempre erro de digitação, e criar do nada produziria um
 * indicador fantasma com dados que ninguém procura — pior aqui, porque ele
 * apareceria no painel da diretoria sem meta e sem dono.
 */
export async function idDoIndicador(prisma: PrismaClient, codigo: string): Promise<string> {
  const indicador = await prisma.indicador.findUnique({ where: { codigo } })
  if (!indicador) {
    throw new Error(
      `Indicador "${codigo}" não existe. Cadastre-o antes de carregar fato para ele.`,
    )
  }
  return indicador.id
}

export async function mapearFiliais(
  prisma: PrismaClient,
  siglas: Iterable<string>,
): Promise<Map<string, string>> {
  const unicas = [...new Set(siglas)]
  const filiais = await prisma.filial.findMany({ where: { sigla: { in: unicas } } })
  const mapa = new Map(filiais.map((f) => [f.sigla, f.id]))

  const faltando = unicas.filter((s) => !mapa.has(s))
  if (faltando.length > 0) {
    // Nunca cria filial implicitamente: uma sigla nova quase sempre é erro de
    // digitação na consulta, e criar do nada produziria uma filial fantasma
    // com dados que ninguém procura.
    throw new DadosInvalidos(
      `Filial desconhecida: ${faltando.join(', ')}. Cadastre antes de enviar dados.`,
    )
  }
  return mapa
}

/** Recusa datas fora da janela declarada — o payload tem que ser coerente consigo. */
export function validarDatasNaJanela(
  linhas: Array<{ data: string }>,
  periodo: { de: string; ate: string },
): void {
  const fora = linhas
    .map((l, i) => ({ i, data: l.data }))
    .filter((l) => l.data < periodo.de || l.data > periodo.ate)

  if (fora.length > 0) {
    const amostra = fora.slice(0, 5).map((f) => `linha ${f.i}: ${f.data}`).join(', ')
    throw new DadosInvalidos(
      `${fora.length} linha(s) fora do período declarado (${periodo.de} a ${periodo.ate}): ${amostra}` +
        (fora.length > 5 ? ' …' : ''),
    )
  }
}

/** Recusa datas no futuro — indicador de bug na consulta da origem. */
export function validarSemFuturo(periodo: { ate: string }, hoje: Date): void {
  const hojeIso = hoje.toISOString().slice(0, 10)
  if (periodo.ate > hojeIso) {
    throw new DadosInvalidos(
      `Período termina no futuro (${periodo.ate}, hoje é ${hojeIso}). ` +
        'Verifique a consulta na origem.',
    )
  }
}

interface Carga<T> {
  fonte: string
  periodo: { de: string; ate: string }
  linhas: T[]
  origemIp: string | null
  /** Apaga a janela e devolve quantas linhas saíram. */
  apagarJanela: (tx: Prisma.TransactionClient, de: Date, ate: Date) => Promise<number>
  /** Insere as linhas e devolve quantas entraram. */
  inserir: (tx: Prisma.TransactionClient, syncId: string) => Promise<number>
  /** Expurgo da retenção; devolve quantas linhas saíram. */
  expurgar?: (tx: Prisma.TransactionClient) => Promise<number>
  /**
   * Quando o trabalho REALMENTE começou, se antes desta chamada.
   *
   * Existe porque a carga de origem Oracle consulta o banco ANTES de chamar
   * aqui, e a consulta é o que leva minutos. Sem isto, `sync_execucao` mediria só
   * a escrita — a tela de administração mostrava "1s" para uma carga de 30
   * segundos, que é pior que não mostrar duração nenhuma.
   *
   * Ausente nas cargas que vêm por HTTP: lá o payload já chegou pronto, e o
   * tempo de rede não é do portal.
   */
  iniciadoEm?: Date
}

export async function executarCarga<T>(
  prisma: PrismaClient,
  carga: Carga<T>,
): Promise<ResultadoIngestao> {
  const de = new Date(`${carga.periodo.de}T00:00:00.000Z`)
  const ate = new Date(`${carga.periodo.ate}T00:00:00.000Z`)

  const sync = await prisma.syncExecucao.create({
    data: {
      fonte: carga.fonte,
      status: 'EM_ANDAMENTO',
      ...(carga.iniciadoEm === undefined ? {} : { iniciadoEm: carga.iniciadoEm }),
      periodoDe: de,
      periodoAte: ate,
      linhasRecebidas: carga.linhas.length,
      origemIp: carga.origemIp,
    },
  })

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const removidas = await carga.apagarJanela(tx, de, ate)
      const gravadas = await carga.inserir(tx, sync.id)
      const expurgadas = carga.expurgar ? await carga.expurgar(tx) : 0

      await tx.syncExecucao.update({
        where: { id: sync.id },
        data: {
          status: 'SUCESSO',
          finalizadoEm: new Date(),
          linhasGravadas: gravadas,
          linhasRemovidas: removidas + expurgadas,
        },
      })

      return { removidas, gravadas, expurgadas }
    },
    /*
     * O TETO PADRÃO DO PRISMA É 5 SEGUNDOS, e uma carga real passa disso.
     *
     * Medido em 27/08/2026, primeira carga de `vendas-linha` com dado de
     * verdade: 27.078 linhas (5 dias × 9 filiais) levaram **5.185 ms** e a
     * transação foi encerrada no meio, com P2028. Cinco dias é uma janela
     * modesta -- o fluxo diário reescreve 60.
     *
     * O teto tem de ser da OPERAÇÃO, não do padrão de uma biblioteca: apagar a
     * janela e regravá-la é indivisível por definição (é isso que impede o
     * portal de ficar com meio período carregado), e quebrá-la em pedaços
     * menores para caber num timeout arbitrário destruiria justamente essa
     * garantia.
     *
     * 10 minutos, e `maxWait` de 30 s para a espera por conexão do pool. Perdas
     * já usa teto de 20 minutos do lado do Oracle pelo mesmo motivo.
     */
    { timeout: 10 * 60_000, maxWait: 30_000 })

    return { syncId: sync.id, recebidas: carga.linhas.length, avisos: [], ...resultado }
  } catch (erro) {
    // A execução fica registrada como ERRO mesmo quando a transação reverte —
    // é fora dela de propósito, senão o registro da falha sumiria junto.
    await prisma.syncExecucao.update({
      where: { id: sync.id },
      data: {
        status: 'ERRO',
        finalizadoEm: new Date(),
        erro: erro instanceof Error ? erro.message.slice(0, 2000) : String(erro),
      },
    })
    marcarFalhaRegistrada(erro)
    throw erro
  }
}

/**
 * A falha JÁ tem linha em `sync_execucao` — não registre outra.
 *
 * Existe porque a carga pode morrer nos DOIS lados desta função: antes dela
 * (consulta ao Oracle, teto de linhas, validação de cadastro) e dentro dela
 * (a transação). Quem chama não tem como distinguir olhando o erro, e sem esta
 * marca a falha de dentro apareceria duas vezes no histórico.
 *
 * Símbolo e não propriedade de texto: o erro atravessa camadas e vai para o
 * log, e um `erro.syncRegistrado` seria serializado junto, virando ruído na
 * mensagem que alguém vai ler às 3 da manhã.
 *
 * Erro que não é objeto (alguém deu `throw 'texto'`) não aceita marca. Aí a
 * falha é registrada pelos dois lados, e uma linha repetida é melhor do que
 * nenhuma.
 */
const FALHA_REGISTRADA = Symbol.for('portalgd.falhaRegistradaEmSync')

export function marcarFalhaRegistrada(erro: unknown): void {
  if (typeof erro === 'object' && erro !== null) {
    Object.defineProperty(erro, FALHA_REGISTRADA, { value: true, enumerable: false })
  }
}

export function falhaJaRegistrada(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && FALHA_REGISTRADA in erro
}

/**
 * Registra uma falha que aconteceu ANTES de `executarCarga` criar a linha.
 *
 * **O defeito que isto conserta** (medido em 10/09/2026): `vendedor-dia` foi
 * disparada à mão duas vezes, recusou as duas por cadastro faltando
 * (*"Vendedor não cadastrado: OES|32848, LIT|31904, LIT|29376"*), e o
 * `sync_execucao` não ganhou **nenhuma** linha no dia. A tela mostrava "carga
 * em andamento" e depois voltava ao normal, sem explicação em lugar nenhum: o
 * erro existia só no log do servidor, que ninguém abre.
 *
 * Pior que o silêncio: o comentário da rota de carga AFIRMAVA que a falha ficava
 * registrada. Uma regra certa escrita ao lado de um código que não a cumpre.
 *
 * `linhasRecebidas` aceita o que se sabe -- zero quando a consulta nem chegou a
 * responder. Não é o mesmo que "a consulta devolveu zero", e por isso a
 * mensagem do erro vai junto: é ela que diz qual dos dois foi.
 */
export async function registrarFalhaDeCarga(
  prisma: PrismaClient,
  dados: {
    fonte: string
    /**
     * Ausente nas fontes de CADASTRO, que são retrato e não janela: aí a linha
     * fica com a data de hoje, que é quando a tentativa aconteceu.
     *
     * `periodo_de` e `periodo_ate` são NOT NULL no banco -- conferido no
     * schema --, então não há a opção de deixar em branco.
     */
    periodo?: { de: string; ate: string }
    origemIp: string
    iniciadoEm: Date
    linhasRecebidas?: number
    erro: unknown
  },
): Promise<void> {
  const hoje = dados.iniciadoEm.toISOString().slice(0, 10)
  const periodo = dados.periodo ?? { de: hoje, ate: hoje }

  await prisma.syncExecucao.create({
    data: {
      fonte: dados.fonte,
      status: 'ERRO',
      iniciadoEm: dados.iniciadoEm,
      finalizadoEm: new Date(),
      periodoDe: new Date(`${periodo.de}T00:00:00.000Z`),
      periodoAte: new Date(`${periodo.ate}T00:00:00.000Z`),
      linhasRecebidas: dados.linhasRecebidas ?? 0,
      linhasGravadas: 0,
      origemIp: dados.origemIp,
      erro:
        dados.erro instanceof Error
          ? dados.erro.message.slice(0, 2000)
          : String(dados.erro).slice(0, 2000),
    },
  })

  /*
   * Marca o erro DEPOIS de gravar. Assim quem tem um segundo guarda-chuva mais
   * externo -- e a carga de Oracle tem, um por bloco e um por disparo -- não
   * escreve a mesma falha duas vezes.
   */
  marcarFalhaRegistrada(dados.erro)
}

/** Primeiro dia do ano-calendário mais antigo que deve sobreviver. */
export function limiteDaRetencao(hoje: Date): Date {
  return new Date(Date.UTC(hoje.getUTCFullYear() - ANOS_RETIDOS, 0, 1))
}

/** ISO 'YYYY-MM-DD' -> Date em UTC. Coluna e' `@db.Date`, sem hora. */
export const dataDe = (s: string) => new Date(`${s}T00:00:00.000Z`)

/**
 * Recusa chaves repetidas no payload.
 *
 * Sem isso o `createMany` estouraria na constraint única com uma mensagem do
 * Postgres, difícil de interpretar do lado do n8n. E chave duplicada quase
 * sempre significa `GROUP BY` faltando na consulta da origem — vale apontar o
 * problema, não só rejeitar.
 */
export function exigirChaveUnica(chaves: string[], descricao: string): void {
  const vistas = new Set<string>()
  const repetidas = new Set<string>()
  for (const c of chaves) {
    if (vistas.has(c)) repetidas.add(c)
    vistas.add(c)
  }
  if (repetidas.size > 0) {
    const amostra = [...repetidas].slice(0, 5).join(', ')
    throw new DadosInvalidos(
      `${repetidas.size} chave(s) ${descricao} repetida(s) no payload: ${amostra}` +
        (repetidas.size > 5 ? ' …' : '') +
        '. Verifique se falta um GROUP BY na consulta da origem.',
    )
  }
}

/**
 * Retenção do detalhe por linha e por vendedor — **60 dias**.
 *
 * Chegou a ser 12–24 meses por uns instantes, para o backfill de 2026 caber, e
 * voltou. O detalhe existe para o CICLO CORRENTE: o quadro do N4, o Pareto, a
 * marcação da semana. Guardar um ano dele custa 506 MB e ~2 milhões de linhas
 * (medido em 03/09/2026) para responder o que `venda_area_mes` responde em
 * ~2.200 linhas e 592 kB — 890 vezes menor, e conferido ao centavo antes de o
 * detalhe ser descartado.
 *
 * O histórico agora é do RESUMO, e é ele que precisa sobreviver. O detalhe pode
 * ir embora porque o que ele sabia de único — a gerência de cada venda — já foi
 * consolidado por mês antes do expurgo alcançá-lo.
 *
 * Vive aqui e não na rota porque a gravação saiu dela: o expurgo é parte da
 * carga, e a rota e o agendamento interno têm de usar o MESMO corte. Duas
 * cópias divergiriam em silêncio, e o sintoma seria detalhe sumindo em datas
 * diferentes conforme quem disparou.
 */
export const RETENCAO_DIAS_DETALHE = 60

/**
 * A retenção efetiva: o piso de 60 dias, ou o que o ambiente pedir A MAIS.
 *
 * `Math.max` e não `??`: a variável pode ampliar a janela para um backfill, e
 * nunca encurtá-la. Encurtar apagaria detalhe, e um erro de digitação em
 * produção não deve poder fazer isso.
 */
export function retencaoEfetiva(pedida = env.RETENCAO_DIAS_DETALHE): number {
  return Math.max(RETENCAO_DIAS_DETALHE, pedida)
}

export function limiteDoDetalhe(hoje: Date, dias = retencaoEfetiva()): Date {
  /*
   * MEIA-NOITE, e não a hora corrente.
   *
   * A coluna é `@db.Date`, e o expurgo apaga `data < corte`. Carregando a hora
   * do momento, o corte das 12h de 1º de novembro apagava o PRÓPRIO 1º de
   * novembro — 61 dias, não os 60 declarados. Some um dia por carga, sempre o
   * mais antigo, e nada avisa.
   */
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - dias))
}

/**
 * O teto da janela MANUAL do detalhe, em dias.
 *
 * Separado da retenção porque responde outra pergunta: quantos dias o
 * administrador pode pedir de uma vez. Dois anos de `vendas-linha` são ~3,9
 * milhões de linhas e ~100 blocos de Oracle -- um pedido desses quase sempre é
 * erro de digitação na data, e o backfill de verdade se faz pelo script.
 */
export const MAX_DIAS_MANUAL_DETALHE = 400

/**
 * O teto das transações de carga.
 *
 * O padrão do Prisma são 5 segundos, e uma carga real passa disso -- ver o
 * comentário em `service.ts`. O teto tem de ser da OPERAÇÃO: apagar a janela e
 * regravá-la é indivisível, e parti-la para caber num timeout de biblioteca
 * destruiria a garantia que ela existe para dar.
 */
export const TETO_DA_CARGA = { timeout: 10 * 60_000, maxWait: 30_000 }

/**
 * Até onde o agregado do Power BI ainda é COMPARÁVEL com o detalhe do Oracle.
 *
 * O BI tem atualização incremental: **dois meses ficam vivos, o resto é
 * congelado** (analista, 03/09/2026). Partição congelada não reprocessa — o
 * agregado de janeiro é a foto de janeiro, e o detalhe do Oracle é o estado de
 * HOJE, com o que foi cancelado ou corrigido depois.
 *
 * Então as duas fontes **não vão concordar** em mês fechado, e nenhuma está
 * errada. Foi o que travou o backfill de 2026: OES em 23/01 divergia 0,207%
 * contra a tolerância de 0,1%, e recarregar o agregado não mudava nada —
 * porque o BI não reprocessa o passado.
 *
 * O sinal confirmou o diagnóstico: o viés documentado da comparação é o
 * detalhe MAIOR que o agregado, nas nove filiais. Ali o detalhe era MENOR —
 * perdeu o que foi cancelado depois da foto.
 *
 * A correção não é afrouxar a tolerância, que é a única trava contra consulta
 * quebrada. É a validação saber onde a comparação faz sentido.
 *
 * Dois meses de CALENDÁRIO, e não 60 dias corridos: a partição do refresh
 * incremental é mensal, então a fronteira é o 1º do mês anterior.
 */
export function inicioDaJanelaViva(hoje: Date): Date {
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1))
}
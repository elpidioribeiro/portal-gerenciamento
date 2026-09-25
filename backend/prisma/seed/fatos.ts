import type { PrismaClient } from '@prisma/client'
import { desvioPercentual } from '../../src/lib/percentual.js'
import { FILIAIS, MATRIZ, META_GLOBAL, META_VENDAS, type SiglaFilial } from './dados-handoff.js'

/**
 * Fatos diários de 01/01/2025 até hoje.
 *
 * O mês corrente é gerado para agregar **exatamente** nos valores da matriz do
 * handoff; os meses anteriores recebem variação plausível em torno da meta,
 * para que os gráficos de série tenham forma.
 *
 * Nada aqui usa Math.random: o seed precisa ser reproduzível, senão dois
 * desenvolvedores veem números diferentes e nenhuma comparação com o protótipo
 * é possível.
 */

/** Ruído determinístico em [-1, 1], estável para o mesmo par de entradas. */
function ruido(a: number, b: number): number {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

function diasDoMes(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate()
}

/** Distribui um total inteiro em `n` parcelas, sobra na primeira. */
function repartir(total: number, n: number): number[] {
  const base = Math.floor(total / n)
  const partes = Array<number>(n).fill(base)
  partes[0] = base + (total - base * n)
  return partes
}

/**
 * Distribui um total inteiro proporcionalmente a pesos, preservando a soma
 * exata (a diferença de arredondamento vai para a maior parcela).
 *
 * Usado para dar variação dia a dia sem alterar o total do mês — que é o que
 * mantém a matriz batendo com o handoff enquanto o gráfico deixa de ser reto.
 */
function repartirComPeso(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((a, b) => a + b, 0)
  const partes = pesos.map((p) => Math.round((total * p) / soma))
  const diferenca = total - partes.reduce((a, b) => a + b, 0)
  if (diferenca !== 0) {
    let maior = 0
    for (let i = 1; i < partes.length; i++) if (partes[i]! > partes[maior]!) maior = i
    partes[maior] = partes[maior]! + diferenca
  }
  return partes
}

interface Contexto {
  prisma: PrismaClient
  filiais: Map<string, string>
  usuarioId: string
  hoje: Date
  inicio: Date
}

/**
 * Lista de (ano, mes, diasAConsiderar) do início até hoje.
 *
 * `inicio` é construído com `Date.UTC`, então tem que ser lido com os métodos
 * `getUTC*`. Ler com `getFullYear()`/`getMonth()` (que são de hora LOCAL) faria
 * 01/01/2025 00:00 UTC virar 31/12/2024 21:00 em UTC−3, e o seed começaria em
 * dezembro de 2024 — um mês inteiro fora da retenção, que só apareceu quando o
 * expurgo da ingestão o apagou.
 */
function mesesAte(inicio: Date, hoje: Date) {
  const lista: Array<{ ano: number; mes: number; dias: number; corrente: boolean }> = []
  let ano = inicio.getUTCFullYear()
  let mes = inicio.getUTCMonth() + 1

  while (ano < hoje.getFullYear() || (ano === hoje.getFullYear() && mes <= hoje.getMonth() + 1)) {
    const corrente = ano === hoje.getFullYear() && mes === hoje.getMonth() + 1
    // O mês corrente para em D-1: o registro de venda é sempre do dia anterior,
    // então nunca existe linha para hoje. Gravar uma criava dois problemas —
    // representava algo que a origem não produz, e sobrevivia às cargas reais
    // (cuja janela também termina em D-1), virando a "última linha do mês" que
    // o painel usa.
    // No dia 1º ficaria zero dia; mantemos um para o mês não nascer vazio.
    const diasCorrente = Math.max(1, hoje.getDate() - 1)
    lista.push({ ano, mes, dias: corrente ? diasCorrente : diasDoMes(ano, mes), corrente })
    mes++
    if (mes > 12) {
      mes = 1
      ano++
    }
  }
  return lista
}

async function criarSync(prisma: PrismaClient, fonte: string, de: Date, ate: Date) {
  return prisma.syncExecucao.create({
    data: {
      fonte,
      status: 'SUCESSO',
      periodoDe: de,
      periodoAte: ate,
      finalizadoEm: new Date(),
      origemIp: 'seed',
    },
  })
}

export async function semearFatos(ctx: Contexto) {
  const { prisma, filiais, hoje, inicio } = ctx
  const meses = mesesAte(inicio, hoje)
  const siglas = FILIAIS.map((f) => f.sigla)

  /**
   * Ids dos indicadores, resolvidos uma vez.
   *
   * Toda linha de fato aponta para um indicador desde 24/08/2026. O seed roda
   * depois de `semearIndicadores`, então eles já existem — se não existirem, o
   * `!` estoura aqui, que é onde o problema deve aparecer.
   */
  const indicadores = new Map(
    (await prisma.indicador.findMany({ select: { codigo: true, id: true } })).map((i) => [
      i.codigo,
      i.id,
    ]),
  )
  const idVendas = indicadores.get('vendas')!
  const idNps = indicadores.get('nps')!
  const idPerdas = indicadores.get('perdas')!
  const idCusto = indicadores.get('custo')!

  const syncVendas = await criarSync(prisma, 'vendas', inicio, hoje)
  const syncNps = await criarSync(prisma, 'nps', inicio, hoje)
  const syncPerdas = await criarSync(prisma, 'perdas', inicio, hoje)
  const syncMov = await criarSync(prisma, 'movimentacao', inicio, hoje)

  const vendas: Array<{
    filialId: string
    data: Date
    valorReal: number
    tendencia: number
    deltaMeta: number
    syncId: string
  }> = []
  const nps: Array<{
    filialId: string
    data: Date
    qtdPromotores: number
    qtdNeutros: number
    qtdDetratores: number
    syncId: string
  }> = []
  const perdas: Array<{
    filialId: string
    data: Date
    tipoQuebra: 'QI' | 'QNI'
    status: 'PENDENTE' | 'APROVADA'
    valor: number
    syncId: string
  }> = []
  const movimentacao: Array<{ filialId: string; data: Date; valor: number; syncId: string }> = []

  /** Vendas por (filial, ano, mes) — o Custo precisa desse total como faturamento. */
  const faturamento = new Map<string, number>()

  for (const [iFilial, sigla] of siglas.entries()) {
    const filialId = filiais.get(sigla)!

    for (const m of meses) {
      const dias = m.dias
      const datas = Array.from({ length: dias }, (_, d) => new Date(Date.UTC(m.ano, m.mes - 1, d + 1)))

      // ── Vendas ────────────────────────────────────────────────────────────
      // Três colunas com papéis distintos (ver schema):
      //  valorReal  → o vendido no dia; soma para formar o mês fechado
      //  tendencia  → previsão de fechamento vigente naquele dia
      //  deltaMeta  → desvio % da tendência sobre a meta, "calculado na origem"
      //
      // No mês corrente a matriz mostra o ÚLTIMO dia, então a tendência e o
      // delta do último dia têm que dar exatamente os números do handoff.
      const metaMes = META_VENDAS[sigla]
      const alvoTendencia = m.corrente
        ? MATRIZ.vendas[iFilial]![0]
        : Math.round(metaMes * (1 + ruido(iFilial, m.ano * 12 + m.mes) * 0.12))

      // Peso por dia da semana: sábado e domingo puxam mais em home center.
      // Os pesos cobrem o MÊS INTEIRO, mesmo no mês corrente, e só os dias já
      // decorridos viram linha. É isso que faz o realizado acumulado ficar
      // abaixo da tendência no meio do mês — se eu distribuísse a tendência
      // apenas entre os dias decorridos, a soma daria a previsão inteira e o
      // seed deixaria de exercitar a diferença entre as duas colunas.
      const pesoDoDia = (d: Date) => {
        const dow = d.getUTCDay()
        return (
          (dow === 6 ? 1.6 : dow === 0 ? 1.3 : 1) *
          (1 + ruido(iFilial * 31 + d.getUTCDate(), m.mes) * 0.08)
        )
      }
      const diasNoMesInteiro = diasDoMes(m.ano, m.mes)
      const somaPesosMes = Array.from({ length: diasNoMesInteiro }, (_, k) =>
        pesoDoDia(new Date(Date.UTC(m.ano, m.mes - 1, k + 1))),
      ).reduce((a, b) => a + b, 0)

      let acumulado = 0
      datas.forEach((data, i) => {
        const ultimo = i === datas.length - 1
        const valorReal = ultimo && !m.corrente
          ? Math.round((alvoTendencia - acumulado) * 100) / 100
          : Math.round((alvoTendencia * pesoDoDia(data)) / somaPesosMes)
        acumulado += valorReal

        // A tendência converge para o alvo ao longo do mês: começa com ruído
        // maior e vai apertando, como uma previsão que melhora com mais dados.
        // O último dia recebe o alvo exato.
        const progresso = (i + 1) / datas.length
        const tendencia = ultimo
          ? alvoTendencia
          : Math.round(alvoTendencia * (1 + ruido(iFilial * 47 + i, m.mes) * 0.09 * (1 - progresso)))

        vendas.push({
          filialId,
          data,
          valorReal,
          tendencia,
          // Delta que a origem calcularia: tendência contra meta do mês.
          deltaMeta: Number(desvioPercentual(tendencia, metaMes).toFixed(4)),
          syncId: syncVendas.id,
        })
      })

      // Faturamento para o Custo é o REALIZADO, não a tendência.
      faturamento.set(`${sigla}|${m.ano}|${m.mes}`, acumulado)

      // ── NPS ───────────────────────────────────────────────────────────────
      // NPS = (promotores − detratores) / respostas × 100. Guardamos as
      // contagens cruas; a fórmula roda na leitura.
      const alvoNps = m.corrente
        ? MATRIZ.nps[iFilial]![0]
        : Math.round(META_GLOBAL.nps * (1 + ruido(iFilial + 7, m.ano * 12 + m.mes) * 0.1))

      // 100 respostas/dia deixa (alvo × dias) sempre inteiro, então o NPS do
      // mês fecha exato sem sobra de arredondamento.
      const respostasTotal = 100 * dias
      const difTotal = Math.round((alvoNps * respostasTotal) / 100)
      const detTotal = Math.floor((respostasTotal - difTotal) / 3)
      const proTotal = detTotal + difTotal
      const neuTotal = respostasTotal - proTotal - detTotal

      // Pesos opostos para promotores e detratores: quando um sobe, o outro
      // desce, então o NPS oscila entre as semanas. Distribuir uniformemente
      // deixaria o gráfico reto e qualquer erro de escala passaria invisível.
      const pesosPro = datas.map((d) => 1 + ruido(iFilial * 61 + d.getUTCDate(), m.mes) * 0.22)
      const pesosDet = pesosPro.map((p) => 2 - p)

      const pro = repartirComPeso(proTotal, pesosPro)
      const det = repartirComPeso(detTotal, pesosDet)
      const neu = repartir(neuTotal, dias)

      datas.forEach((data, i) => {
        nps.push({
          filialId,
          data,
          qtdPromotores: pro[i]!,
          qtdNeutros: neu[i]!,
          qtdDetratores: det[i]!,
          syncId: syncNps.id,
        })
      })

      // ── Movimentação e Perdas ─────────────────────────────────────────────
      // Perdas % Mov = Σ perdas [APROVADA, QI+QNI] / Σ movimentação × 100.
      const alvoPerdas = m.corrente
        ? MATRIZ.perdas[iFilial]![0]
        : Math.round(META_GLOBAL.perdas * (1 + ruido(iFilial + 13, m.ano * 12 + m.mes) * 0.25) * 10) / 10

      // Movimentação acompanha o realizado do mês, não a tendência: é volume
      // que passou pela loja, não previsão.
      const movMes = acumulado * 1.15
      const perdaMes = (alvoPerdas / 100) * movMes

      const pesosMov = datas.map((d) => 1 + ruido(iFilial * 17 + d.getUTCDate(), m.mes + 5) * 0.15)
      const somaMov = pesosMov.reduce((a, b) => a + b, 0)

      // Pesos DIFERENTES para a perda: com os mesmos pesos da movimentação, a
      // razão perda/movimentação daria idêntica todo dia e o gráfico sairia
      // reto — sem exercitar a escala nem revelar erro de mapeamento.
      const pesosPerda = datas.map((d) => 1 + ruido(iFilial * 29 + d.getUTCDate(), m.mes + 11) * 0.45)
      const somaPerda = pesosPerda.reduce((a, b) => a + b, 0)

      let movAcum = 0
      let perdaAcum = 0
      datas.forEach((data, i) => {
        const ultimo = i === datas.length - 1

        const mov = ultimo
          ? Math.round((movMes - movAcum) * 100) / 100
          : Math.round(((movMes * pesosMov[i]!) / somaMov) * 100) / 100
        movAcum += mov
        movimentacao.push({ filialId, data, valor: mov, syncId: syncMov.id })

        const perdaDia = ultimo
          ? Math.round((perdaMes - perdaAcum) * 100) / 100
          : Math.round(((perdaMes * pesosPerda[i]!) / somaPerda) * 100) / 100
        perdaAcum += perdaDia

        // Divisão QI/QNI da perda aprovada — soma exata do dia.
        const qi = Math.round(perdaDia * 0.6 * 100) / 100
        const qni = Math.round((perdaDia - qi) * 100) / 100
        perdas.push({ filialId, data, tipoQuebra: 'QI', status: 'APROVADA', valor: qi, syncId: syncPerdas.id })
        perdas.push({ filialId, data, tipoQuebra: 'QNI', status: 'APROVADA', valor: qni, syncId: syncPerdas.id })

        // Uma quebra PENDENTE por dia, que NÃO pode entrar no indicador.
        // Vale 25% da perda do dia: se o filtro por status quebrar, o número
        // sobe 25% e a matriz deixa de bater com o handoff imediatamente —
        // o erro fica visível em vez de silencioso.
        perdas.push({
          filialId,
          data,
          tipoQuebra: 'QNI',
          status: 'PENDENTE',
          valor: Math.round(perdaDia * 0.25 * 100) / 100,
          syncId: syncPerdas.id,
        })
      })
    }
  }

  // Inserção em lotes — createMany de ~30 mil linhas de uma vez estoura o
  // limite de parâmetros do Postgres.
  const LOTE = 2_000
  async function inserir<T>(
    nome: string,
    linhas: T[],
    syncId: string,
    fn: (l: T[]) => Promise<unknown>,
  ) {
    for (let i = 0; i < linhas.length; i += LOTE) {
      await fn(linhas.slice(i, i + LOTE))
    }
    // Fecha a execução com a contagem real: sem isso `GET /sync/status`
    // reportaria 0 linhas gravadas e o relatório de frescor mentiria.
    await prisma.syncExecucao.update({
      where: { id: syncId },
      data: { linhasRecebidas: linhas.length, linhasGravadas: linhas.length },
    })
    console.log(`  ${nome}: ${linhas.length.toLocaleString('pt-BR')} linhas`)
  }

  await inserir('fato_vendas', vendas, syncVendas.id, (l) =>
    prisma.fatoVendas.createMany({ data: l.map((x) => ({ ...x, indicadorId: idVendas })) }),
  )
  await inserir('fato_nps', nps, syncNps.id, (l) =>
    prisma.fatoNps.createMany({ data: l.map((x) => ({ ...x, indicadorId: idNps })) }),
  )
  await inserir('fato_movimentacao', movimentacao, syncMov.id, (l) =>
    prisma.fatoMovimentacao.createMany({ data: l }),
  )
  await inserir('fato_perdas', perdas, syncPerdas.id, (l) =>
    prisma.fatoPerdas.createMany({ data: l.map((x) => ({ ...x, indicadorId: idPerdas })) }),
  )

  // ── Custo ───────────────────────────────────────────────────────────────
  // Lançamento manual de fechamento: Custo % = custo / faturamento × 100,
  // e faturamento é Σ fato_vendas do mês. Gravamos o VALOR em reais, para que
  // o percentual seja recalculado na leitura como em produção.
  const custos: Array<{
    filialId: string
    ano: number
    mes: number
    valor: number
    lancadoPorId: string
  }> = []

  for (const [iFilial, sigla] of siglas.entries()) {
    const filialId = filiais.get(sigla)!
    for (const m of meses) {
      const alvo = m.corrente
        ? MATRIZ.custo[iFilial]![0]
        : Math.round(META_GLOBAL.custo * (1 + ruido(iFilial + 23, m.ano * 12 + m.mes) * 0.06) * 10) / 10
      const fat = faturamento.get(`${sigla}|${m.ano}|${m.mes}`)!
      custos.push({
        filialId,
        ano: m.ano,
        mes: m.mes,
        valor: Math.round(((alvo / 100) * fat) * 100) / 100,
        lancadoPorId: ctx.usuarioId,
      })
    }
  }
  await prisma.fatoCusto.createMany({
    data: custos.map((c) => ({ ...c, indicadorId: idCusto })),
  })
  console.log(`  fato_custo: ${custos.length} linhas`)

  return { meses }
}

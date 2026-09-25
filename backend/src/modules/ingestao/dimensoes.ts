import type { PrismaClient } from '@prisma/client'
import { agora } from '../../lib/datas.js'
import { DadosInvalidos } from '../../lib/erros.js'
import { inicioDaJanelaViva } from './service.js'

/**
 * Os auxiliares de dimensão, fora da rota.
 *
 * `resolverVendedores`, `resolverHierarquia` e `validarSomaContraAgregado`
 * moravam em `routes.ts` e recebiam o `FastifyInstance` inteiro para usar UMA
 * coisa dele: `app.prisma`. O acoplamento não incomodava enquanto só a rota os
 * chamava -- e era exatamente o que impedia os gravadores de morarem fora dela.
 *
 * Agora recebem o `PrismaClient`, e servem os dois gatilhos: a rota
 * `/ingest/*` e o agendamento interno do portal.
 */

/**
 * Resolve (filial, código do vendedor) → id, RECUSANDO o que não existe.
 *
 * O vendedor nasce em `vendedor-area`, e só lá: é a única carga que traz a
 * área, e `dimensao_vendedor.area_venda_id` é obrigatória. Criar aqui um
 * vendedor sem área exigiria afrouxar aquela coluna, e vendedor sem área não
 * entra em denominador nenhum — ele sumiria do indicador com a venda dele
 * gravada, sem nada acusar.
 */
export async function resolverVendedores(
  prisma: PrismaClient,
  linhas: Array<{ filial: string; codVendedor: string }>,
): Promise<Map<string, string>> {
  const pares = [...new Set(linhas.map((l) => `${l.filial}|${l.codVendedor}`))]
  const registros = await prisma.dimVendedor.findMany({
    where: {
      OR: pares.map((par) => {
        const [sigla, codVendedor] = par.split('|') as [string, string]
        return { filial: { sigla }, codVendedor }
      }),
    },
    include: { filial: { select: { sigla: true } } },
  })

  const mapa = new Map(registros.map((v) => [`${v.filial.sigla}|${v.codVendedor}`, v.id]))
  const faltando = pares.filter((par) => !mapa.has(par))
  if (faltando.length > 0) {
    throw new DadosInvalidos(
      `Vendedor não cadastrado: ${faltando.slice(0, 5).join(', ')}` +
        `${faltando.length > 5 ? ` e mais ${faltando.length - 5}` : ''}. ` +
        'O par é (filial, código do vendedor). ' +
        'O vendedor nasce na carga `vendedor-area` — rode-a antes desta.',
    )
  }
  return mapa
}

/**
 * Confere o acumulado derivado contra o `QTUTIL` da origem.
 *
 * É a ÚNICA defesa contra uma leitura errada das marcas de `FERIADO<n>`. Elas
 * são código de tipo de dia, com 32 valores distintos na base, e o portal lê
 * "zero é dia em que a loja abre". Se essa leitura estiver errada -- ou se
 * aparecer um código novo --, o número sai plausível: uma cota diária alta
 * demais põe a loja inteira fora da meta, e ninguém desconfia do calendário
 * olhando um percentual baixo.
 *
 * Só confere MÊS COMPLETO. Num mês parcial o acumulado é legitimamente menor
 * que o total, e cobrar igualdade recusaria carga boa.
 */
export function validarAcumuladoContraQtutil(
  linhas: Array<{ filial: string; data: string; acumuladoDia: number; uteisDoMes: number }>,
): void {
  const porMes = new Map<string, typeof linhas>()
  for (const l of linhas) {
    const k = `${l.filial}|${l.data.slice(0, 7)}`
    const lista = porMes.get(k) ?? []
    lista.push(l)
    porMes.set(k, lista)
  }

  const erros: string[] = []
  for (const [k, dias] of porMes) {
    const [, competencia] = k.split('|') as [string, string]
    const [ano, mes] = competencia.split('-').map(Number) as [number, number]
    const ultimoDoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate()

    // Mês parcial: o acumulado é menor que o total por direito.
    if (!dias.some((d) => Number(d.data.slice(8)) === ultimoDoMes)) continue

    const maior = Math.max(...dias.map((d) => d.acumuladoDia))
    const daOrigem = dias[0]!.uteisDoMes
    if (maior !== daOrigem) {
      erros.push(`${k}: contei ${maior}, a origem diz ${daOrigem}`)
    }
  }

  if (erros.length > 0) {
    throw new DadosInvalidos(
      `O calendário não fecha com o QTUTIL da origem em ${erros.length} mês(es): ` +
        `${erros.slice(0, 5).join('; ')}${erros.length > 5 ? ` e mais ${erros.length - 5}` : ''}. ` +
        'Ou a leitura de FERIADO<n> mudou, ou o cadastro do mês está incompleto — ' +
        'ver PLANO §7.15.',
    )
  }
}


/**
 * Resolve (filial, gerência, área de venda) → ids das duas dimensões.
 *
 * Todas vêm JUNTO com o fato e são cadastro de apoio, não referência de
 * negócio — criar sob demanda evita um fluxo n8n só para elas. (Filial é
 * diferente: lá uma sigla nova é sinal de erro.)
 *
 * A alocação em gerência é da ÁREA DE VENDA.
 *
 * A LINHA DE PRODUTO SAIU EM 18/09/2026, junto com o grão do fato. Esta função
 * criava e reclassificava `DimLinha` a cada carga; nenhuma tela lia a dimensão,
 * e o fato que a referenciava passou a ser por área. A tabela `dimensao_linha`
 * FICA NO BANCO, órfã e congelada, por decisão do analista -- removê-la
 * encareceria a GMUD sem mudar comportamento.
 *
 * A dimensão passa a valer pela classificação de HOJE a cada carga. O passado
 * não se mexe: o fato guarda área e gerência do dia da venda.
 */
export async function resolverHierarquia(
  prisma: PrismaClient,
  filiais: Map<string, string>,
  registros: Array<{
    filial: string
    gerencia: string
    cdArea: string
    areaVenda: string
  }>,
): Promise<{ gerencias: Map<string, string>; areas: Map<string, string> }> {
  const filialIds = [...new Set(registros.map((r) => filiais.get(r.filial)!))]

  // ── Gerências ──────────────────────────────────────────────────────────────
  const gerencias = new Map<string, string>()
  const jaG = await prisma.dimGerencia.findMany({
    where: { filialId: { in: filialIds } },
    select: { id: true, filialId: true, nome: true },
  })
  for (const g of jaG) gerencias.set(`${g.filialId}|${g.nome}`, g.id)

  const faltamG = [
    ...new Map(
      registros
        .filter((r) => !gerencias.has(`${filiais.get(r.filial)!}|${r.gerencia}`))
        .map((r) => [`${filiais.get(r.filial)!}|${r.gerencia}`, {
          filialId: filiais.get(r.filial)!,
          nome: r.gerencia,
        }]),
    ).values(),
  ]
  if (faltamG.length > 0) {
    await prisma.dimGerencia.createMany({ data: faltamG, skipDuplicates: true })
    const novos = await prisma.dimGerencia.findMany({
      where: { filialId: { in: filialIds } },
      select: { id: true, filialId: true, nome: true },
    })
    for (const g of novos) gerencias.set(`${g.filialId}|${g.nome}`, g.id)
  }

  // ── Áreas de venda, pelo CÓDIGO ────────────────────────────────────────────
  const areas = new Map<string, string>()
  const jaA = await prisma.dimAreaVenda.findMany({
    where: { filialId: { in: filialIds } },
    select: { id: true, filialId: true, cdArea: true, nome: true, gerenciaId: true },
  })
  const porCodigo = new Map(jaA.map((a) => [`${a.filialId}|${a.cdArea}`, a]))

  const desejadasA = [
    ...new Map(
      registros.map((r) => {
        const filialId = filiais.get(r.filial)!
        return [
          `${filialId}|${r.cdArea}`,
          {
            filialId,
            cdArea: r.cdArea,
            nome: r.areaVenda,
            gerenciaId: gerencias.get(`${filialId}|${r.gerencia}`)!,
          },
        ]
      }),
    ).values(),
  ]

  const criarA = desejadasA.filter((a) => !porCodigo.has(`${a.filialId}|${a.cdArea}`))
  if (criarA.length > 0) {
    await prisma.dimAreaVenda.createMany({ data: criarA, skipDuplicates: true })
  }

  /*
   * Reafirmadas a cada carga, mas SÓ AS QUE MUDARAM.
   *
   * Antes era um `upsert` por registro, sempre, e o `update` gravava mesmo
   * quando nada tinha mudado. Em regime normal nada muda -- a origem manda o
   * mesmo cadastro todo dia --, então isto costuma escrever ZERO linhas.
   */
  const mudouA = desejadasA.filter((a) => {
    const atual = porCodigo.get(`${a.filialId}|${a.cdArea}`)
    return atual && (atual.nome !== a.nome || atual.gerenciaId !== a.gerenciaId)
  })
  for (const a of mudouA) {
    await prisma.dimAreaVenda.update({
      where: { filialId_cdArea: { filialId: a.filialId, cdArea: a.cdArea } },
      data: { nome: a.nome, gerenciaId: a.gerenciaId },
    })
  }

  if (criarA.length > 0 || mudouA.length > 0) {
    const novas = await prisma.dimAreaVenda.findMany({
      where: { filialId: { in: filialIds } },
      select: { id: true, filialId: true, cdArea: true },
    })
    for (const a of novas) areas.set(`${a.filialId}|${a.cdArea}`, a.id)
  } else {
    for (const a of jaA) areas.set(`${a.filialId}|${a.cdArea}`, a.id)
  }

  /*
   * OS MAPAS SAEM COM A SIGLA NA CHAVE, não com o id da filial.
   *
   * Dentro desta função a chave é o `filialId`, que é o que as consultas
   * devolvem. Quem chama tem o registro do lote em mãos, onde a filial é a
   * SIGLA -- e procurar por id ali devolveria `undefined` para tudo.
   *
   * Foi exatamente o que aconteceu na primeira execução real (27/08/2026):
   * `areaVendaId: undefined` chegou ao `createMany` como se fosse id, e quem
   * acusou foi o Postgres. O `!` nas buscas desligou a checagem que o
   * TypeScript teria feito.
   */
  const siglaDe = new Map([...filiais].map(([sigla, id]) => [id, sigla]))
  const porSigla = (m: Map<string, string>) =>
    new Map(
      [...m].map(([chave, id]) => {
        const corte = chave.indexOf('|')
        return [`${siglaDe.get(chave.slice(0, corte))}|${chave.slice(corte + 1)}`, id]
      }),
    )

  return {
    gerencias: porSigla(gerencias),
    areas: porSigla(areas),
  }
}

/**
 * Valida `Σ detalhe == agregado` para cada dia.
 *
 * Sem isso, painel e drill-down mostrariam números diferentes para o mesmo dia
 * e não haveria como saber qual está certo — as duas cargas vêm da mesma origem
 * por caminhos distintos. Falhar a carga é melhor que servir dois números.
 */
export async function validarSomaContraAgregado(
  prisma: PrismaClient,
  filiais: Map<string, string>,
  linhas: Array<{ filial: string; data: string; valor: number }>,
  indicadorId: string,
): Promise<void> {
  const soma = new Map<string, number>()
  for (const l of linhas) {
    const k = `${l.filial}|${l.data}`
    soma.set(k, (soma.get(k) ?? 0) + l.valor)
  }

  const divergencias: string[] = []
  const semAgregado: string[] = []
  /*
   * Fora da janela viva do BI não há o que comparar — a partição está
   * congelada e o detalhe já andou. Ver `inicioDaJanelaViva`.
   */
  const vivoDesde = inicioDaJanelaViva(agora()).toISOString().slice(0, 10)

  for (const [chave, total] of soma) {
    const [sigla, data] = chave.split('|') as [string, string]
    if (data < vivoDesde) continue
    const agregado = await prisma.fatoVendas.findUnique({
      where: {
        filialId_data_indicadorId: {
          filialId: filiais.get(sigla)!,
          data: new Date(`${data}T00:00:00.000Z`),
          indicadorId,
        },
      },
    })

    if (!agregado) {
      semAgregado.push(chave)
      continue
    }

    /*
     * TOLERÂNCIA RELATIVA AO VALOR, não ao tamanho do lote.
     *
     * Era `0,01 × nº de linhas do lote`, e o defeito era de forma: a
     * tolerância mudava conforme a janela enviada, não conforme o número
     * conferido. Um dia de R$ 1,4 milhão ganhava R$ 53 de folga se viesse
     * sozinho e R$ 270 se viesse num lote de cinco dias — a mesma comparação,
     * dois critérios.
     *
     * MEDIDO em julho/2026, 274 pares filial-dia, detalhe do Oracle contra o
     * agregado do Power BI:
     *
     *     pior divergência relativa   0,0883%   (NOR, 04/07)
     *     segunda pior                0,0166%
     *     todo o resto                abaixo de 0,011%
     *     total do mês                0,0020%   (R$ 4.672 em R$ 238,7 mi)
     *
     * E o sinal é SEMPRE o mesmo: o detalhe é maior, nas nove filiais. Isso é
     * viés sistemático da origem, não ruído — a DAX exclui alguma coisa que o
     * SQL inclui. Fica registrado como pergunta aberta no PLANO; não é o que
     * esta validação existe para pegar.
     *
     * 0,1% foi a decisão do analista (27/08/2026), com folga ESTREITA sobre o
     * pior caso de julho: 0,0883% contra 0,1%.
     *
     * SUBIU PARA 0,5% EM 21/09/2026, e foi decisão pragmática, não conserto. Na
     * primeira carga de vendas-linha em produção, CAM 14/09 divergiu 0,23%
     * (detalhe R$ 733.053,22 contra agregado R$ 731.363,72, R$ 1.689 a mais) --
     * quase 3x o pior caso de julho, no mesmo sentido de sempre (detalhe maior:
     * a DAX exclui algo que o SQL inclui). O analista decidiu destravar a carga
     * agora e investigar depois -- "bom melhor que ótimo". A folga de 0,5% cabe
     * este caso com margem, mas NÃO explica por que o viés cresceu.
     *
     * ISSO É DÍVIDA, não solução: ver a pendência de investigação no PLANO
     * (§7.82). Um dia que passe de 0,5% continua derrubando a carga, e a
     * primeira pergunta segue sendo se o viés cresceu -- não se a tolerância
     * está apertada. Se a investigação achar a causa, o certo é voltar a
     * apertar, não deixar frouxo por conforto.
     *
     * Continua ordens de grandeza abaixo do que a checagem protege: uma área
     * ou linha que suma da carga vale pontos percentuais do dia, não
     * milésimos. Foi assim que o `DIM_LINHA` teria sido pego.
     *
     * O LIMITE CONHECIDO, e ele já existia antes: área pequena demais some sem
     * acusar. "BANHEIRAS" tem meta de R$ 6 mil no mês, ~0,01% da filial —
     * perdê-la inteira passa por baixo desta rede. A checagem pega ruptura
     * estrutural, não a perda de um item pequeno.
     */
    const esperado = Number(agregado.valorReal)
    // 0,5% desde 21/09/2026 (era 0,1%) -- decisao pragmatica, ver comentario
    // acima e a pendencia no PLANO §7.82.
    const tolerancia = Math.max(Math.abs(esperado) * 0.005, 1)
    if (Math.abs(total - esperado) > tolerancia) {
      divergencias.push(`${sigla} ${data}: detalhe ${total.toFixed(2)} ≠ agregado ${esperado.toFixed(2)}`)
    }
  }

  /*
   * Só dias VIVOS chegam aqui: o congelado sai no `continue` acima, antes da
   * busca do agregado. Então exigir o agregado continua certo -- é a ordem das
   * cargas que ele protege, e ela só vale onde há o que comparar.
   */
  if (semAgregado.length > 0) {
    throw new DadosInvalidos(
      `Sem vendas agregadas para ${semAgregado.length} dia(s): ${semAgregado.slice(0, 5).join(', ')}. ` +
        'Rode o fluxo de vendas antes do de vendas-linha.',
    )
  }

  if (divergencias.length > 0) {
    throw new DadosInvalidos(
      `A soma do detalhe não bate com o agregado em ${divergencias.length} dia(s): ` +
        divergencias.slice(0, 5).join(' | ') +
        (divergencias.length > 5 ? ' …' : ''),
    )
  }
}

export async function resolverAreasPorCodigo(
  prisma: PrismaClient,
  filiais: Map<string, string>,
  linhas: Array<{ filial: string; cdArea: string; areaVenda: string; gerencia: string }>,
): Promise<Map<string, string>> {
  /*
   * Repete só as DUAS primeiras etapas de `resolverHierarquia` -- gerência e
   * área --, em vez de chamá-la. Ela resolve três níveis, e o terceiro é a
   * LINHA, que aqui não existe: passar linha vazia criaria uma
   * `dimensao_linha` fantasma que nada aponta, só para reaproveitar código.
   */
  const registros = linhas
  const filialIds = [...new Set(registros.map((r) => filiais.get(r.filial)!))]

  const gerencias = new Map<string, string>()
  const jaG = await prisma.dimGerencia.findMany({
    where: { filialId: { in: filialIds } },
    select: { id: true, filialId: true, nome: true },
  })
  for (const g of jaG) gerencias.set(`${g.filialId}|${g.nome}`, g.id)

  const faltamG = [
    ...new Map(
      registros
        .filter((r) => !gerencias.has(`${filiais.get(r.filial)!}|${r.gerencia}`))
        .map((r) => [
          `${filiais.get(r.filial)!}|${r.gerencia}`,
          { filialId: filiais.get(r.filial)!, nome: r.gerencia },
        ]),
    ).values(),
  ]
  if (faltamG.length > 0) {
    await prisma.dimGerencia.createMany({ data: faltamG, skipDuplicates: true })
    for (const g of await prisma.dimGerencia.findMany({
      where: { filialId: { in: filialIds } },
      select: { id: true, filialId: true, nome: true },
    })) {
      gerencias.set(`${g.filialId}|${g.nome}`, g.id)
    }
  }

  const desejadas = [
    ...new Map(
      registros.map((r) => {
        const filialId = filiais.get(r.filial)!
        return [
          `${filialId}|${r.cdArea}`,
          {
            filialId,
            cdArea: r.cdArea,
            nome: r.areaVenda,
            gerenciaId: gerencias.get(`${filialId}|${r.gerencia}`)!,
          },
        ]
      }),
    ).values(),
  ]

  const jaA = await prisma.dimAreaVenda.findMany({
    where: { filialId: { in: filialIds } },
    select: { id: true, filialId: true, cdArea: true },
  })
  const existe = new Set(jaA.map((a) => `${a.filialId}|${a.cdArea}`))
  const criar = desejadas.filter((a) => !existe.has(`${a.filialId}|${a.cdArea}`))
  if (criar.length > 0) {
    await prisma.dimAreaVenda.createMany({ data: criar, skipDuplicates: true })
  }

  const todas = await prisma.dimAreaVenda.findMany({
    where: { filialId: { in: filialIds } },
    select: { id: true, filialId: true, cdArea: true },
  })
  const siglaDe = new Map([...filiais].map(([sigla, id]) => [id, sigla]))
  const mapa = new Map<string, string>()
  for (const a of todas) mapa.set(`${siglaDe.get(a.filialId)}|${a.cdArea}`, a.id)

  return mapa
}

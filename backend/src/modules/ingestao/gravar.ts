import type { PrismaClient } from '@prisma/client'
import type { z } from 'zod'
import { agora } from '../../lib/datas.js'
import { atualizarResumoVendedor, competenciasDaJanela } from './resumo-vendedor.js'
import { resolverHierarquia, resolverVendedores, validarSomaContraAgregado } from './dimensoes.js'
import { conferirDeltaMeta } from './coerencia.js'
import type { npsSchema, vendasSchema } from './schemas.js'
import {
  dataDe,
  executarCarga,
  limiteDoDetalhe,
  exigirChaveUnica,
  limiteDaRetencao,
  idDoIndicador,
  mapearFiliais,
  validarDatasNaJanela,
  validarSemFuturo,
  type ResultadoIngestao,
} from './service.js'

/**
 * Gravação de Perdas e Movimentação, fora das rotas.
 *
 * Extraído porque estas duas fontes passaram a ter **dois chamadores**: a rota
 * `/ingest/*` (que o n8n usava e o `npm run recarregar` ainda usa) e o
 * agendamento interno do portal, que lê o Oracle direto.
 *
 * A alternativa era o agendamento chamar a própria API por HTTP em localhost, e
 * ela é pior por três motivos: exigiria o `INGEST_TOKEN` para o portal falar
 * consigo mesmo, assumiria que o portal se alcança em `localhost` (falso em
 * container com mais de uma réplica), e faria uma carga de minutos passar pelo
 * timeout de requisição HTTP.
 *
 * Só estas duas. Vendas e NPS continuam com a escrita na rota — mexer nelas sem
 * necessidade seria risco sem retorno.
 */

export interface JanelaCarga {
  de: string
  ate: string
}

/** Opcional; ver `iniciadoEm` em `service.ts`. */
export interface Cronometro {
  iniciadoEm?: Date
}

export interface LinhaPerdas {
  filial: string
  data: string
  tipoQuebra: 'QI' | 'QNI'
  status: 'PENDENTE' | 'APROVADA'
  valor: number
}

export interface LinhaMovimentacao {
  filial: string
  data: string
  valor: number
}

/**
 * `origem` distingue quem gravou, e vai para `sync_execucao.origem_ip`.
 *
 * A coluna guarda IP quando a carga vem de fora; com o agendamento interno não
 * existe IP nenhum, e gravar `'127.0.0.1'` misturaria as duas coisas. O seed já
 * usa a mesma coluna para se identificar (`'seed'`), e a trava contra dado
 * sintético depende disso.
 */
export type Origem = string | null

export async function gravarPerdas(
  prisma: PrismaClient,
  entrada: { periodo: JanelaCarga; linhas: LinhaPerdas[]; origem: Origem } & Cronometro,
): Promise<ResultadoIngestao> {
  const { periodo, linhas, origem } = entrada

  validarSemFuturo(periodo, agora())
  validarDatasNaJanela(linhas, periodo)
  const filiais = await mapearFiliais(
    prisma,
    linhas.map((l) => l.filial),
  )
  const indicadorId = await idDoIndicador(prisma, 'perdas')
  exigirChaveUnica(
    linhas.map((l) => `${l.filial}|${l.data}|${l.tipoQuebra}|${l.status}`),
    'filial+data+tipo+status',
  )

  return executarCarga(prisma, {
    fonte: 'perdas',
    periodo,
    linhas,
    origemIp: origem,
    ...(entrada.iniciadoEm === undefined ? {} : { iniciadoEm: entrada.iniciadoEm }),
    /**
     * O filtro por `indicadorId` NAO e' opcional.
     *
     * A ingestao substitui janela: apaga o periodo e regrava. Sem o filtro,
     * carregar um indicador filho apagaria o pai e os irmaos no periodo
     * inteiro — e o sintoma apareceria no painel dias depois, como numero que
     * some sem erro nenhum no log.
     */
    apagarJanela: async (tx, de, ate) =>
      (await tx.fatoPerdas.deleteMany({ where: { data: { gte: de, lte: ate }, indicadorId } }))
        .count,
    inserir: async (tx, syncId) =>
      (
        await tx.fatoPerdas.createMany({
          data: linhas.map((l) => ({
            filialId: filiais.get(l.filial)!,
            data: dataDe(l.data),
            tipoQuebra: l.tipoQuebra,
            status: l.status,
            valor: l.valor,
            indicadorId,
            syncId,
          })),
        })
      ).count,
    expurgar: async (tx) =>
      (await tx.fatoPerdas.deleteMany({ where: { data: { lt: limiteDaRetencao(agora()) } } })).count,
  })
}

export async function gravarMovimentacao(
  prisma: PrismaClient,
  entrada: { periodo: JanelaCarga; linhas: LinhaMovimentacao[]; origem: Origem } & Cronometro,
): Promise<ResultadoIngestao> {
  const { periodo, linhas, origem } = entrada

  validarSemFuturo(periodo, agora())
  validarDatasNaJanela(linhas, periodo)
  const filiais = await mapearFiliais(
    prisma,
    linhas.map((l) => l.filial),
  )
  exigirChaveUnica(
    linhas.map((l) => `${l.filial}|${l.data}`),
    'filial+data',
  )

  return executarCarga(prisma, {
    fonte: 'movimentacao',
    periodo,
    linhas,
    origemIp: origem,
    ...(entrada.iniciadoEm === undefined ? {} : { iniciadoEm: entrada.iniciadoEm }),
    apagarJanela: async (tx, de, ate) =>
      (await tx.fatoMovimentacao.deleteMany({ where: { data: { gte: de, lte: ate } } })).count,
    inserir: async (tx, syncId) =>
      (
        await tx.fatoMovimentacao.createMany({
          data: linhas.map((l) => ({
            filialId: filiais.get(l.filial)!,
            data: dataDe(l.data),
            valor: l.valor,
            syncId,
          })),
        })
      ).count,
    expurgar: async (tx) =>
      (await tx.fatoMovimentacao.deleteMany({ where: { data: { lt: limiteDaRetencao(agora()) } } }))
        .count,
  })
}

export interface LinhaVendasLinha {
  filial: string
  data: string
  /** A hierarquia de venda, os três níveis. Ver `vendasLinhaSchema`. */
  gerencia: string
  /** O CÓDIGO da área (`ERP_AREA_VENDA.CD_AREA`), que é a identidade dela. */
  cdArea: string
  /** Rótulo, reafirmado a cada carga. A identidade é o `cdArea`. */
  areaVenda: string
  valor: number
}

export interface LinhaVendedorDia {
  filial: string
  data: string
  codVendedor: string
  valor: number
}

/**
 * Detalhe de vendas por linha.
 *
 * Extraído da rota pelo mesmo motivo de `gravarPerdas`: passou a ter dois
 * chamadores. A validação da soma contra o agregado vem junto -- ela é parte da
 * gravação, não da rota, e deixá-la para trás faria o disparo pela tela de
 * administração gravar sem a conferência que a rota fazia.
 */
export async function gravarVendasLinha(
  prisma: PrismaClient,
  entrada: { periodo: JanelaCarga; linhas: LinhaVendasLinha[]; origem: Origem } & Cronometro,
): Promise<ResultadoIngestao> {
  const { periodo, linhas, origem } = entrada
  validarSemFuturo(periodo, agora())
  validarDatasNaJanela(linhas, periodo)
  const filiais = await mapearFiliais(prisma, linhas.map((l) => l.filial))
  exigirChaveUnica(
    linhas.map((l) => `${l.filial}|${l.data}|${l.cdArea}`),
    'filial+data+area',
  )

  const indicadorId = await idDoIndicador(prisma, 'vendas')
  const dim = await resolverHierarquia(prisma, filiais, linhas)
  await validarSomaContraAgregado(prisma, filiais, linhas, indicadorId)

  const resultado = await executarCarga(prisma, {
    fonte: 'vendas-linha',
    periodo,
    linhas,
    origemIp: origem,
    /**
     * Filtrar por `indicadorId` aqui e' obrigatorio: a ingestao substitui
     * JANELA, e sem o filtro carregar um indicador filho apagaria o pai no
     * periodo inteiro, sem erro nenhum.
     */
    apagarJanela: async (tx, de, ate) =>
      (
        await tx.fatoVendasLinha.deleteMany({
          where: { data: { gte: de, lte: ate }, indicadorId },
        })
      ).count,
    inserir: async (tx, syncId) =>
      (
        await tx.fatoVendasLinha.createMany({
          data: linhas.map((l) => ({
            filialId: filiais.get(l.filial)!,
            data: dataDe(l.data),
            // Área e gerência do DIA da venda. Ver o comentário no modelo.
            // A chave do mapa é o CÓDIGO da área, não o nome.
            areaVendaId: dim.areas.get(`${l.filial}|${l.cdArea}`)!,
            gerenciaId: dim.gerencias.get(`${l.filial}|${l.gerencia}`)!,
            valor: l.valor,
            indicadorId,
            syncId,
          })),
        })
      ).count,
    expurgar: async (tx) =>
      (await tx.fatoVendasLinha.deleteMany({ where: { data: { lt: limiteDoDetalhe(agora()) } } }))
        .count,
  })

  await atualizarResumoMensal(prisma, periodo, indicadorId)
  return resultado
}

/**
 * Refaz o resumo mensal dos meses que a carga tocou.
 *
 * DEPOIS da gravação e fora da transação dela, de propósito: o resumo é
 * derivado, e recalculá-lo dentro da transação faria uma falha aqui desfazer
 * uma carga que estava correta. Se este passo falhar, o detalhe está gravado e
 * o resumo se refaz na carga seguinte.
 *
 * Recalcula do DETALHE, e não soma o lote: o mês pode ter dias que não vieram
 * nesta janela, e somar o lote sobre o valor guardado contaria duas vezes o que
 * a substituição de janela acabou de reescrever.
 *
 * Exportada para o teste: a trava contra encolher só é exercitável com o
 * detalhe PARCIAL, que é o estado normal depois que a retenção voltou para 60
 * dias -- e testá-la pela carga inteira exigiria Oracle.
 */
export async function atualizarResumoMensal(
  prisma: PrismaClient,
  periodo: JanelaCarga,
  indicadorId: string,
): Promise<void> {
  const hoje = agora()
  const mesCorrente = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, '0')}`

  /*
   * A trava contra o resumo ENCOLHER.
   *
   * Carregar cinco dias de março recalcularia março a partir dos cinco dias que
   * sobraram no detalhe -- o resto já foi expurgado -- e o total do mês viraria
   * um quinto do que foi. O `dias` guardado é o que denuncia: se o recálculo vê
   * menos dias do que o resumo já registrava, é reposição parcial e não
   * correção, e o valor guardado vale mais.
   *
   * O mês CORRENTE é a exceção e não pode ser: ele cresce todo dia, e ali o
   * número de dias subindo é o esperado.
   */
  await prisma.$executeRaw`
    INSERT INTO venda_area_mes
      (filial_id, indicador_id, area_venda_id, gerencia_id, ano, mes, vendido, dias)
    SELECT l.filial_id, l.indicador_id, l.area_venda_id, l.gerencia_id,
           EXTRACT(YEAR FROM l.data)::INTEGER,
           EXTRACT(MONTH FROM l.data)::INTEGER,
           SUM(l.valor), COUNT(DISTINCT l.data)
      FROM fato_venda_linha l
     WHERE l.indicador_id = ${indicadorId}::uuid
       AND TO_CHAR(l.data, 'YYYY-MM') IN (
             SELECT DISTINCT TO_CHAR(d, 'YYYY-MM')
               FROM GENERATE_SERIES(${periodo.de}::date, ${periodo.ate}::date, '1 day') d)
     GROUP BY 1, 2, 3, 4, 5, 6
    ON CONFLICT (filial_id, area_venda_id, indicador_id, ano, mes) DO UPDATE
       SET vendido = EXCLUDED.vendido,
           dias    = EXCLUDED.dias,
           atualizado_em = NOW()
     WHERE EXCLUDED.dias >= venda_area_mes.dias
        OR TO_CHAR(MAKE_DATE(EXCLUDED.ano, EXCLUDED.mes, 1), 'YYYY-MM') = ${mesCorrente}
  `
}

/** Venda do vendedor por dia. Exige o cadastro de vendedores já carregado. */
export async function gravarVendedorDia(
  prisma: PrismaClient,
  entrada: { periodo: JanelaCarga; linhas: LinhaVendedorDia[]; origem: Origem } & Cronometro,
): Promise<ResultadoIngestao> {
  const { periodo, linhas, origem } = entrada
  validarSemFuturo(periodo, agora())
  validarDatasNaJanela(linhas, periodo)
  const filiais = await mapearFiliais(prisma, linhas.map((l) => l.filial))
  exigirChaveUnica(
    linhas.map((l) => `${l.filial}|${l.data}|${l.codVendedor}`),
    'filial+data+codVendedor',
  )

  const vendedores = await resolverVendedores(prisma, linhas)

  const resultado = await executarCarga(prisma, {
    fonte: 'vendedor-dia',
    periodo,
    linhas,
    origemIp: origem,
    /*
     * Sem filtro de indicador, diferente de `vendas-linha`: só uma fonte
     * escreve nesta tabela. Ver o comentário do modelo.
     */
    apagarJanela: async (tx, de, ate) =>
      (await tx.fatoVendaVendedor.deleteMany({ where: { data: { gte: de, lte: ate } } })).count,
    inserir: async (tx, syncId) =>
      (
        await tx.fatoVendaVendedor.createMany({
          data: linhas.map((l) => ({
            filialId: filiais.get(l.filial)!,
            data: dataDe(l.data),
            vendedorId: vendedores.get(`${l.filial}|${l.codVendedor}`)!,
            valor: l.valor,
            syncId,
          })),
        })
      ).count,
    expurgar: async (tx) =>
      (await tx.fatoVendaVendedor.deleteMany({ where: { data: { lt: limiteDoDetalhe(agora()) } } }))
        .count,
  })

  /*
   * O resumo mensal, refeito para as competências que a janela tocou.
   *
   * Depois da carga e fora da transação dela, como em `atualizarResumoMensal`:
   * o resumo é derivado, e uma falha aqui não pode desfazer uma carga correta.
   */
  await atualizarResumoVendedor(
    prisma,
    competenciasDaJanela(dataDe(periodo.de), dataDe(periodo.ate)),
  )
  return resultado
}

export type LinhaVendas = z.infer<typeof vendasSchema>['linhas'][number]
export type LinhaNps = z.infer<typeof npsSchema>['linhas'][number]

/**
 * Vendas — realizado, tendência e delta da meta.
 *
 * A origem é o Power BI, não o Oracle, e por isso este gravador não foi
 * extraído junto com os outros em §7.52: o portal ainda não sabia buscar dado
 * lá. Saiu agora que ele agenda Vendas e NPS por conta própria (§7.53).
 *
 * Devolve `avisos` além do resultado: a origem manda o delta da meta pronto, e
 * ele pode vir em fração, com sinal invertido ou calculado sobre o realizado --
 * três erros que não geram exceção nenhuma e produzem painel errado.
 */
export async function gravarVendas(
  prisma: PrismaClient,
  entrada: { periodo: JanelaCarga; linhas: LinhaVendas[]; origem: Origem } & Cronometro,
): Promise<ResultadoIngestao & { avisos: string[] }> {
  const { periodo, linhas, origem } = entrada
  validarSemFuturo(periodo, agora())
  validarDatasNaJanela(linhas, periodo)
  const filiais = await mapearFiliais(prisma, linhas.map((l) => l.filial))
  exigirChaveUnica(linhas.map((l) => `${l.filial}|${l.data}`), 'filial+data')

  // A origem manda o delta pronto, mas ele pode vir em fração, com sinal
  // invertido ou calculado sobre o realizado — três erros que não geram
  // exceção nenhuma e produzem painel errado. Ver coerencia.ts.
  const indicadorId = await idDoIndicador(prisma, 'vendas')
  const avisos = await conferirDeltaMeta(prisma, indicadorId, linhas, filiais)

  const resultado = await executarCarga(prisma, {
    fonte: 'vendas',
    periodo,
    linhas,
    origemIp: origem,
    /**
     * Filtrar por `indicadorId` aqui e' obrigatorio: a ingestao substitui
     * JANELA, e sem o filtro carregar um indicador filho apagaria o pai no
     * periodo inteiro, sem erro nenhum.
     */
    apagarJanela: async (tx, de, ate) =>
      (await tx.fatoVendas.deleteMany({ where: { data: { gte: de, lte: ate }, indicadorId } }))
        .count,
    inserir: async (tx, syncId) =>
      (
        await tx.fatoVendas.createMany({
          data: linhas.map((l) => ({
            filialId: filiais.get(l.filial)!,
            data: dataDe(l.data),
            valorReal: l.valorReal,
            tendencia: l.tendencia,
            indicadorId,
            deltaMeta: l.deltaMeta ?? null,
            syncId,
          })),
        })
      ).count,
    expurgar: async (tx) =>
      (await tx.fatoVendas.deleteMany({ where: { data: { lt: limiteDaRetencao(agora()) } } }))
        .count,
  })

  return { ...resultado, avisos }
}

/** NPS — a nota da filial no dia. */
export async function gravarNps(
  prisma: PrismaClient,
  entrada: { periodo: JanelaCarga; linhas: LinhaNps[]; origem: Origem } & Cronometro,
): Promise<ResultadoIngestao> {
  const { periodo, linhas, origem } = entrada
  validarSemFuturo(periodo, agora())
  validarDatasNaJanela(linhas, periodo)
  const filiais = await mapearFiliais(prisma, linhas.map((l) => l.filial))
  exigirChaveUnica(linhas.map((l) => `${l.filial}|${l.data}`), 'filial+data')

  const indicadorId = await idDoIndicador(prisma, 'nps')
  const resultado = await executarCarga(prisma, {
    fonte: 'nps',
    periodo,
    linhas,
    origemIp: origem,
    /**
     * Filtrar por `indicadorId` aqui e' obrigatorio: a ingestao substitui
     * JANELA, e sem o filtro carregar um indicador filho apagaria o pai no
     * periodo inteiro, sem erro nenhum.
     */
    apagarJanela: async (tx, de, ate) =>
      (await tx.fatoNps.deleteMany({ where: { data: { gte: de, lte: ate }, indicadorId } })).count,
    inserir: async (tx, syncId) =>
      (
        await tx.fatoNps.createMany({
          data: linhas.map((l) => ({
            filialId: filiais.get(l.filial)!,
            data: dataDe(l.data),
            qtdPromotores: l.qtdPromotores,
            qtdNeutros: l.qtdNeutros,
            qtdDetratores: l.qtdDetratores,
            indicadorId,
            syncId,
          })),
        })
      ).count,
    expurgar: async (tx) =>
      (await tx.fatoNps.deleteMany({ where: { data: { lt: limiteDaRetencao(agora()) } } })).count,
  })

  return resultado
}

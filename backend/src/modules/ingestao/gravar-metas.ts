import type { PrismaClient } from '@prisma/client'
import { DadosInvalidos } from '../../lib/erros.js'
import { resolverAreasPorCodigo } from './dimensoes.js'
import { mapearFiliais, TETO_DA_CARGA } from './service.js'

/**
 * Grava metas por competência.
 *
 * EXTRAÍDA DA ROTA EM 18/09/2026, pelo mesmo motivo de `gravarPerdas` e
 * `gravarVendasLinha`: passou a ter dois chamadores. Até aqui o único jeito de
 * carregar meta era um POST em `/ingest/metas`, e por isso **a carga agendada
 * do portal nunca carregou meta nenhuma** -- ela só sabia gravar fato.
 *
 * O buraco veio da migração: no desenho antigo o n8n carregava meta E fato no
 * mesmo fluxo. Quando Vendas e NPS passaram para o agendador interno, a metade
 * do fato veio junto e a da meta ficou para trás. Em desenvolvimento ninguém
 * notou, porque o seed cria as metas; em produção o quadro subiu com
 * "sem meta" em todas as células, afirmando ao mesmo tempo "9 filiais na meta".
 *
 * Meta NÃO TEM JANELA: é upsert por competência, e reenviar a mesma é operação
 * normal. Não há o que apagar fora das chaves enviadas.
 */
export interface LinhaMeta {
  indicador: string
  filial: string
  ano: number
  mes: number
  valor: number
  /** Presente só na meta por ÁREA DE VENDA. Ver `metasSchema`. */
  cdArea?: string | undefined
  areaVenda?: string | undefined
  gerencia?: string | undefined
}

export async function gravarMetas(
  prisma: PrismaClient,
  entrada: { linhas: LinhaMeta[]; origemIp: string },
): Promise<{ syncId: string; recebidas: number; gravadas: number }> {
  const { linhas, origemIp } = entrada

  const filiais = await mapearFiliais(prisma, linhas.map((l) => l.filial))
  const indicadores = await prisma.indicador.findMany()
  const porCodigo = new Map(indicadores.map((i) => [i.codigo, i.id]))

  const desconhecidos = [...new Set(linhas.map((l) => l.indicador))].filter(
    (c) => !porCodigo.has(c),
  )
  if (desconhecidos.length > 0) {
    throw new DadosInvalidos(`Indicador desconhecido: ${desconhecidos.join(', ')}`)
  }

  /*
   * Meta de ÁREA DE VENDA entra no escopo `AREA_VENDA`, com o alvo sendo a
   * própria área. A área vem por CÓDIGO -- quem manda é uma consulta do Oracle,
   * que não conhece os uuid do portal.
   *
   * A área é CRIADA se não existir, e não recusada (27/08/2026): 7 áreas têm
   * orçamento e não venderam nem têm vendedor na janela, e por causa delas as
   * 9.603 metas não entravam. Sem `areaVenda`/`gerencia` a criação não é
   * possível, e aí a recusa volta.
   */
  const comArea = linhas.filter((l) => l.cdArea !== undefined)
  let areas = new Map<string, string>()

  if (comArea.length > 0) {
    const semCadastro = comArea.filter((l) => !l.areaVenda || !l.gerencia)
    if (semCadastro.length > 0) {
      throw new DadosInvalidos(
        'Meta de área exige `areaVenda` e `gerencia` junto com `cdArea` — ' +
          'são eles que permitem criar a área quando ela ainda não existe. ' +
          `Faltam em ${String(semCadastro.length)} linha(s).`,
      )
    }
    areas = await resolverAreasPorCodigo(
      prisma,
      filiais,
      comArea.map((l) => ({
        filial: l.filial,
        cdArea: l.cdArea!,
        areaVenda: l.areaVenda!,
        gerencia: l.gerencia!,
      })),
    )
  }

  const chaves = linhas.map((l) =>
    l.cdArea === undefined
      ? {
          escopo: 'INDICADOR' as const,
          alvoId: porCodigo.get(l.indicador)!,
          filialId: filiais.get(l.filial)!,
          ano: l.ano,
          mes: l.mes,
          valor: l.valor,
        }
      : {
          escopo: 'AREA_VENDA' as const,
          alvoId: areas.get(`${l.filial}|${l.cdArea}`)!,
          filialId: filiais.get(l.filial)!,
          ano: l.ano,
          mes: l.mes,
          valor: l.valor,
        },
  )

  let gravadas = 0
  await prisma.$transaction(async (tx) => {
    /*
     * Apaga por COMPETÊNCIA, com os alvos daquela competência agrupados -- e
     * não uma condição por meta.
     *
     * Era `OR` das 9.603 chaves enviadas, uma a uma. A primeira carga real de
     * meta por área derrubou isso: o Postgres não devolvia a tempo e o cliente
     * desistia antes.
     *
     * O agrupamento preserva a garantia que o `OR` original dava, e que é o
     * motivo de não filtrar por intervalo: **um lote pode trazer competências
     * salteadas**, e apagar por intervalo removeria meta que nem estava nele.
     */
    const grupos = new Map<
      string,
      {
        escopo: 'INDICADOR' | 'AREA_VENDA'
        filialId: string
        ano: number
        mes: number
        alvoId: { in: string[] }
      }
    >()
    for (const { valor: _valor, alvoId, ...c } of chaves) {
      const k = `${c.escopo}|${c.filialId}|${String(c.ano)}|${String(c.mes)}`
      const g = grupos.get(k) ?? { ...c, alvoId: { in: [] } }
      g.alvoId.in.push(alvoId)
      grupos.set(k, g)
    }

    await tx.meta.deleteMany({ where: { OR: [...grupos.values()] } })
    gravadas = (await tx.meta.createMany({ data: chaves })).count
  }, TETO_DA_CARGA)

  const sync = await prisma.syncExecucao.create({
    data: {
      fonte: 'metas',
      status: 'SUCESSO',
      periodoDe: new Date(Date.UTC(Math.min(...linhas.map((l) => l.ano)), 0, 1)),
      periodoAte: new Date(Date.UTC(Math.max(...linhas.map((l) => l.ano)), 11, 31)),
      linhasRecebidas: linhas.length,
      linhasGravadas: gravadas,
      finalizadoEm: new Date(),
      origemIp,
    },
  })

  return { syncId: sync.id, recebidas: linhas.length, gravadas }
}

import type { PrismaClient } from '@prisma/client'
import { agora } from '../../lib/datas.js'
import { bateuCotaAcumulada } from '../variaveis/cota-acumulada.js'
import {
  bateuMeta,
  contaNoDenominador,
  type VendedorNoMes,
} from '../variaveis/performance-vendedor.js'

/**
 * O RESUMO MENSAL de Performance Vendedor — o histórico do indicador.
 *
 * Performance Vendas guarda o histórico porque a venda por área é somável;
 * este indicador não é. `naMeta / aptos` de dois meses não se soma, e a conta
 * de um mês fechado depende de um realizado que deixa de existir: o detalhe de
 * `fato_venda_vendedor` retém 60 dias. Recalcular março em setembro daria
 * realizado zero para todo mundo e o indicador **desabaria para 0%** — sem
 * erro, com número plausível na tela.
 *
 * Por isso o que se guarda é a CONTA JÁ FEITA: `aptos` e `naMeta`, calculados
 * enquanto o detalhe do mês ainda estava lá.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A REGRA NÃO É REESCRITA AQUI EM SQL.                                     │
 * │                                                                          │
 * │ Quem entra no denominador é `contaNoDenominador`, e quem bateu é         │
 * │ `bateuCotaAcumulada` — as MESMAS funções da tela semanal, importadas.    │
 * │ Escrever `houve_venda <> 'SEM_VENDA' AND sitafa <> 7 AND meta > 0` num    │
 * │ INSERT ... SELECT seria uma segunda cópia da regra, e o gráfico e o      │
 * │ quadro divergiriam no primeiro ajuste feito num lado só.                  │
 * │                                                                          │
 * │ O custo é trazer os vendedores para a memória. São ~1.500 por            │
 * │ competência nas nove lojas; o preço é irrelevante e a garantia não é.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** Uma competência a refazer. */
export interface Competencia {
  ano: number
  mes: number
}

/** As competências que uma janela de datas toca, sem repetir. */
export function competenciasDaJanela(de: Date, ate: Date): Competencia[] {
  const fora: Competencia[] = []
  const d = new Date(Date.UTC(de.getUTCFullYear(), de.getUTCMonth(), 1))
  const fim = new Date(Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), 1))
  while (d <= fim) {
    fora.push({ ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 })
    d.setUTCMonth(d.getUTCMonth() + 1)
  }
  return fora
}

/**
 * Refaz o resumo das competências informadas.
 *
 * FORA da transação da carga, como o resumo de vendas: é derivado, e uma falha
 * aqui não pode desfazer uma carga que estava correta. Se falhar, o detalhe
 * está gravado e o resumo se refaz na carga seguinte.
 */
export async function atualizarResumoVendedor(
  prisma: PrismaClient,
  competencias: Competencia[],
): Promise<void> {
  if (competencias.length === 0) return

  const hoje = agora()
  const mesCorrente = { ano: hoje.getUTCFullYear(), mes: hoje.getUTCMonth() + 1 }

  for (const c of competencias) {
    /*
     * A situação do vendedor no mês. É ela que traz cota, SITAFA e a
     * classificação — sem ela não há denominador, e a competência é pulada em
     * vez de gravar zero. Zero seria lido como "ninguém bateu".
     */
    const situacoes = await prisma.vendedorMes.findMany({
      where: { ano: c.ano, mes: c.mes },
      select: {
        filialId: true,
        vendedorId: true,
        meta: true,
        sitafa: true,
        houveVenda: true,
        vendedor: {
          select: {
            codVendedor: true,
            areaVenda: { select: { id: true, gerenciaId: true } },
          },
        },
      },
    })
    if (situacoes.length === 0) continue

    /*
     * O realizado do mês, do detalhe. Vendedor sem linha aqui tem realizado
     * zero, e isso é um resultado -- ele estava apto e não vendeu.
     */
    const realizado = await prisma.$queryRaw<Array<{ vendedor_id: string; total: number }>>`
      SELECT vendedor_id, SUM(valor)::FLOAT AS total
        FROM fato_venda_vendedor
       WHERE EXTRACT(YEAR  FROM data) = ${c.ano}
         AND EXTRACT(MONTH FROM data) = ${c.mes}
       GROUP BY 1
    `
    /*
     * Sem `Number(...)`: o `::FLOAT` no SELECT acima e' que faz a conversao, e
     * o driver entrega number. O `Number()` aqui sugeria que o valor chega
     * como texto -- o que seria verdade sem o cast no SQL, e e' justamente por
     * isso que ele esta la'.
     */
    const totalDe = new Map(realizado.map((r) => [r.vendedor_id, r.total]))

    /*
     * Dias com venda no mês — a mesma trava de `venda_area_mes`.
     *
     * Depois que a retenção volta a expurgar, refazer um mês velho o veria com
     * poucos dias (ou nenhum) e a conta desabaria. O `dias` guardado denuncia:
     * recálculo que vê menos dias do que o resumo já registrava é reposição
     * parcial, não correção, e o valor guardado vale mais.
     */
    const [contagem] = await prisma.$queryRaw<Array<{ dias: number }>>`
      SELECT COUNT(DISTINCT data)::INTEGER AS dias
        FROM fato_venda_vendedor
       WHERE EXTRACT(YEAR  FROM data) = ${c.ano}
         AND EXTRACT(MONTH FROM data) = ${c.mes}
    `
    const dias = contagem?.dias ?? 0

    /*
     * NENHUM dia de detalhe: a competência é pulada, e não gravada como 0%.
     *
     * Acontece de verdade, e apareceu no backfill: a carga de
     * `vendedor-situacao` dispara a consolidação, e ela roda ANTES de o
     * realizado daquele mês existir. Sem esta guarda, cada competência nascia
     * com `naMeta = 0` e `aptos` cheio -- um mês inteiro a 0% na tela, que se lê
     * como "ninguém bateu a meta" e significa "o realizado ainda não chegou".
     *
     * O `ON CONFLICT` não protegia disso: a trava contra encolher compara com o
     * que já está gravado, e aqui não havia nada gravado ainda.
     */
    if (dias === 0) continue

    /*
     * O CALENDÁRIO DE CADA FILIAL, no ÚLTIMO DIA COM DETALHE do mês.
     *
     * É a invariante de `corteDe` aplicada aqui: realizado e calendário têm de
     * apontar para o mesmo dia. Amarrar ao último dia carregado, e não a hoje,
     * faz a consolidação ser função só do que está na tabela -- rodá-la duas
     * vezes dá o mesmo número, e o backfill de um mês velho não é medido pelo
     * calendário de hoje.
     *
     * Sem linha (2025 não tem `dia_util` carregado) a cota cheia vale, e para
     * mês FECHADO as duas dão o mesmo: no fim do mês `acumulado = doMes`, e a
     * cota rateada é a cota inteira.
     */
    const calendarios = await prisma.$queryRaw<
      Array<{ filial_id: string; acumulado: number; do_mes: number }>
    >`
      SELECT DISTINCT ON (d.filial_id)
             d.filial_id, d.acumulado_dia AS acumulado, d.uteis_do_mes AS do_mes
        FROM dia_util d
        JOIN (SELECT filial_id, MAX(data) AS ate
                FROM fato_venda_vendedor
               WHERE EXTRACT(YEAR  FROM data) = ${c.ano}
                 AND EXTRACT(MONTH FROM data) = ${c.mes}
               GROUP BY 1) m ON m.filial_id = d.filial_id
       WHERE d.data <= m.ate
         AND EXTRACT(YEAR  FROM d.data) = ${c.ano}
         AND EXTRACT(MONTH FROM d.data) = ${c.mes}
       ORDER BY d.filial_id, d.data DESC
    `
    const calendarioDe = new Map(
      calendarios.map((k) => [k.filial_id, { acumulado: k.acumulado, doMes: k.do_mes }]),
    )

    /** Agrupa por área, já com a conta pronta. */
    const porArea = new Map<string, { gerenciaId: string; filialId: string; vs: VendedorNoMes[] }>()
    for (const s of situacoes) {
      const area = s.vendedor.areaVenda
      const atual = porArea.get(area.id) ?? {
        gerenciaId: area.gerenciaId,
        filialId: s.filialId,
        vs: [],
      }
      atual.vs.push({
        codVendedor: s.vendedor.codVendedor,
        matricula: null,
        nome: '',
        areaVenda: area.id,
        ano: c.ano,
        mes: c.mes,
        meta: Number(s.meta),
        sitafa: s.sitafa,
        houveVenda: s.houveVenda,
        realizado: totalDe.get(s.vendedorId) ?? 0,
      })
      porArea.set(area.id, atual)
    }

    const ehCorrente = c.ano === mesCorrente.ano && c.mes === mesCorrente.mes

    for (const [areaVendaId, { gerenciaId, filialId, vs }] of porArea) {
      const aptos = vs.filter(contaNoDenominador)
      // Área sem ninguém apto não vira linha de zero: `null` na tela é ausência.
      if (aptos.length === 0) continue

      /*
       * "BATEU" É CONTRA A COTA RATEADA, sempre -- e não só no mês corrente.
       *
       * Uma regra só, sem ramo por mês: em mês fechado `acumulado = doMes` e a
       * cota rateada É a cota inteira, então o número não muda. No mês em
       * curso ela é a única comparação que faz sentido -- no dia 2, medir
       * contra a cota do mês inteiro dava **0%**, enquanto o cartão do topo da
       * mesma tela dizia 55%.
       *
       * `bateuCotaAcumulada` devolve `null` quando nenhum dia útil decorreu (o
       * 1º do mês): ali não há o que comparar, e a competência inteira é
       * pulada em vez de virar uma linha de zero.
       */
      const calendario = calendarioDe.get(filialId)
      let naMeta = 0
      if (calendario === undefined) {
        naMeta = aptos.filter(bateuMeta).length
      } else {
        const bateu = aptos.map((v) => bateuCotaAcumulada(v.realizado, v.meta, calendario))
        if (bateu.some((b) => b === null)) continue
        naMeta = bateu.filter(Boolean).length
      }

      await prisma.$executeRaw`
        INSERT INTO vendedor_area_mes
          (filial_id, area_venda_id, gerencia_id, ano, mes, aptos, na_meta, dias)
        VALUES (${filialId}::uuid, ${areaVendaId}::uuid, ${gerenciaId}::uuid,
                ${c.ano}, ${c.mes}, ${aptos.length}, ${naMeta}, ${dias})
        ON CONFLICT (filial_id, area_venda_id, ano, mes) DO UPDATE
           SET aptos = EXCLUDED.aptos,
               na_meta = EXCLUDED.na_meta,
               dias = EXCLUDED.dias,
               atualizado_em = NOW()
         WHERE EXCLUDED.dias >= vendedor_area_mes.dias
            OR ${ehCorrente}
      `
    }
  }
}

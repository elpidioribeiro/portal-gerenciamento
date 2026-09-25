import type { PrismaClient } from '@prisma/client'
import { desvioPercentual } from '../../lib/percentual.js'
import { DadosInvalidos } from '../../lib/erros.js'

/**
 * Confere se o `deltaMeta` recebido é coerente com `tendencia` e a meta.
 *
 * Existe porque a origem (uma medida `%GAP` no Power BI) pode errar de três
 * formas que **não geram erro nenhum** — a carga entra, o painel fica errado e
 * ninguém percebe:
 *
 * 1. **Escala.** Power BI guarda percentual como fração (`-0.1304`) e apenas
 *    exibe como `-13,04%`. Sem multiplicar por 100, todo desvio chega 100×
 *    menor e a matriz mostra `0%` em tudo.
 * 2. **Sinal.** "GAP" costuma ser `meta − realizado` (o quanto falta), enquanto
 *    o portal espera `realizado − meta`. Invertido, filial acima da meta
 *    aparece vermelha e filial em risco aparece verde — coerente consigo mesmo
 *    e completamente errado.
 * 3. **Base.** Se a medida compara o realizado acumulado (e não a tendência)
 *    com a meta, volta o problema que a tendência resolveu: no dia 18 de 31,
 *    filial adiantada pintada de vermelho.
 *
 * Os três somem quando se compara o delta recebido com o que a própria
 * tendência produziria.
 */

/** Divergência a partir da qual a carga é recusada, em pontos percentuais. */
const LIMIAR_SISTEMATICO = 5
/** Fração de linhas divergentes que caracteriza erro sistemático, não ruído. */
const FRACAO_SISTEMATICA = 0.5

export interface AvisoCoerencia {
  mensagem: string
}

export async function conferirDeltaMeta(
  prisma: PrismaClient,
  indicadorVendasId: string,
  todasAsLinhas: Array<{
    filial: string
    data: string
    tendencia: number
    deltaMeta?: number | undefined
  }>,
  filiais: Map<string, string>,
): Promise<string[]> {
  // Só há o que conferir onde a origem mandou o delta. Sem ele o portal
  // calcula o desvio da própria meta, e não existe divergência possível.
  const linhas = todasAsLinhas.filter(
    (l): l is typeof l & { deltaMeta: number } => l.deltaMeta !== undefined,
  )
  if (linhas.length === 0) return []

  // Índice das metas por (filial, ano, mês) para não consultar linha a linha.
  const competencias = new Set(linhas.map((l) => `${l.filial}|${l.data.slice(0, 7)}`))
  const metas = new Map<string, number>()

  for (const c of competencias) {
    const [sigla, anoMes] = c.split('|') as [string, string]
    const [ano, mes] = anoMes.split('-').map(Number) as [number, number]
    const meta = await prisma.meta.findUnique({
      where: {
        escopo_alvoId_filialId_ano_mes: {
          escopo: 'INDICADOR',
          alvoId: indicadorVendasId,
          filialId: filiais.get(sigla)!,
          ano,
          mes,
        },
      },
    })
    if (meta) metas.set(c, Number(meta.valor))
  }

  const conferiveis = linhas.filter((l) => metas.has(`${l.filial}|${l.data.slice(0, 7)}`))

  if (conferiveis.length === 0) {
    // Sem meta carregada não há como conferir. Não é erro: o fluxo de metas
    // pode simplesmente ainda não ter rodado.
    return [
      'Não foi possível conferir `deltaMeta`: nenhuma meta de Vendas cadastrada para as ' +
        'competências enviadas. Rode o fluxo de metas para habilitar a checagem.',
    ]
  }

  const divergentes = conferiveis
    .map((l) => {
      const meta = metas.get(`${l.filial}|${l.data.slice(0, 7)}`)!
      const esperado = desvioPercentual(l.tendencia, meta)
      return { ...l, meta, esperado, diferenca: Math.abs(l.deltaMeta - esperado) }
    })
    .filter((d) => d.diferenca > LIMIAR_SISTEMATICO)

  if (divergentes.length === 0) return []

  const proporcao = divergentes.length / conferiveis.length
  const amostra = divergentes[0]!

  const diagnostico = diagnosticar(amostra.deltaMeta, amostra.esperado)
  const detalhe =
    `${amostra.filial} ${amostra.data}: recebido ${amostra.deltaMeta.toFixed(4)}, ` +
    `esperado ${amostra.esperado.toFixed(2)} (tendência ${amostra.tendencia} sobre meta ${amostra.meta})`

  if (proporcao >= FRACAO_SISTEMATICA) {
    // Metade ou mais das linhas divergindo não é ruído de arredondamento —
    // é a medida da origem calculando outra coisa. Recusar é melhor que
    // gravar um painel inteiro errado.
    throw new DadosInvalidos(
      `\`deltaMeta\` incoerente com \`tendencia\` em ${divergentes.length} de ${conferiveis.length} linhas. ` +
        `${diagnostico} Exemplo — ${detalhe}`,
    )
  }

  return [
    `${divergentes.length} de ${conferiveis.length} linhas com \`deltaMeta\` divergente do esperado. ` +
      `Exemplo — ${detalhe}`,
  ]
}

/** Aponta a causa provável a partir da relação entre recebido e esperado. */
function diagnosticar(recebido: number, esperado: number): string {
  if (esperado === 0) return ''

  const razao = recebido / esperado

  if (Math.abs(razao - 0.01) < 0.005) {
    return 'O valor parece estar em FRAÇÃO decimal — multiplique por 100 no n8n (o Power BI guarda 0,13 e exibe 13%).'
  }
  if (Math.abs(razao + 1) < 0.1) {
    return 'O SINAL parece invertido — a medida deve calcular `realizado − meta`, não `meta − realizado`.'
  }
  if (Math.abs(razao + 0.01) < 0.005) {
    return 'O valor parece estar em fração E com o sinal invertido.'
  }
  return 'Verifique se a medida compara a TENDÊNCIA com a meta (e não o realizado acumulado).'
}

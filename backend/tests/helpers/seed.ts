import { PrismaClient } from '@prisma/client'
import { MATRIZ } from '../../prisma/seed/dados-handoff.js'

/**
 * Confere que o banco de teste está semeado, e FALHA se não estiver.
 *
 * Antes isto devolvia um booleano e treze testes se marcavam como pulados
 * quando o banco tinha dado real do Power BI — o desenvolvedor não podia rodar
 * a suíte sem apagar o próprio dado, então pular era o menor dos males.
 *
 * Com o banco de teste separado (ver tests/setup/banco.ts), essa situação
 * deixou de existir: o `portalgd_test` é recriado e semeado a cada execução, e
 * nenhum dado real mora nele. Manter o pulo seria pior que inútil — se um dia o
 * seed parasse de reproduzir a matriz do handoff, treze testes sumiriam do
 * relatório em silêncio, com o verde intacto, e o defeito passaria. Ausência de
 * seed agora é defeito de preparação, e defeito precisa quebrar.
 */
export async function exigirSeed(): Promise<void> {
  const prisma = new PrismaClient()
  try {
    const gus = await prisma.filial.findUnique({ where: { sigla: 'CEN' } })
    if (!gus) throw new Error('a filial CEN não existe')

    const hoje = new Date()
    const de = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), 1))
    const ate = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() + 1, 0))

    // A checagem olha direto para o VALOR que os testes esperam, não para o
    // histórico de sync. Uma versão anterior usava `origem_ip = 'seed'` da
    // última execução — e falhava, porque os próprios testes de ingestão
    // gravam sync e viravam a "última".
    const ultima = await prisma.fatoVendas.findFirst({
      where: { filialId: gus.id, data: { gte: de, lte: ate } },
      orderBy: { data: 'desc' },
      select: { tendencia: true },
    })
    if (!ultima) throw new Error('não há venda de CEN no mês corrente')

    const esperado = MATRIZ.vendas[0][0]
    const veio = Number(ultima.tendencia)
    if (veio !== esperado) {
      throw new Error(
        `a tendência de CEN no mês corrente é ${veio}, e o handoff pede ${esperado}`,
      )
    }
  } catch (e) {
    throw new Error(
      'O banco de teste não está semeado como o handoff manda: ' +
        `${e instanceof Error ? e.message : String(e)}.\n` +
        'O seed roda automaticamente em tests/setup/global.ts — se falhou ali, ' +
        'rode `npm run test:limpar` e tente de novo.',
    )
  } finally {
    await prisma.$disconnect()
  }
}

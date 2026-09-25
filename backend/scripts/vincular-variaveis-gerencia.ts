/**
 * Aplica o cadastro do GD — variáveis de controle, pontos de causa e o vínculo
 * com as gerências — sem apagar nada.
 *
 *     npm run vincular-variaveis
 *
 * POR QUE EXISTE, em vez de o seed fazer: o seed limpa as tabelas fato antes de
 * popular, e se recusa a rodar em banco com dado real -- corretamente, porque o
 * dado do Power BI não volta sozinho. Mas o cadastro do GD precisa chegar lá.
 * Este script só ACRESCENTA, e é idempotente.
 *
 * O que ele NÃO faz: apagar as variáveis de demonstração que já existam. Elas
 * podem ter ocorrências marcadas, e apagá-las levaria o Pareto junto. Ficam no
 * banco, apenas DESVINCULADAS das gerências -- e o quadro só desenha o que está
 * vinculado, então elas somem da tela sem sumir do histórico.
 */
import { PrismaClient } from '@prisma/client'
import { VARIAVEIS_GD } from '../prisma/seed/variaveis-gd.js'

const prisma = new PrismaClient()

/**
 * As variáveis de VENDAS vão para as gerências de venda. Depósito fica de fora:
 * ele não vende, e a gerência dele aparece sob a categoria Operacional, que
 * ainda não tem variável.
 */
const GERENCIAS_DE_VENDA = ['CONSTRUÇÃO', 'NÃO CONSTRUÇÃO']

async function main() {
  // ── 1. As variáveis e seus pontos de causa ────────────────────────────────
  const idsDoGd: string[] = []

  for (const def of VARIAVEIS_GD) {
    const indicador = await prisma.indicador.findUnique({ where: { codigo: def.indicador } })
    if (!indicador) throw new Error(`Indicador "${def.indicador}" não existe.`)

    const v = await prisma.variavelControle.upsert({
      where: { indicadorId_nome: { indicadorId: indicador.id, nome: def.nome } },
      update: { unidade: def.unidade, sentido: def.sentido, ativo: true },
      create: {
        indicadorId: indicador.id,
        nome: def.nome,
        unidade: def.unidade,
        sentido: def.sentido,
        ordem: idsDoGd.length + 1,
      },
    })
    idsDoGd.push(v.id)

    for (const [i, nome] of def.pontosCausa.entries()) {
      await prisma.pontoCausa.upsert({
        where: { variavelControleId_nome: { variavelControleId: v.id, nome } },
        update: { ordem: i + 1, ativo: true },
        create: { variavelControleId: v.id, nome, ordem: i + 1 },
      })
    }
    console.log(`   ${def.nome}  ·  ${def.pontosCausa.length} pontos de causa`)
  }

  // ── 2. O vínculo com as gerências de venda ────────────────────────────────
  const gerencias = await prisma.dimGerencia.findMany({
    where: { nome: { in: GERENCIAS_DE_VENDA } },
    select: { id: true, filial: { select: { sigla: true } } },
  })

  /*
   * Desvincula o que NÃO é do GD, e só o vínculo.
   *
   * Sem isto, as variáveis de demonstração que já estavam no banco continuariam
   * no quadro ao lado das de verdade -- e o supervisor marcaria ponto de causa
   * numa variável que ninguém acompanha.
   */
  const removidos = await prisma.gerenciaVariavel.deleteMany({
    where: { gerenciaId: { in: gerencias.map((g) => g.id) }, variavelControleId: { notIn: idsDoGd } },
  })

  const r = await prisma.gerenciaVariavel.createMany({
    data: gerencias.flatMap((g) => idsDoGd.map((id) => ({ gerenciaId: g.id, variavelControleId: id }))),
    skipDuplicates: true,
  })

  console.log(
    `\n${gerencias.length} gerências de venda em ${new Set(gerencias.map((g) => g.filial.sigla)).size} filiais.`,
  )
  console.log(`${r.count} vínculos novos · ${removidos.count} vínculos de variável de fora removidos.\n`)
}

main()
  .catch((e: unknown) => {
    console.error('\nFalhou:', e instanceof Error ? e.message : e, '\n')
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

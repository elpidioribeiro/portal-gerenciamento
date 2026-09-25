import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { consultar, encerrarOracle } from '../src/lib/oracle.js'

/**
 * Compara o SQL de Perdas do Oracle com o que está no portal (vindo do Power BI).
 *
 * Existe porque esta conferência foi feita cinco vezes à mão durante a
 * investigação, e vai ser feita de novo: a cada mudança no SQL, a cada mês novo,
 * e antes de trocar a origem de Perdas do Power Automate para o Oracle direto.
 *
 * **A janela é do PORTAL, não do mês.** Comparar o mês inteiro contra um portal
 * que carregou até D-1 dá diferença que parece erro de regra e é só calendário —
 * foi o primeiro resultado desta investigação, e custou uma rodada de 58 s para
 * descobrir. Aqui a janela sai do próprio `fato_perdas`.
 *
 * Uso:
 *   npm run comparar:perdas            # mês corrente
 *   npm run comparar:perdas 2026-07    # mês escolhido
 */

// O SQL mora com `fontes.mjs`, que e' a fonte unica das consultas — este
// script le' o MESMO arquivo que a carga executa, senao a conferencia validaria
// uma consulta e a carga rodaria outra.
const ARQUIVO_SQL = path.resolve(import.meta.dirname, '..', 'src', 'fontes', 'sql', 'perdas.sql')

/**
 * `FILIAL` e `VALOR` como `number | string`.
 *
 * O genérico de `consultar` é uma AFIRMAÇÃO nossa sobre o que o driver devolve,
 * não uma garantia dele — e o `node-oracledb` tem configuração para trazer
 * NUMBER como texto. Declarar `number` puro tornaria o `Number()` redundante aos
 * olhos do compilador, e removê-lo trocaria soma por concatenação no dia em que
 * a origem passasse do inteiro seguro do JS. Numa comparação de valores, isso
 * seria um total errado sem erro nenhum.
 */
interface Linha {
  FILIAL: number | string
  DATA: Date
  TIPO_QUEBRA: string
  VALOR: number | string
}

const prisma = new PrismaClient()

function mesPedido(): { ano: number; mes: number } {
  const arg = process.argv[2]
  if (!arg) {
    const hoje = new Date()
    return { ano: hoje.getUTCFullYear(), mes: hoje.getUTCMonth() + 1 }
  }
  const m = /^(\d{4})-(\d{2})$/.exec(arg)
  if (!m) throw new Error(`Mês inválido: "${arg}". Use o formato 2026-08.`)
  return { ano: Number(m[1]), mes: Number(m[2]) }
}

const fmt = (n: number) => n.toFixed(2).padStart(15)
const iso = (d: Date) => d.toISOString().slice(0, 10)

async function main() {
  const { ano, mes } = mesPedido()
  const de = new Date(Date.UTC(ano, mes - 1, 1))
  const ate = new Date(Date.UTC(ano, mes, 0))

  const noPortal = await prisma.fatoPerdas.aggregate({
    where: { data: { gte: de, lte: ate } },
    _max: { data: true },
    _sum: { valor: true },
    _count: true,
  })

  if (noPortal._count === 0) {
    throw new Error(
      `O portal não tem Perdas em ${ano}-${String(mes).padStart(2, '0')}. ` +
        'Sem o lado do Power BI não há o que comparar.',
    )
  }

  /**
   * O corte é o último dia que o portal tem.
   *
   * O SQL busca o mês todo — o Oracle já tem hoje, o portal só até D-1 — e o
   * recorte acontece aqui, em memória. Buscar exatamente a janela do portal
   * economizaria nada (o custo é o plano de execução, não o volume) e esconderia
   * quanto dado existe além dela, que é informação útil.
   */
  const corte = iso(noPortal._max.data!)
  const portal = Number(noPortal._sum.valor ?? 0)

  console.log(`  Mês ${ano}-${String(mes).padStart(2, '0')} · portal carregado até ${corte}\n`)

  const sql = readFileSync(ARQUIVO_SQL, 'utf8').replace(/;\s*$/, '')
  const t0 = Date.now()
  // `perfil: 'carga'` — esta consulta leva minutos e já estourou o teto de 60 s
  // do caminho da API. Ver OpcoesConsulta em lib/oracle.ts.
  // Janela como TEXTO: o SQL usa TO_DATE(:de, 'YYYY-MM-DD'). Ver perdas.sql.
  const { linhas, truncado } = await consultar<Linha>(
    sql,
    { de: iso(de), ate: iso(ate) },
    { perfil: 'carga' },
  )
  console.log(`  Oracle: ${linhas.length} grupos em ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  if (truncado) {
    throw new Error(
      'A consulta voltou truncada no teto de linhas. Comparar um total parcial ' +
        'contra o total do portal acusaria diferença que não existe. Aumente ORACLE_MAX_ROWS.',
    )
  }

  const dia = (l: Linha) => iso(new Date(l.DATA))
  const dentro = linhas.filter((l) => dia(l) <= corte)
  const soma = (ls: Linha[], f: (l: Linha) => boolean = () => true) =>
    ls.filter(f).reduce((a, l) => a + Number(l.VALOR), 0)

  const total = soma(dentro)
  const dif = total - portal
  const pct = portal === 0 ? 0 : (dif / Math.abs(portal)) * 100

  console.log(`\n  ${'até ' + corte} · SQL ${fmt(total)} · portal ${fmt(portal)}`)
  console.log(`  ${' '.repeat(14)}  diferença ${fmt(dif)}  ${pct.toFixed(2)}%\n`)

  const filiais = await prisma.filial.findMany({
    where: { codigo: { not: null } },
    orderBy: { codigo: 'asc' },
  })

  let fecham = 0
  console.log('  filial            SQL          portal       diferença')
  for (const f of filiais) {
    const o = soma(dentro, (l) => Number(l.FILIAL) === f.codigo)
    const p = Number(
      (
        await prisma.fatoPerdas.aggregate({
          where: { filialId: f.id, data: { gte: de, lte: ate } },
          _sum: { valor: true },
        })
      )._sum.valor ?? 0,
    )
    const d = o - p
    const ok = Math.abs(d) < 0.01
    if (ok) fecham++
    console.log(`  ${f.sigla.padEnd(6)} ${fmt(o)} ${fmt(p)} ${fmt(d)} ${ok ? 'ok' : ''}`)
  }

  for (const tq of ['QI', 'QNI'] as const) {
    const o = soma(dentro, (l) => l.TIPO_QUEBRA === tq)
    const p = Number(
      (
        await prisma.fatoPerdas.aggregate({
          where: { data: { gte: de, lte: ate }, tipoQuebra: tq },
          _sum: { valor: true },
        })
      )._sum.valor ?? 0,
    )
    const d = o - p
    console.log(`  ${tq.padEnd(6)} ${fmt(o)} ${fmt(p)} ${fmt(d)} ${Math.abs(d) < 0.01 ? 'ok' : ''}`)
  }

  console.log(`\n  ${fecham} de ${filiais.length} filiais fecham ao centavo.`)

  /**
   * Dias que o Oracle tem além do portal.
   *
   * Não é divergência — é o que a próxima carga vai trazer. Aparece porque foi
   * justamente isso que confundiu a primeira comparação desta investigação.
   */
  const fora = [...new Set(linhas.filter((l) => dia(l) > corte).map(dia))].sort()
  if (fora.length > 0) {
    console.log(`\n  Além de ${corte}, o Oracle já tem ${fora.length} dia(s):`)
    for (const d of fora) console.log(`    ${d} ${fmt(soma(linhas, (l) => dia(l) === d))}`)
    console.log('  Isto não é divergência: é o que a próxima carga traz.')
  }

  if (Math.abs(dif) >= 0.01) {
    console.log('\n  Para localizar diferença, acrescente `tipo_de_mov` e `situac` ao')
    console.log('  SELECT e ao GROUP BY do arquivo SQL — ver o comentário lá.')
  }
}

main()
  .catch((e: unknown) => {
    console.error(`\n${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await encerrarOracle()
    await prisma.$disconnect()
  })

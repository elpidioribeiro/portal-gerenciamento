import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * A view `vw_tipo_perda` desdobra Perdas por tipo de quebra: FILIAL, DATA, TIPO,
 * VALOR.
 *
 * É view e não tabela porque `fato_perdas` já guarda exatamente esses campos —
 * uma cópia alimentada a partir dela seria dois lugares com os mesmos números, e
 * toda recarga de Perdas exigiria repopular a cópia. Este projeto já pagou três
 * vezes por fonte duplicada.
 *
 * O que estes testes protegem é a EQUIVALÊNCIA. Uma view não pode divergir da
 * tabela por definição, mas o *filtro* dela pode ficar errado — e aí ela mostra
 * um subconjunto silenciosamente, que é pior que erro.
 */

const prisma = new PrismaClient()
afterAll(() => prisma.$disconnect())

describe('vw_tipo_perda espelha fato_perdas', () => {
  it('a soma por tipo é idêntica à da tabela', async () => {
    // `soma` pode ser NULL: `SUM` sobre zero linhas nao devolve zero, devolve nada.
    // Por isso o `Number()` adiante nao e' redundante.
    const view = await prisma.$queryRaw<Array<{ tipo: string; n: bigint; soma: number | null }>>`
      SELECT tipo, COUNT(*) AS n, SUM(valor)::float8 AS soma
      FROM vw_tipo_perda GROUP BY tipo ORDER BY tipo`
    const tabela = await prisma.fatoPerdas.groupBy({
      by: ['tipoQuebra'],
      where: { status: 'APROVADA' },
      _count: true,
      _sum: { valor: true },
      orderBy: { tipoQuebra: 'asc' },
    })

    expect(view.length, 'a view não devolveu nada — o seed tem Perdas?').toBeGreaterThan(0)
    expect(view.map((v) => v.tipo)).toEqual(tabela.map((t) => t.tipoQuebra))
    for (const [i, v] of view.entries()) {
      const t = tabela[i]!
      expect(Number(v.n), `contagem de ${v.tipo}`).toBe(t._count)
      expect(Number(v.soma), `soma de ${v.tipo}`).toBeCloseTo(Number(t._sum.valor), 2)
    }
  })

  it('a soma dos tipos reproduz o total de Perdas do período', async () => {
    // É a propriedade de que o indicador depende: o desdobramento não pode
    // perder nem inventar valor em relação ao número que o painel mostra.
    const daView = await prisma.$queryRaw<Array<{ soma: number | null }>>`
      SELECT SUM(valor)::float8 AS soma FROM vw_tipo_perda`
    const total = await prisma.fatoPerdas.aggregate({
      where: { status: 'APROVADA' },
      _sum: { valor: true },
    })
    expect(Number(daView[0]!.soma)).toBeCloseTo(Number(total._sum.valor), 2)
  })

  it('só traz QI e QNI', async () => {
    const tipos = await prisma.$queryRaw<Array<{ tipo: string }>>`
      SELECT DISTINCT tipo FROM vw_tipo_perda ORDER BY tipo`
    expect(tipos.map((t) => t.tipo)).toEqual(['QI', 'QNI'])
  })

  /**
   * O invariante é a view NÃO TRANSFORMAR o sinal — não que existam os dois.
   *
   * A primeira versão deste teste exigia ao menos um valor negativo e um
   * positivo, e falhou: o seed gera só negativos, enquanto o dado real tem 3.472
   * positivos. Exigir os dois tornaria o teste dependente de qual banco está
   * embaixo — que é justamente o que a separação do banco de teste eliminou.
   *
   * Comparar as contagens contra a tabela cobre o que importa: se alguém aplicar
   * `ABS()` ou inverter o sinal na view, o total deixaria de fechar com o
   * indicador sem erro nenhum aparecer.
   *
   * Nenhum sinal está associado a um tipo: QI (identificada) e QNI (não
   * identificada) podem vir positivas ou negativas.
   */
  it('não transforma o sinal: as contagens batem com a tabela', async () => {
    const view = await prisma.$queryRaw<Array<{ neg: bigint; pos: bigint }>>`
      SELECT COUNT(*) FILTER (WHERE valor < 0) AS neg,
             COUNT(*) FILTER (WHERE valor > 0) AS pos
      FROM vw_tipo_perda`
    const [neg, pos] = await Promise.all([
      prisma.fatoPerdas.count({ where: { status: 'APROVADA', valor: { lt: 0 } } }),
      prisma.fatoPerdas.count({ where: { status: 'APROVADA', valor: { gt: 0 } } }),
    ])
    expect(Number(view[0]!.neg), 'negativos').toBe(neg)
    expect(Number(view[0]!.pos), 'positivos').toBe(pos)
  })

  it('não vaza quebra PENDENTE', async () => {
    // Hoje o fluxo só envia APROVADA, então isto passa por vacuidade. Fica para
    // o dia em que PENDENTE começar a chegar: só APROVADA entra no indicador, e
    // a view tem de respeitar a mesma regra.
    const n = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n FROM vw_tipo_perda`
    const aprovadas = await prisma.fatoPerdas.count({ where: { status: 'APROVADA' } })
    expect(Number(n[0]!.n)).toBe(aprovadas)
  })
})

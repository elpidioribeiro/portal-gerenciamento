import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * As fontes de cadastro recebem os parâmetros que a consulta delas pede.
 *
 * O defeito que originou este arquivo: `rodarCadastro` chamava `consultar` com
 * `{}` sempre, num comentário que dizia *"o SQL de cadastro não tem `:de` nem
 * `:ate`"*. Metade das fontes de cadastro tem. O Oracle recusava com
 * `NJS-098: 2 bind placeholders were used but 0 bind values were provided`
 * **antes** de a execução ser registrada — então não havia linha em
 * `sync_execucao`, e o painel de administração não mostrava nem erro: o botão
 * "Atualizar" parecia não fazer nada.
 *
 * O que o escondia: as duas fontes SEM bind (`vendedor-area`,
 * `area-supervisor`) funcionavam. Meia funcionalidade parece funcionalidade
 * inteira quando ninguém testa a outra metade.
 *
 * A raiz foi ler `janelaDias: null` como "não tem janela". O `fontes.mjs` diz
 * outra coisa, e diz explicitamente: *"por COMPETÊNCIA, não por dia"*.
 */

const chamadas: Array<{ sql: string; binds: unknown }> = []

vi.mock('../../src/lib/oracle.js', () => ({
  consultar: vi.fn(async (sql: string, binds: unknown) => {
    chamadas.push({ sql, binds })
    /*
     * Devolve VAZIO de propósito: o executor aborta logo em seguida, com
     * "não devolveu nenhuma linha". É o que permite conferir o que foi passado
     * ao Oracle sem gravar nada — o gravador nunca chega a rodar.
     */
    return { linhas: [], truncado: false }
  }),
  encerrarOracle: vi.fn(async () => {}),
  oracleRespondendo: vi.fn(async () => false),
}))

const prisma = new PrismaClient()
afterAll(() => prisma.$disconnect())
beforeEach(() => {
  chamadas.length = 0
})

/** Roda e engole o "nenhuma linha": aqui o que importa é o que foi perguntado. */
async function binsDe(fonte: 'vendedor-area' | 'area-supervisor' | 'vendedor-situacao' | 'dias-uteis') {
  const { executarCargaCadastro } = await import('../../src/modules/carga/executar.js')
  await executarCargaCadastro(prisma, fonte, 'teste').catch(() => undefined)
  return chamadas.at(-1)
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

describe('parâmetros da carga de cadastro', () => {
  it('manda a competência para quem tem `:de` no SQL', async () => {
    for (const fonte of ['vendedor-situacao', 'dias-uteis'] as const) {
      const c = await binsDe(fonte)
      expect(c, fonte).toBeDefined()
      expect(c!.sql, fonte).toContain(':de')

      const binds = c!.binds as { de?: string; ate?: string }
      expect(binds.de, fonte).toMatch(ISO)
      expect(binds.ate, fonte).toMatch(ISO)
      expect(binds.de! < binds.ate!, fonte).toBe(true)
    }
  })

  it('não manda parâmetro para quem não pede', async () => {
    for (const fonte of ['vendedor-area', 'area-supervisor'] as const) {
      const c = await binsDe(fonte)
      expect(c!.sql, fonte).not.toContain(':de')
      expect(c!.binds, fonte).toEqual({})
    }
  })

  /**
   * A janela cobre DOIS meses: o corrente e o anterior.
   *
   * `HOUVE_VENDA` é calculada com `SYSDATE` na origem — enquanto o mês corre
   * todo mundo é MÊS EM VIGOR, e quando fecha a MESMA linha vira COM VENDA ou
   * SEM VENDA. Recarregar só o mês corrente congelaria o anterior no rótulo
   * provisório, e o denominador nunca mais mudaria.
   */
  it('a competência vai do 1º do mês anterior ao fim do mês corrente', async () => {
    const c = await binsDe('vendedor-situacao')
    const { de, ate } = c!.binds as { de: string; ate: string }

    const hoje = new Date()
    const anterior = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1))
    const fimDoCorrente = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0))

    expect(de).toBe(anterior.toISOString().slice(0, 10))
    expect(ate).toBe(fimDoCorrente.toISOString().slice(0, 10))
    // Vira o ano sem tratamento especial: `Date.UTC` com mês -1 já resolve.
    expect(de.slice(0, 7)).not.toBe(ate.slice(0, 7))
  })
})

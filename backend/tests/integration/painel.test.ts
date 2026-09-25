import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import { FILIAIS, MATRIZ, arredondar } from '../../prisma/seed/dados-handoff.js'
import { exigirSeed } from '../helpers/seed.js'

/**
 * A matriz que a API entrega é a mesma do handoff?
 *
 * O teste de `matriz-seed` confere os dados no banco; este confere o caminho
 * inteiro — agregação, meta do período, aritmética do desvio e regra de status.
 * É o que pega um erro introduzido na rota sem tocar no seed.
 *
 * Requer banco semeado: npm run db:start && npm run db:seed
 */

let app: FastifyInstance

// Os testes de fidelidade ao handoff só valem sobre o seed. Ver helpers/seed.ts.
await exigirSeed()

beforeAll(async () => {
  app = await buildApp()
  await app.ready()
})
afterAll(() => app.close())

const hoje = new Date()
const ANO = hoje.getFullYear()
const MES = hoje.getMonth() + 1

async function pedirPainel(query = `modo=mes&ano=${ANO}&mes=${MES}`) {
  const r = await app.inject({ method: 'GET', url: `/api/v1/painel?${query}` })
  expect(r.statusCode, r.body).toBe(200)
  return r.json()
}

describe('GET /painel', () => {
  it('entrega as 9 filiais na ordem do handoff', async () => {
    const d = await pedirPainel()
    expect(d.filiais.map((f: { sigla: string }) => f.sigla)).toEqual(FILIAIS.map((f) => f.sigla))
  })

  it('entrega os 4 indicadores na ordem do handoff', async () => {
    const d = await pedirPainel()
    expect(d.indicadores.map((i: { codigo: string }) => i.codigo)).toEqual([
      'vendas',
      'nps',
      'perdas',
      'custo',
    ])
  })

  it.each([
    ['vendas', MATRIZ.vendas],
    ['nps', MATRIZ.nps],
    ['perdas', MATRIZ.perdas],
    ['custo', MATRIZ.custo],
  ])('%s: os 9 desvios batem com a matriz do handoff', async (codigo, esperado) => {
    const d = await pedirPainel()
    const linha = d.indicadores.find((i: { codigo: string }) => i.codigo === codigo)

    // O handoff traz os desvios inteiros; a API passou a devolver duas casas.
    // Comparamos arredondado, com a mesma regra do handoff (meio para longe do
    // zero) — `Math.round(-12.5)` daria -12 e quebraria a comparação.
    const obtidos = linha.celulas.map((c: { desvio: number }) => arredondar(c.desvio))
    expect(obtidos).toEqual(esperado.map(([, desvio]) => desvio))
  })

  it('a cor segue o sentido do indicador, não o sinal do desvio', async () => {
    const d = await pedirPainel()
    const porCodigo = Object.fromEntries(
      d.indicadores.map((i: { codigo: string }) => [i.codigo, i]),
    )

    // Vendas é "maior é melhor": desvio negativo é vermelho.
    const png = porCodigo.vendas.celulas.find((c: { filial: string }) => c.filial === 'SER')
    expect(png.desvio).toBeLessThan(0)
    expect(png.situacao).toBe('abaixo')

    // Custo é "menor é melhor", e é ele que carrega o contraste: aqui desvio
    // POSITIVO é vermelho e NEGATIVO é verde, o oposto de Vendas. Uma regra
    // literal de "desvio negativo = ruim" pintaria Custo errado justamente
    // quando a filial está gastando menos que o orçado.
    const custo = porCodigo.custo.celulas.filter((c: { desvio: number | null }) => c.desvio !== null)
    expect(custo.length, 'o seed precisa ter Custo para este teste valer').toBeGreaterThan(0)
    for (const c of custo) {
      expect(c.situacao, `custo ${c.filial} desvio ${c.desvio}`).toBe(c.desvio > 0 ? 'abaixo' : 'acima')
    }

    // Perdas tem valor NEGATIVO (convenção da origem) contra meta negativa, e é
    // MAIOR_MELHOR: perder menos é estar mais alto. São quatro faixas, então o
    // que se confere aqui não é a cor de cada célula — isso é papel de
    // faixas.test.ts — e sim a MONOTONICIDADE: mais folga nunca pode dar cor
    // pior. É a propriedade que quebra se alguém inverter o sentido de volta,
    // e ela não depende dos limiares.
    const ORDEM: Record<string, number> = { abaixo: 0, atencao: 1, acima: 2, otimo: 3 }
    const perdas = porCodigo.perdas.celulas
      .filter((c: { valor: number | null }) => c.valor !== null)
      .map((c: { filial: string; valor: number; meta: number; situacao: string }) => ({
        ...c,
        folga: c.valor - c.meta,
      }))
      .sort((a: { folga: number }, b: { folga: number }) => a.folga - b.folga)

    expect(perdas.length, 'o seed precisa ter Perdas para este teste valer').toBeGreaterThan(0)
    for (const c of perdas) {
      expect(c.valor, `perdas ${c.filial} deveria ser negativa`).toBeLessThanOrEqual(0)
    }
    for (let i = 1; i < perdas.length; i++) {
      const anterior = perdas[i - 1]!
      const atual = perdas[i]!
      expect(
        ORDEM[atual.situacao]!,
        `${atual.filial} (folga ${atual.folga.toFixed(3)}) não pode ter cor pior que ` +
          `${anterior.filial} (folga ${anterior.folga.toFixed(3)})`,
      ).toBeGreaterThanOrEqual(ORDEM[anterior.situacao]!)
    }
  })

  it('o desvio vem com duas casas decimais', async () => {
    const d = await pedirPainel()
    const comDesvio = d.indicadores
      .flatMap((i: { celulas: Array<{ desvio: number | null }> }) => i.celulas)
      .filter((c: { desvio: number | null }) => c.desvio !== null)

    expect(comDesvio.length).toBeGreaterThan(0)
    for (const c of comDesvio) {
      // Não pode ter mais de 2 casas; inteiro é aceitável (ex.: -12).
      expect(Number(c.desvio.toFixed(2))).toBe(c.desvio)
    }
  })

  it('conta corretamente quantas filiais estão piores que a meta', async () => {
    const d = await pedirPainel()
    for (const ind of d.indicadores) {
      // Amarelo entra na conta: 'atencao' é "abaixo da meta, mas por pouco",
      // não "na meta". Contar só o vermelho faria o painel anunciar
      // "0 de 9 fora da meta" com células amarelas visíveis na mesma linha.
      // Hoje só NPS tem a faixa; nos outros o filtro não muda nada.
      const fora = ind.celulas.filter(
        (c: { situacao: string | null }) => c.situacao === 'abaixo' || c.situacao === 'atencao',
      ).length
      expect(ind.foraDaMeta, ind.codigo).toBe(fora)
    }
  })

  it('só NPS tem células amarelas', async () => {
    const d = await pedirPainel()
    for (const ind of d.indicadores) {
      const amarelas = ind.celulas.filter(
        (c: { situacao: string | null }) => c.situacao === 'atencao',
      ).length
      if (ind.codigo !== 'nps') {
        expect(amarelas, `${ind.codigo} não deveria ter faixa intermediária`).toBe(0)
      }
    }
  })

  it('rótulo de meta só existe quando ela é igual em todas as filiais', async () => {
    const d = await pedirPainel()
    const porCodigo = Object.fromEntries(
      d.indicadores.map((i: { codigo: string }) => [i.codigo, i]),
    )
    // Vendas tem meta por filial — não há rótulo único que sirva.
    expect(porCodigo.vendas.metaRotulo).toBeNull()
    // 75, não os 80 do handoff: é o que a medida [Meta NPS] do dataset devolve.
    expect(porCodigo.nps.metaRotulo).toBe('meta 75')
    // Meta NEGATIVA, como o valor: é o limite de perda que não se deve furar.
    expect(porCodigo.perdas.metaRotulo).toBe('meta -4,0%')
  })

  it('modo ano agrega o período inteiro sem quebrar', async () => {
    const d = await pedirPainel(`modo=ano&ano=${ANO}`)
    expect(d.periodo.modo).toBe('ano')
    expect(d.periodo.mes).toBeNull()
    for (const ind of d.indicadores) {
      expect(ind.celulas).toHaveLength(9)
    }
  })

  it('período sem dado nenhum devolve células nulas, não zeros', async () => {
    // 2024 está fora da retenção (ano corrente + anterior) e nunca foi semeado.
    const d = await pedirPainel(`modo=mes&ano=${ANO - 2}&mes=1`)
    for (const ind of d.indicadores) {
      for (const c of ind.celulas) {
        expect(c.valor, `${ind.codigo}/${c.filial}`).toBeNull()
        expect(c.situacao).toBeNull()
      }
    }
  })

  it('recusa mês fora de 1–12', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/v1/painel?modo=mes&ano=${ANO}&mes=13` })
    expect(r.statusCode).toBe(400)
  })
})

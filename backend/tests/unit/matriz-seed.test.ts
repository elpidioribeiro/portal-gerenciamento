import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'
import {
  FILIAIS,
  MATRIZ,
  arredondar,
  desvioPercentual,
  metaDe,
} from '../../prisma/seed/dados-handoff.js'

/**
 * O seed é fiel ao handoff?
 *
 * Estes testes leem do banco com a MESMA aritmética que a API vai usar e
 * comparam com os números literais do design. É o que impede o seed de
 * "quase" reproduzir a matriz — um desvio de 1 ponto numa célula passa
 * despercebido numa conferência visual, mas quebra aqui.
 *
 * Roda sobre o banco de teste, que o globalSetup semeia a cada execucao.
 */

import { exigirSeed } from '../helpers/seed.js'

await exigirSeed()

const prisma = new PrismaClient()
afterAll(() => prisma.$disconnect())

const hoje = new Date()
const ANO = hoje.getFullYear()
const MES = hoje.getMonth() + 1
const de = new Date(Date.UTC(ANO, MES - 1, 1))
const ate = new Date(Date.UTC(ANO, MES - 1, hoje.getDate()))

async function filialId(sigla: string) {
  const f = await prisma.filial.findUniqueOrThrow({ where: { sigla } })
  return f.id
}

describe('matriz do painel reproduz o handoff', () => {
  it('Vendas: no mês vigente vale a ÚLTIMA tendência, não a soma do realizado', async () => {
    for (const [i, f] of FILIAIS.entries()) {
      const ultimo = await prisma.fatoVendas.findFirstOrThrow({
        where: { filialId: await filialId(f.sigla), data: { gte: de, lte: ate } },
        orderBy: { data: 'desc' },
      })
      const [esperado, desvioEsperado] = MATRIZ.vendas[i]!

      expect(Number(ultimo.tendencia), `tendência ${f.sigla}`).toBe(esperado)
      expect(arredondar(Number(ultimo.deltaMeta)), `delta_meta ${f.sigla}`).toBe(desvioEsperado)

      // O delta que a origem manda tem que ser reproduzível pela nossa própria
      // aritmética — se divergir, ou a meta está errada ou a origem usa outra
      // conta, e nos dois casos é melhor descobrir aqui.
      expect(
        arredondar(desvioPercentual(Number(ultimo.tendencia), metaDe('vendas', f.sigla))),
        `delta conferido ${f.sigla}`,
      ).toBe(desvioEsperado)
    }
  })

  it('Vendas: o realizado acumulado fica ABAIXO da tendência no mês em curso', async () => {
    // É o cenário que motivou a mudança: no dia 18 de 31, o acumulado é menor
    // que a previsão de fechamento. Se fossem iguais, o seed não estaria
    // exercitando a diferença entre as duas colunas.
    const id = await filialId('CEN')
    const soma = await prisma.fatoVendas.aggregate({
      where: { filialId: id, data: { gte: de, lte: ate } },
      _sum: { valorReal: true },
    })
    const ultimo = await prisma.fatoVendas.findFirstOrThrow({
      where: { filialId: id, data: { gte: de, lte: ate } },
      orderBy: { data: 'desc' },
    })
    expect(Number(soma._sum.valorReal)).toBeLessThan(Number(ultimo.tendencia))
  })

  it('NPS: (promotores − detratores) / respostas × 100', async () => {
    for (const [i, f] of FILIAIS.entries()) {
      const s = await prisma.fatoNps.aggregate({
        where: { filialId: await filialId(f.sigla), data: { gte: de, lte: ate } },
        _sum: { qtdPromotores: true, qtdNeutros: true, qtdDetratores: true },
      })
      const p = s._sum.qtdPromotores ?? 0
      const n = s._sum.qtdNeutros ?? 0
      const d = s._sum.qtdDetratores ?? 0
      const nps = ((p - d) / (p + n + d)) * 100
      const [esperado, desvioEsperado] = MATRIZ.nps[i]!

      expect(Math.round(nps), `NPS ${f.sigla}`).toBe(esperado)
      expect(arredondar(desvioPercentual(esperado, metaDe('nps', f.sigla))), `desvio ${f.sigla}`).toBe(
        desvioEsperado,
      )
    }
  })

  it('Perdas: só APROVADA entra, e a razão fecha sobre os totais', async () => {
    for (const [i, f] of FILIAIS.entries()) {
      const id = await filialId(f.sigla)
      const janela = { data: { gte: de, lte: ate } }

      const perda = await prisma.fatoPerdas.aggregate({
        where: { filialId: id, status: 'APROVADA', ...janela },
        _sum: { valor: true },
      })
      const mov = await prisma.fatoMovimentacao.aggregate({
        where: { filialId: id, ...janela },
        _sum: { valor: true },
      })

      const pct = (Number(perda._sum.valor ?? 0) / Number(mov._sum.valor ?? 1)) * 100
      const [esperado, desvioEsperado] = MATRIZ.perdas[i]!

      expect(Number(pct.toFixed(1)), `Perdas ${f.sigla}`).toBe(esperado)
      expect(arredondar(desvioPercentual(esperado, metaDe('perdas', f.sigla))), `desvio ${f.sigla}`).toBe(
        desvioEsperado,
      )
    }
  })

  it('Perdas: ignorar o status PENDENTE mudaria o número (o filtro é real)', async () => {
    const id = await filialId('NOR')
    const janela = { data: { gte: de, lte: ate } }

    const soAprovada = await prisma.fatoPerdas.aggregate({
      where: { filialId: id, status: 'APROVADA', ...janela },
      _sum: { valor: true },
    })
    const tudo = await prisma.fatoPerdas.aggregate({
      where: { filialId: id, ...janela },
      _sum: { valor: true },
    })

    // Comparado em MÓDULO: perda é negativa na convenção da origem, e sem o
    // módulo a desigualdade se inverte — o teste passaria a afirmar o contrário
    // do que quer dizer.
    //
    // Se alguém remover o filtro por status, a magnitude sobe ~25% e a matriz
    // deixa de bater. Este teste garante que o seed tem dado suficiente para
    // que esse erro apareça, em vez de passar despercebido.
    expect(Math.abs(Number(tudo._sum.valor))).toBeGreaterThan(
      Math.abs(Number(soAprovada._sum.valor)) * 1.2,
    )
  })

  it('Custo: custo / faturamento, com faturamento vindo de fato_vendas', async () => {
    for (const [i, f] of FILIAIS.entries()) {
      const id = await filialId(f.sigla)

      const custo = await prisma.fatoCusto.findFirstOrThrow({
        where: { filialId: id, ano: ANO, mes: MES, indicador: { codigo: 'custo' } },
      })
      // Faturamento é o REALIZADO, nunca a tendência: dividir custo contábil
      // por uma previsão faria o percentual mudar sem nada acontecer no custo.
      const fat = await prisma.fatoVendas.aggregate({
        where: { filialId: id, data: { gte: de, lte: ate } },
        _sum: { valorReal: true },
      })

      const pct = (Number(custo.valor) / Number(fat._sum.valorReal ?? 1)) * 100
      const [esperado, desvioEsperado] = MATRIZ.custo[i]!

      expect(Number(pct.toFixed(1)), `Custo ${f.sigla}`).toBe(esperado)
      expect(arredondar(desvioPercentual(esperado, metaDe('custo', f.sigla))), `desvio ${f.sigla}`).toBe(
        desvioEsperado,
      )
    }
  })
})

describe('armadilhas de agregação', () => {
  it('razão do mês se recalcula sobre os totais, não é a média das razões diárias', async () => {
    const id = await filialId('NOR')
    const janela = { data: { gte: de, lte: ate } }

    const perdas = await prisma.fatoPerdas.findMany({
      where: { filialId: id, status: 'APROVADA', ...janela },
      select: { data: true, valor: true },
    })
    const movs = await prisma.fatoMovimentacao.findMany({
      where: { filialId: id, ...janela },
      select: { data: true, valor: true },
    })

    const porDia = new Map<string, { p: number; m: number }>()
    for (const r of perdas) {
      const k = r.data.toISOString().slice(0, 10)
      porDia.set(k, { p: (porDia.get(k)?.p ?? 0) + Number(r.valor), m: porDia.get(k)?.m ?? 0 })
    }
    for (const r of movs) {
      const k = r.data.toISOString().slice(0, 10)
      porDia.set(k, { p: porDia.get(k)?.p ?? 0, m: Number(r.valor) })
    }

    const dias = [...porDia.values()].filter((d) => d.m > 0)
    const mediaDasRazoes = dias.reduce((a, d) => a + (d.p / d.m) * 100, 0) / dias.length
    const razaoDosTotais =
      (dias.reduce((a, d) => a + d.p, 0) / dias.reduce((a, d) => a + d.m, 0)) * 100

    /*
     * A divergência só EXISTE com dois dias ou mais: com um só, as duas contas
     * são a mesma expressão, e a diferença é zero por álgebra -- não por o seed
     * ter ficado uniforme.
     *
     * E um dia só acontece: a janela é `dia 1 do mês -> hoje`, então **todo dia
     * 1º** ela tem um dia. A asserção ficava vacuosa e a suíte quebrava uma vez
     * por mês, sempre na mesma data.
     *
     * O comentário anterior culpava o seed ("ficou uniforme demais"), e mandava
     * quem tropeçasse nisto procurar no lugar errado -- doze vezes por ano.
     */
    if (dias.length > 1) {
      expect(Math.abs(mediaDasRazoes - razaoDosTotais)).toBeGreaterThan(0)
    }

    // Esta vale sempre: é o número do handoff, com um dia ou com trinta.
    expect(Number(razaoDosTotais.toFixed(1))).toBe(MATRIZ.perdas[1][0])
  })
})

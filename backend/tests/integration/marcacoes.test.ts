import { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.js'
import { exigirSeed } from '../helpers/seed.js'

/**
 * Marcação de ponto de causa e Pareto — o meio do ciclo do GD.
 *
 * A marcação é POR ÁREA DE VENDA desde 09/09/2026 (§7.59): conta-se onde o
 * problema aparece, e o que a reunião usa é a SOMA das áreas. Foi por gerência
 * de 31/08 a 09/09 (§7.29), e as linhas daquele período continuam entrando na
 * soma — há teste disso.
 *
 * O que estes testes protegem falha em SILÊNCIO, sem exceção nenhuma:
 *
 *  - marcar sem responder pela variável enche o Pareto de causa apontada por
 *    quem não vive o problema, e a reunião prioriza errado;
 *  - gravar de novo criando linha nova em vez de sobrescrever deixaria a grade
 *    com o número certo e o Pareto com o dobro;
 *  - célula zerada guardando zero encheria o Pareto de causas com peso nenhum;
 *  - o corte de 80% errado por um item muda para onde a reunião olha primeiro.
 */

await exigirSeed()

const prisma = new PrismaClient()
let app: FastifyInstance

/** O bypass autentica `f00001mle`. */
const EU = 'f00001mle'

let variavelId: string
let pontos: { id: string; nome: string }[]
let gerenciaId: string
let areaVendaId: string
/** Uma segunda área da MESMA gerência, quando o seed tem. Só a soma usa. */
let outraAreaId: string | null = null
/**
 * A gerência e TODAS as suas áreas.
 *
 * A limpeza entre testes tem de varrer os dois escopos: apagar só o da gerência
 * deixaria a marcação da área anterior somando no Pareto do teste seguinte, e o
 * número passaria a depender da ordem em que os testes rodam.
 */
let alvosDoTeste: string[]
let eu: string
let idPerfil: number
let codEmpresa: number
let filialOriginal: string | null

const ANO = 2026
const MES = 8

beforeAll(async () => {
  app = await buildApp()
  await app.ready()

  const usuario = await prisma.usuario.findUnique({ where: { loginErp: EU } })
  if (!usuario) throw new Error('Usuário do bypass não existe. Rode o seed.')
  eu = usuario.id
  filialOriginal = usuario.filialId

  /*
   * O usuário do bypass é N2, e N2 NÃO TEM FILIAL — é corporativo, vê todas.
   * Pela regra da associação isso significa que um N2 não marca ponto de causa,
   * o que é coerente: quem marca é o N4, na reunião da área dele. Há teste
   * disso mais abaixo.
   *
   * Para exercitar a marcação, este arquivo dá uma filial ao usuário e a
   * devolve no fim. É a configuração que um N4 real tem.
   */
  const filial = await prisma.filial.findFirst({ where: { codigo: { not: null } } })
  if (filial?.codigo == null) throw new Error('Nenhuma filial com código de empresa.')
  codEmpresa = filial.codigo
  await prisma.usuario.update({ where: { id: eu }, data: { filialId: filial.id } })

  /*
   * `ativo: true` nos DOIS lugares, e é o ponto.
   *
   * O `where` escolhe a variável; o `include` escolhe as linhas com que o teste
   * vai comparar. A rota filtra `ativo`, então um fixture que o ignorasse
   * montaria a expectativa sobre um conjunto que a rota nunca devolve -- e foi
   * exatamente o que aconteceu em 31/08/2026, quando as 36 causas sintéticas do
   * handoff foram desativadas: 14 testes caíram de uma vez comparando lista
   * cheia com lista vazia.
   */
  const v = await prisma.variavelControle.findFirst({
    where: { pontosCausa: { some: { ativo: true } } },
    include: {
      pontosCausa: { where: { ativo: true }, orderBy: { ordem: 'asc' }, select: { id: true, nome: true } },
    },
  })
  if (!v) throw new Error('Nenhuma variável com ponto de causa ATIVO. Rode o seed.')
  variavelId = v.id
  pontos = v.pontosCausa

  const area = await prisma.dimAreaVenda.findFirst({
    where: { filialId: filial.id },
    include: { gerencia: { select: { id: true, nome: true } } },
  })
  if (!area) throw new Error('Nenhuma área de venda. Rode o seed.')
  gerenciaId = area.gerencia.id
  areaVendaId = area.id

  const daGerencia = await prisma.dimAreaVenda.findMany({
    where: { gerenciaId },
    select: { id: true },
    orderBy: { cdArea: 'asc' },
  })
  outraAreaId = daGerencia.find((a) => a.id !== areaVendaId)?.id ?? null
  alvosDoTeste = [gerenciaId, ...daGerencia.map((a) => a.id)]

  /*
   * O usuário do bypass precisa da classificação de perfil para poder marcar —
   * é a mesma configuração que a tela de administração faz.
   */
  idPerfil = usuario.idPerfil ?? 9001
  await prisma.usuario.update({ where: { id: eu }, data: { idPerfil } })
})

afterAll(async () => {
  await prisma.perfilNivel.deleteMany({ where: { idPerfil } })
  await prisma.gerenciaVariavel.deleteMany({ where: { gerenciaId } })
  await prisma.usuario.update({ where: { id: eu }, data: { filialId: filialOriginal } })
  await app.close()
  await prisma.$disconnect()
})

/** Zera a célula de teste e (re)cria a associação, para cada teste começar igual. */
beforeEach(async () => {
  await prisma.ocorrenciaPontoCausa.deleteMany({
    where: { alvoId: { in: alvosDoTeste }, ano: ANO, mes: MES },
  })

  /*
   * Quem pode marcar sai de `perfil_variavel`, cadastrado junto com o nível
   * (28/08/2026, §7.20). São dois elos, e o teste monta os dois: o perfil é N4
   * e acompanha a variável, e a pessoa tem filial.
   */
  await prisma.perfilNivel.deleteMany({ where: { idPerfil } })
  await prisma.perfilNivel.create({
    data: {
      idPerfil,
      nivel: 'N4',
      descricao: 'Gerente adjunto de teste',
      variaveis: { create: [{ variavelControleId: variavelId }] },
    },
  })
  await prisma.gerenciaVariavel.deleteMany({ where: { gerenciaId } })
  await prisma.gerenciaVariavel.create({ data: { gerenciaId, variavelControleId: variavelId } })
})

/**
 * A gravação em lote, que substituiu o `POST` por clique em 28/08/2026.
 *
 * O corpo diz QUANTO a célula passa a valer, não quanto somar. Ver PLANO
 * §7.21: a tela conta em memória e manda tudo ao confirmar, porque uma ida ao
 * banco por clique custava a conversa da reunião.
 */
const gravar = (body: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url: `/api/v1/variaveis/${variavelId}/marcacoes`, payload: body })

/** Uma célula, o caso mais comum nos testes. */
const celula = (pontoCausaId: string, semana: number, quantidade: number) =>
  gravar({
    gerenciaId,
    areaVendaId,
    ano: ANO,
    mes: MES,
    celulas: [{ pontoCausaId, semana, quantidade }],
  })

type Grade = {
  podeMarcar: boolean
  pontosCausa: { id: string; nome: string; semanas: number[]; total: number }[]
}

/**
 * A grade de UMA área — a que se preenche.
 *
 * `area` ausente cai na de teste. Passar `null` pede a SOMA da gerência, que é
 * outra leitura: sem `areaVendaId` na URL.
 */
const grade = async (area: string | null = areaVendaId) => {
  const daArea = area === null ? '' : `&areaVendaId=${area}`
  const r = await app.inject({
    method: 'GET',
    url: `/api/v1/variaveis/${variavelId}/marcacoes?ano=${ANO}&mes=${MES}&gerenciaId=${gerenciaId}${daArea}`,
  })
  expect(r.statusCode, r.body).toBe(200)
  return r.json<Grade>()
}

/** O que a linha `(ponto, semana)` guarda no banco, na área de teste. */
const linhasNoBanco = (pontoCausaId: string, semana: number) =>
  prisma.ocorrenciaPontoCausa.count({
    where: {
      pontoCausaId,
      escopo: 'AREA_VENDA',
      alvoId: areaVendaId,
      ano: ANO,
      mes: MES,
      semana,
    },
  })

const pareto = async () => {
  const r = await app.inject({
    method: 'GET',
    url: `/api/v1/variaveis/${variavelId}/pareto?ano=${ANO}&mes=${MES}&gerenciaId=${gerenciaId}`,
  })
  expect(r.statusCode, r.body).toBe(200)
  return r.json<{
    total: number
    itens: { nome: string; quantidade: number; percentual: number; acumulado: number; vital: boolean }[]
  }>()
}

describe('a grade', () => {
  it('nasce com todas as células zeradas, cinco semanas por linha', async () => {
    const g = await grade()
    expect(g.pontosCausa).toHaveLength(pontos.length)
    for (const p of g.pontosCausa) {
      expect(p.semanas).toHaveLength(5)
      expect(p.total).toBe(0)
    }
  })

  it('grava na célula da semana, e só nela', async () => {
    expect((await celula(pontos[0]!.id, 3, 1)).statusCode).toBe(200)

    const g = await grade()
    const linha = g.pontosCausa.find((p) => p.id === pontos[0]!.id)
    expect(linha?.semanas).toEqual([0, 0, 1, 0, 0])
    expect(linha?.total).toBe(1)
  })

  /**
   * A garantia da unicidade `(ponto, área, ano, mês, semana)`: sem ela o
   * segundo toque criaria linha nova, a grade mostraria 1 e o Pareto contaria 2.
   */
  it('gravar de novo SOBRESCREVE a célula, não cria outra linha', async () => {
    await celula(pontos[0]!.id, 2, 1)
    await celula(pontos[0]!.id, 2, 5)
    await celula(pontos[0]!.id, 2, 3)

    const g = await grade()
    expect(g.pontosCausa.find((p) => p.id === pontos[0]!.id)?.semanas[1]).toBe(3)

    expect(await linhasNoBanco(pontos[0]!.id, 2)).toBe(1)
  })

  it('a célula zerada REMOVE a linha em vez de guardar zero', async () => {
    await celula(pontos[0]!.id, 1, 2)
    const r = await celula(pontos[0]!.id, 1, 0)
    expect(r.statusCode).toBe(200)
    expect(r.json().apagadas).toBe(1)

    expect(await linhasNoBanco(pontos[0]!.id, 1)).toBe(0)
  })

  it('zerar célula que já estava vazia não quebra', async () => {
    const r = await celula(pontos[0]!.id, 4, 0)
    expect(r.statusCode).toBe(200)
    expect(r.json().apagadas).toBe(1)
  })

  /**
   * O lote é o ponto da mudança: a reunião marca várias causas e confirma uma
   * vez só. Se ele gravasse uma e ignorasse as outras, a grade voltaria certa
   * (ela relê do banco) e o Pareto sairia errado -- sem erro nenhum.
   */
  it('grava várias células de uma vez', async () => {
    const r = await gravar({
      gerenciaId,
      areaVendaId,
      ano: ANO,
      mes: MES,
      celulas: [
        { pontoCausaId: pontos[0]!.id, semana: 1, quantidade: 2 },
        { pontoCausaId: pontos[1]!.id, semana: 1, quantidade: 3 },
        { pontoCausaId: pontos[0]!.id, semana: 2, quantidade: 4 },
      ],
    })
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json().gravadas).toBe(3)

    const g = await grade()
    expect(g.pontosCausa.find((p) => p.id === pontos[0]!.id)?.semanas.slice(0, 2)).toEqual([2, 4])
    expect(g.pontosCausa.find((p) => p.id === pontos[1]!.id)?.semanas[0]).toBe(3)
  })

  /**
   * A mesma célula duas vezes no corpo é erro de quem chamou. Escolher uma
   * delas gravaria um número que ninguém digitou.
   */
  it('recusa a mesma célula repetida no corpo', async () => {
    const r = await gravar({
      gerenciaId,
      areaVendaId,
      ano: ANO,
      mes: MES,
      celulas: [
        { pontoCausaId: pontos[0]!.id, semana: 1, quantidade: 2 },
        { pontoCausaId: pontos[0]!.id, semana: 1, quantidade: 5 },
      ],
    })
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/duas vezes/i)
  })

  /**
   * Ponto de causa de OUTRA variável entraria pela porta da variável do
   * caminho: o Pareto de uma apareceria dentro da outra.
   */
  it('recusa ponto de causa que não é desta variável', async () => {
    const deOutra = await prisma.pontoCausa.findFirst({
      where: { variavelControleId: { not: variavelId }, ativo: true },
    })
    if (!deOutra) return // Seed com uma variável só; nada a verificar.

    const r = await gravar({
      gerenciaId,
      areaVendaId,
      ano: ANO,
      mes: MES,
      celulas: [{ pontoCausaId: deOutra.id, semana: 1, quantidade: 1 }],
    })
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/não é desta variável/i)
  })

  it('semana fora de 1..5 é recusada — o banco tem a mesma trava', async () => {
    expect((await celula(pontos[0]!.id, 6, 1)).statusCode).toBe(400)
    expect((await celula(pontos[0]!.id, 0, 1)).statusCode).toBe(400)
  })
})

/**
 * **A soma da gerência**, que é o que a reunião olha.
 *
 * Marca-se dentro da área; o bloco de fora mostra o total. O que estes testes
 * protegem falha calado: uma soma que mostra a última área em vez do total, uma
 * grade de fora que aceita clique e devolve erro no salvar, e as linhas do
 * escopo antigo sumindo da tela sem sair do banco.
 */
describe('a soma da gerência', () => {
  it('soma as áreas, e não mostra a última', async () => {
    if (outraAreaId === null) return // Gerência com uma área só neste seed.

    await celula(pontos[0]!.id, 1, 2)
    await gravar({
      gerenciaId,
      areaVendaId: outraAreaId,
      ano: ANO,
      mes: MES,
      celulas: [{ pontoCausaId: pontos[0]!.id, semana: 1, quantidade: 3 }],
    })

    const soma = await grade(null)
    expect(soma.pontosCausa.find((p) => p.id === pontos[0]!.id)?.semanas[0]).toBe(5)
  })

  /**
   * A soma não é marcável nem para quem responde pela variável: não existe onde
   * gravar. Quem diz isso é o servidor — a tela não recalcula a regra.
   */
  it('nunca é marcável, mesmo para quem marca na área', async () => {
    expect((await grade()).podeMarcar).toBe(true)
    expect((await grade(null)).podeMarcar).toBe(false)
  })

  /**
   * As linhas gravadas contra a GERÊNCIA entre 31/08 e 09/09/2026 continuam
   * contando. Filtrar só `AREA_VENDA` as faria desaparecer da tela sem apagar
   * nada do banco — o pior tipo de perda, porque o dado fica lá e ninguém
   * procura o que não sabe que existiu.
   */
  it('inclui o que foi marcado contra a gerência antes de 09/09/2026', async () => {
    await prisma.ocorrenciaPontoCausa.create({
      data: {
        pontoCausaId: pontos[0]!.id,
        escopo: 'GERENCIA',
        alvoId: gerenciaId,
        ano: ANO,
        mes: MES,
        semana: 4,
        quantidade: 7,
        registradoPorId: eu,
      },
    })

    expect((await grade(null)).pontosCausa.find((p) => p.id === pontos[0]!.id)?.semanas[3]).toBe(7)
    expect((await pareto()).total).toBe(7)
    // E não aparece na grade da área: lá não foi marcado.
    expect((await grade()).pontosCausa.find((p) => p.id === pontos[0]!.id)?.total).toBe(0)
  })

  /**
   * Área de OUTRA gerência gravaria certinho e sumiria da soma de quem marcou,
   * aparecendo na de quem não marcou — engano que só se descobre no mês
   * seguinte, comparando Pareto com ata.
   */
  it('recusa área que não é desta gerência', async () => {
    const forasteira = await prisma.dimAreaVenda.findFirst({
      where: { gerenciaId: { not: gerenciaId } },
      select: { id: true },
    })
    if (!forasteira) return // Seed com uma gerência só; nada a verificar.

    const r = await gravar({
      gerenciaId,
      areaVendaId: forasteira.id,
      ano: ANO,
      mes: MES,
      celulas: [{ pontoCausaId: pontos[0]!.id, semana: 1, quantidade: 1 }],
    })
    expect(r.statusCode, r.body).toBe(404)
    expect(r.json().erro).toMatch(/não é desta gerência/i)
  })

  it('a grade de área que não existe é 404, não grade vazia', async () => {
    const r = await app.inject({
      method: 'GET',
      url:
        `/api/v1/variaveis/${variavelId}/marcacoes?ano=${ANO}&mes=${MES}` +
        `&gerenciaId=${gerenciaId}&areaVendaId=00000000-0000-4000-8000-000000000000`,
    })
    expect(r.statusCode).toBe(404)
  })
})

describe('quem pode marcar', () => {
  it('quem responde pela variável marca', async () => {
    expect((await grade()).podeMarcar).toBe(true)
    expect((await celula(pontos[0]!.id, 1, 1)).statusCode).toBe(200)
  })

  /**
   * Ausência de associação NEGA — nunca "libera tudo".
   *
   * O contrário seria o erro caro: um VENDEDOR, cargo com 21 lotações, marcaria
   * ponto de causa de departamento que não é o dele, e o Pareto da reunião
   * passaria a apontar causa levantada por quem não vive o problema.
   */
  it('sem a variável no perfil, não marca — e a grade avisa antes', async () => {
    await prisma.perfilVariavel.deleteMany({ where: { idPerfil } })

    expect((await grade()).podeMarcar).toBe(false)
    const r = await celula(pontos[0]!.id, 1, 1)
    expect(r.statusCode).toBe(403)
    expect(r.json().erro).toMatch(/não responde por esta variável/i)
  })

  /**
   * O N2 é corporativo e não tem filial, e sem filial não há área para marcar.
   * É coerente com o GD: quem marca ponto de causa é quem vive o problema, na
   * reunião da área — o N4.
   */
  it('sem filial, não marca — é o caso do N2, que é corporativo', async () => {
    await prisma.usuario.update({ where: { id: eu }, data: { filialId: null } })
    try {
      expect((await grade()).podeMarcar).toBe(false)
      expect((await celula(pontos[0]!.id, 1, 1)).statusCode).toBe(403)
    } finally {
      const f = await prisma.filial.findFirst({ where: { codigo: codEmpresa } })
      await prisma.usuario.update({ where: { id: eu }, data: { filialId: f!.id } })
    }
  })

  /**
   * Perfil sem classificação não marca.
   *
   * Em produção a pessoa nem chega aqui: `resolverNivelComAcesso` recusa na
   * porta, a cada requisição (ver `plugins/auth.ts`). Este teste roda sob o
   * bypass de desenvolvimento, que entrega o usuário sem passar por lá — e é
   * justamente por isso que ele vale: prova que a marcação **também** fecha
   * sozinha, sem depender da porta.
   *
   * Fecha em silêncio, e não com erro: a grade fica em somente-leitura. É a
   * decisão de sempre — o contrário, liberar tudo na ausência de cadastro,
   * encheria o Pareto de causa apontada por quem não vive o problema.
   */
  it('perfil sem classificação não marca, mesmo com a porta aberta', async () => {
    await prisma.perfilNivel.deleteMany({ where: { idPerfil } })

    expect((await grade()).podeMarcar).toBe(false)
    const r = await celula(pontos[0]!.id, 1, 1)
    expect(r.statusCode).toBe(403)
    expect(r.json().erro).toMatch(/não responde por esta variável/i)
  })
})

/**
 * **O Pareto do N3: a mesma marcação, somada uma vez só.**
 *
 * O N4 marca contra a ÁREA, na reunião dele. O N3 lê a soma das áreas da
 * gerência — não é dado novo, é a mesma linha agregada mais alto, e vem da
 * MESMA rota. Ninguém marca duas vezes. Ver PLANO §7.59.
 *
 * O que estes testes protegem é a igualdade: se a soma por gerência divergir da
 * soma das áreas, as duas telas mostram Paretos diferentes do mesmo mês e a
 * reunião do N3 prioriza contra o que o N4 apontou.
 */
describe('o Pareto por gerência', () => {
  const paretoDaGerencia = async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/variaveis/${variavelId}/pareto?ano=${ANO}&mes=${MES}&gerenciaId=${gerenciaId}`,
    })
    expect(r.statusCode, r.body).toBe(200)
    return r.json<{
      total: number
      itens: {
        nome: string
        quantidade: number
        areas: { nome: string; quantidade: number }[]
      }[]
    }>()
  }

  it('soma o que foi marcado nas áreas da gerência', async () => {
    await gravar({
      gerenciaId,
      areaVendaId,
      ano: ANO,
      mes: MES,
      celulas: [
        { pontoCausaId: pontos[0]!.id, semana: 1, quantidade: 3 },
        { pontoCausaId: pontos[1]!.id, semana: 2, quantidade: 1 },
      ],
    })

    const g = await paretoDaGerencia()
    expect(g.total).toBeGreaterThanOrEqual(4)
    const causa = g.itens.find((i) => i.nome === pontos[0]!.nome)
    expect(causa?.quantidade).toBeGreaterThanOrEqual(3)
  })

  it('gerência que não existe é 404, não lista vazia', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/variaveis/${variavelId}/pareto?ano=${ANO}&mes=${MES}&gerenciaId=00000000-0000-4000-8000-000000000000`,
    })
    expect(r.statusCode).toBe(404)
  })
})

describe('o Pareto', () => {
  it('soma as quantidades do ciclo e ordena da maior para a menor', async () => {
    // O Pareto soma as SEMANAS de cada ponto: 1+1 contra 2+1.
    await gravar({
      gerenciaId,
      areaVendaId,
      ano: ANO,
      mes: MES,
      celulas: [
        { pontoCausaId: pontos[0]!.id, semana: 1, quantidade: 1 },
        { pontoCausaId: pontos[0]!.id, semana: 2, quantidade: 1 },
        { pontoCausaId: pontos[1]!.id, semana: 1, quantidade: 2 },
        { pontoCausaId: pontos[1]!.id, semana: 3, quantidade: 1 },
      ],
    })

    const p = await pareto()
    expect(p.total).toBe(5)
    expect(p.itens[0]?.nome).toBe(pontos[1]!.nome)
    expect(p.itens[0]?.quantidade).toBe(3)
    expect(p.itens[1]?.quantidade).toBe(2)
  })

  /**
   * "Vital" é quem ENTRA antes dos 80%, não quem termina abaixo deles.
   *
   * Medir pelo acumulado final deixaria de fora justamente a barra que cruza a
   * linha — e é ela que fecha o corte. Um item a menos no corte muda para onde
   * a reunião olha primeiro.
   */
  it('marca como vital quem entra antes dos 80% acumulados, incluindo quem cruza a linha', async () => {
    await gravar({
      gerenciaId,
      areaVendaId,
      ano: ANO,
      mes: MES,
      celulas: [
        { pontoCausaId: pontos[0]!.id, semana: 1, quantidade: 7 },
        { pontoCausaId: pontos[1]!.id, semana: 1, quantidade: 2 },
        { pontoCausaId: pontos[2]!.id, semana: 1, quantidade: 1 },
      ],
    })

    const p = await pareto()
    expect(p.total).toBe(10)
    // 70% · acumula 70 → vital
    expect(p.itens[0]?.vital).toBe(true)
    // 20% · entra em 70 (abaixo de 80) e cruza para 90 → ainda vital
    expect(p.itens[1]?.acumulado).toBe(90)
    expect(p.itens[1]?.vital).toBe(true)
    // 10% · entra em 90 → fora
    expect(p.itens[2]?.vital).toBe(false)
  })

  it('empate é desempatado pelo nome, não pela ordem do banco', async () => {
    await celula(pontos[0]!.id, 1, 1)
    await celula(pontos[1]!.id, 1, 1)

    const nomes = [pontos[0]!.nome, pontos[1]!.nome].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    for (let i = 0; i < 3; i++) {
      expect((await pareto()).itens.map((x) => x.nome)).toEqual(nomes)
    }
  })

  it('sem marcação nenhuma devolve vazio, não erro', async () => {
    const p = await pareto()
    expect(p.total).toBe(0)
    expect(p.itens).toEqual([])
  })
})

/**
 * Performance Vendas, ponta a ponta.
 *
 * O que se protege aqui é a garantia que justifica calcular no portal em vez de
 * pedir ao BI: **a soma das projeções das áreas dá a projeção da filial**. Se
 * ela quebrar, o sintoma na tela é "as áreas não fecham com o total" — numa
 * tela onde os dois números aparecem lado a lado.
 */
describe('performance de vendas', () => {
  let gerenciaId: string
  let filialId: string
  let areas: { id: string; nome: string }[]

  const performance = async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/gerencias/${gerenciaId}/performance-vendas?ano=${ANO}&mes=${MES}`,
    })
    expect(r.statusCode, r.body).toBe(200)
    return r.json<{
      /*
       * O CORTE da própria rota, e não um recalculado aqui (§7.22).
       *
       * Sem ele o teste somava o mês inteiro contra uma rota que soma até D-1,
       * e só passava nos dias em que os dois coincidiam.
       */
      corte: string | null
      areas: { areaVendaId: string; nome: string; numerador: number; denominador: number | null; percentual: number | null }[]
      gerencia: { numerador: number; denominador: number; percentual: number } | null
    }>()
  }

  beforeAll(async () => {
    const g = await prisma.dimGerencia.findFirst({
      where: { areasVenda: { some: {} } },
      include: { areasVenda: { orderBy: { nome: 'asc' }, select: { id: true, nome: true } } },
    })
    if (!g) throw new Error('Nenhuma gerência com áreas. Rode o seed.')
    gerenciaId = g.id
    filialId = g.filialId
    areas = g.areasVenda
  })

  beforeEach(async () => {
    await prisma.meta.deleteMany({
      where: { escopo: 'AREA_VENDA', alvoId: { in: areas.map((a) => a.id) }, ano: ANO, mes: MES },
    })
  })

  it('sem meta cadastrada, o percentual é nulo e a gerência não fecha conta', async () => {
    const p = await performance()
    expect(p.areas.every((a) => a.percentual === null)).toBe(true)
    expect(p.gerencia).toBeNull()
  })

  /**
   * O fator aplicado às áreas é o da FILIAL — que é o que garante que as duas
   * projeções fechem quando o detalhe cobre o mesmo período do agregado.
   *
   * A identidade completa (`Σ projeções das áreas == tendência da filial`) só
   * vale quando `fato_venda_linha` cobre o mês inteiro, e aqui ela **não vale**:
   * a suíte carrega vendas por linha em poucos dias enquanto `fato_venda` tem o
   * mês todo. Afirmá-la assim mediria a completude da carga de teste, não a
   * conta — e falharia por um motivo que não é defeito.
   *
   * O que se verifica então é a RAZÃO: projetado ÷ vendido nas áreas tem de dar
   * o mesmo fator de tendência ÷ vendido na filial. Se a rota usasse outro
   * fator — média das áreas, projeção própria — este número mudaria.
   *
   * A identidade completa está provada onde ela é exata: no teste puro de
   * `performance-vendas.ts`.
   */
  it('aplica às áreas o fator de projeção da filial, não outro', async () => {
    const indicadorId = (await prisma.indicador.findUnique({ where: { codigo: 'vendas' } }))!.id
    const de = new Date(Date.UTC(ANO, MES - 1, 1))
    /*
     * O CORTE VEM DA ROTA, não do fim do mês.
     *
     * Esta era a causa de o teste falhar de forma intermitente: ele somava o
     * mês inteiro enquanto a rota soma até D-1 (§7.22), e passava só quando os
     * dois coincidiam. Perguntar o corte à própria rota é o que mantém as duas
     * pontas no mesmo instante — a mesma invariante que o `corteDe` documenta.
     */
    const corteDaRota = (await performance()).corte
    if (corteDaRota === null) return // Mês no futuro: nada a projetar.
    const ate = new Date(`${corteDaRota}T00:00:00.000Z`)

    const [tendencia, vendidoFilial, vendidoAreas] = await Promise.all([
      prisma.fatoVendas.findFirst({
        where: { data: { gte: de, lte: ate }, indicadorId, filialId },
        orderBy: { data: 'desc' },
        select: { tendencia: true },
      }),
      prisma.fatoVendas.aggregate({
        where: { data: { gte: de, lte: ate }, indicadorId, filialId },
        _sum: { valorReal: true },
      }),
      prisma.fatoVendasLinha.aggregate({
        where: { data: { gte: de, lte: ate }, indicadorId, gerenciaId },
        _sum: { valor: true },
      }),
    ])

    const somaAreas = Number(vendidoAreas._sum.valor ?? 0)
    if (somaAreas === 0) {
      // Sem carga de vendas por linha no período: nada a projetar, e a rota
      // devolve zero. O teste diz isso em vez de passar por vacuidade.
      expect((await performance()).areas.every((a) => a.numerador === 0)).toBe(true)
      return
    }

    const esperado =
      Number(tendencia?.tendencia ?? 0) / Number(vendidoFilial._sum.valorReal ?? 1)
    const p = await performance()
    const obtido = p.areas.reduce((a, x) => a + x.numerador, 0) / somaAreas

    expect(obtido).toBeCloseTo(esperado, 6)
  })

  it('a gerência soma numerador e denominador, e não promedia percentuais', async () => {
    const [a1, a2] = areas
    if (!a1 || !a2) return

    // Metas de tamanhos bem diferentes: promediar daria número muito outro.
    await prisma.meta.createMany({
      data: [
        { escopo: 'AREA_VENDA', alvoId: a1.id, filialId, ano: ANO, mes: MES, valor: 2_000_000 },
        { escopo: 'AREA_VENDA', alvoId: a2.id, filialId, ano: ANO, mes: MES, valor: 100_000 },
      ],
    })

    const p = await performance()
    const comMeta = p.areas.filter((x) => x.denominador !== null)
    const num = comMeta.reduce((a, x) => a + x.numerador, 0)
    const den = comMeta.reduce((a, x) => a + (x.denominador ?? 0), 0)

    expect(p.gerencia?.denominador).toBeCloseTo(den, 2)
    expect(p.gerencia?.percentual).toBeCloseTo((num / den) * 100, 4)
  })
})

/**
 * O quadro do N3: quais gerências existem e o que cada uma acompanha.
 *
 * O que se protege: **gerência sem vínculo devolve categoria vazia**, e é isso
 * que impede o Depósito de aparecer sob Vendas com um traço no lugar do número
 * — lido como dado faltando quando a verdade é que a pergunta não se aplica.
 *
 * E a filial sai do USUÁRIO, não da querystring: aceitá-la de qualquer um faria
 * um N3 ver a gerência de outra loja mudando um parâmetro na URL.
 */
describe('as gerências da filial', () => {
  let filialSigla: string
  let perfilOriginal: number | null

  const listar = (qs = '') =>
    app.inject({ method: 'GET', url: `/api/v1/gerencias${qs}` })

  const gerencias = async (qs = '') => {
    const r = await listar(qs)
    expect(r.statusCode, r.body).toBe(200)
    return (r.json<{
      gerencias: {
        nome: string
        areasVenda: { nome: string }[]
        categorias: { indicador: string; nome: string; variaveis: { nome: string }[] }[]
      }[]
    }>()).gerencias
  }

  beforeAll(async () => {
    const f = await prisma.filial.findFirst({ where: { codigo: codEmpresa } })
    filialSigla = f!.sigla

    /*
     * O usuário do bypass é N2 — corporativo, sem filial própria, e por isso
     * ele PRECISA informar a filial. Este bloco testa o caminho do N3, que é
     * quem usa esta tela, então o nível vai para N3 e volta no fim.
     *
     * `idPerfil` sai junto: com ele presente, `resolverNivelComAcesso` busca o
     * nível em `perfil_nivel` a cada requisição e ignora o gravado aqui.
     */
    perfilOriginal = (await prisma.usuario.findUnique({ where: { id: eu } }))!.idPerfil
    await prisma.usuario.update({ where: { id: eu }, data: { nivel: 'N3', idPerfil: null } })
  })

  afterAll(async () => {
    await prisma.usuario.update({
      where: { id: eu },
      data: { nivel: 'N2', idPerfil: perfilOriginal },
    })
  })

  it('devolve as gerências da filial do usuário, com suas áreas de venda', async () => {
    const gs = await gerencias()
    expect(gs.length).toBeGreaterThan(0)
    expect(gs.some((g) => g.areasVenda.length > 0)).toBe(true)
  })

  /**
   * Gerência ÓRFÃ — sem área de venda — é estado possível, não defeito.
   *
   * Realocar a última área de uma gerência a deixa vazia: `dimensao_area_venda`
   * aponta para a nova, e a antiga fica sem nenhuma. Acontece de verdade na
   * carga, e a suíte reproduz — o teste de ingestão move "Eletro" de Não
   * Construção para Construção.
   *
   * A rota devolve mesmo assim, e é o certo: esconder faria a gerência
   * desaparecer do portal sem ninguém entender por quê. Quem decide se desenha
   * é a tela, pela mesma regra da categoria sem variável.
   */
  it('gerência sem área de venda é devolvida, não escondida', async () => {
    const gs = await gerencias()
    for (const g of gs) expect(Array.isArray(g.areasVenda)).toBe(true)
  })

  it('agrupa as variáveis por indicador — é a categoria da tela', async () => {
    const gs = await gerencias()
    const comVariaveis = gs.filter((g) => g.categorias.length > 0)
    expect(comVariaveis.length).toBeGreaterThan(0)
    for (const g of comVariaveis) {
      for (const c of g.categorias) {
        expect(c.variaveis.length).toBeGreaterThan(0)
        expect(c.indicador).toBeTruthy()
      }
    }
  })

  /**
   * A regra que decide o que a tela do N3 desenha.
   *
   * Sem vínculo, a categoria não vem — e a tela não a mostra. Devolvê-la vazia
   * com as variáveis dentro faria o Depósito aparecer sob Vendas.
   */
  it('gerência sem vínculo vem com categorias vazias, não com a categoria em branco', async () => {
    const g = await prisma.dimGerencia.findFirst({
      where: { filial: { codigo: codEmpresa }, variaveis: { none: {} } },
    })
    if (!g) return // Todas vinculadas neste seed; nada a verificar.

    const encontrada = (await gerencias()).find((x) => x.nome === g.nome)
    expect(encontrada?.categorias).toEqual([])
  })

  /**
   * O N3 não vê a loja de OUTRA pessoa pela URL.
   *
   * A rota usa `resolverVisao`, a mesma de `/painel` e `/indicador`
   * (28/08/2026), então a trava é uma só para as três.
   *
   * **O que este teste mede mudou em 10/09/2026 (§7.63).** Ele pedia a PRÓPRIA
   * filial e esperava 403, porque qualquer troca de visão exigia administrador.
   * Com o estreitamento liberado, pedir a própria filial é identidade e passa —
   * e o teste continuaria verde afirmando uma recusa que não existe mais.
   *
   * Passou a pedir OUTRA filial, que é o risco de verdade: sem esta recusa, um
   * gerente de loja veria a gerência de outra trocando um parâmetro na URL.
   */
  it('o N3 não escolhe a filial de outra loja pela URL', async () => {
    const antes = (await prisma.usuario.findUnique({ where: { id: eu } }))!.papelAdmin
    const outra = await prisma.filial.findFirst({
      where: { tipo: 'FILIAL', ativa: true, sigla: { not: filialSigla } },
      select: { sigla: true },
    })
    if (!outra) return // Seed com uma filial só; não há para onde andar de lado.

    await prisma.usuario.update({ where: { id: eu }, data: { papelAdmin: 'NENHUM' } })
    try {
      const r = await listar(`?visaoNivel=N3&visaoFilial=${outra.sigla}`)
      expect(r.statusCode).toBe(403)
      expect(r.json().erro).toMatch(/estreitar a sua vis/i)
    } finally {
      await prisma.usuario.update({ where: { id: eu }, data: { papelAdmin: antes } })
    }
  })

  /**
   * E a PRÓPRIA filial passa, sem ser administrador — é a outra metade de
   * §7.63. Sem este caso, nada no arquivo prova que o estreitamento funciona.
   */
  it('o N3 abre a própria filial pela URL, sem ser administrador', async () => {
    const antes = (await prisma.usuario.findUnique({ where: { id: eu } }))!.papelAdmin
    await prisma.usuario.update({ where: { id: eu }, data: { papelAdmin: 'NENHUM' } })
    try {
      const r = await listar(`?visaoNivel=N3&visaoFilial=${filialSigla}`)
      expect(r.statusCode, r.body).toBe(200)
    } finally {
      await prisma.usuario.update({ where: { id: eu }, data: { papelAdmin: antes } })
    }
  })

  /**
   * E o administrador escolhe — é o que faz o seletor do cabeçalho significar
   * alguma coisa nesta tela.
   */
  it('o administrador abre a gerência de outra loja pela visão', async () => {
    const antes = (await prisma.usuario.findUnique({ where: { id: eu } }))!.papelAdmin
    await prisma.usuario.update({ where: { id: eu }, data: { papelAdmin: 'ADMIN' } })
    try {
      const r = await listar(`?visaoNivel=N4&visaoFilial=${filialSigla}`)
      expect(r.statusCode, r.body).toBe(200)
      expect((r.json<{ gerencias: unknown[] }>()).gerencias.length).toBeGreaterThan(0)
    } finally {
      await prisma.usuario.update({ where: { id: eu }, data: { papelAdmin: antes } })
    }
  })

  it('sem filial no usuário, recusa em vez de devolver tudo', async () => {
    await prisma.usuario.update({ where: { id: eu }, data: { filialId: null } })
    try {
      const r = await listar()
      expect(r.statusCode).toBe(403)
    } finally {
      const f = await prisma.filial.findFirst({ where: { codigo: codEmpresa } })
      await prisma.usuario.update({ where: { id: eu }, data: { filialId: f!.id } })
    }
  })
})

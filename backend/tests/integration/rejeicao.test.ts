import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { exigirSeed } from '../helpers/seed.js'

/**
 * REJEITAR: devolver a contramedida a quem a passou (PLANO §7.58).
 *
 * O que este arquivo protege é a REGRA DE DESTINO. Rejeitar não é "mandar para
 * o nível de baixo" — é desfazer o último repasse —, e a diferença só aparece
 * em dois casos que o caminho comum não visita:
 *
 *  - §7.42, o N2 abre ação PARA o N4: não houve repasse nenhum, e "para baixo"
 *    não tem destino. O certo é voltar a quem abriu;
 *  - DIRECIONAMENTO, que troca de dono no MESMO nível: devolver para baixo
 *    mandaria a ação a um nível onde ela nunca esteve.
 *
 * Errar o destino não dá erro em tela: a ação simplesmente reaparece na lista
 * da pessoa errada, e quem a rejeitou acha que devolveu.
 *
 * Roda como um N3 PRÓPRIO deste arquivo, e não como o `f00001mle` da suíte:
 * rejeitar exige estar com a ação nas mãos, e o usuário do bypass é sempre o
 * mesmo — não dá para ele passar a bola e recebê-la. O env entra mockado, como
 * em `bypass-inativo.test.ts`, para não mexer no que os outros arquivos usam.
 */

const LOGIN_N3 = 'frejeicaon3'
const LOGIN_N4 = 'frejeicaon4'

vi.mock('../../src/config/env.js', async (original) => {
  const mod = await original<typeof import('../../src/config/env.js')>()
  return { ...mod, env: { ...mod.env, AUTH_DEV_BYPASS: true, AUTH_DEV_USUARIO: LOGIN_N3 } }
})

await exigirSeed()

const prisma = new PrismaClient()
let app: FastifyInstance

let filialId: string
let bucketN3: string
let idN3: string
let idN4: string

let seq = 0

/**
 * Monta a contramedida DIRETO NO BANCO, no estado exato que se quer testar.
 *
 * Pela API seria melhor, e não dá: as rotas agem sempre como o usuário do
 * bypass, e todo estado interessante aqui envolve DUAS pessoas — uma que passa
 * e outra que recebe. O que se fabrica é o estado que as rotas de escalação e
 * de abertura já produzem (elas têm teste próprio em `contramedidas.test.ts`);
 * o que se mede é só o destino da devolução.
 */
async function cenario(opts: {
  criadoPorId: string
  responsavelAtualId: string
  /** O repasse que colocou a ação na mão do responsável, se houve. */
  repasse?: { autorId: string; de: 'N2' | 'N3' | 'N4'; para: 'N2' | 'N3' | 'N4'; destinoId: string }
}) {
  seq += 1
  const c = await prisma.contramedida.create({
    data: {
      codigo: `RJ-${String(seq).padStart(4, '0')}`,
      titulo: 'Contramedida de teste da rejeição',
      filialId,
      nivelAtual: 'N3',
      bucketId: bucketN3,
      responsavelAtualId: opts.responsavelAtualId,
      criadoPorId: opts.criadoPorId,
      prazo: new Date('2026-09-30T00:00:00.000Z'),
      prioridade: 'ALTA',
      comentarioAbertura: 'Indicador vermelho. Contramedida: ajustar o processo.',
    },
  })
  if (opts.repasse) {
    await prisma.movimentacao.create({
      data: {
        contramedidaId: c.id,
        tipo: 'ESCALACAO',
        autorId: opts.repasse.autorId,
        nivelOrigem: opts.repasse.de,
        nivelDestino: opts.repasse.para,
        responsavelDestinoId: opts.repasse.destinoId,
        texto: 'Fora do meu alcance.',
      },
    })
  }
  return c.codigo
}

const rejeitar = (codigo: string, texto: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/contramedidas/${codigo}/rejeitar`,
    payload: { texto },
  })

const detalhe = async (codigo: string) => {
  const r = await app.inject({ method: 'GET', url: `/api/v1/contramedidas/${codigo}` })
  expect(r.statusCode, r.body).toBe(200)
  return r.json<{
    contramedida: {
      nivelAtual: string
      responsavel: string
      status: string
      prazo: string
      trilha: { nivel: string }[]
    }
    movimentacoes: { tipo: string; texto: string }[]
    permissoes: {
      podeRejeitar: boolean
      podeEscalar: boolean
      podeDirecionar: boolean
      podeConcluir: boolean
    }
  }>()
}

beforeAll(async () => {
  const [filial, bucket] = await Promise.all([
    prisma.filial.findFirst({ select: { id: true } }),
    prisma.bucket.findFirst({ where: { nivel: 'N3' }, select: { id: true } }),
  ])
  if (!filial || !bucket) throw new Error('Banco de teste sem seed suficiente. Rode o seed.')
  filialId = filial.id
  bucketN3 = bucket.id

  const n3 = await prisma.usuario.upsert({
    where: { loginErp: LOGIN_N3 },
    update: { ativo: true },
    create: {
      loginErp: LOGIN_N3,
      nome: 'N3 da rejeição',
      iniciais: 'NR3',
      cargo: 'Teste',
      nivel: 'N3',
      ativo: true,
      filialId: filial.id,
    },
  })
  const n4 = await prisma.usuario.upsert({
    where: { loginErp: LOGIN_N4 },
    update: { ativo: true },
    create: {
      loginErp: LOGIN_N4,
      nome: 'N4 da rejeição',
      iniciais: 'NR4',
      cargo: 'Teste',
      nivel: 'N4',
      ativo: true,
      filialId: filial.id,
    },
  })
  idN3 = n3.id
  idN4 = n4.id

  const { buildApp } = await import('../../src/app.js')
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  await prisma.movimentacao.deleteMany({ where: { contramedida: { codigo: { startsWith: 'RJ-' } } } })
  await prisma.contramedida.deleteMany({ where: { codigo: { startsWith: 'RJ-' } } })
  await prisma.usuario.deleteMany({ where: { loginErp: { in: [LOGIN_N3, LOGIN_N4] } } })
  await prisma.$disconnect()
})

describe('rejeitar', () => {
  it('devolve a quem ESCALOU, no nível de onde a ação veio', async () => {
    const codigo = await cenario({
      criadoPorId: idN4,
      responsavelAtualId: idN3,
      repasse: { autorId: idN4, de: 'N4', para: 'N3', destinoId: idN3 },
    })

    const r = await rejeitar(codigo, 'Isso é execução da área, não do setor.')
    expect(r.statusCode, r.body).toBe(204)

    const d = await detalhe(codigo)
    expect(d.contramedida.nivelAtual).toBe('N4')
    expect(d.contramedida.responsavel).toBe('N4 da rejeição')
    expect(d.movimentacoes.at(-1)).toMatchObject({
      tipo: 'REJEICAO',
      texto: 'Isso é execução da área, não do setor.',
    })
  })

  /*
   * A trilha é o que a reunião lê para ver a cadeia de ajuda. Se a rejeição
   * não virasse passo, a ação apareceria parada no N3 depois de já ter voltado
   * — e os dias seriam contados para quem não está mais com ela.
   */
  it('vira PASSO na trilha — sem isso os dias contam para a pessoa errada', async () => {
    const codigo = await cenario({
      criadoPorId: idN4,
      responsavelAtualId: idN3,
      repasse: { autorId: idN4, de: 'N4', para: 'N3', destinoId: idN3 },
    })
    const antes = await detalhe(codigo)
    expect(antes.contramedida.trilha.map((p) => p.nivel)).toEqual(['N4', 'N3'])

    expect((await rejeitar(codigo, 'Volta para a área.')).statusCode).toBe(204)

    const depois = await detalhe(codigo)
    expect(depois.contramedida.trilha.map((p) => p.nivel)).toEqual(['N4', 'N3', 'N4'])
  })

  /*
   * §7.42: o N2 abre para o N4 (aqui, o N4 abre para o N3). Não houve repasse,
   * então não há "nível de baixo" para devolver — o destino é quem abriu.
   */
  it('sem repasse, devolve a QUEM ABRIU — o caso do §7.42', async () => {
    const codigo = await cenario({ criadoPorId: idN4, responsavelAtualId: idN3 })

    expect((await rejeitar(codigo, 'Não é do meu setor.')).statusCode).toBe(204)

    const d = await detalhe(codigo)
    expect(d.contramedida.responsavel).toBe('N4 da rejeição')
    expect(d.contramedida.nivelAtual).toBe('N4')
  })

  it('a observação é OBRIGATÓRIA — devolver calado retém a informação', async () => {
    const codigo = await cenario({
      criadoPorId: idN4,
      responsavelAtualId: idN3,
      repasse: { autorId: idN4, de: 'N4', para: 'N3', destinoId: idN3 },
    })
    const r = await rejeitar(codigo, '')
    expect(r.statusCode).toBe(400)
  })

  /*
   * Quem abriu a ação para si mesmo não tem a quem devolver. O que se mede aqui
   * é que a PERMISSÃO já diz isso: botão que só serve para tomar 400 não deve
   * existir na tela — a mesma regra de `podeDarFeedback`.
   */
  it('ação aberta por mim para mim não pode ser rejeitada, e a permissão já avisa', async () => {
    const codigo = await cenario({ criadoPorId: idN3, responsavelAtualId: idN3 })

    const d = await detalhe(codigo)
    expect(d.permissoes.podeRejeitar).toBe(false)

    // 422, que e' o status de `DadosInvalidos` -- o mesmo de destino invalido
    // em escalar e direcionar.
    const r = await rejeitar(codigo, 'Tentando devolver para mim mesmo.')
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/nunca foi repassada/i)
  })

  it('a permissão liga quando há a quem devolver', async () => {
    const codigo = await cenario({ criadoPorId: idN4, responsavelAtualId: idN3 })
    const d = await detalhe(codigo)
    expect(d.permissoes.podeRejeitar).toBe(true)
  })

  /*
   * Devolver para uma conta desativada esconde a ação de todo mundo: ela fica
   * com um responsável que não entra no portal e sai das listas de quem poderia
   * agir. Recusar deixa a ação onde está — visível.
   */
  it('recusa devolver a quem foi desativado', async () => {
    const codigo = await cenario({ criadoPorId: idN4, responsavelAtualId: idN3 })
    await prisma.usuario.update({ where: { id: idN4 }, data: { ativo: false } })

    const r = await rejeitar(codigo, 'Volta para a área.')
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/não está mais ativo/i)

    await prisma.usuario.update({ where: { id: idN4 }, data: { ativo: true } })
  })

  it('não rejeita ação que não está com você', async () => {
    const codigo = await cenario({ criadoPorId: idN3, responsavelAtualId: idN4 })
    const r = await rejeitar(codigo, 'Não é minha.')
    // 404: quem não pode ver a ação não recebe confirmação de que ela existe.
    expect([403, 404]).toContain(r.statusCode)
  })

  /*
   * O STATUS `REJEITADA` (§7.69).
   *
   * Antes dele a ação devolvida voltava a aparecer como "em andamento" ou
   * "atrasada" -- indistinguível de uma que ninguém tocou. A rejeição só
   * existia na trilha, e trilha é detalhe: quem olha a LISTA não via.
   */
  it('depois de rejeitada, o status é REJEITADA', async () => {
    const codigo = await cenario({
      criadoPorId: idN4,
      responsavelAtualId: idN3,
      repasse: { autorId: idN4, de: 'N4', para: 'N3', destinoId: idN3 },
    })
    expect((await detalhe(codigo)).contramedida.status).toBe('EM_ANDAMENTO')

    expect((await rejeitar(codigo, 'Volta para a área.')).statusCode).toBe(204)

    expect((await detalhe(codigo)).contramedida.status).toBe('REJEITADA')
  })

  /*
   * A DECISÃO DO ANALISTA, 10/09/2026: rejeitada vem ANTES de atrasada.
   *
   * É a única exceção ao "atraso por último, e SEMPRE" do §7.5, e o custo foi
   * aceito de olhos abertos: a ação devolvida e vencida sai da conta de
   * atrasadas. O argumento é do GD -- ela está PARADA esperando alguém
   * retomá-la, e é isso que precisa aparecer na reunião.
   */
  it('rejeitada VENCE o atraso, e este teste guarda a escolha', async () => {
    const codigo = await cenario({
      criadoPorId: idN4,
      responsavelAtualId: idN3,
      repasse: { autorId: idN4, de: 'N4', para: 'N3', destinoId: idN3 },
    })
    /* Prazo no passado: sem a rejeição, esta ação seria ATRASADA. */
    await prisma.contramedida.update({
      where: { codigo },
      data: { prazo: new Date('2020-01-01') },
    })
    expect((await detalhe(codigo)).contramedida.status).toBe('ATRASADA')

    expect((await rejeitar(codigo, 'Volta, e está vencida.')).statusCode).toBe(204)

    expect((await detalhe(codigo)).contramedida.status).toBe('REJEITADA')
  })

  /*
   * REJEITAR FECHA A AÇÃO.
   *
   * Decisão do analista, 10/09/2026: *"depois que é rejeitado ele é fechada,
   * não pode mais fazer nada nela"*. É o segundo jeito de uma ação terminar, ao
   * lado da conclusão -- uma resolveu, a outra foi recusada por quem deveria
   * executá-la.
   *
   * A checagem mora em `podeAgir`, que é a porta de escalar, direcionar,
   * atualizar, concluir e rejeitar. Este teste percorre as cinco: uma delas
   * ficar de fora deixaria mexer numa ação encerrada, e nada na tela avisaria.
   */
  it('depois de rejeitada, NENHUM movimento é aceito', async () => {
    const codigo = await cenario({
      criadoPorId: idN3,
      responsavelAtualId: idN3,
      repasse: { autorId: idN4, de: 'N4', para: 'N3', destinoId: idN3 },
    })
    expect((await rejeitar(codigo, 'Volta para a área.')).statusCode).toBe(204)

    /* O bypass age como o N3, que era o responsável antes de devolver. */
    const tentativas = [
      ['atualizacoes', { texto: 'Ainda estou tratando disso.' }],
      ['escalar', { texto: 'Sobe de novo.', destino: 'N2' }],
      ['concluir', { texto: 'Considero resolvida.' }],
      ['rejeitar', { texto: 'Rejeito outra vez.' }],
    ] as const

    for (const [rota, payload] of tentativas) {
      const r = await app.inject({
        method: 'POST',
        url: `/api/v1/contramedidas/${codigo}/${rota}`,
        payload,
      })
      expect([400, 403, 404, 422], `${rota} deveria ser recusada, veio ${r.statusCode}`).toContain(
        r.statusCode,
      )
    }

    /* E continua rejeitada -- nenhuma das tentativas mudou o estado. */
    expect((await detalhe(codigo)).contramedida.status).toBe('REJEITADA')
  })

  it('as permissões fecham junto: a tela não desenha botão que o servidor recusa', async () => {
    const codigo = await cenario({
      criadoPorId: idN3,
      responsavelAtualId: idN3,
      repasse: { autorId: idN4, de: 'N4', para: 'N3', destinoId: idN3 },
    })
    expect((await rejeitar(codigo, 'Volta para a área.')).statusCode).toBe(204)

    const d = await detalhe(codigo)
    expect(d.permissoes).toMatchObject({
      podeEscalar: false,
      podeDirecionar: false,
      podeConcluir: false,
      podeRejeitar: false,
    })
  })
})

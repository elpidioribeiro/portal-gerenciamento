import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { exigirSeed } from '../helpers/seed.js'

/**
 * As rotas de carga: quem pode disparar, e o que é recusado antes de tocar o
 * Oracle.
 *
 * O executor em si NÃO é exercitado — ele consulta o Oracle, que está desligado
 * na suíte de propósito (ver `vitest.config.ts`). O que se testa é a camada que
 * decide: a trava de administrador, a validação de janela, e o 409 de carga
 * concorrente. São as recusas que, se falharem, deixam alguém apagar uma janela
 * inteira de indicador por acidente.
 */

/**
 * O Power Automate entra no mock junto com o Oracle.
 *
 * Sem isto, o teste que dispara `vendas` sai daqui e faz um `fetch` de verdade:
 * a promessa fica pendurada, `emAndamento` nunca solta, e TODOS os testes
 * seguintes levam 409. O sintoma não aponta o culpado -- foi assim que este
 * mock nasceu.
 */
vi.mock('../../src/lib/power-automate.js', () => ({
  consultarPowerBI: vi.fn(async () => {
    throw new Error('consultarPowerBI() não deveria ser chamado: o teste passou da validação.')
  }),
  endpointDa: vi.fn(() => 'https://exemplo.invalido/gatilho'),
}))

vi.mock('../../src/lib/oracle.js', () => ({
  // Nunca chamado nestes testes: toda recusa acontece antes. Se algum caso
  // chegar aqui, o erro aponta o teste que passou da validação sem querer.
  consultar: vi.fn(async () => {
    throw new Error('consultar() não deveria ser chamado: o teste passou da validação.')
  }),
  encerrarOracle: vi.fn(async () => {}),
  oracleRespondendo: vi.fn(async () => false),
}))

await exigirSeed()

const prisma = new PrismaClient()
let app: FastifyInstance

const LOGIN_SESSAO = process.env.AUTH_DEV_USUARIO ?? 'f00001mle'

async function tornarAdmin(admin: boolean) {
  await prisma.usuario.update({ where: { loginErp: LOGIN_SESSAO }, data: { papelAdmin: admin ? 'ADMIN' : 'NENHUM' } })
}

beforeAll(async () => {
  const { buildApp } = await import('../../src/app.js')
  app = await buildApp()
  await app.ready()
})

afterAll(async () => {
  await tornarAdmin(false)
  await app.close()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await tornarAdmin(true)
})

const post = (payload: object) =>
  app.inject({ method: 'POST', url: '/api/v1/admin/cargas', payload })

describe('quem pode disparar carga', () => {
  /**
   * Uma carga apaga e regrava janelas inteiras de indicador. Se a trava caísse,
   * qualquer N2 — toda a diretoria — poderia reescrever o painel.
   */
  it('nega para quem não é administrador', async () => {
    await tornarAdmin(false)
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/cargas' })).statusCode).toBe(403)
    expect((await post({ fonte: 'perdas', dias: 3 })).statusCode).toBe(403)
  })
})

describe('estado das cargas', () => {
  it('lista as fontes de origem Oracle com janela e horário', async () => {
    const d = (await app.inject({ method: 'GET', url: '/api/v1/admin/cargas' })).json()

    expect(d.fontes.map((f: { fonte: string }) => f.fonte)).toEqual([
      'perdas',
      'movimentacao',
      'vendas-linha',
      'vendedor-dia',
      'vendas',
      'nps',
    ])
    const perdas = d.fontes.find((f: { fonte: string }) => f.fonte === 'perdas')
    expect(perdas.janelaDias).toBe(730)
    expect(perdas.horario).toBe('03:15')
  })

  /**
   * Cada fonte reporta a data da SUA tabela.
   *
   * Era um ternário `perdas ? fatoPerdas : fatoMovimentacao`, e com duas fontes
   * funcionava. Com quatro, as duas novas herdariam a data da movimentação — e
   * o defeito é do tipo que não se vê: o painel mostraria uma data plausível
   * para uma fonte que talvez esteja parada há uma semana.
   *
   * Compara contra o banco, não contra data escrita à mão: a asserção continua
   * valendo quando a janela do seed mudar, e falha no instante em que alguém
   * ligar a fonte na tabela errada.
   */
  it('cada fonte reporta o último dia da sua própria tabela', async () => {
    const d = (await app.inject({ method: 'GET', url: '/api/v1/admin/cargas' })).json()
    const naTela = (nome: string) =>
      d.fontes.find((f: { fonte: string }) => f.fonte === nome).ultimoDiaComDado

    const doBanco = async (max: Promise<{ _max: { data: Date | null } }>) => {
      const r = await max
      return r._max.data ? r._max.data.toISOString().slice(0, 10) : null
    }

    expect(naTela('perdas')).toBe(await doBanco(prisma.fatoPerdas.aggregate({ _max: { data: true } })))
    expect(naTela('movimentacao')).toBe(
      await doBanco(prisma.fatoMovimentacao.aggregate({ _max: { data: true } })),
    )
    expect(naTela('vendas-linha')).toBe(
      await doBanco(prisma.fatoVendasLinha.aggregate({ _max: { data: true } })),
    )
    expect(naTela('vendedor-dia')).toBe(
      await doBanco(prisma.fatoVendaVendedor.aggregate({ _max: { data: true } })),
    )
  })

  /**
   * Só perdas e movimentação são agendadas PELO PORTAL.
   *
   * `vendas-linha` e `vendedor-dia` continuam no n8n. Se um dia entrarem em
   * `FONTES_AGENDADAS` sem sair do n8n, a mesma janela passa a ser carregada
   * duas vezes por dia por dois sistemas — e este teste é o que avisa.
   */
  /**
   * Todas as dez fontes são agendadas pelo portal desde §7.53.
   *
   * A lista já foi menor por uma premissa errada: acreditava-se que
   * `vendas-linha` e `vendedor-dia` continuavam no n8n, e elas estavam sem
   * agendador nenhum. Este teste existe para a próxima mudança na lista ser
   * deliberada -- se alguém tirar uma fonte daqui, tem de explicar quem passa a
   * carregá-la.
   */
  it('o portal agenda todas as fontes que sabe carregar', async () => {
    const d = (await app.inject({ method: 'GET', url: '/api/v1/admin/cargas' })).json()
    for (const f of d.fontes) expect(f.agendada, f.fonte).toBe(true)
  })

  /**
   * Em teste o agendamento é desligado — um `setTimeout` pendente segura o
   * processo e a suíte não termina. `proximo` nulo é o sinal de desligado, e a
   * tela usa exatamente isso para avisar.
   */
  it('reporta o agendamento como desligado na suíte', async () => {
    const d = (await app.inject({ method: 'GET', url: '/api/v1/admin/cargas' })).json()
    for (const f of d.fontes) expect(f.proximo).toBeNull()
  })

  /**
   * As fontes de cadastro vêm em lista PRÓPRIA, e não misturadas em `fontes`.
   *
   * Elas não têm janela, horário nem próximo disparo. Enfiá-las na mesma lista
   * obrigaria a inventar um valor para cada um desses campos — e a tela
   * desenharia um editor de horário para uma fonte que o portal não agenda,
   * que é exatamente o defeito que este projeto passou a semana consertando.
   */
  it('lista as fontes de cadastro à parte, sem janela', async () => {
    const d = (await app.inject({ method: 'GET', url: '/api/v1/admin/cargas' })).json()

    expect(d.cadastro.map((f: { fonte: string }) => f.fonte)).toEqual([
      'vendedor-area',
      'area-supervisor',
      'vendedor-situacao',
      'dias-uteis',
    ])
    // Nenhuma delas aparece entre as de janela.
    const janela = d.fontes.map((f: { fonte: string }) => f.fonte)
    for (const c of d.cadastro) expect(janela).not.toContain(c.fonte)
  })

  /**
   * A rota de cadastro RECUSA fonte de janela, e vice-versa.
   *
   * São dois contratos: um exige janela, o outro não a aceita. Se os dois
   * aceitassem qualquer fonte, disparar `perdas` pela rota de cadastro
   * carregaria a janela padrão sem ninguém ter pedido janela nenhuma.
   */
  it('cada rota só aceita as fontes que sabe carregar', async () => {
    const cadastroComJanela = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/cargas/cadastro',
      payload: { fonte: 'perdas' },
    })
    expect(cadastroComJanela.statusCode).toBe(400)

    const janelaComCadastro = await post({ fonte: 'dias-uteis', dias: 3 })
    expect(janelaComCadastro.statusCode).toBe(400)
  })

  /**
   * Vendas e NPS AGORA aparecem — e a inversão deste teste é a mudança.
   *
   * Ele afirmava o contrário: enquanto elas vinham do n8n, listá-las no painel
   * prometeria um controle que o portal não tinha. Desde §7.53 o portal as
   * carrega, e escondê-las seria esconder metade dos indicadores de quem
   * administra.
   */
  it('lista também as fontes do Power BI, que o portal passou a carregar', async () => {
    const d = (await app.inject({ method: 'GET', url: '/api/v1/admin/cargas' })).json()
    const nomes = d.fontes.map((f: { fonte: string }) => f.fonte)
    expect(nomes).toContain('vendas')
    expect(nomes).toContain('nps')
  })
})

describe('validação da janela', () => {
  it('recusa fonte que o portal não carrega', async () => {
    expect((await post({ fonte: 'inexistente', dias: 3 })).statusCode).toBe(400)
    // Cadastro tem rota própria: aqui é recusada por não ter janela.
    expect((await post({ fonte: 'dias-uteis', dias: 3 })).statusCode).toBe(400)
  })

  /**
   * `dias` e `de`/`ate` são modos alternativos. Aceitar os dois exigiria decidir
   * qual ganha, e qualquer escolha surpreenderia metade de quem chamasse.
   */
  it('recusa os dois modos juntos', async () => {
    const r = await post({ fonte: 'perdas', dias: 3, de: '2026-08-01', ate: '2026-08-03' })
    expect(r.statusCode).toBe(400)
    expect(r.body).toMatch(/OU o par/)
  })

  it('recusa nenhum dos dois modos', async () => {
    expect((await post({ fonte: 'perdas' })).statusCode).toBe(400)
  })

  it('recusa `de` sem `ate`', async () => {
    expect((await post({ fonte: 'perdas', de: '2026-08-01' })).statusCode).toBe(400)
  })

  it('recusa data fora do formato ISO', async () => {
    expect((await post({ fonte: 'perdas', de: '01/08/2026', ate: '03/08/2026' })).statusCode).toBe(
      400,
    )
  })

  it('recusa `de` depois de `ate`', async () => {
    const r = await post({ fonte: 'perdas', de: '2026-08-20', ate: '2026-08-01' })
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/depois de/)
  })

  /**
   * O teto é a retenção do portal: janela maior carregaria dado que o expurgo
   * apaga na mesma transação — trabalho de minutos jogado fora sem erro nenhum.
   */
  it('recusa janela acima da retenção', async () => {
    const porDatas = await post({ fonte: 'perdas', de: '2020-01-01', ate: '2026-08-20' })
    expect(porDatas.statusCode).toBe(422)
    expect(porDatas.json().erro).toMatch(/teto de perdas é 730/)

    // Pelo outro modo a recusa é do schema, antes de qualquer conta.
    expect((await post({ fonte: 'perdas', dias: 5000 })).statusCode).toBe(400)
  })

  /**
   * O teto da janela MANUAL é por fonte, e não é a retenção.
   *
   * Nasceu igual à retenção, quando o detalhe guardava 60 dias: pedir um ano
   * seria ACEITO e terminaria com sessenta dias no banco, porque o expurgo
   * apaga o resto na mesma transação.
   *
   * A retenção do detalhe subiu para 12–24 meses (§7.55), e o teto continua
   * existindo por outro motivo: dois anos de `vendas-linha` são ~3,9 milhões de
   * linhas e ~100 blocos de Oracle. Um pedido desses quase sempre é erro de
   * digitação na data, e o backfill de verdade se faz pelo script.
   */
  it('o teto da janela manual é por fonte', async () => {
    const detalhe = await post({ fonte: 'vendas-linha', de: '2024-01-01', ate: '2026-08-20' })
    expect(detalhe.statusCode).toBe(422)
    expect(detalhe.json().erro).toMatch(/teto de vendas-linha é 400/)

    // E o de perdas continua aceitando os dois anos que a retenção dela permite.
    const longa = await post({ fonte: 'perdas', dias: 700 })
    expect(longa.statusCode, longa.body).not.toBe(422)
  })

  it('recusa dias zero ou negativo', async () => {
    expect((await post({ fonte: 'perdas', dias: 0 })).statusCode).toBe(400)
    expect((await post({ fonte: 'perdas', dias: -7 })).statusCode).toBe(400)
  })
})

describe('registro do disparo', () => {
  /**
   * A auditoria é gravada ANTES de disparar, e é o que sobra quando a carga
   * falha: quem pediu, qual janela, quando. Sem isso, uma janela reescrita por
   * engano não tem como ser rastreada até a pessoa.
   *
   * O disparo em si falha aqui (Oracle mockado para recusar), e isso não afeta o
   * teste: a rota devolve 202 sem esperar o resultado, de propósito.
   */
  it('audita quem disparou e com qual janela', async () => {
    await prisma.auditLog.deleteMany({ where: { acao: 'DISPARAR_CARGA' } })

    const r = await post({ fonte: 'perdas', de: '2026-08-01', ate: '2026-08-03' })
    expect(r.statusCode).toBe(202)
    expect(r.json()).toMatchObject({ fonte: 'perdas', de: '2026-08-01', ate: '2026-08-03' })

    const log = await prisma.auditLog.findFirst({
      where: { acao: 'DISPARAR_CARGA' },
      orderBy: { criadoEm: 'desc' },
    })
    expect(log?.entidadeId).toBe('perdas')
    expect(log?.payload).toMatchObject({ de: '2026-08-01', ate: '2026-08-03' })

    await prisma.auditLog.deleteMany({ where: { acao: 'DISPARAR_CARGA' } })
  })

  /** A janela vem do SERVIDOR: quem chama manda `dias`, quem calcula é ele. */
  it('devolve a janela que calculou, não a que foi pedida', async () => {
    const r = await post({ fonte: 'movimentacao', dias: 3 })
    expect(r.statusCode).toBe(202)

    const { de, ate } = r.json()
    const dias = (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000 + 1
    expect(dias).toBe(3)

    // Termina em D-1, nunca hoje.
    const hoje = new Date().toISOString().slice(0, 10)
    expect(ate < hoje).toBe(true)

    await prisma.auditLog.deleteMany({ where: { acao: 'DISPARAR_CARGA' } })
  })

  /**
   * DOIS disparos em sequência, esperando a TRAVA soltar entre eles.
   *
   * A rota é 202 e não espera a carga; e só uma carga roda por vez
   * (`cargaEmAndamento`). Sem a espera, o segundo disparo cai na trava e recebe
   * 422 — sem `blocos` na resposta.
   *
   * O teste passava sem a espera por SORTE: nesta suíte não há Oracle, a carga
   * morria em milissegundos e a trava soltava antes do segundo `post`. Em
   * 10/09/2026 o caminho da falha ganhou uma ida ao banco (§7.64 — registrar a
   * falha em `sync_execucao`) e a corrida virou de lado.
   *
   * A trava não é o assunto daqui: este teste é sobre a CONTA de blocos e o
   * texto do aviso, os dois calculados antes de a carga começar. Esperar é o
   * que separa o que está sendo medido do que estava sendo tolerado.
   */
  const esperarTravaLivre = async () => {
    const { cargaEmAndamento } = await import('../../src/modules/carga/executar.js')
    for (let i = 0; i < 100 && cargaEmAndamento(); i++) {
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(cargaEmAndamento(), 'a carga anterior não soltou a trava em 5 s').toBe(false)
  }

  it('avisa quando a janela vai render mais de um bloco', async () => {
    const um = await post({ fonte: 'perdas', dias: 20 })
    expect(um.json().blocos).toBe(1)
    expect(um.json().aviso).toBeNull()

    await esperarTravaLivre()

    const varios = await post({ fonte: 'perdas', dias: 200 })
    expect(varios.statusCode, varios.body).toBe(202)
    expect(varios.json().blocos).toBe(7)
    expect(varios.json().aviso).toMatch(/7 blocos/)

    await esperarTravaLivre()
    await prisma.auditLog.deleteMany({ where: { acao: 'DISPARAR_CARGA' } })
  })
})

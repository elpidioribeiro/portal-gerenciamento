import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { exigirSeed } from '../helpers/seed.js'

/**
 * As rotas de administração.
 *
 * O catálogo de perfis vem do Oracle, e o Oracle está **desligado** no ambiente
 * de teste de propósito (ver `vitest.config.ts`): suíte que depende do banco da
 * empresa falha no CI e falha fora da rede. Então o módulo de consulta entra
 * mockado — o que sobra para testar é exatamente o que pode quebrar sem
 * ninguém notar: a trava de administrador, o cruzamento entre o catálogo de
 * fora e a classificação de dentro, e a substituição de conjunto.
 *
 * O `vi.mock` tem de vir antes do `buildApp`, e por isso o import da app é
 * dinâmico: um `import` estático no topo seria içado acima do mock e a rota
 * carregaria o módulo verdadeiro.
 */

const PERFIL_LIVRE = 900_001
const PERFIL_OUTRO = 900_002
/** Perfil que existe na view mas sem lotação — exercita o 404 de escopos. */
const PERFIL_SEM_ESCOPO = 900_003
const LOCAL = 'LOJA DE TESTE'

/*
 * SAIU: tres constantes de empresa (`EMPRESA_A = 1`, `EMPRESA_B`,
 * `EMPRESA_FORA = 99`) e o comentario que dizia que elas exercitavam "a
 * traducao codigo->sigla" e o caso "99 nao e' filial do GD, volta com sigla
 * nula".
 *
 * Nenhuma das tres era usada, e o mock de `listarPerfis` abaixo nao tem campo
 * de empresa nenhum -- essa cobertura nao existe mais. O comentario era a
 * metade pior: afirmava um cenario testado, e quem lesse confiaria nele.
 *
 * A empresa deixou de entrar na classificacao de perfil (PLANO 7.20, e o
 * cabecalho de `admin/routes.ts`: "a EMPRESA nao entra em nenhum dos tres").
 * Se a traducao codigo->sigla precisar de teste, ele nasce onde ela mora.
 */

vi.mock('../../src/modules/admin/perfis-oracle.js', () => ({
  listarPerfis: vi.fn(async () => [
    {
      idPerfil: PERFIL_LIVRE,
      cargos: ['CARGO A'],
      lotacoes: [LOCAL, 'OUTRA LOTACAO'],
      pessoas: 10,
      locais: 2,
    },
    {
      idPerfil: PERFIL_OUTRO,
      cargos: ['CARGO B', 'CARGO C'],
      lotacoes: ['LOTACAO B'],
      pessoas: 3,
      locais: 1,
    },
  ]),
  perfilExiste: vi.fn(
    async (id: number) => id === PERFIL_LIVRE || id === PERFIL_OUTRO || id === PERFIL_SEM_ESCOPO,
  ),
}))

await exigirSeed()

const prisma = new PrismaClient()
let app: FastifyInstance
let variaveis: string[]

/** Login do usuário que o bypass de desenvolvimento atende na suíte. */
const LOGIN_SESSAO = process.env.AUTH_DEV_USUARIO ?? 'f00001mle'

async function tornarAdmin(admin: boolean) {
  await prisma.usuario.update({ where: { loginErp: LOGIN_SESSAO }, data: { papelAdmin: admin ? 'ADMIN' : 'NENHUM' } })
}

beforeAll(async () => {
  const { buildApp } = await import('../../src/app.js')
  app = await buildApp()
  await app.ready()

  const vs = await prisma.variavelControle.findMany({ take: 3, orderBy: { nome: 'asc' } })
  variaveis = vs.map((v) => v.id)
  if (variaveis.length < 3) throw new Error('O seed precisa ter ao menos 3 variáveis de controle.')
})

afterAll(async () => {
  await prisma.perfilNivel.deleteMany({ where: { idPerfil: { in: [PERFIL_LIVRE, PERFIL_OUTRO, PERFIL_SEM_ESCOPO] } } })
  await tornarAdmin(false)
  await app.close()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.perfilNivel.deleteMany({ where: { idPerfil: { in: [PERFIL_LIVRE, PERFIL_OUTRO, PERFIL_SEM_ESCOPO] } } })
  // A auditoria também: ela é append-only por natureza, e sem limpar aqui o
  // teste que conta registros soma o que os testes anteriores gravaram.
  await prisma.auditLog.deleteMany({
    where: { entidadeId: { in: [String(PERFIL_LIVRE), String(PERFIL_OUTRO), String(PERFIL_SEM_ESCOPO)] } },
  })
  await tornarAdmin(true)
})

/**
 * Dois ramos em vez de espalhar o `payload` com spread condicional: as
 * sobrecargas do `inject` não aceitam a união que o spread produz, e o teste
 * compilaria só com `as any` — que esconderia erro de verdade na chamada.
 */
function pedir(method: 'GET' | 'PUT' | 'DELETE', url: string, payload?: object) {
  return payload === undefined
    ? app.inject({ method, url })
    : app.inject({ method, url, payload })
}

describe('a trava de administrador', () => {
  /**
   * A checagem é por coluna `admin`, não por nível: o administrador é N2, mas
   * nem todo N2 administra. Este teste é o que impede alguém "simplificar" a
   * guarda para `nivel === 'N2'` sem perceber o que está abrindo.
   */
  it('nega todas as rotas de /admin para quem não é admin, mesmo sendo N2', async () => {
    await tornarAdmin(false)
    const sessao = await prisma.usuario.findUnique({ where: { loginErp: LOGIN_SESSAO } })
    expect(sessao?.nivel).toBe('N2')

    for (const [metodo, url] of [
      ['GET', '/api/v1/admin/perfis'],
      ['GET', '/api/v1/admin/variaveis'],
      ['GET', '/api/v1/admin/visoes'],
      ['PUT', `/api/v1/admin/perfis/${PERFIL_LIVRE}`],
      ['DELETE', `/api/v1/admin/perfis/${PERFIL_LIVRE}`],
      // As rotas de matrícula entram na trava como as outras: nível próprio é
      // o cadastro mais poderoso do portal — ele vence o do cargo.
      ['GET', '/api/v1/admin/matriculas'],
      ['PUT', '/api/v1/admin/matriculas/990011'],
      ['DELETE', '/api/v1/admin/matriculas/990011'],
    ] as const) {
      const r = await pedir(metodo, url, metodo === 'PUT' ? { nivel: 'N2', descricao: 'x' } : undefined)
      expect(r.statusCode, `${metodo} ${url}`).toBe(403)
    }
  })

  it('libera para quem é admin', async () => {
    const r = await pedir('GET', '/api/v1/admin/perfis')
    expect(r.statusCode).toBe(200)
  })
})

describe('catálogo de perfis', () => {
  it('cruza o catálogo do RH com a classificação do portal', async () => {
    await pedir('PUT', `/api/v1/admin/perfis/${PERFIL_LIVRE}`, {
      nivel: 'N3',
      descricao: 'Cargo A classificado',
    })

    const d = (await pedir('GET', '/api/v1/admin/perfis')).json()
    const livre = d.perfis.find((p: { idPerfil: number }) => p.idPerfil === PERFIL_LIVRE)
    const outro = d.perfis.find((p: { idPerfil: number }) => p.idPerfil === PERFIL_OUTRO)

    expect(livre).toMatchObject({ nivel: 'N3', descricao: 'Cargo A classificado', ativo: true })
    expect(outro).toMatchObject({ nivel: null, descricao: null, ativo: false })
    // Perfil com mais de um cargo mantém a lista: `id_perfil` não é 1:1 com
    // cargo, e escolher um a esmo faria classificar a coisa errada.
    expect(outro.cargos).toEqual(['CARGO B', 'CARGO C'])
  })

  /**
   * O resumo é o que dimensiona o trabalho na tela. Contar bloqueado errado dá
   * a impressão de que falta pouco quando falta tudo.
   */
  it('conta bloqueados e as pessoas que eles representam', async () => {
    const antes = (await pedir('GET', '/api/v1/admin/perfis')).json().resumo
    expect(antes).toEqual({
      total: 2,
      classificados: 0,
      bloqueados: 2,
      pessoasBloqueadas: 13,
    })

    await pedir('PUT', `/api/v1/admin/perfis/${PERFIL_LIVRE}`, { nivel: 'N2', descricao: 'x' })

    const depois = (await pedir('GET', '/api/v1/admin/perfis')).json().resumo
    expect(depois).toEqual({
      total: 2,
      classificados: 1,
      bloqueados: 1,
      pessoasBloqueadas: 3,
    })
  })

  /**
   * Classificação desligada bloqueia o login igual a não ter classificação. A
   * tela tem de mostrar as duas do mesmo jeito, senão o administrador procura o
   * perfil na lista dos pendentes e não acha.
   */
  it('classificação inativa conta como bloqueada', async () => {
    await pedir('PUT', `/api/v1/admin/perfis/${PERFIL_LIVRE}`, {
      nivel: 'N2',
      descricao: 'desligada',
      ativo: false,
    })

    const d = (await pedir('GET', '/api/v1/admin/perfis')).json()
    const p = d.perfis.find((x: { idPerfil: number }) => x.idPerfil === PERFIL_LIVRE)
    expect(p.nivel).toBeNull()
    expect(p.ativo).toBe(false)
    // A descrição continua visível: é o que o administrador escreveu, e apagá-la
    // da resposta faria a reativação parecer um cadastro novo.
    expect(p.descricao).toBe('desligada')
    expect(d.resumo.bloqueados).toBe(2)
  })

  /**
   * A tabela aceita os seis níveis do modelo e esta API só escreve três. Um
   * INSERT por SQL pode ter deixado N1 lá, e N1 não tem tela — mostrar como
   * classificado esconderia um perfil que na prática está bloqueado.
   */
  it('nível sem tela no portal também conta como bloqueado', async () => {
    await prisma.perfilNivel.create({
      data: { idPerfil: PERFIL_LIVRE, nivel: 'N1', descricao: 'via SQL' },
    })

    const d = (await pedir('GET', '/api/v1/admin/perfis')).json()
    const p = d.perfis.find((x: { idPerfil: number }) => x.idPerfil === PERFIL_LIVRE)
    expect(p.nivel).toBeNull()
    expect(d.resumo.bloqueados).toBe(2)
  })

  it('recusa nível que o portal não atende', async () => {
    for (const nivel of ['N1', 'N5', 'CROSS', 'N9']) {
      const r = await pedir('PUT', `/api/v1/admin/perfis/${PERFIL_LIVRE}`, {
        nivel,
        descricao: 'x',
      })
      expect(r.statusCode, nivel).toBe(400)
    }
  })

  it('recusa perfil que não existe na view do RH', async () => {
    const r = await pedir('PUT', '/api/v1/admin/perfis/777777', { nivel: 'N2', descricao: 'x' })
    expect(r.statusCode).toBe(404)
    expect(r.json().erro).toMatch(/não existe na view do RH/)
  })

  it('registra a classificação na auditoria, com antes e depois', async () => {
    await pedir('PUT', `/api/v1/admin/perfis/${PERFIL_LIVRE}`, { nivel: 'N2', descricao: 'v1' })
    await pedir('PUT', `/api/v1/admin/perfis/${PERFIL_LIVRE}`, {
      nivel: 'N4',
      variaveis: [variaveis[0]!],
      descricao: 'v2',
    })

    const log = await prisma.auditLog.findMany({
      where: { entidade: 'perfil_nivel', entidadeId: String(PERFIL_LIVRE) },
      orderBy: { criadoEm: 'asc' },
    })
    expect(log).toHaveLength(2)

    const primeiro = log[0]!.payload as { antes: unknown; depois: { nivel: string } }
    const segundo = log[1]!.payload as { antes: { nivel: string }; depois: { nivel: string } }

    // Classificação nova: sem "antes". É o que distingue criação de mudança.
    expect(primeiro.antes).toBeNull()
    expect(primeiro.depois.nivel).toBe('N2')
    expect(segundo.antes.nivel).toBe('N2')
    expect(segundo.depois.nivel).toBe('N4')
  })

  /**
   * As variáveis são do N4, e são OBRIGATÓRIAS nele.
   *
   * Um N4 sem variável entra no portal, vê o quadro e clica sem efeito nenhum —
   * a marcação é recusada em silêncio, porque ele não responde por variável
   * alguma. É o defeito que só aparece na reunião, quando já é tarde.
   */
  it('recusa o N4 sem variável de controle', async () => {
    const r = await pedir('PUT', `/api/v1/admin/perfis/${PERFIL_LIVRE}`, {
      nivel: 'N4',
      variaveis: [],
      descricao: 'adjunto sem nada para marcar',
    })
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/ao menos uma variável/i)
    expect(await prisma.perfilNivel.findUnique({ where: { idPerfil: PERFIL_LIVRE } })).toBeNull()
  })

  /**
   * E recusa variáveis em quem não marca. Gravá-las para um N3 seria cadastro
   * que a resolução ignora — o administrador acharia que configurou algo.
   */
  it('recusa variáveis no N3, que não marca ponto de causa', async () => {
    const r = await pedir('PUT', `/api/v1/admin/perfis/${PERFIL_LIVRE}`, {
      nivel: 'N3',
      variaveis: [variaveis[0]!],
      descricao: 'gerente geral',
    })
    expect(r.statusCode).toBe(422)
    expect(r.json().erro).toMatch(/são do N4/i)
  })

  /**
   * A lista é SUBSTITUÍDA, não somada: o que não vier no corpo sai. Somar
   * faria a tela nunca conseguir tirar uma variável.
   */
  it('substitui o conjunto de variáveis do perfil', async () => {
    const url = `/api/v1/admin/perfis/${PERFIL_LIVRE}`
    await pedir('PUT', url, { nivel: 'N4', variaveis: [variaveis[0]!, variaveis[1]!], descricao: 'v1' })
    await pedir('PUT', url, { nivel: 'N4', variaveis: [variaveis[2]!], descricao: 'v2' })

    const d = (await pedir('GET', '/api/v1/admin/perfis')).json()
    const livre = d.perfis.find((p: { idPerfil: number }) => p.idPerfil === PERFIL_LIVRE)
    expect(livre.variaveis).toEqual([variaveis[2]])
  })

  /**
   * Tirar a classificação leva as variáveis junto, por cascata. Associação sem
   * nível não vale nada — sem nível a pessoa nem entra —, e sobrando ela
   * reapareceria se o perfil fosse reclassificado depois.
   */
  it('remover a classificação apaga as variáveis do perfil', async () => {
    await pedir('PUT', `/api/v1/admin/perfis/${PERFIL_OUTRO}`, {
      nivel: 'N4',
      variaveis: [variaveis[0]!],
      descricao: 'x',
    })
    await pedir('DELETE', `/api/v1/admin/perfis/${PERFIL_OUTRO}`)
    expect(await prisma.perfilVariavel.count({ where: { idPerfil: PERFIL_OUTRO } })).toBe(0)
  })

  /**
   * Remover a classificação do próprio perfil tranca o administrador fora na
   * requisição seguinte, porque o nível é resolvido a cada uma. A coluna `admin`
   * não salva — ela permite escolher a visão, não substitui a resolução.
   */
  it('remove a classificação de outro perfil', async () => {
    await pedir('PUT', `/api/v1/admin/perfis/${PERFIL_OUTRO}`, {
      nivel: 'N4',
      variaveis: [variaveis[0]!],
      descricao: 'x',
    })
    const r = await pedir('DELETE', `/api/v1/admin/perfis/${PERFIL_OUTRO}`)
    expect(r.statusCode).toBe(204)
    expect(await prisma.perfilNivel.findUnique({ where: { idPerfil: PERFIL_OUTRO } })).toBeNull()
  })

  it('não deixa o admin remover a classificação do próprio perfil', async () => {
    const eu = await prisma.usuario.findUnique({ where: { loginErp: LOGIN_SESSAO } })
    const perfilOriginal = eu?.idPerfil ?? null

    /**
     * O perfil do usuário da sessão passa a ser PERFIL_LIVRE, e ele é
     * classificado antes — o nível é resolvido a cada requisição, então sem a
     * classificação a própria chamada da rota já seria recusada, e o teste
     * passaria por 403 em vez de pelo 409 que interessa.
     */
    await prisma.perfilNivel.create({
      data: { idPerfil: PERFIL_LIVRE, nivel: 'N2', descricao: 'meu perfil' },
    })
    await prisma.usuario.update({
      where: { loginErp: LOGIN_SESSAO },
      data: { idPerfil: PERFIL_LIVRE },
    })

    try {
      const r = await pedir('DELETE', `/api/v1/admin/perfis/${PERFIL_LIVRE}`)
      expect(r.statusCode).toBe(409)
      expect(r.json().erro).toMatch(/seu próprio perfil/)

      // Continua lá: a recusa não pode apagar nada antes de recusar.
      expect(
        await prisma.perfilNivel.findUnique({ where: { idPerfil: PERFIL_LIVRE } }),
      ).not.toBeNull()
    } finally {
      await prisma.usuario.update({
        where: { loginErp: LOGIN_SESSAO },
        data: { idPerfil: perfilOriginal },
      })
    }
  })
})

/**
 * **O cadastro do N2**: matrícula a matrícula, e ela vence o perfil.
 *
 * Perfil é CARGO, e cargo nem sempre diz o papel no GD: Pedro Souto tem
 * `id_perfil` 11, associado a N3, e responde como N2. Sem esta tabela a saída
 * seria reclassificar o perfil 11 inteiro — levando junto todo mundo com aquele
 * cargo. Ver PLANO §7.20.
 */
describe('o N2, por matrícula', () => {
  const MATRICULA = 990011

  afterEach(async () => {
    await prisma.matriculaNivel.deleteMany({ where: { matricula: MATRICULA } })
  })

  /**
   * O nível NÃO vem no corpo: cadastrar a matrícula É cadastrar o N2. Este
   * teste é o que impede alguém devolver o campo ao corpo sem perceber que a
   * tela deixaria de ter uma forma só por nível.
   */
  it('cadastra a pessoa como N2 sem receber o nível', async () => {
    const r = await pedir('PUT', `/api/v1/admin/matriculas/${MATRICULA}`, { descricao: 'Exceção de teste' })
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json().nivel).toBe('N2')

    const salvo = await prisma.matriculaNivel.findUnique({ where: { matricula: MATRICULA } })
    expect(salvo?.nivel).toBe('N2')
  })

  it('reenviar sobrescreve, não duplica', async () => {
    await pedir('PUT', `/api/v1/admin/matriculas/${MATRICULA}`, { descricao: 'primeiro', })
    await pedir('PUT', `/api/v1/admin/matriculas/${MATRICULA}`, { descricao: 'segundo', })
    const todos = await prisma.matriculaNivel.findMany({ where: { matricula: MATRICULA } })
    expect(todos).toHaveLength(1)
    expect(todos[0]?.nivel).toBe('N2')
  })

  it('lista e remove', async () => {
    await pedir('PUT', `/api/v1/admin/matriculas/${MATRICULA}`, { descricao: 'x', })
    const lista = await pedir('GET', '/api/v1/admin/matriculas')
    expect(lista.json().matriculas.some((m: { matricula: number }) => m.matricula === MATRICULA)).toBe(
      true,
    )

    const r = await pedir('DELETE', `/api/v1/admin/matriculas/${MATRICULA}`)
    expect(r.statusCode).toBe(204)
    expect(await prisma.matriculaNivel.findUnique({ where: { matricula: MATRICULA } })).toBeNull()
  })

  /**
   * A mesma trava do perfil: tirar o próprio pode te trancar fora, e o nível é
   * resolvido a cada requisição — não há como reverter de dentro.
   */
  it('não deixa o admin remover a própria matrícula', async () => {
    const eu = await prisma.usuario.findUnique({ where: { loginErp: LOGIN_SESSAO } })
    const original = eu?.matricula ?? null
    try {
      await prisma.usuario.update({
        where: { loginErp: LOGIN_SESSAO },
        data: { matricula: MATRICULA },
      })
      await pedir('PUT', `/api/v1/admin/matriculas/${MATRICULA}`, { descricao: 'eu' })

      const r = await pedir('DELETE', `/api/v1/admin/matriculas/${MATRICULA}`)
      expect(r.statusCode).toBe(409)
      // Continua lá: a recusa não pode apagar nada antes de recusar.
      expect(await prisma.matriculaNivel.findUnique({ where: { matricula: MATRICULA } })).not.toBeNull()
    } finally {
      await prisma.usuario.update({
        where: { loginErp: LOGIN_SESSAO },
        data: { matricula: original },
      })
    }
  })
})

describe('visões oferecidas', () => {
  it('declara qual nível exige filial, para o front não repetir a regra', async () => {
    const d = (await pedir('GET', '/api/v1/admin/visoes')).json()
    /*
     * N3 passou a exigir filial em 27/08/2026: ele é o gerente geral DE LOJA,
     * não um nível corporativo. Só o N2 vê a rede inteira.
     */
    expect(d.niveis).toEqual([
      { nivel: 'N2', exigeFilial: false },
      { nivel: 'N3', exigeFilial: true },
      { nivel: 'N4', exigeFilial: true },
    ])
    expect(d.filiais).toHaveLength(9)
  })
})

describe('a âncora master, em /admin/acessos', () => {
  /*
   * A trava da âncora ficou ESTREITA em 21/09/2026 (§7.82 vizinha): o papel
   * master dela é imutável (é a garantia contra o portal ficar sem quem concede
   * acesso), mas o `recebe_acao` muda como o de qualquer um. O caso que motivou:
   * a própria conta âncora presa recebendo ação sem participar do GD.
   *
   * A sessão precisa ser MASTER para a rota aceitar (exigirMaster). E a âncora
   * (10001) não existe no seed, então é criada e apagada aqui.
   */
  const ANCORA = 10001
  const login = 'u10001abc-teste'

  async function comSessaoMaster() {
    await prisma.usuario.update({
      where: { loginErp: LOGIN_SESSAO },
      data: { papelAdmin: 'MASTER' },
    })
  }

  beforeEach(async () => {
    await comSessaoMaster()
    await prisma.usuario.deleteMany({ where: { matricula: ANCORA } })
    await prisma.usuario.create({
      data: {
        matricula: ANCORA,
        loginErp: login,
        nome: 'Ancora de Teste',
        iniciais: 'AT',
        cargo: 'TESTE',
        nivel: 'N2',
        // A coluna diz NENHUM de proposito: papelAdminDe deve computar MASTER
        // mesmo assim. E' o cenario real -- a linha nunca precisou dizer master.
        papelAdmin: 'NENHUM',
        recebeAcao: true,
        ativo: true,
      },
    })
  })

  afterEach(async () => {
    await prisma.usuario.deleteMany({ where: { matricula: ANCORA } })
    await tornarAdmin(true)
  })

  it('a âncora NÃO pode perder o papel master (o estado irreversível)', async () => {
    const r = await pedir('PUT', `/api/v1/admin/acessos/${ANCORA}`, {
      papelAdmin: 'NENHUM',
      recebeAcao: true,
    })
    expect(r.statusCode, r.body).toBe(422)
    // E a linha continua intacta.
    const depois = await prisma.usuario.findUnique({ where: { matricula: ANCORA } })
    expect(depois?.recebeAcao).toBe(true)
  })

  it('a âncora PODE sair da cadeia de ajuda (recebe_acao = false)', async () => {
    const r = await pedir('PUT', `/api/v1/admin/acessos/${ANCORA}`, {
      papelAdmin: 'MASTER',
      recebeAcao: false,
    })
    expect(r.statusCode, r.body).toBe(200)
    const corpo: { papelAdmin: string; recebeAcao: boolean } = r.json()
    // Continua MASTER (efetivo), e agora fora da cadeia.
    expect(corpo.papelAdmin).toBe('MASTER')
    expect(corpo.recebeAcao).toBe(false)

    const depois = await prisma.usuario.findUnique({ where: { matricula: ANCORA } })
    expect(depois?.recebeAcao).toBe(false)
  })

  it('o papel gravado da âncora NÃO é tocado — continua computado', async () => {
    await pedir('PUT', `/api/v1/admin/acessos/${ANCORA}`, {
      papelAdmin: 'MASTER',
      recebeAcao: false,
    })
    // A coluna segue NENHUM (nao se escreve na ancora); o master vem do codigo.
    const depois = await prisma.usuario.findUnique({ where: { matricula: ANCORA } })
    expect(depois?.papelAdmin).toBe('NENHUM')
  })
})

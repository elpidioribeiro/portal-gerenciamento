import { PrismaClient, type Usuario } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { veTodasAsFiliais, filtroDeFiliais, resolverVisao } from '../../src/modules/auth/escopo.js'
import { exigirSeed } from '../helpers/seed.js'

/**
 * A regra de escopo e a troca de visão do administrador.
 *
 * A regra é do usuário: **só o N2 vê todas as filiais; N3 e N4 veem a sua.** O que
 * este arquivo protege não é a regra em si — é o conjunto de recusas em volta
 * dela, porque cada uma delas, se falhar, falha em silêncio:
 *
 *  - um não administrador conseguindo trocar de visão veria dados de outro nível;
 *  - um N4 sem filial cadastrada caindo na visão corporativa seria promovido a
 *    diretoria por um campo em branco;
 *  - `visaoFilial` ignorado junto de N2 devolveria as 9 filiais para quem pediu
 *    uma, confirmando um entendimento errado da regra.
 *
 * Nenhum desses casos dá erro visível. Só teste pega.
 */

await exigirSeed()

const prisma = new PrismaClient()
let filialPal: string
/** Uma SEGUNDA filial, para o caso de "andar de lado" ter para onde andar. */
let filialGus: string

beforeAll(async () => {
  const f = await prisma.filial.findFirst({ where: { sigla: 'SUL' } })
  if (!f) throw new Error('Filial SUL não existe no banco de teste. Rode o seed.')
  filialPal = f.id

  const g = await prisma.filial.findFirst({ where: { sigla: 'CEN' } })
  if (!g) throw new Error('Filial CEN não existe no banco de teste. Rode o seed.')
  filialGus = g.id
})

afterAll(() => prisma.$disconnect())

/**
 * Usuário sintético. Não vai ao banco porque `resolverVisao` só consulta o
 * Prisma para traduzir a sigla da filial — o resto da decisão sai do usuário.
 */
function usuario(over: Partial<Usuario> = {}): Usuario {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    loginErp: 'f99999tst',
    matricula: null,
    // Usuário de teste nasce como quem já entrou: a carga não o criou.
    origemCarga: false,
    // Participa da cadeia de ajuda, que é o caso de quase todo mundo.
    recebeAcao: true,
    nome: 'Teste',
    iniciais: 'TT',
    cargo: 'Teste',
    idPerfil: null,
    nomloc: null,
    nivel: 'N2',
    filialId: null,
    bucketId: null,
    foto: null,
    senhaHash: null,
    papelAdmin: 'NENHUM',
    ativo: true,
    ...over,
  }
}

describe('quem vê todas as filiais', () => {
  /**
   * Mudou em 27/08/2026: o N3 saiu daqui.
   *
   * Ele é o gerente geral DE LOJA — a reunião dele é com os adjuntos da mesma
   * filial. Com a regra antiga ele abria o portal e via a rede inteira, sem
   * erro nenhum: a tela da diretoria servida a um gerente de loja.
   */
  it('só o N2 vê todas as filiais; N3 e N4 veem a sua', () => {
    expect(veTodasAsFiliais('N2')).toBe(true)
    expect(veTodasAsFiliais('N3')).toBe(false)
    expect(veTodasAsFiliais('N4')).toBe(false)
  })

  /**
   * O filtro é sempre aplicado e às vezes não restringe nada. É o que permite
   * `where: { ...outros, ...filtroDeFiliais(visao) }` sem `if` na rota — e um
   * `if` espalhado é o que se esquece.
   */
  it('o filtro corporativo é objeto vazio, não um filtro que casa com tudo', () => {
    expect(filtroDeFiliais({ nivel: 'N2', filialId: null, simulada: false })).toEqual({})
    expect(filtroDeFiliais({ nivel: 'N4', filialId: 'abc', simulada: false })).toEqual({
      id: 'abc',
    })
  })
})

describe('visão natural, sem pedido de troca', () => {
  it('N2 vê tudo', async () => {
    const v = await resolverVisao(prisma, usuario({ nivel: 'N2' }))
    expect(v).toEqual({ nivel: 'N2', filialId: null, simulada: false })
  })

  it('N4 vê a própria filial', async () => {
    const v = await resolverVisao(prisma, usuario({ nivel: 'N4', filialId: filialPal }))
    expect(v).toEqual({ nivel: 'N4', filialId: filialPal, simulada: false })
  })

  /**
   * O caso que motivou a checagem: cair na visão corporativa daria a alguém de
   * loja o painel inteiro da diretoria, e o sintoma seria nenhum.
   */
  it('N4 sem filial é recusado, não promovido a corporativo', async () => {
    await expect(resolverVisao(prisma, usuario({ nivel: 'N4', filialId: null }))).rejects.toThrow(
      /nenhuma filial está associada/,
    )
  })

  it('nível sem tela no portal é recusado', async () => {
    await expect(resolverVisao(prisma, usuario({ nivel: 'N1' }))).rejects.toThrow(/não tem tela/)
    await expect(resolverVisao(prisma, usuario({ nivel: 'CROSS' }))).rejects.toThrow(/não tem tela/)
  })
})

describe('troca de visão', () => {
  const admin = () => usuario({ papelAdmin: 'ADMIN', nivel: 'N2' })

  it('o administrador vê como N4 numa filial', async () => {
    const v = await resolverVisao(prisma, admin(), { visaoNivel: 'N4', visaoFilial: 'SUL' })
    expect(v).toEqual({ nivel: 'N4', filialId: filialPal, simulada: true })
  })

  it('o administrador vê como N3 numa filial — N3 também é visão de filial', async () => {
    const v = await resolverVisao(prisma, admin(), { visaoNivel: 'N3', visaoFilial: 'SUL' })
    expect(v).toEqual({ nivel: 'N3', filialId: filialPal, simulada: true })
  })

  it('N3 sem filial é recusado, como o N4', async () => {
    await expect(resolverVisao(prisma, admin(), { visaoNivel: 'N3' })).rejects.toThrow(
      /visão de filial/i,
    )
  })

  it('marca a visão como simulada, para a tela poder avisar', async () => {
    const v = await resolverVisao(prisma, admin(), { visaoNivel: 'N3', visaoFilial: 'SUL' })
    expect(v.simulada).toBe(true)
    // Mesmo escolhendo o próprio nível: quem está olhando precisa saber que o
    // seletor está ativo, senão não entende por que a tela não volta ao normal.
    const igual = await resolverVisao(prisma, admin(), { visaoNivel: 'N2' })
    expect(igual.simulada).toBe(true)
  })

  /**
   * **ESTREITAR É LIVRE; ALARGAR E ANDAR DE LADO EXIGEM ADMINISTRADOR** —
   * §7.63, 10/09/2026.
   *
   * Era `admin` para qualquer troca, e isso trancava o desdobramento que a
   * diretoria faz todo dia: a matriz do N2 aponta a célula, clicar nela abre a
   * reunião daquela loja, e o N2 do portal **não é administrador** (medido:
   * `n2-teste` tem `papelAdmin: 'NENHUM'`). A cadeia N2 → N3 → N4 parava na primeira
   * porta, com 403 em toda requisição da tela.
   *
   * A liberação não expõe dado novo — o N2 já lê o número das nove filiais na
   * matriz de onde clica —, e é isso que a torna segura. As três recusas abaixo
   * são o que sobrou da trava, e são elas que importam.
   */
  it('o N2 estreita para o N3 de uma filial sem ser administrador', async () => {
    const v = await resolverVisao(prisma, usuario({ nivel: 'N2', papelAdmin: 'NENHUM' }), {
      visaoNivel: 'N3',
      visaoFilial: 'SUL',
    })
    expect(v).toEqual({ nivel: 'N3', filialId: filialPal, simulada: true })
  })

  it('e segue estreitando para o N4 da mesma filial', async () => {
    const v = await resolverVisao(prisma, usuario({ nivel: 'N3', filialId: filialPal }), {
      visaoNivel: 'N4',
      visaoFilial: 'SUL',
    })
    expect(v.nivel).toBe('N4')
    expect(v.filialId).toBe(filialPal)
  })

  /**
   * ANDAR DE LADO continua fechado: é a loja de outra pessoa.
   *
   * É a recusa que a trava antiga existia para fazer, e a única das três que
   * protege dado que o pedinte não vê de outro jeito.
   */
  it('o N3 não vê a loja de outra pessoa, nem estreitando o nível', async () => {
    await expect(
      resolverVisao(prisma, usuario({ nivel: 'N3', filialId: filialGus }), {
        visaoNivel: 'N4',
        visaoFilial: 'SUL',
      }),
    ).rejects.toThrow(/estreitar a sua visão/)
  })

  it('o N3 não alarga para a visão corporativa', async () => {
    await expect(
      resolverVisao(prisma, usuario({ nivel: 'N3', filialId: filialPal }), { visaoNivel: 'N2' }),
    ).rejects.toThrow(/estreitar a sua visão/)
  })

  /**
   * O N4 é adjunto de UMA gerência; o quadro do N3 é a loja inteira. Subir um
   * degrau aqui alarga, mesmo sem sair da filial.
   */
  it('o N4 não alarga para o N3 da própria loja', async () => {
    await expect(
      resolverVisao(prisma, usuario({ nivel: 'N4', filialId: filialPal }), {
        visaoNivel: 'N3',
        visaoFilial: 'SUL',
      }),
    ).rejects.toThrow(/estreitar a sua visão/)
  })

  /**
   * Só a filial, sem o nível, é pedido MALFORMADO — e a resposta diz o que
   * falta, em vez de falar de permissão.
   *
   * A ordem das checagens mudou junto com a regra: a forma do pedido é
   * verificada antes de quem pode fazê-lo. Antes esta chamada respondia "só o
   * administrador", o que mandava procurar cadastro quando o problema era a
   * URL.
   */
  it('só a filial, sem o nível, pede o nível — não fala de permissão', async () => {
    await expect(
      resolverVisao(prisma, usuario({ papelAdmin: 'NENHUM' }), { visaoFilial: 'SUL' }),
    ).rejects.toThrow(/Informe visaoNivel/)
  })

  it('N4 exige filial', async () => {
    await expect(resolverVisao(prisma, admin(), { visaoNivel: 'N4' })).rejects.toThrow(
      /informe visaoFilial/,
    )
  })

  it('nível corporativo com filial é recusado, não ignorado', async () => {
    await expect(
      resolverVisao(prisma, admin(), { visaoNivel: 'N2', visaoFilial: 'SUL' }),
    ).rejects.toThrow(/corporativo e vê todas as filiais/)
  })

  it('nível inexistente é recusado', async () => {
    await expect(resolverVisao(prisma, admin(), { visaoNivel: 'N9' })).rejects.toThrow(
      /Visão inválida/,
    )
    // N1 existe no modelo mas não tem tela — a recusa vale igual.
    await expect(resolverVisao(prisma, admin(), { visaoNivel: 'N1' })).rejects.toThrow(
      /Visão inválida/,
    )
  })

  it('filial inexistente é recusada', async () => {
    await expect(
      resolverVisao(prisma, admin(), { visaoNivel: 'N4', visaoFilial: 'ZZZ' }),
    ).rejects.toThrow(/não existe ou está inativa/)
  })

  /**
   * `undefined` explícito tem de contar como ausência.
   *
   * Importa porque as rotas desestruturam a querystring e repassam os dois
   * campos sempre. Se `{ visaoNivel: undefined }` fosse lido como pedido de
   * troca, TODA requisição de não administrador viraria 403.
   */
  it('undefined nos dois campos é ausência de pedido, não pedido vazio', async () => {
    const v = await resolverVisao(prisma, usuario({ papelAdmin: 'NENHUM', nivel: 'N2' }), {
      visaoNivel: undefined,
      visaoFilial: undefined,
    })
    expect(v.simulada).toBe(false)
  })
})

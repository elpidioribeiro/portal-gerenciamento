import { PrismaClient, type Usuario } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NaoAutorizado } from '../../src/lib/erros.js'
import {
  NIVEIS_COM_ACESSO,
  resolverNivel,
  resolverNivelComAcesso,
  temAcessoAoPortal,
} from '../../src/modules/auth/nivel.js'

/**
 * Resolução do nível a partir do `id_perfil` corporativo.
 *
 * A propriedade que mais importa aqui é **falhar fechado**: um perfil que
 * ninguém mapeou não pode virar acesso de diretoria por omissão.
 */

const prisma = new PrismaClient()

const PERFIL_TESTE = 990001
const PERFIL_INATIVO = 990002
const PERFIL_CROSS = 990003

beforeAll(async () => {
  await prisma.perfilNivel.createMany({
    data: [
      { idPerfil: PERFIL_TESTE, nivel: 'N3', descricao: 'teste' },
      { idPerfil: PERFIL_INATIVO, nivel: 'N2', descricao: 'teste inativo', ativo: false },
      { idPerfil: PERFIL_CROSS, nivel: 'CROSS', descricao: 'teste cross' },
    ],
    skipDuplicates: true,
  })
})

afterAll(async () => {
  await prisma.perfilNivel.deleteMany({
    where: { idPerfil: { in: [PERFIL_TESTE, PERFIL_INATIVO, PERFIL_CROSS] } },
  })
  await prisma.$disconnect()
})

function usuarioFake(idPerfil: number | null, nivelCadastrado: Usuario['nivel'] = 'N4'): Usuario {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    loginErp: 'f99999tst',
    matricula: null,
    // Usuário de teste nasce como quem já entrou: a carga não o criou.
    origemCarga: false,
    // Participa da cadeia de ajuda, que é o caso de quase todo mundo.
    recebeAcao: true,
    nome: 'Teste',
    iniciais: 'TT',
    cargo: 'Teste',
    idPerfil,
    nomloc: null,
    nivel: nivelCadastrado,
    filialId: null,
    bucketId: null,
    foto: null,
    senhaHash: null,
    // Falso em todos os casos deste arquivo: o que se testa aqui é a resolução
    // de nível pelo id_perfil, e o admin escapa dela por definição.
    papelAdmin: 'NENHUM',
    ativo: true,
  }
}

describe('resolução de nível pelo id_perfil', () => {
  it('usa o mapeamento quando há id_perfil, ignorando o nível cadastrado', async () => {
    // O cadastro diz N4; o perfil corporativo diz N3. O corporativo vence.
    const nivel = await resolverNivel(prisma, usuarioFake(PERFIL_TESTE, 'N4'))
    expect(nivel).toBe('N3')
  })

  it('cai no nível cadastrado quando não há id_perfil (usuário do mock)', async () => {
    expect(await resolverNivel(prisma, usuarioFake(null, 'N2'))).toBe('N2')
  })

  it('NEGA perfil não mapeado — nunca cai num nível padrão', async () => {
    await expect(resolverNivel(prisma, usuarioFake(999999))).rejects.toThrow(
      NaoAutorizado,
    )
  })

  it('NEGA perfil mapeado porém inativo', async () => {
    await expect(resolverNivel(prisma, usuarioFake(PERFIL_INATIVO))).rejects.toThrow(NaoAutorizado)
  })

  it('a mensagem do erro cita o perfil, para o suporte saber o que cadastrar', async () => {
    await expect(resolverNivel(prisma, usuarioFake(987654))).rejects.toThrow(/987654/)
  })
})

describe('quem tem tela no portal', () => {
  it('N2, N3 e N4 têm acesso', () => {
    for (const n of NIVEIS_COM_ACESSO) expect(temAcessoAoPortal(n)).toBe(true)
  })

  it('N1, N5 e CROSS não têm', () => {
    for (const n of ['N1', 'N5', 'CROSS'] as const) expect(temAcessoAoPortal(n)).toBe(false)
  })

  it('perfil válido mas de nível sem tela é recusado no login', async () => {
    // CROSS existe no modelo (o handoff o usa em escalação), mas ninguém loga
    // com ele — a contramedida escalada continua com quem escalou.
    await expect(resolverNivelComAcesso(prisma, usuarioFake(PERFIL_CROSS))).rejects.toThrow(
      /CROSS.*não tem acesso/s,
    )
  })

  it('nível com tela passa por resolverNivelComAcesso', async () => {
    expect(await resolverNivelComAcesso(prisma, usuarioFake(PERFIL_TESTE))).toBe('N3')
  })
})

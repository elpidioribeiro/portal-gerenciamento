import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'

/**
 * Cria (ou atualiza) os três usuários de teste: um por nível atendido.
 *
 * Para que serve: conferir as três telas do GD sem depender de uma pessoa real
 * de cada nível — hoje há um N4 e um N3 no portal, e nenhum N2 que possa ser
 * usado à vontade.
 *
 *     n2-teste   corporativo, sem filial
 *     n3-teste   Norte
 *     n4-teste   Norte, gerência CONSTRUÇÃO
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A SENHA NÃO PASSA POR AQUI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ela vem de `SENHA_TESTE`, no ambiente, e o script só guarda o hash. Nada é
 * impresso, e nenhum valor padrão existe: sem a variável, os usuários são
 * criados SEM senha e só servem ao bypass.
 *
 *     REM cmd (o terminal deste projeto). Sem aspas: elas viram parte do valor.
 *     set SENHA_TESTE=...
 *     npx tsx --env-file=.env scripts/usuarios-de-teste.ts
 *     set SENHA_TESTE=
 *
 * Para tirá-los de circulação:
 *
 *     npx tsx --env-file=.env scripts/usuarios-de-teste.ts --remover
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COMO ELES ENTRAM
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Pela porta local (§7.40), que exige `AUTH_TESTE_LOCAL=true` no `.env`. Ela
 * alcança só quem tem `senha_hash`, e o login corporativo nunca grava esse
 * campo — nenhuma pessoa real passa por ela. É recusada no boot em produção.
 *
 * A filial na tela de login é ignorada para eles: usuário de teste não pertence
 * à API de loja nenhuma.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O NÍVEL SAI DO `id_perfil`, como no login de verdade
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Podiam nascer com `id_perfil` nulo e o nível gravado à mão — `resolverNivel`
 * aceita isso para o provedor mock. Mas aí o teste exercitaria um caminho que
 * a produção não usa, e é justamente a resolução de nível que a gente quer ver
 * funcionando. Com perfil real, quem testa vê o que a pessoa veria.
 *
 * O 18 não é decoração: é ele que faz o quadro do n4-teste abrir em CONSTRUÇÃO
 * (`gerenciaDoPerfil`), como o analista pediu.
 */

const prisma = new PrismaClient()

const PESSOAS = [
  {
    login: 'n2-teste',
    nome: 'N2 de Teste',
    cargo: 'Diretoria (teste)',
    idPerfil: 448,
    filial: null,
    iniciais: 'N2',
  },
  {
    login: 'n3-teste',
    nome: 'N3 de Teste',
    cargo: 'Gerência geral (teste)',
    idPerfil: 11,
    filial: 'NOR',
    iniciais: 'N3',
  },
  {
    login: 'n4-teste',
    nome: 'N4 de Teste',
    cargo: 'Gerência adjunta (teste)',
    /** 18 = CONSTRUÇÃO. É daqui que a gerência do quadro sai. */
    idPerfil: 18,
    filial: 'NOR',
    iniciais: 'N4',
  },
] as const

/**
 * `--remover` desativa os três, e NÃO os apaga.
 *
 * Apagar quebraria qualquer ação que eles tenham aberto ou recebido — a
 * contramedida aponta para o usuário, e a linha sumindo levaria a ação junto ou
 * deixaria uma FK órfã. Desativado, o login recusa e eles somem de toda lista de
 * destinatário; o histórico do que fizeram continua legível.
 *
 * A senha é apagada no mesmo movimento: sem `senha_hash`, a porta local
 * (§7.40) não os alcança mais nem se a chave for religada.
 */
async function remover() {
  for (const p of PESSOAS) {
    const u = await prisma.usuario.updateMany({
      where: { loginErp: p.login },
      data: { ativo: false, senhaHash: null },
    })
    console.log(`  ${u.count > 0 ? 'desativado' : 'não existia'}  ${p.login}`)
  }
  console.log(`
  Eles continuam no banco, inativos, porque podem ter ação aberta ou recebida.
  Para fechar a porta de vez, tire AUTH_TESTE_LOCAL do .env.
`)
}

async function main() {
  if (process.argv.includes('--remover')) return remover()

  const senha = process.env.SENHA_TESTE?.trim()
  const hash = senha ? await argon2.hash(senha, { type: argon2.argon2id }) : null

  for (const p of PESSOAS) {
    const filial = p.filial
      ? await prisma.filial.findFirst({ where: { sigla: p.filial }, select: { id: true } })
      : null
    if (p.filial && !filial) throw new Error(`Filial ${p.filial} não existe no portal.`)

    const perfil = await prisma.perfilNivel.findUnique({ where: { idPerfil: p.idPerfil } })
    if (!perfil?.ativo) {
      throw new Error(
        `id_perfil ${String(p.idPerfil)} não está classificado num nível do GD. ` +
          'Classifique-o na tela de administração antes de criar o usuário de teste.',
      )
    }

    const dados = {
      nome: p.nome,
      iniciais: p.iniciais,
      cargo: p.cargo,
      idPerfil: p.idPerfil,
      nivel: perfil.nivel,
      filialId: filial?.id ?? null,
      ativo: true,
      /*
       * `origemCarga: false` -- estes não vieram da carga, e ela não pode
       * desativá-los numa desclassificação de perfil.
       */
      origemCarga: false,
      /* Só sobrescreve a senha quando uma nova foi informada. */
      ...(hash ? { senhaHash: hash } : {}),
    }

    const existia = await prisma.usuario.findUnique({ where: { loginErp: p.login } })
    const u = existia
      ? await prisma.usuario.update({ where: { id: existia.id }, data: dados })
      : await prisma.usuario.create({ data: { loginErp: p.login, ...dados } })

    console.log(
      `  ${existia ? 'atualizado' : 'criado'}  ${p.login.padEnd(9)} ${u.nivel}  ` +
        `perfil ${String(p.idPerfil).padEnd(4)} ${p.filial ?? 'corporativo'}` +
        (hash ? '  (senha definida)' : '  (SEM senha — só pelo bypass)'),
    )
  }

  console.log(`
  Para entrar com senha, ponha no backend/.env:

      AUTH_TESTE_LOCAL=true

  e reinicie o backend. A filial escolhida na tela de login é ignorada para
  eles. A chave é recusada no boot com NODE_ENV=production.

  Sem SENHA_TESTE no ambiente, ninguém ganhou senha: use o bypass
  (AUTH_DEV_USUARIO=n3-teste) ou rode de novo com a variável.
`)
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())

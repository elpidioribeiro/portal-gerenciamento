import argon2 from 'argon2'
import { PrismaClient } from '@prisma/client'
import { env } from '../src/config/env.js'

/**
 * Dá SENHA LOCAL a um usuário, para ele entrar sem passar pela API corporativa.
 *
 * É a "porta local" de `ErpAuthProvider` (§7.40): quem tem `senha_hash` entra
 * por senha do portal, e o caminho corporativo **nunca grava esse campo**. Este
 * script é o único jeito de gravá-lo fora do seed.
 *
 * **Serve para desenvolvimento, e só.** `AUTH_TESTE_LOCAL` não é honrada em
 * produção — `validarEnv` derruba o boot. Se a pessoa precisa do portal de
 * verdade, o caminho é o login ERP dela funcionar na API da loja, não isto.
 *
 * **A SENHA VEM DO AMBIENTE, não de argumento.** Argumento de linha de comando
 * aparece no `tasklist` para quem estiver na máquina; é a mesma regra que a
 * esteira de revisão aplica aos painéis. A senha não é impressa em lugar
 * nenhum, nem em caso de erro.
 *
 * Uso:
 *
 *   SENHA_LOCAL='...' npx tsx --env-file=.env scripts/senha-local.ts 28769
 *
 * O argumento é a MATRÍCULA, e não o login: é justamente o login que costuma
 * ser desconhecido quando se precisa disto. Opcionalmente, um segundo argumento
 * troca o `login_erp` da pessoa — o que ela vai digitar na tela.
 */
async function main() {
  if (env.ehProducao) {
    throw new Error(
      'Este script não roda em produção: a porta local não é honrada lá, e gravar ' +
        'senha_hash numa base de produção só cria um campo que ninguém usa e todo mundo teme.',
    )
  }

  const matricula = Number(process.argv[2])
  const novoLogin = process.argv[3]?.trim().toLowerCase()
  const senha = process.env.SENHA_LOCAL

  if (!Number.isInteger(matricula)) {
    throw new Error('Informe a MATRÍCULA: npx tsx scripts/senha-local.ts 28769')
  }
  if (!senha || senha.length < 8) {
    throw new Error('Defina SENHA_LOCAL no ambiente, com ao menos 8 caracteres.')
  }

  const prisma = new PrismaClient()
  const usuario = await prisma.usuario.findUnique({
    where: { matricula },
    select: { id: true, loginErp: true, nome: true, nivel: true, ativo: true, idPerfil: true },
  })
  if (!usuario) {
    throw new Error(
      `Nenhum usuário com a matrícula ${String(matricula)}. Ele precisa existir — a carga de ` +
        'usuários cria as pessoas do escopo do GD.',
    )
  }

  /*
   * O nível vem do `id_perfil`, resolvido a cada requisição. Avisar aqui evita
   * a descoberta pela tela: a pessoa entra e leva "perfil não mapeado", que é
   * outra coisa e manda procurar no lugar errado.
   */
  const perfil =
    usuario.idPerfil === null
      ? null
      : await prisma.perfilNivel.findUnique({ where: { idPerfil: usuario.idPerfil } })

  const hash = await argon2.hash(senha, { type: argon2.argon2id })
  const atualizado = await prisma.usuario.update({
    where: { id: usuario.id },
    data: {
      senhaHash: hash,
      ativo: true,
      ...(novoLogin ? { loginErp: novoLogin, origemCarga: false } : {}),
    },
    select: { loginErp: true, nome: true },
  })

  console.log(`senha local gravada para ${atualizado.nome}`)
  console.log(`  login para digitar na tela: ${atualizado.loginErp}`)
  console.log(`  filial na tela: qualquer uma das 9 lojas — a porta local não olha a filial`)
  console.log(
    `  nível: ${perfil ? `${perfil.nivel} (perfil ${String(usuario.idPerfil)})` : 'SEM PERFIL MAPEADO — vai levar recusa no login'}`,
  )
  console.log('')
  console.log('LEMBRE: isto só vale onde AUTH_TESTE_LOCAL=true. Em produção o boot recusa.')
  console.log(
    'E note que a porta local passou a alcançar uma pessoa REAL — o comentário de',
  )
  console.log(
    '`ErpAuthProvider` diz que ela nunca alcança, e isso deixa de valer nesta base.',
  )

  await prisma.$disconnect()
}

void main().catch((e: unknown) => {
  //  Só a mensagem: a pilha do Prisma pode trazer o objeto `data` do update.
  console.error((e as Error).message)
  process.exit(1)
})

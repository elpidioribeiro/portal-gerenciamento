import { PrismaClient } from '@prisma/client'

/**
 * Tira a senha e desativa os usuários criados pelo seed.
 *
 * O seed cria 16 pessoas fictícias — Marcos Leite, Helena Braga… — todas N2 ou
 * N3, todas com a senha de `SEED_SENHA_PADRAO`, cujo padrão é `portalgd` e está
 * escrito no `.env.example`, versionado no Git. Em desenvolvimento local isso é
 * o ponto: dá para logar sem a API corporativa.
 *
 * Vira problema quando o banco sai da máquina. Foi o que aconteceu em 22/08/2026,
 * ao copiar o banco local para o Postgres do servidor: as 16 contas foram junto,
 * ativas, num banco alcançável pela rede da empresa. Com `AUTH_PROVIDER=mock` —
 * o único modo que funciona enquanto o `ErpAuthProvider` não existe — quem
 * lesse o repositório entrava como diretoria.
 *
 * O critério é `senhaHash != null`. É o marcador honesto: quem vem da API
 * corporativa **nunca** tem senha no portal, porque quem autentica é a ERP. Ter
 * hash aqui significa, por construção, que veio do seed.
 *
 * O que NÃO é tocado:
 *
 * - o administrador, mesmo que tivesse senha — desativá-lo trancaria a
 *   administração pela própria aplicação;
 * - as ocorrências de Pareto que referenciam esses usuários. Desativar em vez de
 *   apagar preserva a chave estrangeira e mantém a operação reversível.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/neutralizar-seed.ts          # mostra o que faria
 *   npx tsx --env-file=.env scripts/neutralizar-seed.ts --aplicar
 */

const prisma = new PrismaClient()

async function main() {
  const aplicar = process.argv.includes('--aplicar')

  const alvos = await prisma.usuario.findMany({
    where: { senhaHash: { not: null }, papelAdmin: 'NENHUM' },
    orderBy: { loginErp: 'asc' },
  })

  const protegidos = await prisma.usuario.findMany({
    where: { senhaHash: { not: null }, papelAdmin: 'ADMIN' },
  })

  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://?/')
  console.log(`  banco: ${url.hostname}/${url.pathname.replace(/^\//, '')}`)
  console.log(`  ${alvos.length} usuário(s) com senha do seed:\n`)

  for (const u of alvos) {
    console.log(
      `    ${u.loginErp.padEnd(12)} ${u.nome.padEnd(24)} ${u.nivel}  ${u.ativo ? 'ativo' : 'inativo'}`,
    )
  }

  if (protegidos.length > 0) {
    console.log(`\n  ${protegidos.length} administrador(es) preservado(s):`)
    for (const u of protegidos) console.log(`    ${u.loginErp} — não será tocado`)
  }

  if (alvos.length === 0) {
    console.log('\n  Nada a fazer: nenhum usuário do seed com senha neste banco.')
    return
  }

  if (!aplicar) {
    console.log('\n  SECO — nada foi alterado. Repita com --aplicar para executar.')
    console.log('  O que faria: senhaHash = null e ativo = false nos usuários acima.')
    return
  }

  const r = await prisma.usuario.updateMany({
    where: { id: { in: alvos.map((u) => u.id) } },
    data: { senhaHash: null, ativo: false },
  })

  console.log(`\n  ${r.count} usuário(s) sem senha e desativado(s).`)

  /**
   * Confere no banco em vez de confiar no retorno do `updateMany`.
   *
   * O que falha aqui é uma conta continuar logando com senha pública, e isso não
   * dá sintoma nenhum — ninguém percebe até alguém entrar.
   */
  const restantes = await prisma.usuario.count({ where: { senhaHash: { not: null }, papelAdmin: 'NENHUM' } })
  if (restantes > 0) {
    throw new Error(`Ainda restam ${restantes} usuário(s) com senha. A neutralização NÃO fechou.`)
  }
  console.log('  Conferido: nenhum usuário não-administrador tem senha neste banco.')
}

main()
  .catch((e: unknown) => {
    console.error(`\n${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

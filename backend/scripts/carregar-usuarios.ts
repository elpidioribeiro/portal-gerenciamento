/**
 * Roda a carga de usuários para as classificações que JÁ existem.
 *
 * A carga normalmente dispara sozinha, quando o administrador classifica um
 * perfil na tela (§7.33). Este script existe para o caso que aquele gatilho não
 * cobre: os perfis classificados ANTES de a carga existir — ninguém vai
 * reclassificá-los só para disparar o efeito.
 *
 * Simula por padrão. `--aplicar` grava.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { encerrarOracle } from '../src/lib/oracle.js'
import { pessoasDoPerfil, sincronizarUsuariosDoPerfil } from '../src/modules/admin/carga-usuarios.js'

const aplicar = process.argv.includes('--aplicar')
const prisma = new PrismaClient()

const perfis = await prisma.perfilNivel.findMany({
  where: { ativo: true },
  orderBy: { idPerfil: 'asc' },
})
console.log(`${perfis.length} perfis classificados e ativos.\n`)

let total = 0
for (const p of perfis) {
  if (aplicar) {
    const r = await sincronizarUsuariosDoPerfil(prisma, p.idPerfil, p.nivel)
    total += r.criados
    console.log(
      `  perfil ${String(p.idPerfil).padEnd(5)} ${p.nivel}  ` +
        `criados=${r.criados} atualizados=${r.atualizados} reativados=${r.reativados}` +
        (r.semFilial > 0 ? `  SEM FILIAL: ${r.semFilial}` : ''),
    )
  } else {
    const pessoas = await pessoasDoPerfil(p.idPerfil)
    total += pessoas.length
    console.log(`  perfil ${String(p.idPerfil).padEnd(5)} ${p.nivel}  ${pessoas.length} pessoas`)
  }
}

console.log(
  aplicar
    ? `\n${total} usuários criados.`
    : `\n${total} pessoas seriam sincronizadas. Rode com --aplicar para gravar.`,
)

await prisma.$disconnect()
await encerrarOracle()

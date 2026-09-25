import type { PrismaClient } from '@prisma/client'

/**
 * Mapeamento `id_perfil` do sistema corporativo → nível do GD.
 *
 * Correspondência definida pelo usuário:
 *   N2 ← gerente corporativo / diretoria
 *   N3 ← GR1
 *   N4 ← gerente adjunto
 *
 * CROSS existe no modelo e é usado em escalação; N1 e N5 saíram da hierarquia
 * em 24/08/2026 e ficaram reservados no enum. Ninguém loga com esses perfis.
 * Por isso não aparecem aqui: perfil ausente nega o acesso.
 *
 * Adicionar um cargo novo é acrescentar uma linha, sem deploy.
 */
const PERFIS = [
  // ── N2 — corporativo / diretoria ──────────────────────────────────────────
  { idPerfil: 34, nivel: 'N2', descricao: 'Gerente Corporativo de Prev e Perdas' },
  { idPerfil: 3224, nivel: 'N2', descricao: 'Gerente Corporativo de Operações' },
  { idPerfil: 1465, nivel: 'N2', descricao: 'Gerente Corp de Integração de Estoques' },
  // Diretoria é N2 no handoff (Marcos Leite = "Diretoria Operações");
  // N1 é a Vice-presidência.
  { idPerfil: 342, nivel: 'N2', descricao: 'Diretor de Operações Corporativo' },

  // ── N3 — GR1 ──────────────────────────────────────────────────────────────
  // Aguardando os id_perfil (PLANO.md seção 15).

  // ── N4 — gerente adjunto ──────────────────────────────────────────────────
  // Aguardando os id_perfil (PLANO.md seção 15).
] as const

export async function semearPerfis(prisma: PrismaClient) {
  for (const p of PERFIS) {
    /*
     * Uma linha por `id_perfil`. Todos aqui são N2, e o N2 não leva variáveis
     * de controle: quem marca ponto de causa é o N4. Ver PLANO §7.20.
     */
    await prisma.perfilNivel.upsert({
      where: { idPerfil: p.idPerfil },
      update: { nivel: p.nivel, descricao: p.descricao },
      create: { idPerfil: p.idPerfil, nivel: p.nivel, descricao: p.descricao },
    })
  }

  const porNivel = PERFIS.reduce<Record<string, number>>((acc, p) => {
    acc[p.nivel] = (acc[p.nivel] ?? 0) + 1
    return acc
  }, {})
  const resumo = Object.entries(porNivel)
    .map(([n, q]) => `${n}: ${q}`)
    .join(' · ')
  console.log(`  perfil_nivel: ${PERFIS.length} perfis (${resumo}) — N3 e N4 pendentes`)
}

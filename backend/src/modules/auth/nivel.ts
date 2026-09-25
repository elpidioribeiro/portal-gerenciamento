import type { Nivel, PrismaClient, Usuario } from '@prisma/client'
import { NaoAutorizado } from '../../lib/erros.js'

/**
 * Níveis que têm tela no portal. Quem não estiver aqui não entra — o modelo
 * conhece CROSS, usado em escalação e contramedidas, e ainda guarda N1 e N5,
 * que saíram da hierarquia em 24/08/2026 e ficaram reservados no enum. Ninguém
 * loga com nenhum dos três.
 */
export const NIVEIS_COM_ACESSO = ['N2', 'N3', 'N4'] as const satisfies readonly Nivel[]

/**
 * Níveis que a API pode devolver.
 *
 * Mais amplo que `NIVEIS_COM_ACESSO` por causa de um caminho só: o bypass de
 * desenvolvimento entrega o usuário sem passar pela resolução de nível, e o
 * seed cria pessoas em CROSS. Fora dele, ninguém em CROSS loga.
 *
 * `N1` e `N5` ficam de fora: saíram da hierarquia em 24/08/2026 e continuam no
 * enum do banco apenas porque removê-los custaria recriar o tipo e reescrever
 * seis colunas.
 */
export const NIVEIS_NA_API = ['N2', 'N3', 'N4', 'CROSS'] as const satisfies readonly Nivel[]
export type NivelNaApi = (typeof NIVEIS_NA_API)[number]

/**
 * Estreita o nível do banco para o que o contrato promete, e **falha alto**
 * quando não dá.
 *
 * Um usuário em N1 ou N5 não deveria existir: o login recusa os dois. Chegar
 * aqui com um significa dado inconsistente — e a resposta certa é 500 com log,
 * não devolver o valor assim mesmo nem trocá-lo por um plausível. As duas
 * alternativas entregariam uma tela que funciona mostrando a hierarquia errada,
 * que é o defeito mais caro de descobrir.
 */
export function nivelNaApi(nivel: Nivel): NivelNaApi {
  const permitidos: readonly Nivel[] = NIVEIS_NA_API
  if (permitidos.includes(nivel)) return nivel as NivelNaApi
  throw new Error(
    `Usuário com nível "${nivel}", que saiu da hierarquia e não tem representação na API. ` +
      'Corrija o cadastro: o nível precisa ser um de ' +
      `${NIVEIS_NA_API.join(', ')}.`,
  )
}

export type NivelComAcesso = (typeof NIVEIS_COM_ACESSO)[number]

export function temAcessoAoPortal(nivel: Nivel): nivel is NivelComAcesso {
  return (NIVEIS_COM_ACESSO as readonly Nivel[]).includes(nivel)
}

/**
 * Resolve o nível efetivo do usuário.
 *
 * `id_perfil` é a fonte da verdade quando existe: o nível é do sistema
 * corporativo, não do cadastro do portal. Resolver a cada requisição (em vez de
 * confiar no `usuario.nivel` gravado) faz com que uma correção no mapeamento
 * valha na hora — inclusive um rebaixamento, que é o caso em que o atraso
 * importaria.
 *
 * Falha fechada em duas situações, ambas de propósito:
 *  - perfil não mapeado, ou mapeado e inativo;
 *  - nível sem tela no portal (N1, N5, CROSS).
 */
/**
 * O nível da pessoa, em duas tentativas e nesta ordem:
 *
 *   1. a MATRÍCULA, se cadastrada e ativa — **vence sempre**
 *   2. o `id_perfil`
 *
 * A matrícula é o cadastro do N2, e ela vence porque perfil é CARGO, e cargo
 * nem sempre diz o papel no GD: Pedro Souto tem `id_perfil` 11, associado a N3,
 * e responde como N2. A alternativa seria reclassificar o perfil 11 inteiro,
 * levando junto todo mundo com aquele cargo. Ver PLANO §7.20.
 *
 * **Sem mescla.** Se a matrícula está cadastrada, é aquela linha que responde —
 * o perfil deixa de ser consultado, inclusive para as variáveis: quem é N2 não
 * marca ponto de causa.
 */
export async function resolverNivel(prisma: PrismaClient, usuario: Usuario): Promise<Nivel> {
  if (usuario.matricula !== null) {
    const daPessoa = await prisma.matriculaNivel.findUnique({
      where: { matricula: usuario.matricula },
    })
    if (daPessoa?.ativo) return daPessoa.nivel
  }

  if (!usuario.idPerfil) {
    // Usuário do MockAuthProvider: não vem do sistema corporativo, então o
    // nível cadastrado é tudo o que existe.
    return usuario.nivel
  }

  const perfil = await prisma.perfilNivel.findUnique({ where: { idPerfil: usuario.idPerfil } })

  if (!perfil || !perfil.ativo) {
    throw new NaoAutorizado(
      `O perfil ${usuario.idPerfil} não está mapeado para um nível do ` +
        'Gerenciamento Diário. Procure o administrador do portal.',
    )
  }

  return perfil.nivel
}

/** Resolve o nível e recusa quem não tem tela. */
export async function resolverNivelComAcesso(
  prisma: PrismaClient,
  usuario: Usuario,
): Promise<Nivel> {
  const nivel = await resolverNivel(prisma, usuario)

  if (!temAcessoAoPortal(nivel)) {
    throw new NaoAutorizado(
      `O Portal GD atende os níveis ${NIVEIS_COM_ACESSO.join(', ')}. ` +
        `Seu perfil corresponde ao nível ${nivel}, que não tem acesso.`,
    )
  }

  return nivel
}

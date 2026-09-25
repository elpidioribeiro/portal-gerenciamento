import type { Prisma, PrismaClient, Usuario } from '@prisma/client'
import { NaoAutorizado } from '../../lib/erros.js'
import { NIVEIS_COM_ACESSO, type NivelComAcesso } from './nivel.js'
import { ehAdmin } from './papel-admin.js'

/**
 * Quais filiais um nível vê, e como o administrador troca de visão.
 *
 * Até aqui nenhuma rota filtrava por nível: v1 é N2 (diretoria) e todo mundo
 * autenticado via as 9 filiais. Este módulo é o que faz o seletor de visão do
 * administrador significar alguma coisa — sem a regra de escopo, escolher "ver
 * como N4" devolveria exatamente a mesma resposta.
 *
 * A regra é do usuário, não inventada aqui: **só o N2 vê todas as filiais. N3 e
 * N4 veem a sua.**
 *
 * Mudou em 27/08/2026. Antes o N3 também via o conjunto inteiro, porque a regra
 * fora escrita quando ele parecia um nível corporativo. Ele não é: **o N3 é o
 * gerente geral DE LOJA** — a reunião dele é com os gerentes adjuntos de
 * Construção, Não Construção e Operacional, todos da mesma filial. Ver PLANO
 * §7.12.
 *
 * Com a regra antiga, um N3 abria o portal e via a rede inteira. Não dava erro:
 * dava a tela da diretoria para um gerente de loja.
 *
 * "Ver todas as filiais" e "não ter filial" continuam sendo coisas DIFERENTES,
 * e só o N2 é as duas. É o que sustenta a abertura de ação: escolher um
 * destinatário N3 passa por escolher a filial, exatamente como no N4.
 */

/** Níveis que veem o conjunto inteiro de filiais — não os que não têm filial. */
const VEEM_TODAS_AS_FILIAIS = ['N2'] as const satisfies readonly NivelComAcesso[]

export function veTodasAsFiliais(nivel: NivelComAcesso): boolean {
  return (VEEM_TODAS_AS_FILIAIS as readonly NivelComAcesso[]).includes(nivel)
}

/**
 * O recorte com que a requisição será atendida.
 *
 * `filialId` é nulo para os níveis corporativos e obrigatório para N4 — a
 * distinção é o conteúdo inteiro deste tipo, e por isso ele existe em vez de as
 * rotas carregarem `nivel` e `filialId` soltos.
 */
export interface Visao {
  nivel: NivelComAcesso
  filialId: string | null
  /** Verdadeiro quando um administrador está vendo como outro nível. */
  simulada: boolean
}

/**
 * Filtro de filial para o `where` do Prisma.
 *
 * Devolve objeto vazio no caso corporativo, de propósito: espalhar
 * `if (nivel === 'N4')` pelas rotas é como se esquece um. Aqui o filtro é
 * sempre aplicado, e às vezes não restringe nada.
 */
export function filtroDeFiliais(visao: Visao): Prisma.FilialWhereInput {
  if (visao.filialId === null) return {}
  return { id: visao.filialId }
}

/** O que a rota recebe da querystring para trocar de visão. */
export interface PedidoDeVisao {
  visaoNivel?: string | undefined
  visaoFilial?: string | undefined
}

/**
 * Resolve a visão da requisição, validando no servidor.
 *
 * O ponto que não pode ser confiado ao cliente: quem pode adotar qual visão é
 * decidido AQUI, por `exigirPermissaoDeVisao` — estreitar é livre, alargar e
 * andar de lado exigem administrador. Um `visaoNivel=N2` mandado por um N4
 * comum não é ignorado em silêncio — é 403. Ignorar seria pior: o front
 * mostraria o seletor funcionando e devolvendo os dados do nível de origem, e
 * ninguém saberia se o recorte aplicado foi o pedido ou o real.
 */
export async function resolverVisao(
  prisma: PrismaClient,
  usuario: Usuario,
  pedido: PedidoDeVisao = {},
): Promise<Visao> {
  const pediuAlgo = pedido.visaoNivel !== undefined || pedido.visaoFilial !== undefined

  if (!pediuAlgo) return visaoNatural(usuario)

  const nivel = pedido.visaoNivel
  if (nivel === undefined) {
    throw new NaoAutorizado('Informe visaoNivel junto com visaoFilial.')
  }
  if (!ehNivelComAcesso(nivel)) {
    throw new NaoAutorizado(
      `Visão inválida: "${nivel}". O portal atende ${NIVEIS_COM_ACESSO.join(', ')}.`,
    )
  }

  if (veTodasAsFiliais(nivel)) {
    /**
     * Recusar em vez de ignorar. Uma filial junto de N2 significa que quem
     * chamou entendeu a regra ao contrário; devolver a visão corporativa
     * calada confirmaria o mal-entendido.
     */
    if (pedido.visaoFilial !== undefined) {
      throw new NaoAutorizado(
        `${nivel} é corporativo e vê todas as filiais. Remova visaoFilial ou escolha N4.`,
      )
    }
    exigirPermissaoDeVisao(usuario, nivel, null)
    return { nivel, filialId: null, simulada: true }
  }

  if (pedido.visaoFilial === undefined) {
    throw new NaoAutorizado(`${nivel} é visão de filial: informe visaoFilial com a sigla.`)
  }

  const filial = await prisma.filial.findFirst({
    where: { sigla: pedido.visaoFilial, tipo: 'FILIAL', ativa: true },
  })
  if (!filial) {
    throw new NaoAutorizado(`Filial "${pedido.visaoFilial}" não existe ou está inativa.`)
  }

  exigirPermissaoDeVisao(usuario, nivel, filial.id)

  return { nivel, filialId: filial.id, simulada: true }
}

/**
 * PROFUNDIDADE do nível: quanto mais alto o número, menos se vê.
 *
 * N2 é a rede, N3 é uma loja, N4 é uma gerência dentro da loja. É a ordem da
 * cadeia de ajuda, e é ela que define o que "estreitar" significa.
 */
const PROFUNDIDADE: Record<NivelComAcesso, number> = { N2: 0, N3: 1, N4: 2 }

/**
 * Quem pode adotar a visão pedida.
 *
 * **Estreitar é livre; alargar e andar de lado exigem administrador.**
 *
 * Era `admin` para qualquer troca, e isso quebrava o desdobramento que a
 * diretoria faz todo dia: a matriz do N2 aponta a célula, e clicar nela abre a
 * reunião daquela loja (§7.63). O N2 do portal **não é administrador** --
 * medido, `n2-teste` tem `admin: false` --, então a cadeia N2 → N3 → N4 parava
 * na primeira porta, com 403 em toda requisição da tela.
 *
 * A liberação não expõe dado novo, e é isso que a torna segura: o N2 já lê o
 * número das nove filiais na própria matriz de onde ele clica. O que ele ganha
 * é o RECORTE de um dado que já era dele.
 *
 * O que continua fechado, e é o motivo de a regra existir:
 *
 *   N3 da CEN → N3 da NOR    andar de lado: a loja de outra pessoa
 *   N3 da CEN → N2           alargar: a tela da diretoria
 *   N4 da CEN → N3 da CEN    alargar: a loja inteira, sendo de uma gerência
 *
 * `visaoNatural` é a referência, e não `usuario.nivel` cru: ela é quem recusa
 * um N3 sem filial cadastrada, e reusá-la mantém essa recusa valendo aqui.
 */
function exigirPermissaoDeVisao(
  usuario: Usuario,
  nivelPedido: NivelComAcesso,
  filialPedidaId: string | null,
): void {
  if (ehAdmin(usuario)) return

  const natural = visaoNatural(usuario)

  const desce = PROFUNDIDADE[nivelPedido] >= PROFUNDIDADE[natural.nivel]
  /*
   * `filialId === null` na visão natural é o corporativo: qualquer filial é um
   * subconjunto dela. Com filial própria, só a dela -- e a comparação é por
   * id, que é o que o `findFirst` acima já resolveu a partir da sigla.
   */
  const mesmaFilial = natural.filialId === null || natural.filialId === filialPedidaId

  if (desce && mesmaFilial) return

  throw new NaoAutorizado(
    'Você pode estreitar a sua visão, não alargá-la nem trocar de filial. ' +
      `A sua é ${natural.nivel}${natural.filialId === null ? ' (corporativa)' : ' da sua filial'}.`,
  )
}

/**
 * A visão do próprio perfil.
 *
 * N3 ou N4 sem filial cadastrada **não** vira visão corporativa: seria promover
 * um gerente de loja a diretoria por causa de um campo em branco, e sem sintoma
 * nenhum. Falha fechada, dizendo o que corrigir.
 */
function visaoNatural(usuario: Usuario): Visao {
  const nivel = usuario.nivel
  if (!ehNivelComAcesso(nivel)) {
    throw new NaoAutorizado(
      `Seu nível (${nivel}) não tem tela no portal. O Portal GD atende ${NIVEIS_COM_ACESSO.join(', ')}.`,
    )
  }

  if (veTodasAsFiliais(nivel)) return { nivel, filialId: null, simulada: false }

  if (!usuario.filialId) {
    throw new NaoAutorizado(
      `Seu nível (${nivel}) é de filial, mas nenhuma filial está associada ao seu ` +
        'usuário. Procure o administrador do portal.',
    )
  }

  return { nivel, filialId: usuario.filialId, simulada: false }
}

function ehNivelComAcesso(v: string): v is NivelComAcesso {
  return (NIVEIS_COM_ACESSO as readonly string[]).includes(v)
}

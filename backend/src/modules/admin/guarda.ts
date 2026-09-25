import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Usuario } from '@prisma/client'
import { NaoAutorizado } from '../../lib/erros.js'
import { ehAdmin, ehMaster } from '../auth/papel-admin.js'

/**
 * Autentica e exige que a pessoa administre o portal.
 *
 * Toda rota de `/admin` passa por aqui, e a checagem é por **coluna no banco**,
 * não por nível nem por matrícula no código. Duas razões:
 *
 * - por nível seria errado: o administrador é N2, mas nem todo N2 administra —
 *   diretoria não configura variável de controle de ninguém;
 * - por matrícula no código seria deploy: um segundo administrador amanhã deve
 *   ser um `UPDATE`.
 *
 * `papelAdmin` é campo separado de `nivel` justamente porque as duas perguntas
 * são diferentes: `nivel` diz **o que a pessoa vê**, `papelAdmin` diz **o que
 * ela pode configurar**. E `recebeAcao`, uma terceira: se trabalho pode cair na
 * mão dela.
 *
 * > A única matrícula que o código conhece é a ÂNCORA, e ela não contradiz o
 * > primeiro parágrafo — ver `auth/papel-admin.ts`, que explica por que "quem
 * > administra" e "quem não pode ser trancado para fora" são perguntas
 * > diferentes.
 */
export async function exigirAdmin(app: FastifyInstance, req: FastifyRequest): Promise<Usuario> {
  const usuario = await app.autenticar(req)

  if (!ehAdmin(usuario)) {
    throw new NaoAutorizado(
      'Esta área é do administrador do portal. Se você precisa classificar perfis ou ' +
        'configurar variáveis de controle, peça acesso a quem administra.',
    )
  }

  return usuario
}

/**
 * Exige o papel de MASTER — conceder e revogar administradores.
 *
 * É o único degrau acima de `exigirAdmin`, e existe para uma coisa só: um
 * administrador comum faz tudo na área, menos escolher quem mais entra nela.
 * Sem essa separação, conceder acesso seria transitivo — qualquer admin poderia
 * criar outro admin, e revogar quem o criou.
 *
 * A mensagem **diz o que fazer**, e não só que não pode: quem esbarra aqui está
 * tentando dar acesso a alguém, e a saída é pedir a quem tem o papel.
 */
export async function exigirMaster(app: FastifyInstance, req: FastifyRequest): Promise<Usuario> {
  const usuario = await exigirAdmin(app, req)

  if (!ehMaster(usuario)) {
    throw new NaoAutorizado(
      'Conceder e revogar administradores é do administrador principal do portal. ' +
        'Você administra tudo o mais — para dar acesso a alguém, peça a ele.',
    )
  }

  return usuario
}

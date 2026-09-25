import type { PapelAdmin, Usuario } from '@prisma/client'

/**
 * QUEM ADMINISTRA O PORTAL, e quem administra quem administra.
 *
 * Duas perguntas moram aqui, e nenhuma delas é o nível do GD:
 *
 *  - `ADMIN` faz tudo na área de administração;
 *  - `MASTER` faz isso e mais uma coisa: **concede e revoga o papel dos outros**.
 *
 * Pedido do analista em 14/09/2026: *"posso indicar outros, mas o meu nunca pode
 * ser revogado, só por código"*.
 */

/**
 * A ÂNCORA. Esta matrícula é `MASTER` **por código**, e nada no banco a alcança.
 *
 * Parece contradizer o guarda, que diz — e continua certo — que administrar
 * *"por matrícula no código seria deploy"*. Não contradiz, porque a pergunta é
 * outra: aquilo é sobre **quem administra**, que tem de ser dado e mudar por
 * `UPDATE`; isto é sobre **quem não pode ser trancado para fora**, que é
 * exatamente o que não pode depender de uma linha do banco.
 *
 * Sem esta âncora o portal tem um estado irreversível a um clique de distância:
 * o último master se revoga (ou um `UPDATE` errado o revoga) e **não existe tela
 * capaz de desfazer** — conceder papel exige um master, e não há mais nenhum. A
 * saída seria um script contra o banco de produção. É o mesmo raciocínio pelo
 * qual `neutralizar-seed.ts` deixa o administrador de fora da desativação em
 * massa.
 *
 * **Pela MATRÍCULA, não pelo login.** `login_erp` é `u10001abc` e a matrícula é
 * `10001`; o login muda na origem e existe um caminho inteiro de reconciliação
 * por causa disso (§7.33 e o `upsert` do `ErpAuthProvider`, que reaponta o login
 * da linha existente). A matrícula é única desde 31/08 e é a identidade que as
 * duas pontas compartilham.
 *
 * Trocar de âncora é deploy, e isso é a intenção: é a única coisa aqui que
 * deveria exigir alguém abrir o código.
 */
export const MATRICULA_MASTER_ANCORA = 10001

/**
 * O papel EFETIVO — calculado, não lido.
 *
 * A âncora não é conferida contra a coluna: ela **vence** a coluna. Se a linha
 * do banco disser `NENHUM` para a matrícula 10001 — por engano, por uma carga,
 * por um `UPDATE` de madrugada —, o papel efetivo continua `MASTER`. Guardar o
 * valor e apenas *recusar alterá-lo pela API* deixaria a porta aberta para todo
 * caminho que não passa pela API, que é a maioria deles.
 *
 * Para as outras pessoas, a coluna é a verdade.
 */
export function papelAdminDe(usuario: Pick<Usuario, 'matricula' | 'papelAdmin'>): PapelAdmin {
  if (usuario.matricula === MATRICULA_MASTER_ANCORA) return 'MASTER'
  return usuario.papelAdmin
}

/** Administra o portal — `ADMIN` ou `MASTER`. */
export function ehAdmin(usuario: Pick<Usuario, 'matricula' | 'papelAdmin'>): boolean {
  return papelAdminDe(usuario) !== 'NENHUM'
}

/** Pode conceder e revogar o papel dos outros. */
export function ehMaster(usuario: Pick<Usuario, 'matricula' | 'papelAdmin'>): boolean {
  return papelAdminDe(usuario) === 'MASTER'
}

/** A âncora não pode ser mexida por nenhuma rota. */
export function ehAncora(usuario: Pick<Usuario, 'matricula'>): boolean {
  return usuario.matricula === MATRICULA_MASTER_ANCORA
}

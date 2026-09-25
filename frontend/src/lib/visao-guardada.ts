import type { NivelComAcesso } from './api.js'

export interface PedidoVisao {
  nivel: NivelComAcesso
  /** Sigla. Obrigatória em N3 e N4, proibida no N2 — o servidor valida. */
  filial: string | null
  /**
   * NOME da gerência, e **só o N4 tem uma**.
   *
   * Nome e não id: `dimensao_gerencia` tem uma linha por (filial, gerência), e
   * o id amarraria a escolha a UMA loja — trocar de filial deixaria um id órfão
   * apontando para a gerência de outra. O nome mais a filial encontram a linha
   * certa, que é a mesma decisão do cadastro de perfil.
   *
   * Não vai para o servidor: o recorte que ele valida é nível × filial. A
   * gerência escolhe qual quadro a TELA abre dentro dessa filial.
   */
  gerencia: string | null
}

/**
 * A visão simulada, guardada entre recarregamentos — e o DONO dela.
 *
 * `sessionStorage` e não `localStorage`: a visão sobrevive a um F5, que é o que
 * se espera ao mexer numa tela, mas não vaza para outra aba nem para a sessão
 * de amanhã.
 *
 * **O DONO EXISTE POR CAUSA DE UM DEFEITO REAL** (10/09/2026). O analista
 * estava no N2, abriu o N4 de CEN, deslogou e entrou como `N4 de Teste`, de
 * NOR. A tela do novo usuário abriu com a faixa laranja *"você está vendo como
 * N4 · CEN · CONSTRUÇÃO"* e com "nenhuma gerência atribuída a você — é
 * cadastro, não erro": a visão do usuário anterior tinha sobrevivido à troca de
 * pessoa, e as consultas iam para a filial errada. A mensagem culpava o
 * cadastro de quem entrou.
 *
 * `sair()` apaga isto, e o dono é o cinto de segurança para o que o logout não
 * cobre — token expirado, aba reaberta, alguém que fecha a janela sem sair.
 *
 * Este módulo existe separado do `VisaoContext` porque o `SessaoContext`
 * precisa de `esquecerVisao` no logout, e o contexto de visão lê a sessão: um
 * importando o outro daria ciclo.
 */
const CHAVE = 'portalgd.visao'
const CHAVE_DONO = 'portalgd.visao.dono'

export function lerVisaoGuardada(): PedidoVisao | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE)
    if (!bruto) return null
    /*
     * `unknown`, e não `as PedidoVisao`.
     *
     * O cast afirmava a forma que a validação logo abaixo existe para
     * DESCOBRIR -- e com ele o compilador passava a achar que `p.nivel` só
     * podia ser N2, N3 ou N4, o que tornava a terceira comparação literalmente
     * `'N4' !== 'N4'`. A guarda mais importante da função virava código morto
     * aos olhos do tipo, e continuava sendo a única coisa entre um
     * `sessionStorage` editado à mão e uma querystring inválida em toda
     * requisição da sessão.
     *
     * Um cast sobre dado que vem de fora é uma afirmação sobre o mundo. Aqui o
     * mundo é o navegador de outra pessoa.
     */
    const p = JSON.parse(bruto) as unknown
    if (typeof p !== 'object' || p === null) return null
    const { nivel, filial, gerencia } = p as Record<string, unknown>
    if (nivel !== 'N2' && nivel !== 'N3' && nivel !== 'N4') return null
    return {
      nivel,
      filial: typeof filial === 'string' ? filial : null,
      gerencia: typeof gerencia === 'string' ? gerencia : null,
    }
  } catch {
    return null
  }
}

/** Quem pediu a visão guardada. `null` quando não há visão, ou é de antes do dono. */
export function donoDaVisaoGuardada(): string | null {
  try {
    return sessionStorage.getItem(CHAVE_DONO)
  } catch {
    return null
  }
}

export function guardarVisao(pedido: PedidoVisao | null, donoId: string | null): void {
  try {
    if (pedido === null) {
      esquecerVisao()
      return
    }
    sessionStorage.setItem(CHAVE, JSON.stringify(pedido))
    /*
     * Sem dono conhecido a visão é gravada assim mesmo, e sem marca: recusá-la
     * quebraria a troca de visão feita antes de a sessão responder. O efeito do
     * provider confere de novo quando o usuário chega.
     */
    if (donoId !== null) sessionStorage.setItem(CHAVE_DONO, donoId)
  } catch {
    /* Navegador com storage bloqueado: a visão vale só para esta tela. */
  }
}

export function esquecerVisao(): void {
  try {
    sessionStorage.removeItem(CHAVE)
    sessionStorage.removeItem(CHAVE_DONO)
  } catch {
    /* idem */
  }
}

/**
 * A visão guardada é de OUTRA pessoa?
 *
 * Sem dono marcado, não dá para saber, e a resposta é não: é o caso de uma
 * visão gravada por uma versão anterior do portal, e descartá-la sem motivo
 * tiraria da pessoa a visão que ela mesma escolheu há dois minutos.
 */
export function visaoEDeOutroDono(usuarioId: string): boolean {
  const dono = donoDaVisaoGuardada()
  return dono !== null && dono !== usuarioId
}

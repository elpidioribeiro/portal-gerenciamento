import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSessao } from './SessaoContext.js'
import {
  esquecerVisao,
  guardarVisao,
  lerVisaoGuardada,
  visaoEDeOutroDono,
  type PedidoVisao,
} from '../lib/visao-guardada.js'

export type { PedidoVisao }

/**
 * A visão que o administrador escolheu olhar.
 *
 * Guarda apenas o PEDIDO. O recorte de verdade vem na resposta de cada rota
 * (`data.visao`), porque quem decide é o servidor — e uma tela que exibisse o
 * nível a partir daqui mentiria no dia em que a validação recusasse a escolha.
 *
 * `sessionStorage` e não `localStorage`: a visão simulada sobrevive a um F5, que
 * é o que se espera ao mexer numa tela, mas não vaza para outra aba nem para a
 * sessão de amanhã. Estar num recorte que não é o seu sem ter escolhido agora é
 * confuso, mesmo com a faixa de aviso.
 */

interface ContextoVisao {
  /** Nulo = visão do próprio perfil, sem simulação. */
  pedido: PedidoVisao | null
  definir: (p: PedidoVisao | null) => void
  /** Parâmetros para anexar à querystring. Vazio quando não há pedido. */
  params: URLSearchParams
  /** Entra na chave do React Query, para a troca de visão refazer a busca. */
  chave: string
}

const VisaoContext = createContext<ContextoVisao | null>(null)

export function VisaoProvider({ children }: { children: ReactNode }) {
  const { usuario } = useSessao()
  const [pedido, setPedido] = useState<PedidoVisao | null>(lerVisaoGuardada)

  /**
   * A VISÃO DE QUEM SAIU NÃO VALE PARA QUEM ENTRA.
   *
   * Defeito relatado em 10/09/2026: estando no N2 e tendo aberto o N4 de CEN, o
   * analista deslogou e entrou como `N4 de Teste`, de NOR. A tela abriu com a
   * faixa laranja de "você está vendo como N4 · CEN · CONSTRUÇÃO" e com
   * "nenhuma gerência atribuída a você — é cadastro, não erro": as consultas
   * saíam com a filial do usuário anterior, e a mensagem culpava o cadastro de
   * quem tinha acabado de entrar.
   *
   * `sair()` apaga a visão, e isto aqui cobre o que ele não alcança: token
   * expirado, aba reaberta, ou alguém que fecha a janela sem sair.
   */
  useEffect(() => {
    if (!usuario) return
    if (!visaoEDeOutroDono(usuario.id)) return
    esquecerVisao()
    setPedido(null)
  }, [usuario])

  /**
   * O PEDIDO VALE PARA TODO MUNDO, e quem julga é o servidor.
   *
   * Era `usuario?.admin ? pedido : null`, e estava certo enquanto a regra do
   * servidor era "só o administrador troca de visão": mandar os parâmetros de
   * qualquer forma daria 403 em toda requisição, e a tela pareceria quebrada.
   *
   * A regra virou **estreitar é livre** em 10/09/2026 (§7.63), e este descarte
   * passou a ser o próprio defeito: a matriz do N2 definia a visão `N3 · CEN`,
   * o `sessionStorage` guardava, e aqui ela era jogada fora porque
   * `n2-teste.admin === false`. A tela do N3 abria com a visão natural de um N2
   * corporativo — sem filial —, e mostrava "nenhuma gerência nesta loja" sobre
   * uma loja que tem duas. Medido na tela: a API respondia 200 com 2 gerências
   * para a mesma visão que esta linha descartava.
   *
   * É a marca de uma regra copiada: a cópia do cliente continuou afirmando o
   * que o servidor tinha deixado de exigir. Agora existe UMA regra, e ela mora
   * em `resolverVisao`.
   *
   * **Fica dito:** um pedido guardado no `sessionStorage` que ALARGUE a visão
   * — o caso de um administrador ter usado esta aba antes — passa a produzir
   * 403. A `FaixaVisao` mostra qual visão está ativa e como voltar à natural,
   * então é visível e desfazível; antes era invisível e ignorado.
   */
  const valor = useMemo<ContextoVisao>(() => {
    const params = new URLSearchParams()
    if (pedido) {
      params.set('visaoNivel', pedido.nivel)
      if (pedido.filial) params.set('visaoFilial', pedido.filial)
    }

    return {
      pedido,
      definir: (p) => {
        setPedido(p)
        guardarVisao(p, usuario?.id ?? null)
      },
      params,
      /*
       * A gerência entra na chave mesmo não indo na querystring: ela muda o
       * quadro que a tela abre, e sem ela na chave o React Query devolveria o
       * cache da gerência anterior.
       */
      chave: pedido
        ? `${pedido.nivel}:${pedido.filial ?? ''}:${pedido.gerencia ?? ''}`
        : 'natural',
    }
  }, [pedido, usuario])

  return <VisaoContext.Provider value={valor}>{children}</VisaoContext.Provider>
}

export function useVisao(): ContextoVisao {
  const ctx = useContext(VisaoContext)
  if (!ctx) throw new Error('useVisao precisa estar dentro de <VisaoProvider>')
  return ctx
}

/**
 * Junta os parâmetros da visão a uma querystring já montada.
 *
 * Função em vez de cada hook fazer o `for`: os dois hooks precisam disso, e
 * esquecer num deles produziria uma tela que ignora o seletor — sem erro.
 */
export function comVisao(params: URLSearchParams, visao: URLSearchParams): string {
  const juntos = new URLSearchParams(params)
  for (const [k, v] of visao) juntos.set(k, v)
  return juntos.toString()
}

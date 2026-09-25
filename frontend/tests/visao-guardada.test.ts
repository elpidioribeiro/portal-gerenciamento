import { beforeEach, describe, expect, it } from 'vitest'
import {
  esquecerVisao,
  guardarVisao,
  lerVisaoGuardada,
  visaoEDeOutroDono,
} from '../src/lib/visao-guardada.js'

/**
 * O DEFEITO QUE ESTE ARQUIVO GUARDA (10/09/2026).
 *
 * O analista estava no N2, abriu o N4 de CEN, deslogou e entrou como `N4 de
 * Teste`, de NOR. A tela do novo usuário abriu com a faixa laranja *"você está
 * vendo como N4 · CEN · CONSTRUÇÃO"* e com "nenhuma gerência atribuída a você —
 * é cadastro, não erro". A visão do usuário anterior tinha sobrevivido à troca
 * de pessoa: as consultas saíam com a filial errada, e a mensagem culpava o
 * cadastro de quem tinha acabado de entrar.
 *
 * `sair()` limpava o cache de dados e recarregava a página — mas a visão mora no
 * `sessionStorage`, que sobrevive às duas coisas.
 */

const VISAO_DO_N2 = { nivel: 'N4' as const, filial: 'CEN', gerencia: 'CONSTRUÇÃO' }

beforeEach(() => {
  sessionStorage.clear()
})

describe('visão guardada', () => {
  it('sobrevive ao recarregamento, que é para o que ela existe', () => {
    guardarVisao(VISAO_DO_N2, 'usuario-do-n2')
    expect(lerVisaoGuardada()).toEqual(VISAO_DO_N2)
  })

  it('é reconhecida como de OUTRO dono quando quem entra é outra pessoa', () => {
    guardarVisao(VISAO_DO_N2, 'usuario-do-n2')
    expect(visaoEDeOutroDono('usuario-do-n4-teste')).toBe(true)
    expect(visaoEDeOutroDono('usuario-do-n2')).toBe(false)
  })

  it('some inteira no logout — visão e dono', () => {
    guardarVisao(VISAO_DO_N2, 'usuario-do-n2')
    esquecerVisao()
    expect(lerVisaoGuardada()).toBeNull()
    /* Sem o dono junto, a próxima visão herdaria a marca da anterior. */
    expect(visaoEDeOutroDono('qualquer-um')).toBe(false)
  })

  it('sem dono marcado, NÃO é considerada de outro', () => {
    /*
     * É o caso de uma visão gravada por uma versão anterior do portal.
     * Descartá-la sem motivo tiraria da pessoa a visão que ela escolheu há dois
     * minutos.
     */
    guardarVisao(VISAO_DO_N2, null)
    expect(lerVisaoGuardada()).toEqual(VISAO_DO_N2)
    expect(visaoEDeOutroDono('quem-quer-que-seja')).toBe(false)
  })

  it('recusa o que não é visão válida, venha de onde vier', () => {
    sessionStorage.setItem('portalgd.visao', '{"nivel":"N9","filial":"CEN"}')
    expect(lerVisaoGuardada()).toBeNull()
    sessionStorage.setItem('portalgd.visao', 'isto não é json')
    expect(lerVisaoGuardada()).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import type { Usuario } from '@prisma/client'
import {
  MATRICULA_MASTER_ANCORA,
  ehAdmin,
  ehAncora,
  ehMaster,
  papelAdminDe,
} from '../../src/modules/auth/papel-admin.js'
import { movimentoEntregaTrabalho, podeReceberAcao } from '../../src/modules/contramedidas/politicas.js'

/**
 * A ÂNCORA, E O QUE ELA IMPEDE.
 *
 * O portal tem um estado irreversível a um clique de distância: o último master
 * se revoga e **não existe tela capaz de desfazer**, porque conceder papel exige
 * um master. A saída seria um script contra o banco de produção.
 *
 * Estes testes fixam as duas metades da proteção. A rota recusar alterar a
 * âncora é a metade fácil; a que importa é esta: o papel dela é **calculado**,
 * então nem um `UPDATE` por fora da API a tranca para fora.
 */
function quem(over: Partial<Pick<Usuario, 'matricula' | 'papelAdmin'>> = {}) {
  return { matricula: 99999, papelAdmin: 'NENHUM' as const, ...over }
}

describe('papel de administração', () => {
  it('a âncora é MASTER mesmo com a coluna dizendo o contrário', () => {
    const sabotado = quem({ matricula: MATRICULA_MASTER_ANCORA, papelAdmin: 'NENHUM' })
    expect(papelAdminDe(sabotado)).toBe('MASTER')
    expect(ehMaster(sabotado)).toBe(true)
    expect(ehAdmin(sabotado)).toBe(true)
  })

  /* O `UPDATE` mais plausível de todos: alguém revoga geral e esquece a âncora. */
  it('revogar todo mundo no banco não derruba a âncora', () => {
    for (const papel of ['NENHUM', 'ADMIN', 'MASTER'] as const) {
      expect(papelAdminDe(quem({ matricula: MATRICULA_MASTER_ANCORA, papelAdmin: papel }))).toBe(
        'MASTER',
      )
    }
  })

  it('para todo mundo que não é a âncora, a coluna é a verdade', () => {
    expect(papelAdminDe(quem({ papelAdmin: 'NENHUM' }))).toBe('NENHUM')
    expect(papelAdminDe(quem({ papelAdmin: 'ADMIN' }))).toBe('ADMIN')
    expect(papelAdminDe(quem({ papelAdmin: 'MASTER' }))).toBe('MASTER')
  })

  /* Matrícula nula é o usuário que não vem do sistema corporativo (mock). */
  it('matrícula nula não vira âncora por acidente', () => {
    const mock = { matricula: null, papelAdmin: 'NENHUM' as const }
    expect(ehAncora(mock)).toBe(false)
    expect(papelAdminDe(mock)).toBe('NENHUM')
  })

  it('MASTER administra; ADMIN administra sem conceder; NENHUM não entra', () => {
    expect(ehAdmin(quem({ papelAdmin: 'MASTER' }))).toBe(true)
    expect(ehMaster(quem({ papelAdmin: 'MASTER' }))).toBe(true)

    expect(ehAdmin(quem({ papelAdmin: 'ADMIN' }))).toBe(true)
    expect(ehMaster(quem({ papelAdmin: 'ADMIN' }))).toBe(false)

    expect(ehAdmin(quem({ papelAdmin: 'NENHUM' }))).toBe(false)
    expect(ehMaster(quem({ papelAdmin: 'NENHUM' }))).toBe(false)
  })

  it('só a matrícula da âncora é âncora', () => {
    expect(ehAncora({ matricula: MATRICULA_MASTER_ANCORA })).toBe(true)
    expect(ehAncora({ matricula: MATRICULA_MASTER_ANCORA + 1 })).toBe(false)
  })
})

/**
 * QUEM RECEBE TRABALHO.
 *
 * A categoria nova é "administra e não participa da cadeia": vê o quadro do N2,
 * configura o portal, e não pode ter contramedida na mão.
 */
describe('participação na cadeia de ajuda', () => {
  it('recebe quem está ativo E participa', () => {
    expect(podeReceberAcao({ ativo: true, recebeAcao: true })).toBe(true)
  })

  it('não recebe quem administra sem participar', () => {
    expect(podeReceberAcao({ ativo: true, recebeAcao: false })).toBe(false)
  })

  /* Inativo já era recusado por `direcionar` e `rejeitar`, cada um por conta.
     Reunir aqui é o que faz a checagem única no `movimentar` valer para os dois. */
  it('não recebe quem foi desativado, participando ou não', () => {
    expect(podeReceberAcao({ ativo: false, recebeAcao: true })).toBe(false)
    expect(podeReceberAcao({ ativo: false, recebeAcao: false })).toBe(false)
  })

  /**
   * A EXCEÇÃO DA REJEIÇÃO — e é ela que faz "pode abrir" conviver com "não
   * recebe".
   *
   * Quem não recebe ação abre uma para outra pessoa; a pessoa rejeita;
   * `origemDaMao` devolve a quem abriu. Barrar aí prenderia a ação com quem já
   * disse que não é sua, e esconderia a recusa de quem a abriu. Ação rejeitada
   * está encerrada — não é trabalho, é aviso.
   */
  it('escalação e direcionamento entregam trabalho; a rejeição não', () => {
    expect(movimentoEntregaTrabalho('ESCALACAO')).toBe(true)
    expect(movimentoEntregaTrabalho('DIRECIONAMENTO')).toBe(true)
    expect(movimentoEntregaTrabalho('REJEICAO')).toBe(false)
  })

  /*
   * Os três que ficam com o responsável ATUAL. Incluí-los faria a trava barrar
   * alguém de mexer numa ação que já é dele -- o que só acontece se a flag for
   * ligada depois, e é justamente quando a ação precisa poder sair da mão dele.
   */
  it('os movimentos que não trocam de mão passam', () => {
    expect(movimentoEntregaTrabalho('ATUALIZACAO')).toBe(false)
    expect(movimentoEntregaTrabalho('CONCLUSAO')).toBe(false)
    expect(movimentoEntregaTrabalho('FEEDBACK')).toBe(false)
  })
})

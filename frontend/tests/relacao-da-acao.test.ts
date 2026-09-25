import { describe, expect, it } from 'vitest'
import { relacaoDa } from '../src/hooks/useAcoes.js'
import type { ResumoAcao } from '../src/lib/api.js'

/**
 * `relacaoDa` — o que a ação é PARA QUEM OLHA.
 *
 * Ela não tinha teste, e já produziu o mesmo defeito duas vezes: um `return`
 * cedo demais nesta função não dá erro, **move a ação para o quadro de outra
 * pessoa**. §7.39 (feedback atravessando a comparação de nível) e §7.69
 * (rejeitada fazendo o mesmo) saíram daqui.
 *
 * O caso de 11/09/2026 é de outra natureza e por isso vale guardar junto: a
 * função terminava em `return 'afazer'` para o mesmo nível, o que era correto
 * **enquanto ação no meu nível fosse sempre minha**. `direcionar` e abrir para
 * um par (§7.72) quebraram essa garantia — e o sintoma foi a ação de outra
 * pessoa aparecendo como tarefa de quem a abriu.
 */
const acao = (over: Partial<ResumoAcao> = {}): ResumoAcao => ({
  codigo: 'AC-0001',
  criadoPorMim: true,
  souOResponsavel: true,
  abertaPor: { nome: 'Fulano', nivel: 'N2' },
  titulo: 'Ação',
  nivelAtual: 'N2',
  prioridade: 'MEDIA',
  prazo: '2026-09-30',
  criadoEm: '2026-09-01T00:00:00.000Z',
  concluidaEm: null,
  filial: 'Corporativo',
  agrupamento: { nome: 'Geral', grupo: null },
  indicador: null,
  responsavel: 'Fulano',
  status: 'EM_ANDAMENTO',
  sla: 'OK',
  diasEmAberto: 1,
  trilha: [],
  ...over,
})

describe('relação da ação com quem olha', () => {
  it('no meu nível e na minha mão: a fazer', () => {
    expect(relacaoDa(acao(), 'N2')).toBe('afazer')
  })

  /**
   * O DEFEITO DE 11/09/2026, relatado pelo analista: *"o n2-teste abriu a
   * atividade para Andre Pontes e no usuário dele tá 'a fazer'"*.
   *
   * Mesmo nível, outra mão — não é minha tarefa. Vale para as duas portas que
   * produzem esse estado: `direcionar` (que sempre existiu) e abrir ação para
   * um par (§7.72).
   */
  it('no meu nível e na mão de OUTRA pessoa: direcionada, nunca a fazer', () => {
    const deOutro = acao({ souOResponsavel: false, responsavel: 'Andre' })
    expect(relacaoDa(deOutro, 'N2')).toBe('direcionada')
  })

  it('quem RECEBEU a ação direcionada tem ela como a fazer', () => {
    const recebida = acao({ souOResponsavel: true, criadoPorMim: false })
    expect(relacaoDa(recebida, 'N2')).toBe('afazer')
  })

  it('num nível acima do meu: escalada', () => {
    expect(relacaoDa(acao({ nivelAtual: 'N2' }), 'N3')).toBe('escalada')
  })

  it('num nível abaixo do meu: nível abaixo, seja qual for o estado', () => {
    expect(relacaoDa(acao({ nivelAtual: 'N4' }), 'N2')).toBe('nivelAbaixo')
    expect(relacaoDa(acao({ nivelAtual: 'N4', status: 'REJEITADA' }), 'N2')).toBe('nivelAbaixo')
  })

  /* §7.39: aguardando feedback é "a fazer" SÓ de quem abriu. */
  it('aguardando feedback só é meu se fui eu quem abriu', () => {
    const minha = acao({ status: 'AGUARDANDO_FEEDBACK', criadoPorMim: true })
    expect(relacaoDa(minha, 'N2')).toBe('afazer')

    const deOutro = acao({
      status: 'AGUARDANDO_FEEDBACK',
      criadoPorMim: false,
      nivelAtual: 'N4',
    })
    expect(relacaoDa(deOutro, 'N2')).toBe('nivelAbaixo')
  })

  it('concluída vence tudo', () => {
    expect(relacaoDa(acao({ status: 'CONCLUIDA', souOResponsavel: false }), 'N2')).toBe('concluida')
  })

  /* §7.69: rejeitada só depois da comparação de nível — ver o teste acima. */
  it('rejeitada no meu nível é rejeitada', () => {
    expect(relacaoDa(acao({ status: 'REJEITADA' }), 'N2')).toBe('rejeitada')
  })
})

/**
 * A TERCEIRA VEZ DO MESMO DEFEITO — e a função avisa, no comentário entre as
 * duas linhas que o produzem: *"a ordem aqui já custou o mesmo defeito duas
 * vezes"*, e *"a ação do nível de baixo NUNCA é minha, esteja em que estado
 * estiver"*.
 *
 * `AGUARDANDO_FEEDBACK` ganhou a guarda `criadoPorMim` (§7.39) e `REJEITADA`
 * desceu para depois da comparação (§7.69). **`CONCLUIDA` ficou no topo**, e
 * atravessava a comparação do mesmo jeito.
 *
 * Relatado pelo analista em 14/09/2026, olhando a tela com a sessão da Karynna:
 * a AC-0489, concluída pelo N4 da Norte, aparecia na lista pessoal dela,
 * que é N3 da mesma loja. Ela nunca teve essa ação na mão -- ela a ACOMPANHA,
 * que é a visão gerencial de §7.5, e para isso a relação é `nivelAbaixo`, que o
 * filtro de `minhas` descarta.
 */
describe('o nível de baixo não vira meu por mudar de estado', () => {
  const doN4Concluida = acao({
    nivelAtual: 'N4',
    status: 'CONCLUIDA',
    criadoPorMim: false,
    souOResponsavel: false,
  })

  it('ação concluída no N4 é nivelAbaixo para o N3, e não concluida', () => {
    expect(relacaoDa(doN4Concluida, 'N3')).toBe('nivelAbaixo')
  })

  it('e para o N2 também, que está dois degraus acima', () => {
    expect(relacaoDa(doN4Concluida, 'N2')).toBe('nivelAbaixo')
  })

  /* A contrapartida: no MEU nível, concluída continua sendo concluída. */
  it('no próprio nível, concluída segue concluida', () => {
    expect(relacaoDa(acao({ nivelAtual: 'N3', status: 'CONCLUIDA' }), 'N3')).toBe('concluida')
  })

  /*
   * E quem ABRIU continua vendo: a ação que o N3 abriu para o N4 e que foi
   * concluída é dele -- ele precisa dar o feedback (§7.3). O que muda é só o
   * caso em que a pessoa não tem nada a ver com a ação além de acompanhá-la.
   */
  it('mas a que EU abri e aguarda meu feedback continua a fazer', () => {
    expect(
      relacaoDa(
        acao({ nivelAtual: 'N4', status: 'AGUARDANDO_FEEDBACK', criadoPorMim: true }),
        'N3',
      ),
    ).toBe('afazer')
  })
})

/**
 * A MATRIZ INTEIRA — 96 combinações, e não casos soltos.
 *
 * Os testes de cima descrevem regras, e são o que se lê para entender. Este
 * varre **todo o espaço**: cada nível da ação × cada nível de quem olha × cada
 * status × sou ou não o responsável × abri ou não.
 *
 * É a resposta ao que aconteceu três vezes: um estado novo no topo da função
 * atravessava a comparação de nível, e o teste existente não pegava porque
 * cobria `REJEITADA` e não `CONCLUIDA`. Caso a caso, sempre vai faltar um.
 *
 * O que ele fixa é a INVARIANTE que as três vezes violaram, e não uma tabela de
 * valores esperados — tabela envelhece e vira cópia do código. A invariante:
 *
 *   **a relação com uma ação de outro degrau NUNCA depende do estado dela**,
 *   exceto pela obrigação de feedback de quem abriu (§7.39).
 */
const NIVEIS = ['N4', 'N3', 'N2'] as const
const STATUS = [
  'EM_ANDAMENTO',
  'ATRASADA',
  'CONCLUIDA',
  'REJEITADA',
  'AGUARDANDO_FEEDBACK',
] as const

describe('a matriz completa', () => {
  it('abaixo do meu degrau: só nivelAbaixo, ou o feedback que é meu', () => {
    for (const meu of NIVEIS) {
      for (const dela of NIVEIS) {
        if (NIVEIS.indexOf(dela) >= NIVEIS.indexOf(meu)) continue
        for (const status of STATUS) {
          for (const souOResponsavel of [true, false]) {
            for (const criadoPorMim of [true, false]) {
              const r = relacaoDa(
                acao({ nivelAtual: dela, status, souOResponsavel, criadoPorMim }),
                meu,
              )
              const esperado =
                status === 'AGUARDANDO_FEEDBACK' && criadoPorMim ? 'afazer' : 'nivelAbaixo'
              expect(
                r,
                `${meu} olhando ação ${dela}/${status} resp=${String(souOResponsavel)} abri=${String(criadoPorMim)}`,
              ).toBe(esperado)
            }
          }
        }
      }
    }
  })

  /*
   * A CONTRAPARTIDA: acima e no mesmo degrau, o estado MANDA. Sem este caso, a
   * invariante acima seria satisfeita por uma função que devolvesse
   * `nivelAbaixo` para tudo.
   */
  it('no meu degrau e acima, o estado decide', () => {
    for (const meu of NIVEIS) {
      for (const dela of NIVEIS) {
        if (NIVEIS.indexOf(dela) < NIVEIS.indexOf(meu)) continue
        for (const status of STATUS) {
          const r = relacaoDa(acao({ nivelAtual: dela, status }), meu)
          expect(r, `${meu} olhando ação ${dela}/${status}`).not.toBe('nivelAbaixo')
          if (status === 'CONCLUIDA') expect(r).toBe('concluida')
          if (status === 'REJEITADA') expect(r).toBe('rejeitada')
        }
      }
    }
  })

  /* Nenhuma combinação pode cair fora do tipo -- um `undefined` aqui seria um
     caminho sem `return`, que o filtro de `minhas` trataria como "minha". */
  it('nenhuma combinação fica sem relação', () => {
    const validas = new Set([
      'afazer',
      'direcionada',
      'escalada',
      'nivelAbaixo',
      'rejeitada',
      'concluida',
    ])
    for (const meu of [...NIVEIS, 'CROSS'] as const) {
      for (const dela of [...NIVEIS, 'CROSS'] as const) {
        for (const status of STATUS) {
          const r = relacaoDa(acao({ nivelAtual: dela, status }), meu)
          expect(validas.has(r), `${meu} × ${dela} × ${status} devolveu "${r}"`).toBe(true)
        }
      }
    }
  })
})

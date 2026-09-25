import { describe, expect, it } from 'vitest'
import {
  destinosDeEscalacao,
  ehDestinoValidoDeDirecionamento,
  escalacaoTransfereResponsavel,
  estaRejeitada,
  criacaoEhCorporativa,
  criacaoExigeAgrupamento,
  criacaoExigePontoCausa,
  criacaoExigeResponsavel,
  niveisQuePodeCriar,
  podeAgir,
  podeDirecionar,
  podeMarcarPontoCausa,
  podeVer,
  slaDe,
  statusDe,
  type AcaoDaPolitica,
  type NivelAcao,
  type UsuarioDaPolitica,
} from '../../src/modules/contramedidas/politicas.js'

/**
 * Um teste por regra, com o nome da regra.
 *
 * As regras de contramedida mudaram três vezes em 24/08/2026 e nenhuma linha
 * de código as exercitava. Errar aqui erra em silêncio: uma ação escalada para
 * o nível errado não gera exceção, só aparece no quadro de outra pessoa.
 */

const HOJE = new Date('2026-08-24T12:00:00Z')
const dia = (n: number) => new Date(`2026-08-${String(n).padStart(2, '0')}T12:00:00Z`)

/*
 * `filialId` padrão 'f1', o mesmo da ação: assim cada teste que quer falar de
 * LOJA diz isso explicitamente, e os que falam de nível não precisam repetir a
 * loja em toda linha.
 */
const usuario = (nivel: NivelAcao, id = 'u1', filialId: string | null = 'f1'): UsuarioDaPolitica => ({
  id,
  nivel,
  filialId,
})
const acao = (p: Partial<AcaoDaPolitica> = {}): AcaoDaPolitica => ({
  nivelAtual: 'N3',
  filialId: 'f1',
  responsavelAtualId: 'u1',
  criadoPorId: 'u1',
  concluidaEm: null,
  /* Viva por padrão: cada teste que fala de ação FECHADA diz isso na linha. */
  rejeitada: false,
  /*
   * VAZIO por padrão: assim cada teste de visibilidade diz explicitamente se a
   * ação passou pela mão de quem olha. Um padrão com `u1` faria metade dos
   * casos passarem pelo caminho errado sem ninguém notar.
   */
  responsaveisAnteriores: [],
  ...p,
})

describe('ver', () => {
  it('vê o próprio nível e os de baixo', () => {
    expect(podeVer(usuario('N2'), acao({ nivelAtual: 'N4' }))).toBe(true)
    expect(podeVer(usuario('N2'), acao({ nivelAtual: 'N2' }))).toBe(true)
    expect(podeVer(usuario('N3'), acao({ nivelAtual: 'N4' }))).toBe(true)
  })

  it('não vê o que está acima, quando nunca passou pela mão dele', () => {
    expect(podeVer(usuario('N4'), acao({ nivelAtual: 'N3' }))).toBe(false)
    expect(podeVer(usuario('N3'), acao({ nivelAtual: 'N2' }))).toBe(false)
  })

  /**
   * **Quem escalou continua vendo** — é a regra de §7.5, e ela vale na escada
   * inteira, não só no CROSS.
   *
   * Sem isto a aba "Escaladas" é ZERO por construção: a tela a define como
   * "ação num nível acima do meu", e o servidor escondia exatamente essas. Foi
   * assim que a AC-0143 sumiu da lista do N4 no instante em que ele a escalou,
   * em vez de aparecer sob Escaladas (§7.34).
   *
   * O atraso dessa ação continua sendo dele: a variável de controle vermelha é
   * do N4, esteja a contramedida na mão de quem estiver.
   */
  it('vê o que ESCALOU, mesmo estando acima dele', () => {
    const escalada = acao({ nivelAtual: 'N3', responsavelAtualId: 'u9', responsaveisAnteriores: ['u1', 'u9'] })
    expect(podeVer(usuario('N4', 'u1'), escalada)).toBe(true)
  })

  /**
   * E NÃO vê o que subiu pela mão de outro. "Ver o que passou por mim" não é
   * "ver tudo do meu nível para cima" -- um N4 continua sem enxergar a reunião
   * do vizinho.
   */
  /**
   * **A LOJA vem antes do nível** (§7.41).
   *
   * Era o defeito que o n4-teste da Norte mostrou: ele abria a lista e via
   * a ação do gerente da Leste, porque a visibilidade olhava só o degrau
   * da escada -- e degrau não tem loja. Não dava erro: dava a reunião de outra
   * loja.
   */
  it('N4 não vê ação de OUTRA loja, nem no mesmo nível', () => {
    const deOutraLoja = acao({
      nivelAtual: 'N4',
      filialId: 'f2',
      responsavelAtualId: 'u1',
      criadoPorId: 'u1',
    })
    expect(podeVer(usuario('N4', 'u1', 'f1'), deOutraLoja)).toBe(false)
  })

  it('N3 não vê o N4 de outra loja', () => {
    const n4DeOutraLoja = acao({ nivelAtual: 'N4', filialId: 'f2', responsavelAtualId: 'u9' })
    expect(podeVer(usuario('N3', 'u1', 'f1'), n4DeOutraLoja)).toBe(false)
    expect(podeVer(usuario('N3', 'u1', 'f2'), n4DeOutraLoja)).toBe(true)
  })

  /**
   * O N2 é corporativo: vê a rede inteira, e é a única exceção (§7.12).
   * `filialId` nulo NÃO significa "vê tudo" -- significa "não tem loja"; quem
   * decide é `veTodasAsFiliais`.
   */
  it('N2 vê ação de qualquer loja', () => {
    const n3DeOutraLoja = acao({ nivelAtual: 'N3', filialId: 'f2', responsavelAtualId: 'u9' })
    expect(podeVer(usuario('N2', 'u1', null), n3DeOutraLoja)).toBe(true)
  })

  /**
   * **No mesmo nível, só o que é MEU.**
   *
   * "Ver o próprio nível" tratava todo N4 da loja como um só: o adjunto de
   * Construção via as ações de Não Construção marcadas *A fazer* na aba dele --
   * trabalho de outra pessoa aparecendo como dele. A lista é de quem olha, não
   * do cargo dele.
   */
  it('no mesmo nível e na mesma loja, vê a sua e não a do colega', () => {
    const minha = acao({ nivelAtual: 'N4', responsavelAtualId: 'u1', criadoPorId: 'u9' })
    const doColega = acao({ nivelAtual: 'N4', responsavelAtualId: 'u9', criadoPorId: 'u9' })
    expect(podeVer(usuario('N4', 'u1'), minha)).toBe(true)
    expect(podeVer(usuario('N4', 'u1'), doColega)).toBe(false)
  })

  /**
   * E a que EU ABRI continua minha depois de mudar de mãos no mesmo nível --
   * é o direcionamento, que troca o dono sem trocar o degrau.
   */
  it('no mesmo nível, quem ABRIU continua vendo', () => {
    const queEuAbri = acao({ nivelAtual: 'N4', responsavelAtualId: 'u9', criadoPorId: 'u1' })
    expect(podeVer(usuario('N4', 'u1'), queEuAbri)).toBe(true)
  })

  /**
   * A visão do nível ABAIXO continua inteira: é o que a aba "N4 (nível abaixo)"
   * mostra, e é o motivo de ela existir (§7.5) -- o N3 acompanha o que os
   * adjuntos estão fazendo, inclusive o que não é dele.
   */
  it('vê TODAS as do nível abaixo na sua loja, não só as suas', () => {
    const doAdjunto = acao({ nivelAtual: 'N4', responsavelAtualId: 'u9', criadoPorId: 'u9' })
    expect(podeVer(usuario('N3', 'u1'), doAdjunto)).toBe(true)
  })

  it('não vê o que OUTRO escalou para o mesmo nível', () => {
    const doVizinho = acao({ nivelAtual: 'N3', responsavelAtualId: 'u9', responsaveisAnteriores: ['u7', 'u9'] })
    expect(podeVer(usuario('N4', 'u1'), doVizinho)).toBe(false)
  })

  it('quem escalou para CROSS continua vendo', () => {
    const emApoio = acao({ nivelAtual: 'CROSS', responsavelAtualId: 'u1' })
    expect(podeVer(usuario('N2', 'u1'), emApoio)).toBe(true)
    // Outro N2, que não é o responsável, não vê.
    expect(podeVer(usuario('N2', 'u9'), emApoio)).toBe(false)
  })
})

describe('agir', () => {
  it('só o responsável atual age', () => {
    expect(podeAgir(usuario('N3', 'u1'), acao({ responsavelAtualId: 'u1' }))).toBe(true)
    expect(podeAgir(usuario('N3', 'u9'), acao({ responsavelAtualId: 'u1' }))).toBe(false)
  })

  it('ação concluída não aceita mais ação', () => {
    expect(podeAgir(usuario('N3', 'u1'), acao({ concluidaEm: HOJE }))).toBe(false)
  })
})

describe('escalar', () => {
  it('sobe exatamente um nível', () => {
    expect(destinosDeEscalacao(usuario('N4'), acao({ nivelAtual: 'N4' }))).toEqual(['N3'])
    expect(destinosDeEscalacao(usuario('N3'), acao({ nivelAtual: 'N3' }))).toEqual(['N2'])
  })

  it('o eixo CROSS é exclusivo do N2', () => {
    expect(destinosDeEscalacao(usuario('N2'), acao({ nivelAtual: 'N2' }))).toEqual(['CROSS'])
    expect(destinosDeEscalacao(usuario('N4'), acao({ nivelAtual: 'N4' }))).not.toContain('CROSS')
    expect(destinosDeEscalacao(usuario('N3'), acao({ nivelAtual: 'N3' }))).not.toContain('CROSS')
  })

  it('o N2 é o topo: pela linha não há para onde subir', () => {
    expect(destinosDeEscalacao(usuario('N2'), acao({ nivelAtual: 'N2' }))).not.toContain('N1')
  })

  it('nunca se escala a partir de CROSS', () => {
    expect(destinosDeEscalacao(usuario('N2'), acao({ nivelAtual: 'CROSS' }))).toEqual([])
  })

  it('quem não é responsável não escala', () => {
    expect(destinosDeEscalacao(usuario('N3', 'u9'), acao({ responsavelAtualId: 'u1' }))).toEqual([])
  })

  it('escalar para CROSS não transfere a responsabilidade', () => {
    expect(escalacaoTransfereResponsavel('CROSS')).toBe(false)
    expect(escalacaoTransfereResponsavel('N2')).toBe(true)
  })
})

describe('direcionar', () => {
  it('só o N2 direciona', () => {
    expect(podeDirecionar(usuario('N2', 'u1'), acao({ responsavelAtualId: 'u1' }))).toBe(true)
    expect(podeDirecionar(usuario('N3', 'u1'), acao({ responsavelAtualId: 'u1' }))).toBe(false)
    expect(podeDirecionar(usuario('N4', 'u1'), acao({ responsavelAtualId: 'u1' }))).toBe(false)
  })

  it('só o que está com ele', () => {
    expect(podeDirecionar(usuario('N2', 'u9'), acao({ responsavelAtualId: 'u1' }))).toBe(false)
  })

  it('o destino é um N2, e não ele mesmo', () => {
    const eu = usuario('N2', 'u1')
    expect(ehDestinoValidoDeDirecionamento(eu, usuario('N2', 'u2'))).toBe(true)
    expect(ehDestinoValidoDeDirecionamento(eu, usuario('N2', 'u1'))).toBe(false)
    expect(ehDestinoValidoDeDirecionamento(eu, usuario('N3', 'u2'))).toBe(false)
  })
})

describe('marcar ponto de causa', () => {
  it('marca quem tem a variável associada ao perfil', () => {
    const associadas = new Set(['v1', 'v2'])
    expect(podeMarcarPontoCausa({ variavelControleId: 'v1' }, associadas)).toBe(true)
  })

  it('sem a variável associada, não marca', () => {
    expect(podeMarcarPontoCausa({ variavelControleId: 'v9' }, new Set(['v1']))).toBe(false)
  })

  it('perfil sem nenhuma associação nega por padrão', () => {
    expect(podeMarcarPontoCausa({ variavelControleId: 'v1' }, new Set())).toBe(false)
  })
})

describe('criar', () => {
  it('cada nível abre no próprio e em todos abaixo', () => {
    expect(niveisQuePodeCriar('N2')).toEqual(['N2', 'N3', 'N4', 'CROSS'])
    expect(niveisQuePodeCriar('N3')).toEqual(['N3', 'N4'])
  })

  it('o N2 abre direto no N4, sem passar pelo N3', () => {
    expect(niveisQuePodeCriar('N2')).toContain('N4')
  })

  it('o N4 é a base: só abre no próprio nível', () => {
    expect(niveisQuePodeCriar('N4')).toEqual(['N4'])
  })

  it('N4 criando em N3 não é permitido', () => {
    expect(niveisQuePodeCriar('N4')).not.toContain('N3')
  })

  it('só o N2 abre no CROSS', () => {
    expect(niveisQuePodeCriar('N2')).toContain('CROSS')
    expect(niveisQuePodeCriar('N3')).not.toContain('CROSS')
    expect(niveisQuePodeCriar('N4')).not.toContain('CROSS')
  })

  it('abrir no CROSS não pede responsável: fica com quem abriu', () => {
    expect(criacaoExigeResponsavel('CROSS', 'N2')).toBe(false)
  })

  /**
   * **No próprio nível a ação é sua** (§7.42).
   *
   * Só se escolhe responsável abrindo ABAIXO. No mesmo degrau, oferecer a lista
   * seria oferecer o poder de encher a agenda do colega sem passar por ninguém
   * -- quem manda no trabalho dele é o nível acima.
   */
  it('no próprio nível não escolhe responsável; abaixo, sim', () => {
    expect(criacaoExigeResponsavel('N4', 'N4')).toBe(false)
    expect(criacaoExigeResponsavel('N3', 'N3')).toBe(false)

    expect(criacaoExigeResponsavel('N4', 'N3')).toBe(true)
    expect(criacaoExigeResponsavel('N3', 'N2')).toBe(true)
    expect(criacaoExigeResponsavel('N4', 'N2')).toBe(true)
  })

  /**
   * A EXCEÇÃO DO N2 (11/09/2026) — e o teste guarda os dois lados.
   *
   * O N2 escolhe responsável no próprio nível porque é corporativo e não tem
   * degrau acima para proteger os pares. N3 e N4 continuam fechados: a linha
   * acima é o que impede alguém de "uniformizar" a regra depois e reabrir a
   * porta que §7.42 fechou.
   */
  it('o N2 escolhe responsável no PRÓPRIO nível — e só ele', () => {
    expect(criacaoExigeResponsavel('N2', 'N2')).toBe(true)
    expect(criacaoExigeResponsavel('N3', 'N3')).toBe(false)
    expect(criacaoExigeResponsavel('N4', 'N4')).toBe(false)
  })

  it('ação de N2 e de CROSS é corporativa: não escolhe loja', () => {
    expect(criacaoEhCorporativa('N2')).toBe(true)
    expect(criacaoEhCorporativa('CROSS')).toBe(true)
    expect(criacaoEhCorporativa('N3')).toBe(false)
    expect(criacaoEhCorporativa('N4')).toBe(false)
  })

  /**
   * A regra é de QUEM ABRE, não do destino — defeito pego no QA da tela
   * (11/09/2026): o formulário do N2 exigia causa ao abrir para um adjunto.
   *
   * O argumento é o nível de quem abre. O N2 abrindo PARA o N4 não marca causa:
   * a diretoria manda fazer, e não vem de Pareto nenhum.
   */
  it('ponto de causa é obrigatório para QUEM ABRE sendo N4', () => {
    expect(criacaoExigePontoCausa('N4')).toBe(true)
    expect(criacaoExigePontoCausa('N3')).toBe(false)
    expect(criacaoExigePontoCausa('N2')).toBe(false)
    expect(criacaoExigePontoCausa('CROSS')).toBe(false)
  })

  /**
   * O agrupamento é escolhido onde ele é INFORMAÇÃO, e deduzido onde é ECO.
   *
   * N4 = a gerência que toca; CROSS = o setor de apoio. Em N2 e N3 ele é o
   * assunto, e o assunto já vem do GD da causa — perguntar seria pedir que a
   * pessoa repita o que acabou de dizer, e abrir espaço para as duas respostas
   * discordarem.
   */
  it('agrupamento: escolhido em N4 e CROSS, deduzido em N2 e N3', () => {
    expect(criacaoExigeAgrupamento('N4')).toBe(true)
    expect(criacaoExigeAgrupamento('CROSS')).toBe(true)
    expect(criacaoExigeAgrupamento('N3')).toBe(false)
    expect(criacaoExigeAgrupamento('N2')).toBe(false)
  })

  it('quem está no CROSS não abre ação', () => {
    expect(niveisQuePodeCriar('CROSS')).toEqual([])
  })
})

describe('estado derivado', () => {
  it('concluída sem feedback fica aguardando feedback, mesmo passado o prazo', () => {
    const a = { concluidaEm: dia(24), nivelAtual: 'N3' as const, prazo: dia(10) }
    expect(statusDe(a, HOJE)).toBe('AGUARDANDO_FEEDBACK')
  })

  it('concluída com feedback é concluída — o ciclo fechou', () => {
    const a = { concluidaEm: dia(24), nivelAtual: 'N3' as const, prazo: dia(10) }
    expect(statusDe(a, HOJE, true)).toBe('CONCLUIDA')
  })

  it('prazo vencido e aberta é atrasada', () => {
    expect(statusDe({ concluidaEm: null, nivelAtual: 'N3', prazo: dia(10) }, HOJE)).toBe('ATRASADA')
  })

  /**
   * A regra que estava invertida: escalação vinha antes do prazo e devolvia
   * 'ESCALADA', escondendo o atraso justamente na ação que saiu da mão de quem
   * escalou — e é ele quem continua respondendo pelo resultado. Ver PLANO §7.5.
   */
  it('atraso NUNCA é mascarado: ação escalada e vencida é atrasada', () => {
    const a = { concluidaEm: null, nivelAtual: 'N2' as const, prazo: dia(10) }
    expect(statusDe(a, HOJE)).toBe('ATRASADA')
  })

  /**
   * REJEITADA, e a exceção que ela abriu (§7.69).
   *
   * É a ÚNICA coisa que passa na frente do atraso, e a decisão foi do analista
   * com o custo à vista: a ação devolvida e vencida sai da conta de atrasadas.
   * O argumento é do GD — ela está parada esperando alguém retomá-la, e é isso
   * que precisa aparecer na reunião.
   *
   * A diferença para o `ESCALADA` do §7.5, que foi removido por mascarar
   * atraso: aquele descrevia a RELAÇÃO de quem olha com a ação (a mesma era
   * "escalada" para um e "em andamento" para outro); este é estado DA AÇÃO,
   * igual para quem quer que abra a tela.
   */
  it('rejeitada vence o atraso — a exceção, escolhida com o custo à vista', () => {
    const a = { concluidaEm: null, nivelAtual: 'N4' as const, prazo: dia(10) }
    expect(statusDe(a, HOJE)).toBe('ATRASADA')
    expect(statusDe(a, HOJE, false, true)).toBe('REJEITADA')
  })

  it('concluída ainda vence rejeitada: quem resolveu, resolveu', () => {
    const a = { concluidaEm: dia(24), nivelAtual: 'N3' as const, prazo: dia(10) }
    expect(statusDe(a, HOJE, true, true)).toBe('CONCLUIDA')
  })

  /**
   * Rejeitar FECHA a ação: *"depois que é rejeitado ele é fechada, não pode
   * mais fazer nada nela"*. Basta existir a rejeição na trilha — e o que
   * garante que nada virá depois dela é `podeAgir`, logo abaixo.
   */
  it('basta EXISTIR a rejeição: ela fecha, não é episódio', () => {
    expect(estaRejeitada([{ tipo: 'ESCALACAO' }, { tipo: 'REJEICAO' }])).toBe(true)
    expect(estaRejeitada([{ tipo: 'ESCALACAO' }, { tipo: 'ATUALIZACAO' }])).toBe(false)
    expect(estaRejeitada([])).toBe(false)
  })

  /**
   * A PORTA ÚNICA. `podeAgir` é por onde passam escalar, direcionar, atualizar,
   * concluir e rejeitar — fechar a ação num lugar só é o que impede uma das
   * cinco de continuar aceitando movimento numa ação encerrada.
   */
  it('ação rejeitada não aceita mais nada, nem do responsável', () => {
    const minha = acao({ responsavelAtualId: 'u1', rejeitada: true })
    expect(podeAgir(usuario('N3', 'u1'), minha)).toBe(false)
  })

  it('o status de uma rejeitada é REJEITADA, e ela está fechada', () => {
    const a = { concluidaEm: null, nivelAtual: 'N4' as const, prazo: dia(30) }
    expect(statusDe(a, HOJE, false, true)).toBe('REJEITADA')
  })

  it('o status não olha o nível — a mesma ação diz o mesmo para todo mundo', () => {
    const prazo = dia(10)
    for (const nivelAtual of ['N2', 'N3', 'N4', 'CROSS'] as NivelAcao[]) {
      expect(statusDe({ concluidaEm: null, nivelAtual, prazo }, HOJE)).toBe('ATRASADA')
    }
  })

  it('SLA: vencido é crítico, três dias é risco, além disso ok', () => {
    expect(slaDe(dia(10), HOJE)).toBe('CRITICO')
    expect(slaDe(dia(26), HOJE)).toBe('RISCO')
    expect(slaDe(dia(27), HOJE)).toBe('RISCO')
    expect(slaDe(dia(28), HOJE)).toBe('OK')
  })
})

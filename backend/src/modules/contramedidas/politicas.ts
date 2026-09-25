/**
 * As regras de quem pode o quê numa contramedida.
 *
 * Módulo **puro**: recebe dados, devolve decisão, não toca banco nem
 * requisição. É o que permite cada regra virar um teste com o nome da regra —
 * e essas regras já mudaram três vezes em 24/08/2026 (o eixo CROSS virou
 * exclusivo do N2, N1 e N5 saíram, direcionar passou a ser só do N2).
 *
 * Errar aqui erra em SILÊNCIO: uma ação escalada para o nível errado não gera
 * exceção, só aparece no quadro de outra pessoa. Por isso as regras moram num
 * lugar só, e as rotas não decidem nada por conta.
 *
 * Ver PLANO.md §7 para o racional de cada uma.
 */

/** Níveis que uma contramedida pode ocupar. Ver PLANO §7 (N1 e N5 saíram). */
/*
 * O UNICO import deste modulo, e ele preserva a pureza: `veTodasAsFiliais` e'
 * um predicado sobre uma string, sem banco e sem requisicao. Duplicar a regra
 * aqui daria duas definicoes de "quem ve a rede inteira" para divergirem em
 * silencio -- e e' exatamente esse tipo de divergencia que este arquivo existe
 * para evitar.
 */
import type { TipoMovimentacao } from '@prisma/client'
import { veTodasAsFiliais } from '../auth/escopo.js'

export type NivelAcao = 'N2' | 'N3' | 'N4' | 'CROSS'

/**
 * Estreita o nível vindo do banco para o que a política conhece.
 *
 * O enum `nivel_type` ainda guarda `N1` e `N5`, reservados desde que saíram da
 * hierarquia (PLANO §7). A política não os conhece, e a alternativa a esta
 * função seria um `as NivelAcao` — que silencia o compilador sem mudar o dado,
 * e faria uma ação em nível reservado atravessar todas as regras sem bater em
 * nada.
 *
 * Falha alto: chegar aqui com N1 ou N5 significa dado inconsistente, e o
 * sintoma silencioso seria uma ação invisível para todo mundo.
 */
export function nivelDaAcao(nivel: string): NivelAcao {
  if (nivel === 'N2' || nivel === 'N3' || nivel === 'N4' || nivel === 'CROSS') return nivel
  throw new Error(
    `Contramedida em nível "${nivel}", que saiu da hierarquia e não tem regra. ` +
      'Corrija o registro: os níveis válidos são N2, N3, N4 e CROSS.',
  )
}

/**
 * A escada, da base ao topo. CROSS fica FORA: é eixo de apoio, não degrau.
 *
 * A ordem do array é a hierarquia — quem depende dela lê daqui em vez de
 * repetir a sequência, que é como duas listas passam a discordar.
 */
const ESCADA = ['N4', 'N3', 'N2'] as const
type NivelDaEscada = (typeof ESCADA)[number]

const naEscada = (n: NivelAcao): n is NivelDaEscada =>
  (ESCADA as readonly NivelAcao[]).includes(n)

/** O que a política precisa saber de um usuário. Menos que o modelo inteiro. */
export interface UsuarioDaPolitica {
  id: string
  nivel: NivelAcao
  /**
   * A loja de quem olha. Nula para o corporativo, que vê todas.
   *
   * Entrou em 31/08/2026 porque a visibilidade era só por NÍVEL, e nível não
   * tem loja: um N4 da Norte via as ações de N4 da Leste. Ver §7.41.
   */
  filialId: string | null
}

/** O que a política precisa saber de uma contramedida. */
export interface AcaoDaPolitica {
  nivelAtual: NivelAcao
  /** De qual loja a ação é — o recorte que faltava. */
  filialId: string
  responsavelAtualId: string
  criadoPorId: string
  concluidaEm: Date | null
  /**
   * FOI REJEITADA — e isso FECHA a ação (10/09/2026).
   *
   * Decisão do analista: *"depois que é rejeitado ele é fechada, não pode mais
   * fazer nada nela"*. É o segundo jeito de uma ação terminar, ao lado da
   * conclusão, e a diferença entre os dois é o desfecho: uma resolveu, a outra
   * foi recusada por quem deveria executá-la.
   *
   * Fica ao lado de `concluidaEm` de propósito — as duas respondem a mesma
   * pergunta em `podeAgir`: "esta ação ainda está viva?".
   */
  rejeitada: boolean
  /**
   * Todo mundo que já SEGUROU a ação: quem abriu, e cada destino desde então.
   *
   * Existe para a visibilidade (§7.34). Inclui o responsável atual, porque ele
   * é o último destino — não é uma lista de "ex", é a lista inteira.
   */
  responsaveisAnteriores: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Ver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vê o próprio nível, todos ABAIXO — **e tudo que já passou pela sua mão**.
 *
 * A terceira parte entrou em 31/08/2026 (§7.34), e ela conserta uma
 * contradição: a tela tem uma aba "Escaladas", definida como "ação num nível
 * acima do meu", e o servidor escondia exatamente essas. A aba era 0 por
 * construção, para todo mundo.
 *
 * O PLANO já tinha decidido o contrário, em §7.5:
 *
 *   "Atraso é da ação, nunca de quem olha. Antes, uma ação escalada e vencida
 *    mostrava apenas 'Escalada', e o atraso sumia -- justamente no caso em que
 *    a ação saiu da sua mão. QUEM ESCALOU CONTINUA RESPONDENDO PELO RESULTADO:
 *    a variável de controle vermelha é dele."
 *
 * E a trilha do card (`N4 João 2d → N3 você 4d → N2 Marina 12d`) só existe se
 * o N4 continuar vendo a ação depois de escalá-la.
 *
 * A exceção do CROSS já dizia a mesma coisa, e só valia para ele: escalar para
 * apoio **não transfere a responsabilidade**, então quem escalou precisa
 * continuar enxergando. Vale igual para a escada — a diferença é que ali a
 * responsabilidade muda de mãos, e a prestação de contas não.
 *
 * **Não é "ver tudo do meu nível para cima".** É só o que passou por mim: um N4
 * continua sem ver a ação que outro N4 escalou.
 */
export function podeVer(usuario: UsuarioDaPolitica, acao: AcaoDaPolitica): boolean {
  if (acao.nivelAtual === 'CROSS') {
    return usuario.nivel === 'CROSS' || acao.responsavelAtualId === usuario.id
  }
  if (usuario.nivel === 'CROSS') return false
  if (!naEscada(usuario.nivel)) return false

  // Passou pela minha mão: continuo respondendo, continuo vendo (§7.34).
  if (acao.responsaveisAnteriores.includes(usuario.id)) return true

  /**
   * A LOJA, antes do nível.
   *
   * Sem isto a visibilidade era só por nível, e nível não tem loja: o n4-teste
   * da Norte abria a lista e via a ação do gerente da Leste. Não
   * dava erro -- dava a reunião de outra loja.
   *
   * `veTodasAsFiliais` é a mesma regra que o painel e os indicadores já
   * seguiam: **só o N2 vê a rede inteira; N3 e N4 veem a sua** (§7.12). A lista
   * de ações era a única que não a aplicava.
   */
  if (!veTodasAsFiliais(usuario.nivel) && usuario.filialId !== acao.filialId) return false

  /**
   * NO MESMO NÍVEL, só o que é MEU.
   *
   * "Ver o próprio nível" tratava todo N4 da loja como um só: o adjunto de
   * Construção via as ações de Não Construção na aba dele, marcadas *A fazer* —
   * trabalho de outra pessoa aparecendo como dele.
   *
   * A lista é de quem olha, não do cargo dele. O que é meu: sou o responsável,
   * eu abri, ou passou pela minha mão (a checagem acima).
   */
  const mesmoNivel = ESCADA.indexOf(acao.nivelAtual) === ESCADA.indexOf(usuario.nivel)
  if (mesmoNivel) {
    return acao.responsavelAtualId === usuario.id || acao.criadoPorId === usuario.id
  }

  /*
   * ABAIXO: vê tudo da loja. É a visão gerencial de §7.5 -- o N3 acompanha o
   * que os adjuntos estão fazendo, e é para isso que a aba existe.
   */
  return ESCADA.indexOf(acao.nivelAtual) < ESCADA.indexOf(usuario.nivel)
}

// ─────────────────────────────────────────────────────────────────────────────
// Agir
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Só o responsável atual age, e só enquanto a ação está aberta.
 *
 * É a regra que impede a ação de virar terra de ninguém: ver é largo, mexer é
 * de uma pessoa. Vale para escalar, atualizar, direcionar e concluir.
 */
/**
 * AÇÃO FECHADA NÃO ACEITA MAIS NADA, e ela fecha de duas formas.
 *
 * `concluidaEm` é o desfecho bom; a rejeição é o outro — *"depois que é
 * rejeitado ele é fechada, não pode mais fazer nada nela"* (10/09/2026).
 *
 * Estar num lugar só importa: `podeAgir` é a porta por onde passam escalar,
 * direcionar, atualizar, concluir e rejeitar. Repetir a checagem em cada rota
 * seria como uma delas ficaria de fora — e a que ficasse permitiria mexer numa
 * ação encerrada, sem erro nenhum na tela.
 */
export function podeAgir(usuario: UsuarioDaPolitica, acao: AcaoDaPolitica): boolean {
  if (acao.concluidaEm !== null || acao.rejeitada) return false
  return acao.responsavelAtualId === usuario.id
}

// ─────────────────────────────────────────────────────────────────────────────
// Escalar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Para onde esta ação pode subir. Lista vazia = não pode escalar.
 *
 * Sobe **exatamente um degrau**, e o eixo CROSS é exclusivo do N2 — acionar
 * outra diretoria é ato de diretoria. Nunca se escala a partir de CROSS, o que
 * combinado com "só o responsável age" significa que uma ação em apoio só sai
 * de lá pelas mãos de quem a colocou.
 *
 * O N2 é o TOPO: pela linha não há para onde subir, só para o apoio. É
 * deliberado — a diretoria é quem responde pelo indicador.
 */
export function destinosDeEscalacao(
  usuario: UsuarioDaPolitica,
  acao: AcaoDaPolitica,
): NivelAcao[] {
  if (!podeAgir(usuario, acao)) return []
  if (acao.nivelAtual === 'CROSS') return []

  const destinos: NivelAcao[] = []
  const i = ESCADA.indexOf(acao.nivelAtual)
  const acima = ESCADA[i + 1]
  if (acima) destinos.push(acima)
  if (acao.nivelAtual === 'N2') destinos.push('CROSS')
  return destinos
}

/**
 * Escalar para CROSS **mantém** o responsável; para a linha, transfere.
 *
 * Está numa função própria porque contraria a leitura natural do modelo: numa
 * movimentação de escalação para CROSS, `responsavel_destino_id` aponta de
 * volta para o autor. Quem ler o registro sem saber disso vai achar que é bug.
 */
export function escalacaoTransfereResponsavel(destino: NivelAcao): boolean {
  return destino !== 'CROSS'
}


// ─────────────────────────────────────────────────────────────────────────────
// Direcionar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Direcionar é **só do N2** (24/08/2026), e só no que está com ele.
 *
 * A ação troca de dono e continua no mesmo nível. O destino é qualquer usuário
 * de perfil classificado como N2, o próprio excluído — direcionar para si é
 * operação sem efeito, e oferecê-la na lista só gera confusão.
 */
export function podeDirecionar(usuario: UsuarioDaPolitica, acao: AcaoDaPolitica): boolean {
  return usuario.nivel === 'N2' && podeAgir(usuario, acao)
}

export function ehDestinoValidoDeDirecionamento(
  usuario: UsuarioDaPolitica,
  destino: UsuarioDaPolitica,
): boolean {
  return destino.nivel === 'N2' && destino.id !== usuario.id
}

// ─────────────────────────────────────────────────────────────────────────────
// Marcar ponto de causa
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marca quem tem a VARIÁVEL associada ao perfil — não quem tem o nível.
 *
 * O critério é a associação de `perfil_variavel`, a mesma que a tela de
 * administração configura por `(id_perfil, nomloc, cod_empresa)`. Isso já
 * significa que a pessoa é responsável por aquela variável na loja dela; exigir
 * o nível além disso seria uma segunda regra dizendo a mesma coisa, e as duas
 * poderiam discordar.
 *
 * Ausência de associação nega — mesma regra do login, que bloqueia perfil sem
 * nível. Quem não foi configurado não marca nada.
 *
 * O conjunto vem de fora porque a consulta é do banco e esta camada é pura.
 */
export function podeMarcarPontoCausa(
  ponto: { variavelControleId: string },
  variaveisDoPerfil: ReadonlySet<string>,
): boolean {
  return variaveisDoPerfil.has(ponto.variavelControleId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Criar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Em que níveis cada um pode ABRIR ação: **o próprio e todos abaixo**.
 *
 * - N4 só abre para ele mesmo — é a base.
 * - N3 abre para ele e para o N4.
 * - N2 abre para ele, para o N3 e para o N4.
 *
 * Diferente da escalação, que sobe **um** degrau: criar alcança qualquer nível
 * abaixo. O N2 pode abrir direto no N4 sem passar pelo N3, e isso é
 * deliberado — é a diretoria mandando fazer.
 *
 * **O N2 também abre no CROSS**, e ali não se indica usuário: a ação fica com
 * ele. É a mesma regra da escalação para o apoio — o setor ganha visibilidade,
 * a responsabilidade não muda de mãos. Nenhum outro nível alcança o eixo.
 */
const CRIACAO: Record<NivelAcao, readonly NivelAcao[]> = {
  N2: ['N2', 'N3', 'N4', 'CROSS'],
  N3: ['N3', 'N4'],
  N4: ['N4'],
  CROSS: [],
}

export function niveisQuePodeCriar(nivel: NivelAcao): readonly NivelAcao[] {
  return CRIACAO[nivel]
}

/**
 * Abrir ação exige indicar o responsável — só quando se abre ABAIXO.
 *
 * Três casos, e dois deles não têm escolha nenhuma:
 *
 *   NO MEU NÍVEL   a ação é minha. Não se delega para o colega de mesmo
 *                  degrau: quem manda no trabalho dele é o nível acima, e
 *                  oferecer a lista ali seria oferecer o poder de encher a
 *                  agenda de outra pessoa sem passar por ninguém.
 *   NO CROSS       fica com quem abriu -- o eixo de apoio não transfere a
 *                  responsabilidade (§7.5).
 *   ABAIXO         aí sim: o N3 abre para um adjunto, e precisa dizer qual.
 *
 * Decisão do analista, 31/08/2026: *"no seu nível a atividade só pode ser
 * aberta para si próprio; só pode escolher se abrir nível abaixo"*.
 *
 * A tela usa isto para desenhar o campo, e a criação usa o MESMO para recusar
 * (§7.42) -- oferecer uma escolha que o servidor nega é o defeito que a
 * política existe para não ter.
 */
/**
 * Ação aberta NO CORPORATIVO não escolhe loja — ela nasce no corporativo.
 *
 * `contramedida.filial_id` é NOT NULL: toda ação mora numa linha de `filial`.
 * Para N3 e N4 isso é natural — a ação é de uma loja. Para o N2 e para o CROSS
 * não era: os dois são corporativos por natureza, e a tela pedia que se
 * escolhesse uma das nove lojas para uma ação que não é de nenhuma. A escolha
 * não vazava a ação para a loja (N3 e N4 não enxergam nível acima), mas
 * DESLOCAVA: ao abrir o GD daquela loja, o próprio N2 via a ação corporativa
 * dele listada entre as ações de lá.
 *
 * A saída não é coluna anulável — seria espalhar `if (filial === null)` por
 * toda consulta que hoje é direta. É usar a linha que o cadastro já tem:
 * `99-CORPORATIVO`, `tipo = CORPORATIVO`, nome "Corporativo". Decisão do
 * analista em 11/09/2026: *"em vez de rede coloque corporativo, setado"* — sem
 * escolha, e por isso sem chance de errar.
 *
 * **Vale só na CRIAÇÃO.** Uma ação que SOBE de nível — o N4 escala para o N3, o
 * N3 para o N2 — guarda a loja onde nasceu, e tem de guardar: ela continua
 * sendo o problema daquela loja, sendo tratado mais em cima. Aplicar esta regra
 * na escalação apagaria a origem justamente no caso em que ela mais importa.
 */
export function criacaoEhCorporativa(destino: NivelAcao): boolean {
  return destino === 'N2' || destino === 'CROSS'
}

export function criacaoExigeResponsavel(destino: NivelAcao, meuNivel: NivelAcao): boolean {
  if (destino === 'CROSS') return false
  /*
   * Quem não está na escada não abre abaixo de ninguém -- é o CROSS, e a ação
   * dele fica com quem abriu. `naEscada` estreita o tipo para o `indexOf`.
   */
  if (!naEscada(meuNivel)) return false
  if (ESCADA.indexOf(destino) < ESCADA.indexOf(meuNivel)) return true

  /**
   * **A EXCEÇÃO DO N2**, aberta pelo analista em 11/09/2026.
   *
   * A regra de 31/08 -- *"no seu nível a atividade só pode ser aberta para si
   * próprio"* -- continua valendo para N3 e N4, e pelo motivo original: quem
   * manda no trabalho do colega de mesmo degrau é o nível acima, e oferecer a
   * lista ali seria oferecer o poder de encher a agenda de outra pessoa sem
   * passar por ninguém.
   *
   * No N2 não há "nível acima": *"o n2 é corporativo, pode ter mais
   * liberdade"*. A diretoria se organiza entre pares, e o degrau que protegeria
   * os outros dois não existe aqui.
   *
   * Escrito como exceção explícita, e não afrouxando a regra geral: o próximo
   * a ler precisa ver que N3 e N4 continuam fechados de propósito.
   */
  return meuNivel === 'N2' && destino === 'N2'
}

/**
 * Marcar o PONTO DE CAUSA é de QUEM ABRE SENDO N4 — e não de quem abre PARA o
 * N4.
 *
 * A diferença é o defeito que o QA da tela pegou em 11/09/2026. Eu tinha
 * amarrado a regra ao DESTINO, e o formulário do N2 passou a exigir a causa ao
 * abrir uma ação para um adjunto -- que é justamente o caso em que ela não
 * existe: a diretoria manda fazer, não vem de Pareto nenhum. A especificação do
 * analista lista o ponto de causa uma vez só, em *"n4 ao abrir"*.
 *
 * O ciclo do GD nasce na ponta: é o N4 que, na reunião, olha a variável
 * vermelha e aponta a causa. Ação que nasce ali sem causa seria contramedida
 * sem problema, e o Pareto da reunião perderia a linha.
 *
 * De quem abre de cima a exigência não faz sentido: o N2 abre "renegociar
 * contrato com o fornecedor" e não há ponto de causa de reunião nenhuma por
 * trás. Obrigar a escolher um faria a pessoa apontar qualquer um para o
 * formulário deixar enviar -- e um dado inventado é pior que um dado ausente.
 *
 * **Opcional, e não ausente** (decisão do analista, 11/09/2026). O campo
 * continua na tela para N2 e N3: quem quiser amarrar a ação ao vermelho que a
 * motivou, amarra. É esse elo que faz a ação aparecer no bloco "o que já está
 * sendo feito" ao lado do indicador que a gerou (§7.43) -- sem ele, a ação
 * existe e some daquela tela.
 */
export function criacaoExigePontoCausa(meuNivel: NivelAcao): boolean {
  return meuNivel === 'N4'
}

/**
 * ESCOLHER o agrupamento é de quem abre para N4 ou para o CROSS.
 *
 * Nos dois a etiqueta é informação que só a pessoa tem, e não dá para deduzir:
 * no N4 ela é a GERÊNCIA que vai tocar -- e o problema atravessa fronteira,
 * então o gerente abre para a gerência ao lado quando é o caso. No CROSS é o
 * SETOR de apoio.
 *
 * Em N2 e N3 a etiqueta é o assunto, e o assunto o sistema já sabe: vem do GD
 * do ponto de causa. Perguntar seria pedir que a pessoa repita o que ela
 * acabou de dizer ao escolher a causa -- e abrir espaço para as duas
 * discordarem.
 */
export function criacaoExigeAgrupamento(destino: NivelAcao): boolean {
  return destino === 'N4' || destino === 'CROSS'
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado derivado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Status é da AÇÃO: quatro valores, iguais para quem quer que abra a tela.
 *
 * `ESCALADA` saiu (PLANO §7.5). Ela descrevia a relação de QUEM OLHA com a
 * ação, não o estado dela — a mesma ação era "escalada" para quem escalou e
 * "em andamento" para quem a recebeu. Isso agora é filtro, não status.
 */
export type StatusAcao =
  | 'CONCLUIDA'
  | 'AGUARDANDO_FEEDBACK'
  | 'REJEITADA'
  | 'ATRASADA'
  | 'EM_ANDAMENTO'
export type Sla = 'CRITICO' | 'RISCO' | 'OK'

/** Dias de antecedência a partir dos quais o prazo entra em risco. */
const DIAS_DE_RISCO = 3

/**
 * O status é CALCULADO, nunca gravado.
 *
 * Gravado, ele envelheceria sozinho: uma ação venceria à meia-noite e
 * continuaria verde no banco até alguém rodar um job.
 *
 * A ordem das perguntas é a regra:
 *
 *  - **concluída primeiro**, porque uma ação concluída depois do prazo não é
 *    "atrasada", é concluída;
 *  - **rejeitada antes do atraso** (10/09/2026, decisão do analista). Ver
 *    abaixo — é a única exceção ao "atraso por último", e foi escolhida com o
 *    custo à vista;
 *  - **atraso depois**. Antes, escalação vinha antes do prazo e devolvia
 *    `ESCALADA` — o que escondia o atraso justamente na ação que saiu da mão de
 *    quem escalou, que é quem continua respondendo pelo resultado.
 *
 * **REJEITADA E O CUSTO QUE ELA COBRA.** Pôr qualquer coisa antes do prazo é o
 * defeito que derrubou o `ESCALADA` do §7.5: uma ação rejeitada e vencida sai
 * da conta de atrasadas. O analista escolheu assim mesmo, e o argumento é o do
 * GD: a ação devolvida está PARADA esperando alguém retomá-la, e é isso que
 * precisa aparecer na reunião. Atraso sem dono não move ninguém.
 *
 * A diferença para o `ESCALADA` é que este é um estado DA AÇÃO, igual para
 * quem quer que abra a tela — e não a relação de quem olha com ela, que era o
 * defeito de fundo daquele.
 */
export function statusDe(
  acao: { concluidaEm: Date | null; nivelAtual: NivelAcao; prazo: Date },
  hoje: Date,
  temFeedback = false,
  /**
   * A última movimentação foi uma devolução, e ninguém mexeu depois.
   *
   * Derivado, como todo o resto: ver `estaRejeitada`. Uma coluna `rejeitada` no
   * banco precisaria ser apagada por quem retomasse a ação, e o dia em que
   * alguém esquecesse deixaria a ação marcada para sempre.
   */
  rejeitada = false,
): StatusAcao {
  if (acao.concluidaEm !== null) return temFeedback ? 'CONCLUIDA' : 'AGUARDANDO_FEEDBACK'
  if (rejeitada) return 'REJEITADA'
  if (acao.prazo < hoje) return 'ATRASADA'
  return 'EM_ANDAMENTO'
}

/**
 * A ação foi rejeitada — e isso a FECHA.
 *
 * **Basta EXISTIR uma rejeição na trilha**, e não "ser a última movimentação".
 * As duas leituras davam no mesmo resultado enquanto a rejeição fosse
 * terminal — e é justamente por ser terminal que a forma simples é a correta:
 * depois dela não há movimento nenhum, porque `podeAgir` recusa todos.
 *
 * Chegou a ser `at(-1)?.tipo === 'REJEICAO'`, de quando rejeitar era um
 * episódio que a próxima movimentação encerrava. A regra mudou no mesmo dia
 * (*"depois que é rejeitado ele é fechada"*), e manter a versão anterior
 * deixaria uma porta aberta: uma linha gravada por fora — uma correção em
 * produção, uma carga — devolveria a ação à vida sem ninguém pedir.
 */
export function estaRejeitada(movimentacoes: ReadonlyArray<{ tipo: TipoMovimentacao }>): boolean {
  return movimentacoes.some((m) => m.tipo === 'REJEICAO')
}

export function slaDe(prazo: Date, hoje: Date): Sla {
  if (prazo < hoje) return 'CRITICO'
  const limite = new Date(hoje)
  limite.setUTCDate(limite.getUTCDate() + DIAS_DE_RISCO)
  return prazo <= limite ? 'RISCO' : 'OK'
}

/**
 * PODE CAIR TRABALHO NA MÃO DESTA PESSOA?
 *
 * Terceira pergunta do cadastro, e independente das outras duas: `nivel` diz o
 * que a pessoa **vê**, `papelAdmin` diz o que ela **configura**, e esta diz se
 * a cadeia de ajuda pode entregar uma ação a ela.
 *
 * Existe para quem administra o portal sem participar do GD — vê o quadro do
 * N2, classifica perfil, dispara carga, e **não é N2**: não aparece na lista de
 * destinatários e não recebe escalação nem direcionamento. Pedido do analista
 * em 14/09/2026.
 *
 * **Inativo também não recebe**, e isso não é novidade desta regra: `direcionar`
 * e `rejeitar` já recusavam destino inativo, cada um por conta. Reunir as duas
 * condições aqui é o que faz a checagem no `movimentar` valer para as duas.
 */
export function podeReceberAcao(
  pessoa: Readonly<{ ativo: boolean; recebeAcao: boolean }>,
): boolean {
  return pessoa.ativo && pessoa.recebeAcao
}

/**
 * Os movimentos que ENTREGAM TRABALHO — os que a regra acima barra.
 *
 * `REJEICAO` fica de fora **de propósito**, e é a única exceção. Devolver uma
 * ação rejeitada a quem a abriu não entrega trabalho: entrega o aviso de que
 * ela voltou. A ação está encerrada (`movimentar` recusa qualquer movimento
 * numa ação rejeitada, inclusive atualização), então não há o que fazer com
 * ela — só saber.
 *
 * Barrar a devolução seria pior nos dois lados: prenderia a ação com quem já
 * disse que não é sua, e esconderia de quem a abriu que ela foi recusada. O
 * caso aparece assim que alguém que não recebe ação abre uma para outra pessoa,
 * que é justamente o que se espera dessa categoria — ver `origemDaMao`.
 *
 * `ATUALIZACAO`, `CONCLUSAO` e `FEEDBACK` também não trocam de mão, mas passam
 * por `movimentar` com o responsável ATUAL no destino. Incluí-los faria a
 * checagem barrar alguém de mexer numa ação que já é dele — o que só
 * aconteceria se a flag tivesse sido ligada depois, e é exatamente o caso em
 * que a ação precisa continuar podendo sair da mão dele.
 */
const ENTREGA_TRABALHO = new Set<TipoMovimentacao>(['ESCALACAO', 'DIRECIONAMENTO'])

export function movimentoEntregaTrabalho(tipo: TipoMovimentacao): boolean {
  return ENTREGA_TRABALHO.has(tipo)
}

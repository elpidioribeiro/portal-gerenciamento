import type { FastifyInstance } from 'fastify'
import type { Prisma, PrismaClient, TipoMovimentacao, Usuario } from '@prisma/client'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { agora } from '../../lib/datas.js'
import { DadosInvalidos, NaoAutorizado, NaoEncontrado } from '../../lib/erros.js'
import { veTodasAsFiliais } from '../auth/escopo.js'
import {
  criacaoEhCorporativa,
  criacaoExigeAgrupamento,
  criacaoExigePontoCausa,
  criacaoExigeResponsavel,
  destinosDeEscalacao,
  ehDestinoValidoDeDirecionamento,
  escalacaoTransfereResponsavel,
  estaRejeitada,
  niveisQuePodeCriar,
  podeAgir,
  podeDirecionar,
  podeVer,
  nivelDaAcao,
  slaDe,
  statusDe,
  movimentoEntregaTrabalho,
  podeReceberAcao,
  type NivelAcao,
} from './politicas.js'
import { gerenciaDoPerfil } from '../../lib/gerencia-do-perfil.js'

/**
 * As rotas de contramedida. **Não decidem nada**: quem decide é `politicas.ts`.
 *
 * A separação é deliberada. As regras mudaram três vezes em 24/08/2026, e cada
 * mudança precisa acontecer num arquivo só — espalhá-las pelas rotas é como
 * duas passam a discordar, e discordância de regra aqui não gera erro: a ação
 * simplesmente aparece no quadro de outra pessoa.
 */

const nivelEnum = z.enum(['N2', 'N3', 'N4', 'CROSS'])
const statusEnum = z.enum([
  'CONCLUIDA',
  'AGUARDANDO_FEEDBACK',
  'REJEITADA',
  'ATRASADA',
  'EM_ANDAMENTO',
])
const prioridadeEnum = z.enum(['ALTA', 'MEDIA', 'BAIXA'])
const resultadoEnum = z.enum(['META_ATINGIDA', 'MELHORA_PARCIAL', 'SEM_EFEITO'])

const erroSchema = z.object({
  erro: z.string(),
  codigo: z.string(),
  requestId: z.string().optional(),
})

const resumoSchema = z.object({
  codigo: z.string(),
  /** Quem abriu foi quem está olhando — ver `paraResumo`. */
  criadoPorMim: z.boolean(),
  /**
   * A ação está NA MINHA MÃO — e não apenas no meu nível.
   *
   * Faltava, e a lista supria com uma suposição que deixou de valer: *"ação no
   * meu nível é minha"*. Isso era garantido por §7.42 enquanto ninguém podia
   * pôr ação na mão de um par — mas `direcionar` sempre pôde (é só do N2, troca
   * o dono e MANTÉM o nível), e desde §7.72 abrir para um par também põe.
   *
   * O sintoma, relatado pelo analista: *"o n2-teste abriu a atividade para
   * Andre Pontes e no usuário dele tá 'a fazer'"*. A ação de outra pessoa
   * aparecia como tarefa dele.
   *
   * Booleano e não o id, pela mesma razão de `criadoPorMim`: a tela só precisa
   * saber se é ela.
   */
  souOResponsavel: z.boolean(),
  /**
   * Quem ABRIU a ação, com o nível — e não é sempre quem a executa.
   *
   * O N2 abre para o N4 (§7.42), e daí o quadro do N4 ganha um card que ele não
   * criou. Saber de quem veio é metade do contexto: sem isso, a ação aparece
   * como se tivesse nascido sozinha.
   *
   * `criadoPorMim` responde outra pergunta — "o feedback é meu?" — e não serve
   * para esta: ele é um booleano, e o que falta aqui é o nome. Até agora o nome
   * só existia como o primeiro passo da trilha, onde estava rotulado errado.
   */
  abertaPor: z.object({ nome: z.string(), nivel: nivelEnum }),
  titulo: z.string(),
  nivelAtual: nivelEnum,
  prioridade: prioridadeEnum,
  prazo: z.string(),
  criadoEm: z.string(),
  concluidaEm: z.string().nullable(),
  filial: z.string(),
  /** O agrupamento é a COLUNA do quadro. Sem ele a tela não sabe onde por o card. */
  agrupamento: z.object({ nome: z.string(), grupo: z.string().nullable() }),
  indicador: z.string().nullable(),
  responsavel: z.string(),
  /** Derivados na leitura. Ver o comentário em `politicas.statusDe`. */
  status: statusEnum,
  sla: z.enum(['CRITICO', 'RISCO', 'OK']),
  diasEmAberto: z.number().int(),
  /**
   * Por onde a ação passou, com o tempo em cada nível.
   *
   * Vai no RESUMO e não só no detalhe porque o card precisa dela: o tempo em
   * cada etapa é o que responde a pergunta 2 da reunião — o que foi tentado e
   * por que não resolveu — cujo propósito é verificar se a cadeia de ajuda
   * funcionou. Um card que só mostra onde a ação está agora esconde esse dado.
   *
   * Um passo só significa que nunca foi escalada; a tela não desenha trilha
   * nesse caso.
   */
  trilha: z.array(z.object({ nivel: nivelEnum, quem: z.string(), dias: z.number().int() })),
})

/**
 * O que ESTE usuário pode fazer nesta ação, decidido pelo servidor.
 *
 * Vai na resposta do detalhe porque a alternativa é a tela recalcular as regras
 * em JavaScript — uma segunda cópia que envelhece sozinha e, pior, dá a
 * impressão de segurança sem ser. A autorização real continua sendo verificada
 * em cada rota; isto existe para a tela saber qual botão desenhar.
 */
const permissoesSchema = z.object({
  /**
   * Prestar contas sem soltar a ação.
   *
   * Faltava, e o botão aparecia SEMPRE: numa ação concluída o clique voltava
   * 403, e voltaria também na rejeitada -- "botão que só serve para errar", o
   * mesmo defeito que `podeDarFeedback` e `podeRejeitar` já evitavam.
   */
  podeAtualizar: z.boolean(),
  podeEscalar: z.boolean(),
  destinosDeEscalacao: z.array(nivelEnum),
  podeDirecionar: z.boolean(),
  podeDarFeedback: z.boolean(),
  podeConcluir: z.boolean(),
  podeRejeitar: z.boolean(),
})

const DIA_MS = 86_400_000
const iso = (d: Date) => d.toISOString()
const soData = (d: Date) => iso(d).slice(0, 10)

/** Uma contramedida com o que as rotas precisam ler junto. */
const COM_RELACOES = {
  filial: { select: { sigla: true, nome: true, tipo: true } },
  indicador: { select: { codigo: true, nome: true } },
  responsavelAtual: { select: { id: true, nome: true, nivel: true } },
  criadoPor: { select: { nome: true, nivel: true } },
  bucket: { select: { nome: true, grupo: true } },
  /**
   * TODAS as movimentações, em ordem — a trilha precisa da sequência inteira.
   *
   * Custa uma linha por movimento por ação. Aceitável pelo mesmo motivo que o
   * filtro de visibilidade roda em memória: o volume é de contramedidas de uma
   * diretoria, não de fatos. Quando passar de alguns milhares, o corte é
   * paginar a lista, não adivinhar a trilha.
   */
  movimentacoes: {
    orderBy: { criadoEm: 'asc' },
    select: {
      tipo: true,
      criadoEm: true,
      nivelDestino: true,
      /*
       * O ID vai junto do nome porque a VISIBILIDADE depende dele: quem já
       * segurou a ação continua vendo depois de escalar (§7.34). Sem o id, a
       * trilha sabe por quantas mãos ela passou e não sabe de quem são.
       */
      responsavelDestinoId: true,
      responsavelDestino: { select: { nome: true } },
      /*
       * O NÍVEL DE ORIGEM e o AUTOR estavam gravados e ninguém os lia.
       *
       * São eles que sabem onde a ação ESTAVA e com quem — e é a única fonte
       * disso, porque `nivelAtual` e `responsavelAtualId` mudam a cada
       * movimento. Sem os dois, a trilha tinha de supor que quem criou era o
       * primeiro responsável, e essa suposição só vale quando se abre para si.
       */
      nivelOrigem: true,
      autorId: true,
      autor: { select: { nome: true } },
    },
  },
} satisfies Prisma.ContramedidaInclude

type DoBanco = Prisma.ContramedidaGetPayload<{ include: typeof COM_RELACOES }>

/**
 * A contramedida como o resto do módulo a enxerga: com o nível já estreitado.
 *
 * O enum do banco ainda guarda `N1` e `N5`; a política não os conhece. Estreitar
 * UMA vez, ao carregar, em vez de chamar `nivelDaAcao()` em cada uso, é o que
 * impede a próxima rota de esquecer — e um esquecimento aqui não daria erro de
 * tipo se o objeto cru circulasse, porque `Nivel` é atribuível a `string`.
 */
type ComRelacoes = Omit<DoBanco, 'nivelAtual'> & {
  nivelAtual: NivelAcao
  /** A ação foi rejeitada, e por isso está fechada. Ver `estaRejeitada`. */
  rejeitada: boolean
  /** As mãos pelas quais a ação passou — ver `maosPorQuePassou`. */
  responsaveisAnteriores: string[]
}

/**
 * As MÃOS pelas quais a ação passou — quem a abriu, e cada destino desde então.
 *
 * É o que sustenta a regra de visibilidade de §7.34: quem escalou continua
 * respondendo pelo resultado, então continua enxergando. Sai da mesma lista que
 * monta a trilha do card; a trilha mostra os nomes, isto compara os ids.
 */
const maosPorQuePassou = (c: DoBanco): string[] => [
  c.criadoPorId,
  /*
   * O responsável ATUAL entra: quando a ação foi aberta PARA o nível abaixo,
   * ele nunca foi destino de movimentação nenhuma -- era o primeiro
   * responsável, e isso não gera movimento. Sem ele aqui, o N4 para quem o N2
   * abriu a ação a perdia de vista no instante em que escalasse: some do quadro
   * de quem mais deveria acompanhar.
   */
  c.responsavelAtualId,
  /*
   * E os AUTORES: `podeAgir` exige ser o responsável atual, então quem
   * movimentou segurava a ação naquele momento. É o que recupera o responsável
   * inicial depois que ele já escalou -- `responsavelAtualId` já não é ele.
   */
  ...c.movimentacoes.map((m) => m.autorId),
  /*
   * Sem `.filter(id => id !== null)`: `movimentacao.responsavel_destino_id` e'
   * NOT NULL no schema, entao o filtro nunca cortou uma linha. Defendia de um
   * caso que o banco proibe, e ao mesmo tempo sugeria a quem le que movimento
   * sem destino existe.
   */
  ...c.movimentacoes.map((m) => m.responsavelDestinoId),
]

const estreitar = (c: DoBanco): ComRelacoes => ({
  ...c,
  nivelAtual: nivelDaAcao(c.nivelAtual),
  /*
   * Calculado UMA vez, aqui, e não em cada rota: `podeAgir` é consultado em
   * seis lugares, e a rota que esquecesse deixaria mexer numa ação encerrada.
   */
  rejeitada: estaRejeitada(c.movimentacoes),
  responsaveisAnteriores: maosPorQuePassou(c),
})

/**
 * Monta a trilha: um passo por mão pela qual a ação passou.
 *
 * O primeiro passo é a abertura; cada escalação ou direcionamento acrescenta
 * um. Os dias de um passo são até o passo seguinte — e o último conta até a
 * conclusão, ou até hoje se ainda está aberta, que é o número que expõe ação
 * parada.
 */
/**
 * Os movimentos que TROCAM A MÃO da ação — os que viram passo na trilha.
 *
 * `REJEICAO` entra porque devolver é trocar de mão como qualquer escalação: se
 * ficasse fora, a ação apareceria na trilha ainda no nível de quem a rejeitou,
 * e os dias parados seriam contados para a pessoa errada. Uma rejeição que não
 * aparece na trilha é exatamente a falha de cadeia de ajuda que ninguém
 * consegue mostrar na reunião.
 *
 * `ATUALIZACAO`, `CONCLUSAO` e `FEEDBACK` ficam fora: nenhum deles passa a bola
 * (ver as rotas — todos mandam `responsavelDestinoId` igual ao atual).
 */
const TROCA_DE_MAO = new Set<TipoMovimentacao>(['ESCALACAO', 'DIRECIONAMENTO', 'REJEICAO'])

function trilhaDe(c: ComRelacoes, hoje: Date) {
  const troca = c.movimentacoes.filter((m) => TROCA_DE_MAO.has(m.tipo))
  /*
   * O PRIMEIRO PASSO é onde a ação nasceu, e não o nível de quem a abriu.
   *
   * Eram a mesma coisa enquanto só se abria ação para si. Depois do §7.42 o N2
   * abre para o N4, e o passo inicial passou a mentir: uma ação criada pelo N2,
   * escalada pelo N4 ao N3, tinha trilha "N2 -> N3" — o degrau onde ela de fato
   * esteve sumia, e com ele o trabalho que o N4 fez antes de escalar.
   *
   * Sai da primeira TROCA, que grava de onde veio (`nivelOrigem`) e quem a fez
   * (`autor` — que só pode ser o responsável, por `podeAgir`). Sem troca
   * nenhuma, a ação ainda está onde nasceu, e o par atual é o inicial.
   */
  const primeira = troca[0]
  const passos = [
    {
      nivel: primeira ? nivelDaAcao(primeira.nivelOrigem) : c.nivelAtual,
      quem: primeira ? primeira.autor.nome : c.responsavelAtual.nome,
      desde: c.criadoEm,
    },
    ...troca.map((m) => ({
      nivel: nivelDaAcao(m.nivelDestino),
      quem: m.responsavelDestino.nome,
      desde: m.criadoEm,
    })),
  ]
  const fim = c.concluidaEm ?? hoje
  return passos.map((p, i) => {
    const ate = passos[i + 1]?.desde ?? fim
    return {
      nivel: p.nivel,
      quem: p.quem,
      dias: Math.max(0, Math.floor((ate.getTime() - p.desde.getTime()) / DIA_MS)),
    }
  })
}

/**
 * PARA QUEM a rejeição devolve: quem colocou a ação na mão de quem está com ela.
 *
 * Rejeitar é desfazer o último repasse, e não "mandar para o nível de baixo".
 * A diferença aparece no §7.42, em que o N2 abre ação PARA o N4: ali não houve
 * repasse nenhum, e devolver "para baixo" não teria destino — o certo é voltar
 * a quem abriu. Também aparece no DIRECIONAMENTO, que troca de dono no mesmo
 * nível: devolver para baixo mandaria a ação para um nível onde ela nunca
 * esteve.
 *
 * `null` quando não há a quem devolver — a pessoa abriu a ação para si mesma e
 * nunca a passou. É o caso em que o botão não deve existir: rejeitar a própria
 * ação é fechá-la, e para isso existe outra conversa.
 */
function origemDaMao(c: ComRelacoes): { responsavelId: string; nivel: NivelAcao } | null {
  /*
   * De trás para frente: interessa o ÚLTIMO repasse que terminou em quem
   * segura a ação hoje. Pegar o primeiro devolveria para quem a passou há três
   * mãos atrás.
   */
  const repasse = [...c.movimentacoes]
    .reverse()
    .find((m) => TROCA_DE_MAO.has(m.tipo) && m.responsavelDestinoId === c.responsavelAtualId)

  if (repasse) return { responsavelId: repasse.autorId, nivel: nivelDaAcao(repasse.nivelOrigem) }

  // Sem repasse: a ação está com o primeiro responsável. Só há destino se
  // outra pessoa a abriu para ele.
  if (c.criadoPorId !== c.responsavelAtualId) {
    return { responsavelId: c.criadoPorId, nivel: nivelDaAcao(c.criadoPor.nivel) }
  }
  return null
}

function paraResumo(c: ComRelacoes, hoje: Date, quemOlha: string) {
  return {
    codigo: c.codigo,
    /**
     * Quem ABRIU foi quem está olhando.
     *
     * A tela precisa disto para separar "aguardando feedback" de "aguardando o
     * MEU feedback": eram a mesma coisa para ela, e por isso uma ação concluída
     * pelo N4 aparecia em *A fazer* do N3, que não tem feedback nenhum a dar.
     *
     * Um booleano e não o id de quem abriu: a tela só precisa saber se é ela, e
     * mandar o id seria expor identidade de usuário numa lista que qualquer
     * nível acima enxerga.
     */
    criadoPorMim: c.criadoPorId === quemOlha,
    souOResponsavel: c.responsavelAtualId === quemOlha,
    abertaPor: { nome: c.criadoPor.nome, nivel: nivelDaAcao(c.criadoPor.nivel) },
    titulo: c.titulo,
    nivelAtual: c.nivelAtual,
    prioridade: c.prioridade,
    prazo: soData(c.prazo),
    criadoEm: iso(c.criadoEm),
    concluidaEm: c.concluidaEm ? iso(c.concluidaEm) : null,
    /*
     * A SIGLA para loja, o NOME para o que não é loja.
     *
     * O card escreve isto direto ("NOR · Fulano · 3 dias"), e a sigla da linha
     * corporativa é `99-CORPORATIVO` -- código de cadastro, não rótulo. Ficava
     * assim no card enquanto o formulário, na mesma tela, dizia "Corporativo".
     * Pego no QA de 11/09/2026.
     *
     * O campo sempre foi de exibição: nenhum cliente compara ou filtra por ele
     * (o recorte por loja vai na querystring, não daqui).
     */
    filial: c.filial.tipo === 'FILIAL' ? c.filial.sigla : c.filial.nome,
    agrupamento: { nome: c.bucket.nome, grupo: c.bucket.grupo },
    indicador: c.indicador?.codigo ?? null,
    responsavel: c.responsavelAtual.nome,
    status: statusDe(
      { concluidaEm: c.concluidaEm, nivelAtual: c.nivelAtual, prazo: c.prazo },
      hoje,
      c.movimentacoes.some((m) => m.tipo === 'FEEDBACK'),
      estaRejeitada(c.movimentacoes),
    ),
    sla: slaDe(c.prazo, hoje),
    diasEmAberto: Math.floor((hoje.getTime() - c.criadoEm.getTime()) / DIA_MS),
    trilha: trilhaDe(c, hoje),
  }
}

/**
 * Gera o código `AC-0000` DENTRO da transação, por sequence do banco.
 *
 * `MAX(codigo) + 1` na aplicação não serve: duas criações simultâneas leem o
 * mesmo máximo e geram o mesmo código. A sequence é atômica por construção, e
 * é o único lugar onde a unicidade pode ser garantida sob concorrência.
 */
async function proximoCodigo(tx: Prisma.TransactionClient): Promise<string> {
  const [linha] = await tx.$queryRaw<
    { codigo: string }[]
  >`SELECT 'AC-' || lpad(nextval('contramedida_codigo_seq')::text, 4, '0') AS codigo`
  if (!linha) throw new Error('A sequence de código de contramedida não devolveu valor.')
  return linha.codigo
}

/** Carrega a ação pelo código e recusa quem não pode vê-la. */
async function carregar(prisma: PrismaClient, codigo: string, usuario: Usuario) {
  const bruta = await prisma.contramedida.findUnique({
    where: { codigo },
    include: COM_RELACOES,
  })
  if (!bruta) throw new NaoEncontrado(`Contramedida ${codigo} não existe.`)
  const acao = estreitar(bruta)

  const quem = { id: usuario.id, nivel: nivelDaAcao(usuario.nivel), filialId: usuario.filialId }
  /**
   * Quem não pode ver recebe 404, não 403.
   *
   * Responder "existe mas você não pode ver" confirma a existência de uma ação
   * de outro nível para quem perguntou pelo código — e os códigos são
   * sequenciais, então dá para varrer.
   */
  if (!podeVer(quem, acao)) throw new NaoEncontrado(`Contramedida ${codigo} não existe.`)
  return acao
}

/** Exige ser o responsável atual. É a regra que todo movimento compartilha. */
function exigirResponsavel(usuario: Usuario, acao: ComRelacoes) {
  const quem = { id: usuario.id, nivel: nivelDaAcao(usuario.nivel), filialId: usuario.filialId }
  if (!podeAgir(quem, acao)) {
    /*
     * TRÊS motivos, e a mensagem diz qual — senão quem recebe a recusa procura
     * o problema no lugar errado. Uma ação fechada por rejeição respondia "só o
     * responsável atual pode movimentar", e a pessoa ia atrás de permissão
     * quando o que houve foi o encerramento da ação.
     */
    if (acao.concluidaEm) throw new NaoAutorizado('Esta contramedida já foi concluída.')
    if (acao.rejeitada) {
      throw new NaoAutorizado(
        'Esta contramedida foi rejeitada, e a rejeição a encerra — nem atualização ' +
          'ela aceita. Se o assunto continua, abra uma nova ação.',
      )
    }
    throw new NaoAutorizado('Só o responsável atual pode movimentar esta contramedida.')
  }
  return quem
}

/**
 * Caixa alta e sem acento — para casar nomes que dois cadastros escrevem.
 *
 * `dimensao_gerencia` vem da carga de vendas (`CONSTRUÇÃO`); o agrupamento é
 * cadastro do portal, escrito para ser lido na tela (`Construção`). São a mesma
 * gerência, e o casamento entre elas não pode depender de quem digitou.
 */
function semAcento(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .trim()
}

export async function contramedidaRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  /**
   * O AGRUPAMENTO DEDUZIDO — a coluna que a ação ocupa no quadro do nível.
   *
   * Chamada de DOIS lugares, e é por isso que ela existe: a abertura e o
   * `movimentar`. Enquanto a dedução morava só na abertura, escalar deixava o
   * agrupamento do nível de ORIGEM para trás — uma ação no N3 carregando
   * "Construção", que é coluna do N4. A abertura já tratava
   * `bucket.nivel === nivelAtual` como invariante e recusava o contrário com
   * todas as letras; `movimentar` a quebrava em silêncio.
   *
   * Duas cópias da regra é como elas divergem — o §7.72 registrou o mesmo
   * cuidado para o responsável.
   *
   * A dedução é *o GD do ponto de causa*, casada pelo NOME do indicador, e não
   * por um de-para em código: seria uma terceira lista para manter alinhada com
   * o catálogo de indicadores e o de agrupamentos. Cadastrar um GD novo e um
   * agrupamento de mesmo nome já basta.
   *
   * Sem correspondência, cai em "Geral" em vez de falhar: recusar por falta de
   * uma linha de cadastro puniria quem está na reunião por um problema de
   * administração. E "Geral" aparece na tela — quem olha o quadro vê que algo
   * não foi classificado, que é o aviso certo.
   */
  async function agrupamentoDeduzido(nivel: NivelAcao, pontoCausaId: string | null) {
    const ponto =
      pontoCausaId === null
        ? null
        : await app.prisma.pontoCausa.findUnique({
            where: { id: pontoCausaId },
            select: { variavelControle: { select: { indicadorId: true } } },
          })

    const nomeDoGd = ponto
      ? (
          await app.prisma.indicador.findUnique({
            where: { id: ponto.variavelControle.indicadorId },
            select: { nome: true },
          })
        )?.nome
      : undefined

    const achado =
      (nomeDoGd === undefined
        ? null
        : await app.prisma.bucket.findFirst({ where: { nivel, nome: nomeDoGd } })) ??
      (await app.prisma.bucket.findFirst({ where: { nivel, nome: 'Geral' } }))

    if (!achado) {
      throw new DadosInvalidos(
        `O nível ${nivel} não tem agrupamento "Geral" cadastrado, e a ação precisa de ` +
          'uma coluna. Rode o seed do domínio ou cadastre o agrupamento.',
      )
    }
    return achado
  }

  // ── Lista ──────────────────────────────────────────────────────────────────
  r.get(
    '/api/v1/contramedidas',
    {
      schema: {
        tags: ['Contramedidas'],
        summary: 'Lista as contramedidas visíveis para o usuário',
        querystring: z.object({
          filial: z.string().optional(),
          status: statusEnum.optional(),
          prioridade: prioridadeEnum.optional(),
          nivel: nivelEnum.optional(),
          codigo: z.string().optional(),
          /**
           * As ações de uma GERÊNCIA — o bloco "o que já está sendo feito" da
           * reunião do N3.
           *
           * Filtra pelas áreas de venda dela: no N4 o agrupamento É a área, e é
           * por ele que a ação sabe em qual coluna do quadro fica.
           */
          gerenciaId: z.string().uuid().optional(),
          /**
           * As ações de UMA variável de controle — o bloco "o que já está sendo
           * feito" do drill-down do N2 (§7.43).
           *
           * A contramedida guarda `variavelControleId` desde a criação: ela
           * nasce de um ponto de causa, e o ponto pertence a uma variável. Não
           * é derivado na hora, é o elo do ciclo do GD gravado.
           */
          variavelControleId: z.string().uuid().optional(),
        }),
        response: {
          200: z.object({ contramedidas: z.array(resumoSchema) }),
          401: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (req) => {
      const usuario = await app.autenticar(req)
      const q = req.query
      const hoje = agora()

      /**
       * A GERÊNCIA filtra pelas ÁREAS DE VENDA dela, casadas por nome.
       *
       * A contramedida não guarda gerência — guarda `filialId` e `bucketId`, e
       * no N4 o agrupamento É a gerência (§7.28). Então "as ações da Construção
       * da LES" são as daquela filial cujo agrupamento se chama Construção.
       *
       * A filial entra junto de propósito: o agrupamento vale para a rede toda
       * -- há uma só linha "Construção" --, e sem a filial a ação de uma loja
       * apareceria no quadro de outra, sem erro nenhum.
       *
       * O casamento é por NOME, e é insensível a caixa porque as duas pontas
       * têm donos diferentes: `dimensao_gerencia` vem da carga de vendas, em
       * caixa alta ("CONSTRUÇÃO"), e o agrupamento é cadastro do portal, escrito
       * para ser lido na tela ("Construção"). O acento tem de bater -- e é por
       * isso que a falta de par é AVISADA logo abaixo, em vez de virar uma lista
       * vazia silenciosa.
       */
      let daGerencia: Prisma.ContramedidaWhereInput = {}
      if (q.gerenciaId !== undefined) {
        const gerencia = await app.prisma.dimGerencia.findUnique({
          where: { id: q.gerenciaId },
          select: { filialId: true, nome: true },
        })
        if (!gerencia) throw new NaoEncontrado('Gerência não existe.')

        /*
         * Sem agrupamento com o nome da gerência não há o que filtrar, e a
         * resposta certa é vazia -- mas vazio na tela lê como "nenhuma ação
         * aberta", que é uma frase sobre a reunião, não sobre o cadastro.
         * O aviso no log é o que separa as duas.
         *
         * O casamento roda em memória, sobre TRÊS linhas, para poder ignorar
         * acento além de caixa: `CONSTRUÇÃO` da carga, `Construção` do portal
         * e um `CONSTRUCAO` digitado sem acento são a mesma gerência, e o
         * `mode: 'insensitive'` do banco só resolveria os dois primeiros.
         */
        const quadros = await app.prisma.bucket.findMany({
          where: { nivel: 'N4' },
          select: { id: true, nome: true },
        })
        const quadro = quadros.find((b) => semAcento(b.nome) === semAcento(gerencia.nome))
        if (!quadro) {
          req.log.warn(
            { gerencia: gerencia.nome },
            'Gerência sem agrupamento N4 de mesmo nome: as ações dela não têm quadro.',
          )
        }

        daGerencia = {
          filialId: gerencia.filialId,
          // Sem par, `bucketId: undefined` não filtraria NADA -- daí o id falso.
          bucketId: quadro?.id ?? '00000000-0000-4000-8000-000000000000',
        }
      }

      const where: Prisma.ContramedidaWhereInput = {
        ...daGerencia,
        ...(q.filial ? { filial: { sigla: q.filial } } : {}),
        ...(q.prioridade ? { prioridade: q.prioridade } : {}),
        ...(q.nivel ? { nivelAtual: q.nivel } : {}),
        ...(q.codigo ? { codigo: { contains: q.codigo, mode: 'insensitive' } } : {}),
        ...(q.variavelControleId ? { variavelControleId: q.variavelControleId } : {}),
      }

      const todas = await app.prisma.contramedida.findMany({
        where,
        include: COM_RELACOES,
        orderBy: [{ concluidaEm: 'asc' }, { prazo: 'asc' }],
      })

      /**
       * O filtro de visibilidade roda em memória, não no `WHERE`.
       *
       * A regra do CROSS depende do responsável, e a de nível depende da ordem
       * da escada — traduzir isso para SQL duplicaria a política em duas
       * linguagens. O volume é de contramedidas de uma diretoria, não de fatos;
       * quando passar de alguns milhares, vale reescrever, e aí com teste que
       * compare as duas.
       */
      const quem = { id: usuario.id, nivel: nivelDaAcao(usuario.nivel), filialId: usuario.filialId }
      const visiveis = todas.map(estreitar).filter((c) => podeVer(quem, c))

      const resumos = visiveis.map((c) => paraResumo(c, hoje, usuario.id))
      return {
        contramedidas: q.status ? resumos.filter((c) => c.status === q.status) : resumos,
      }
    },
  )

  // ── Detalhe ────────────────────────────────────────────────────────────────
  r.get(
    '/api/v1/contramedidas/:codigo',
    {
      schema: {
        tags: ['Contramedidas'],
        summary: 'Detalhe, histórico e o que o usuário pode fazer',
        params: z.object({ codigo: z.string() }),
        response: {
          200: z.object({
            contramedida: resumoSchema.extend({
              comentarioAbertura: z.string(),
              origem: z.string().nullable(),
              pdcRef: z.string().nullable(),
            }),
            movimentacoes: z.array(
              z.object({
                tipo: z.string(),
                criadoEm: z.string(),
                autor: z.string(),
                nivelOrigem: nivelEnum,
                nivelDestino: nivelEnum,
                motivo: z.string().nullable(),
                texto: z.string(),
                resultado: resultadoEnum.nullable(),
              }),
            ),
            permissoes: permissoesSchema,
          }),
          401: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (req) => {
      const usuario = await app.autenticar(req)
      const acao = await carregar(app.prisma, req.params.codigo, usuario)
      const hoje = agora()
      const quem = { id: usuario.id, nivel: nivelDaAcao(usuario.nivel), filialId: usuario.filialId }

      const movimentacoes = await app.prisma.movimentacao.findMany({
        where: { contramedidaId: acao.id },
        orderBy: { criadoEm: 'asc' },
        include: { autor: { select: { nome: true } } },
      })

      const destinos = destinosDeEscalacao(quem, acao)
      const podeMovimentar = podeAgir(quem, acao)
      return {
        contramedida: {
          ...paraResumo(acao, hoje, usuario.id),
          comentarioAbertura: acao.comentarioAbertura,
          origem: acao.origem,
          pdcRef: acao.pdcRef,
        },
        movimentacoes: movimentacoes.map((m) => ({
          tipo: m.tipo,
          criadoEm: iso(m.criadoEm),
          autor: m.autor.nome,
          nivelOrigem: nivelDaAcao(m.nivelOrigem),
          nivelDestino: nivelDaAcao(m.nivelDestino),
          motivo: m.motivo,
          texto: m.texto,
          resultado: m.resultadoIndicador,
        })),
        permissoes: {
          /*
           * A ação está VIVA, e não "eu sou o responsável".
           *
           * Era `podeMovimentar`, e isso escondia o botão de quem acompanha --
           * mudança que eu fiz sem notar. A rota de atualização não exige ser o
           * responsável de propósito: quem enxerga a ação pode prestar contas
           * nela, e só mexer no PRAZO é do responsável. A permissão tem de dizer
           * o que a rota faz, senão a tela esconde o que o servidor aceita.
           */
          podeAtualizar: !acao.rejeitada,
          podeEscalar: destinos.length > 0,
          destinosDeEscalacao: destinos,
          podeDirecionar: podeDirecionar(quem, acao),
          /**
           * Feedback é de quem abriu, depois de concluída — não do responsável.
           * É o único movimento que não passa por `podeAgir`.
           */
          podeDarFeedback:
            acao.concluidaEm !== null &&
            acao.criadoPorId === usuario.id &&
            // Acontece uma vez só. Sem esta condição o botão fica na tela para
            // sempre, e todo clique volta 403 — botão que só serve para errar.
            !acao.movimentacoes.some((m) => m.tipo === 'FEEDBACK'),
          podeConcluir: podeMovimentar,
          /*
           * Rejeitar exige as duas coisas: estar com a ação E ter a quem
           * devolver. Mandar só `podeMovimentar` poria o botão na tela de quem
           * abriu a ação para si mesmo, e todo clique voltaria 400 — o mesmo
           * defeito que `podeDarFeedback` já evita acima.
           */
          podeRejeitar: podeMovimentar && origemDaMao(acao) !== null,
        },
      }
    },
  )

  // ── Abertura ───────────────────────────────────────────────────────────────
  r.post(
    '/api/v1/contramedidas',
    {
      schema: {
        tags: ['Contramedidas'],
        summary: 'Abre uma contramedida a partir de um ponto de causa',
        body: z.object({
          titulo: z.string().min(3).max(200),
          /**
           * OPCIONAL no corpo — obrigatório só quando a ação nasce no N4.
           *
           * Ver `criacaoExigePontoCausa`: o ciclo do GD nasce na ponta, e é lá
           * que a causa existe. Acima disso ela é o elo que amarra a ação ao
           * vermelho que a motivou, e quem abre decide se amarra.
           *
           * Quem decide é a política, não o schema — pelo mesmo motivo de
           * `responsavelId`: a obrigatoriedade depende do NÍVEL DE DESTINO, e o
           * Zod valida o corpo sem saber para onde a ação vai.
           */
          pontoCausaId: z.string().uuid().optional(),
          filial: z.string().min(1),
          nivel: nivelEnum,
          /**
           * OPCIONAL, e a rota decide quando é obrigatório.
           *
           * Era `uuid()` obrigatório ao lado de um comentário, trinta linhas
           * abaixo, dizendo "no meu nível a ação é MINHA — o corpo não
           * escolhe". As duas coisas não podiam ser verdade: a tela obedecia a
           * regra e não mandava responsável, o Zod recusava o corpo, e abrir
           * ação no próprio nível respondia "Requisição inválida" sem dizer o
           * quê.
           *
           * Quem sabe se é obrigatório é `criacaoExigeResponsavel`, que já
           * decide isso para a tela em `/opcoes`. Um schema não consegue: a
           * resposta depende do nível de QUEM chama, e o schema não o conhece.
           */
          responsavelId: z.string().uuid().optional(),
          /**
           * O agrupamento é a coluna do quadro, e agora ele só é PEDIDO em dois
           * destinos — ver `criacaoExigeAgrupamento`.
           *
           * No N4 ele é a gerência que vai tocar; no CROSS, o setor de apoio.
           * Nos dois é informação que só quem abre tem.
           *
           * Em N2 e N3 ele é DEDUZIDO do GD do ponto de causa, e "Geral" quando
           * não há causa. O comentário antigo dizia que não dava para derivar
           * "porque `ponto_causa.bucket_id` é opcional" — e estava olhando o
           * campo errado: a dedução não passa por ali, passa pelo INDICADOR da
           * variável a que a causa pertence, que a ação já grava desde sempre.
           */
          bucketId: z.string().uuid().optional(),
          prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          prioridade: prioridadeEnum,
          /**
           * Obrigatório: é o conteúdo de GD da ação — o que aconteceu e qual é
           * a contramedida. A coluna é NOT NULL, e uma ação sem esse texto
           * chega na reunião sem nada para discutir.
           */
          comentarioAbertura: z.string().min(1).max(4000),
          pdcRef: z.string().max(100).optional(),
          origem: z.string().max(100).optional(),
        }),
        response: { 201: z.object({ codigo: z.string() }), 401: erroSchema, 422: erroSchema },
      },
    },
    async (req, reply) => {
      const usuario = await app.autenticar(req)
      const b = req.body

      const meu = nivelDaAcao(usuario.nivel)
      const permitidos = niveisQuePodeCriar(meu)
      if (!permitidos.includes(b.nivel)) {
        throw new NaoAutorizado(
          `${usuario.nivel} pode abrir ação em ${permitidos.join(', ')} — não em ${b.nivel}.`,
        )
      }

      /*
       * Quem responde: o corpo escolhe SÓ quando abre para o nível abaixo. No
       * próprio nível (e no CROSS) a ação é de quem abre, e o padrão é ele
       * mesmo -- não é conveniência de tela, é a regra.
       */
      /**
       * QUEM NÃO RECEBE AÇÃO SEMPRE ESCOLHE OUTRA PESSOA.
       *
       * A regra normal deixa a ação com quem abre quando o destino é o próprio
       * nível ou o CROSS. Para quem administra sem participar do GD isso
       * criaria, na abertura, exatamente a ação que a categoria existe para não
       * ter — e sem passar por `movimentar`, que é onde a trava dos outros
       * caminhos mora: abrir não é movimento, é o `create` da contramedida.
       *
       * Então aqui a exigência de responsável deixa de depender do destino.
       */
      const souDaCadeia = podeReceberAcao(usuario)
      const exigeResponsavel = !souDaCadeia || criacaoExigeResponsavel(b.nivel, meu)
      if (!souDaCadeia && !b.responsavelId) {
        throw new DadosInvalidos(
          'Você administra o portal e não participa da cadeia de ajuda: pode abrir ' +
            'ação, sempre para outra pessoa. Escolha quem vai tocar.',
        )
      }
      if (exigeResponsavel && !b.responsavelId) {
        throw new DadosInvalidos(
          /*
           * O MOTIVO muda com o caso, e a frase tem de mudar junto.
           *
           * Era "é um nível abaixo do seu" sempre. Com a exceção do N2 (que
           * escolhe responsável no PRÓPRIO nível), essa explicação passou a
           * mentir justamente no caso novo -- pego no QA de 11/09/2026. Uma
           * mensagem que explica errado é pior que uma que não explica: ela
           * manda procurar no lugar errado.
           */
          b.nivel === meu
            ? `Ação aberta no ${b.nivel} precisa de um responsável — o N2 escolhe entre os pares.`
            : `Ação aberta no ${b.nivel} precisa de um responsável — é um nível abaixo do seu.`,
        )
      }
      const responsavelPedido = b.responsavelId ?? usuario.id

      /**
       * O PONTO DE CAUSA é obrigatório só no N4 — ver `criacaoExigePontoCausa`.
       *
       * Checado ANTES das buscas para a mensagem falar do que falta, e não de
       * um id que nunca foi mandado.
       */
      if (criacaoExigePontoCausa(meu) && b.pontoCausaId === undefined) {
        throw new DadosInvalidos(
          'A ação que o N4 abre nasce de um ponto de causa — é ele que a liga ao ' +
            'vermelho da reunião. Escolha a causa.',
        )
      }
      if (criacaoExigeAgrupamento(b.nivel) && b.bucketId === undefined) {
        throw new DadosInvalidos(
          b.nivel === 'CROSS'
            ? 'Ação no CROSS precisa do setor de apoio.'
            : 'Ação aberta no N4 precisa da gerência que vai tocar.',
        )
      }

      const [filial, ponto, responsavel, bucketEscolhido] = await Promise.all([
        app.prisma.filial.findUnique({ where: { sigla: b.filial } }),
        b.pontoCausaId === undefined
          ? Promise.resolve(null)
          : app.prisma.pontoCausa.findUnique({
              where: { id: b.pontoCausaId },
              include: { variavelControle: { select: { indicadorId: true } } },
            }),
        app.prisma.usuario.findUnique({ where: { id: responsavelPedido } }),
        b.bucketId === undefined
          ? Promise.resolve(null)
          : app.prisma.bucket.findUnique({ where: { id: b.bucketId } }),
      ])
      if (!filial) throw new DadosInvalidos(`Filial "${b.filial}" não existe.`)
      if (b.pontoCausaId !== undefined && !ponto) {
        throw new DadosInvalidos('Ponto de causa não existe.')
      }

      /**
       * A LOJA TEM DE COMBINAR COM O NÍVEL — ver `criacaoEhCorporativa`.
       *
       * A tela já trava o campo, e é exatamente por isso que a rota precisa
       * checar: a tela é uma das formas de chamar, não a única. Sem isto, uma
       * ação corporativa podia nascer carimbada com NOR e aparecer no quadro da
       * loja; e uma ação de loja podia nascer "Corporativo" e não aparecer em
       * quadro nenhum.
       *
       * Recusa com o nome do que veio, em vez de corrigir calado: sobrescrever
       * a filial faria a ação nascer diferente do que foi pedido, sem ninguém
       * saber.
       */
      if (criacaoEhCorporativa(b.nivel)) {
        if (filial.tipo !== 'CORPORATIVO') {
          throw new DadosInvalidos(
            `Ação aberta no ${b.nivel} é corporativa e não se prende a uma loja — ` +
              `veio "${b.filial}". Use a filial corporativa.`,
          )
        }
      } else if (filial.tipo !== 'FILIAL') {
        throw new DadosInvalidos(
          `Ação aberta no ${b.nivel} é de uma loja, e "${b.filial}" não é loja.`,
        )
      }
      if (!responsavel?.ativo) throw new DadosInvalidos('Responsável não existe ou está inativo.')
      /*
       * A mesma regra do `movimentar`, na única porta que não passa por ele.
       * Vem DEPOIS da checagem de `ativo` para a mensagem ser a específica: quem
       * administra e quem foi desativado são recusas diferentes, e dizer a
       * errada manda procurar no lugar errado.
       */
      if (!podeReceberAcao(responsavel)) {
        throw new DadosInvalidos(
          `${responsavel.nome} administra o portal e não participa da cadeia de ajuda — ` +
            'não recebe contramedida. Escolha alguém do nível.',
        )
      }

      /**
       * NO MEU NÍVEL (e no CROSS), a ação é MINHA — o corpo não escolhe.
       *
       * A tela já esconde o seletor nesses casos, mas quem chama a rota direto
       * não passa pela tela. Sem esta checagem, um N4 poderia abrir ação em nome
       * do adjunto da gerência ao lado: encher a agenda de outra pessoa sem
       * passar por ninguém.
       *
       * Recusa em vez de sobrescrever em silêncio. Trocar o responsável por
       * baixo faria a ação nascer com dono diferente do que foi pedido, e quem
       * chamou nunca saberia -- é o tipo de "conserto" que vira um bug de
       * confiança meses depois.
       */
      if (!exigeResponsavel && responsavel.id !== usuario.id) {
        throw new DadosInvalidos(
          b.nivel === 'CROSS'
            ? 'Ação no CROSS fica com quem abre — o eixo de apoio não transfere a responsabilidade.'
            : `Ação aberta no seu próprio nível (${b.nivel}) fica com você. ` +
              'Para indicar outra pessoa, abra no nível abaixo.',
        )
      }
      /**
       * O AGRUPAMENTO: escolhido no N4 e no CROSS, DEDUZIDO no N2 e no N3.
       *
       * A dedução é *o GD do ponto de causa*, e "Geral" quando não há causa —
       * ver `criacaoExigeAgrupamento` e o comentário do catálogo em
       * `prisma/seed/dominio.ts`, onde os agrupamentos destes dois níveis
       * passaram a ter os nomes dos indicadores exatamente para isto.
       *
       * Casa pelo NOME do indicador, e não por um de-para escrito aqui. Um
       * mapa em código seria uma terceira lista para manter alinhada com o
       * catálogo de indicadores e com o de agrupamentos; pelo nome, cadastrar
       * um GD novo e um agrupamento de mesmo nome já basta.
       *
       * Sem correspondência, cai em "Geral" em vez de falhar: recusar a ação
       * porque falta uma linha de cadastro puniria quem está na reunião por um
       * problema de administração. E "Geral" aparece na tela — quem olhar o
       * quadro vê que algo não foi classificado, que é o aviso certo.
       */
      /*
       * Mandar agrupamento onde ele é DEDUZIDO é recusado, não ignorado.
       *
       * A mesma decisão que a rota já tomava para o responsável, doze linhas
       * acima: sobrescrever em silêncio faria a ação nascer diferente do que
       * foi pedido, e quem chamou nunca saberia -- "o tipo de conserto que vira
       * um bug de confiança meses depois".
       */
      if (!criacaoExigeAgrupamento(b.nivel) && b.bucketId !== undefined) {
        throw new DadosInvalidos(
          `Ação aberta no ${b.nivel} recebe o agrupamento do GD do ponto de causa — ele não ` +
            'se escolhe. Não mande `bucketId`.',
        )
      }

      let bucket = bucketEscolhido
      if (!criacaoExigeAgrupamento(b.nivel)) {
        bucket = await agrupamentoDeduzido(b.nivel, b.pontoCausaId ?? null)
      }

      if (!bucket) throw new DadosInvalidos('Agrupamento não existe.')
      if (bucket.nivel !== b.nivel) {
        throw new DadosInvalidos(
          `O agrupamento "${bucket.nome}" é do nível ${bucket.nivel}, e a ação está sendo aberta ` +
            `no ${b.nivel}. Escolha um agrupamento do mesmo nível.`,
        )
      }

      const criada = await app.prisma.$transaction(async (tx) => {
        const codigo = await proximoCodigo(tx)
        return tx.contramedida.create({
          data: {
            codigo,
            titulo: b.titulo,
            /*
             * As três juntas, e as três anuláveis: é o elo com o ciclo do GD.
             * Ou a ação nasceu de uma causa e carrega variável e indicador, ou
             * não nasceu e não carrega nenhum dos três. Gravar um sem os outros
             * criaria ação com indicador e sem causa, que não quer dizer nada.
             */
            pontoCausaId: ponto?.id ?? null,
            variavelControleId: ponto?.variavelControleId ?? null,
            indicadorId: ponto?.variavelControle.indicadorId ?? null,
            filialId: filial.id,
            bucketId: bucket.id,
            nivelAtual: b.nivel,
            responsavelAtualId: responsavel.id,
            criadoPorId: usuario.id,
            prazo: new Date(`${b.prazo}T00:00:00.000Z`),
            prioridade: b.prioridade,
            comentarioAbertura: b.comentarioAbertura,
            pdcRef: b.pdcRef ?? null,
            origem: b.origem ?? null,
          },
        })
      })

      await app.prisma.auditLog.create({
        data: {
          usuarioId: usuario.id,
          acao: 'CONTRAMEDIDA_CRIADA',
          entidade: 'contramedida',
          entidadeId: criada.id,
          payload: { codigo: criada.codigo, nivel: b.nivel },
          ip: req.ip,
        },
      })

      return reply.status(201).send({ codigo: criada.codigo })
    },
  )

  /**
   * Nível que NÃO se prende a uma filial.
   *
   * `veTodasAsFiliais` conhece os três com tela; o CROSS é o quarto e não passa
   * por lá. Ele é eixo de apoio, corporativo por natureza — pedir filial para
   * ele seria oferecer uma escolha que a criação nem usa.
   */
  const semFilial = (nivel: NivelAcao) => nivel === 'CROSS' || veTodasAsFiliais(nivel)

  // ── O que a tela de abrir precisa saber ────────────────────────────────────

  /**
   * Tudo o que o formulário de abrir ação precisa, numa chamada.
   *
   * São cinco listas e nenhuma delas é longa. Cinco requisições para montar um
   * formulário fariam a tela abrir em pedaços, e o campo que chega por último
   * é sempre o que a pessoa já tentou preencher.
   *
   * **Os níveis vêm da política, não de uma lista aqui.** `niveisQuePodeCriar`
   * é a mesma função que a criação usa para recusar — se a tela repetisse a
   * regra, ofereceria um nível que o servidor nega, e o erro chegaria depois
   * de tudo preenchido.
   */
  r.get(
    '/api/v1/contramedidas/opcoes',
    {
      schema: {
        tags: ['Contramedidas'],
        summary: 'Níveis, filiais, agrupamentos, prioridades e pontos de causa para abrir ação',
        response: {
          200: z.object({
            niveis: z.array(
              z.object({
                nivel: nivelEnum,
                /** No CROSS a ação fica com quem abriu — não se indica ninguém. */
                exigeResponsavel: z.boolean(),
                /**
                 * A ação nasce no CORPORATIVO, e a loja não se escolhe.
                 *
                 * Vem por nível, junto de `exigeResponsavel`, porque é a mesma
                 * pergunta: *o que este destino pede do formulário?* A tela lê
                 * daqui em vez de repetir `nivel === 'N2' || nivel === 'CROSS'`
                 * — regra copiada é regra que passa a discordar.
                 */
                ehCorporativa: z.boolean(),
                /**
                 * Marcar a causa é obrigatório?
                 *
                 * Depende de QUEM ABRE, não do destino: só o N4 vem do Pareto.
                 * Repetido em cada nível porque a tela lê tudo do destino
                 * escolhido -- o valor é o mesmo nos quatro, e é de propósito.
                 */
                exigePontoCausa: z.boolean(),
                /**
                 * O agrupamento é ESCOLHIDO neste destino?
                 *
                 * Falso em N2 e N3 — lá ele é deduzido do GD da causa. A tela
                 * esconde o campo, e não manda nada: quem deduz é o servidor,
                 * porque é ele que conhece o catálogo.
                 */
                exigeAgrupamento: z.boolean(),
              }),
            ),
            filiais: z.array(z.object({ sigla: z.string(), nome: z.string() })),
            /**
             * A linha do cadastro que representa o corporativo.
             *
             * A tela precisa dela para PREENCHER o campo quando o destino é N2
             * ou CROSS — e recebe a sigla do servidor em vez de cravar
             * `'99-CORPORATIVO'` no código. Sigla de cadastro muda; código com
             * a sigla escrita dentro só descobre no dia em que mudar.
             *
             * Nula se ninguém cadastrou uma linha `tipo = CORPORATIVO` — aí a
             * tela volta a pedir a loja, que é pior mas funciona, em vez de
             * mandar uma string vazia que o Zod recusa sem explicar.
             */
            filialCorporativa: z.object({ sigla: z.string(), nome: z.string() }).nullable(),
            /**
             * A gerência de quem pede, lida do `id_perfil` — o PADRÃO do campo
             * no formulário, não um limite. Nula para quem não é N4 de venda:
             * aí a pessoa escolhe, que é o que o N3 já fazia.
             */
            minhaGerencia: z.string().nullable(),
            prioridades: z.array(prioridadeEnum),
            /**
             * Os pontos de causa, com a variável e o indicador de cada um.
             *
             * A ação nasce de uma CAUSA — é o elo do ciclo do GD, e a rota de
             * criação exige. Quem abre a partir do Pareto já chega com ela
             * escolhida; quem abre pela lista de ações escolhe aqui.
             */
            causas: z.array(
              z.object({
                id: z.string(),
                nome: z.string(),
                variavel: z.string(),
                indicador: z.string(),
              }),
            ),
          }),
          401: erroSchema,
        },
      },
    },
    async (req) => {
      const usuario = await app.autenticar(req)
      const meu = nivelDaAcao(usuario.nivel)

      const [filiaisTodas, corporativa, causas] = await Promise.all([
        app.prisma.filial.findMany({
          where: { tipo: 'FILIAL', ativa: true },
          orderBy: { ordem: 'asc' },
          select: { id: true, sigla: true, nome: true },
        }),
        /*
         * A linha corporativa sai por FORA da lista de lojas, de propósito: ela
         * não é opção de um seletor -- é o valor que o formulário assume
         * sozinho quando o destino é N2 ou CROSS. Dentro da lista, ela voltaria
         * a ser uma escolha, que é exatamente o que saiu daqui.
         */
        app.prisma.filial.findFirst({
          where: { tipo: 'CORPORATIVO', ativa: true },
          orderBy: { ordem: 'asc' },
          select: { sigla: true, nome: true },
        }),
        app.prisma.pontoCausa.findMany({
          where: { ativo: true },
          orderBy: { ordem: 'asc' },
          select: {
            id: true,
            nome: true,
            variavelControle: {
              select: { nome: true, indicador: { select: { nome: true } } },
            },
          },
        }),
      ])

      /*
       * A filial de quem NÃO é corporativo é uma só, e é a dele. Devolver as
       * nove faria a tela oferecer abrir ação em loja que ele não vê -- o
       * servidor recusaria depois, com o formulário todo preenchido.
       */
      const filiais = semFilial(meu)
        ? filiaisTodas
        : filiaisTodas.filter((f) => f.id === usuario.filialId)

      /*
       * QUEM NAO RECEBE ACAO SEMPRE ESCOLHE OUTRA PESSOA -- em todo nivel, e
       * nao so' onde a regra normal ja pedia.
       *
       * A resposta desta rota e' o que a tela desenha: ela diz, no comentario
       * do campo, que *"o servidor decide (`exigeResponsavel`, em `/opcoes`) e
       * recusa o contrario na criacao; a tela so' desenha o que ele disse"*.
       * Corrigir aqui e' o que faz o formulario parar de oferecer "fica com
       * voce" para quem nao pode ficar -- sem uma linha de frontend, e sem a
       * regra passar a existir em dois lugares.
       */
      const souDaCadeia = podeReceberAcao(usuario)

      return {
        niveis: niveisQuePodeCriar(meu).map((nivel) => ({
          nivel,
          exigeResponsavel: !souDaCadeia || criacaoExigeResponsavel(nivel, meu),
          ehCorporativa: criacaoEhCorporativa(nivel),
          exigePontoCausa: criacaoExigePontoCausa(meu),
          exigeAgrupamento: criacaoExigeAgrupamento(nivel),
        })),
        filiais: filiais.map((f) => ({ sigla: f.sigla, nome: f.nome })),
        filialCorporativa: corporativa,
        minhaGerencia: gerenciaDoPerfil(usuario.idPerfil),
        // Do enum do schema, e não de uma lista solta: são os três valores
        // que a criação aceita, e `prioridadeEnum` é quem os define.
        prioridades: [...prioridadeEnum.options],
        causas: causas.map((c) => ({
          id: c.id,
          nome: c.nome,
          variavel: c.variavelControle.nome,
          indicador: c.variavelControle.indicador.nome,
        })),
      }
    },
  )

  /**
   * Quem pode receber a ação, num nível e numa filial.
   *
   * Separada de `/opcoes` porque depende das duas escolhas, e listar todas as
   * combinações traria gente que ninguém vai ver. Aqui a lista é curta e
   * chega depois de o nível estar escolhido.
   *
   * **O nível é o GRAVADO no usuário**, atualizado a cada login. Resolver o de
   * cada um pelo `id_perfil` custaria duas consultas por pessoa, e a diferença
   * só aparece entre a reclassificação de um perfil e o próximo login de quem
   * o tem -- caso em que a ação vai para alguém que acabou de mudar de papel,
   * e o destinatário aparece na tela dele de qualquer forma.
   */
  r.get(
    '/api/v1/contramedidas/destinatarios',
    {
      schema: {
        tags: ['Contramedidas'],
        summary: 'Pessoas que podem receber uma ação num nível e numa filial',
        querystring: z.object({
          nivel: nivelEnum,
          /** Obrigatória para N3 e N4; ignorada para os corporativos. */
          filial: z.string().optional(),
        }),
        response: {
          200: z.object({
            destinatarios: z.array(
              z.object({
                id: z.string(),
                nome: z.string(),
                cargo: z.string().nullable(),
                filial: z.string().nullable(),
              }),
            ),
          }),
          401: erroSchema,
          422: erroSchema,
        },
      },
    },
    async (req) => {
      await app.autenticar(req)
      const { nivel, filial } = req.query

      /*
       * Nível de filial SEM filial devolveria a rede inteira, e quem escolhesse
       * o primeiro nome estaria mandando ação para outra loja. Recusar é o
       * mesmo cuidado do escopo em `/gerencias`.
       */
      if (!semFilial(nivel) && !filial) {
        throw new DadosInvalidos(`${nivel} é de filial: informe a filial para listar quem recebe.`)
      }

      // `filial` já foi exigida acima para os níveis de loja; o `?? ''` é só
      // para o tipo, e uma sigla vazia não casaria com filial nenhuma.
      const daFilial: Prisma.UsuarioWhereInput = semFilial(nivel)
        ? {}
        : { filial: { sigla: filial ?? '' } }

      /*
       * `recebeAcao` ao lado de `ativo`, e pela mesma razão: os dois descrevem
       * gente que não deve receber trabalho. Quem administra o portal sem
       * participar do GD tem nível N2 — aparece aqui por nível e não deveria.
       *
       * Esta é a ÚNICA rota do backend que lista usuário por nível (conferido),
       * e mesmo assim ela não é a trava: a trava está em `movimentar`, porque
       * um POST direto não passa por lista nenhuma. Aqui é a tela não oferecer
       * o que o servidor vai recusar.
       */
      const pessoas = await app.prisma.usuario.findMany({
        where: { ativo: true, recebeAcao: true, nivel, ...daFilial },
        orderBy: { nome: 'asc' },
        select: { id: true, nome: true, cargo: true, filial: { select: { sigla: true } } },
      })

      return {
        destinatarios: pessoas.map((u) => ({
          id: u.id,
          nome: u.nome,
          cargo: u.cargo,
          filial: u.filial?.sigla ?? null,
        })),
      }
    },
  )

  /**
   * Os agrupamentos de um nível — as colunas do quadro.
   *
   * A LOJA NÃO ENTRA, em nível nenhum. Ela entrava enquanto o agrupamento do N4
   * era a área de venda: as nove lojas juntas tinham 73 áreas, cada uma com a
   * grafia que ela mesma cadastrou, e era preciso filtrar para achar a sua.
   *
   * Desde 29/08/2026 o agrupamento do N4 é a GERÊNCIA (§7.28) -- Construção,
   * Não Construção, Operacional --, que são três e valem para a rede toda,
   * exatamente como os setores de N3, N2 e CROSS. A área de venda volta como
   * agrupamento quando o N5 existir, no nível dele.
   *
   * **TODAS, inclusive no N4**, e isso mudou em 31/08/2026.
   *
   * Por algumas horas a rota devolvia só a gerência de quem pede, lida do
   * `id_perfil` -- e o formulário a mostrava travada, como faz com a loja. O
   * analista corrigiu: **abrir na dele, sim; prendê-lo nela, não.**
   *
   * A diferença é entre economizar um clique e tirar uma visão. Um gerente de
   * Construção precisa abrir ação para Não Construção: a loja é uma só, e o
   * problema de uma área raramente para na fronteira da gerência. Trancar teria
   * feito o portal decidir por ele.
   *
   * O padrão continua sendo o dele -- `minhaGerencia`, em `/opcoes`, é o que a
   * tela usa para pré-selecionar. Padrão é sugestão; lista é permissão.
   */
  r.get(
    '/api/v1/contramedidas/agrupamentos',
    {
      schema: {
        tags: ['Contramedidas'],
        summary: 'Agrupamentos de um nível — as colunas do quadro',
        querystring: z.object({ nivel: nivelEnum }),
        response: {
          200: z.object({
            agrupamentos: z.array(
              z.object({
                id: z.string(),
                nome: z.string(),
                grupo: z.string().nullable(),
              }),
            ),
          }),
          401: erroSchema,
          422: erroSchema,
        },
      },
    },
    async (req) => {
      /*
       * `await` sem guardar o retorno: aqui a CHAMADA e' o efeito -- ela
       * recusa quem nao esta autenticado. O `const usuario =` sugeria que a
       * rota usa a pessoa para filtrar algo, e ela nao usa: o recorte desta
       * lista vem do `nivel` da query.
       *
       * Tirar o `await` junto com a variavel e' que seria o defeito: a rota
       * passaria a atender sem sessao.
       */
      await app.autenticar(req)
      const { nivel } = req.query

      const doNivel = await app.prisma.bucket.findMany({
        where: { nivel },
        orderBy: { ordem: 'asc' },
        select: { id: true, nome: true, grupo: true },
      })

      return { agrupamentos: doNivel }
    },
  )

  // ── Movimentos ─────────────────────────────────────────────────────────────

  /**
   * Os quatro movimentos compartilham a mesma transação: grava a movimentação e
   * atualiza a contramedida. Separá-los deixaria o histórico contando uma
   * história que o estado não confirma.
   */
  async function movimentar(
    usuario: Usuario,
    acao: ComRelacoes,
    dados: {
      tipo: 'ESCALACAO' | 'ATUALIZACAO' | 'DIRECIONAMENTO' | 'CONCLUSAO' | 'FEEDBACK' | 'REJEICAO'
      nivelDestino: NivelAcao
      responsavelDestinoId: string
      texto: string
      motivo?: string | undefined
      novoPrazo?: Date | undefined
      resultado?: 'META_ATINGIDA' | 'MELHORA_PARCIAL' | 'SEM_EFEITO' | undefined
      concluir?: boolean
    },
    ip: string,
  ) {
    /**
     * AÇÃO REJEITADA NÃO RECEBE MOVIMENTO NENHUM — e a checagem mora AQUI.
     *
     * Eu tinha posto em `podeAgir`, afirmando que ele era "a porta única dos
     * cinco movimentos". **Não era**, e o teste de integração provou: a rota de
     * atualização não passa por `podeAgir` de propósito (§ da prestação de
     * contas — quem acompanha pode escrever; só mexer no prazo exige ser o
     * responsável), então ela aceitou `204` numa ação rejeitada.
     *
     * `movimentar` é por onde TODOS passam de verdade: é ela que grava a linha
     * de movimentação. Uma rota nova que esqueça a permissão ainda esbarra aqui.
     *
     * Só REJEITADA, e não "fechada": a ação concluída ainda recebe o `FEEDBACK`
     * de quem abriu (§7.3), que é movimento e passa por esta mesma função.
     */
    if (acao.rejeitada) {
      throw new NaoAutorizado(
        'Esta contramedida foi rejeitada, e a rejeição a encerra — nem atualização ' +
          'ela aceita. Se o assunto continua, abra uma nova ação.',
      )
    }

    /**
     * QUEM RECEBE TEM DE PODER RECEBER — e a checagem mora AQUI pelo mesmo
     * motivo que a de cima.
     *
     * `movimentar` é a única porta por onde todos os movimentos passam de
     * verdade. Deixar isto nas rotas daria quatro cópias da mesma pergunta, e a
     * evidência de que quatro cópias divergem está no próprio arquivo:
     * `direcionar` confere o destino (existe, ativo, nível certo), e
     * **`escalar` não conferia nada** — pegava o `responsavelDestinoId` do corpo
     * e entregava direto. Uma lista filtrada na tela não é trava: o POST passa
     * por cima dela.
     *
     * Só os movimentos que ENTREGAM TRABALHO — ver `movimentoEntregaTrabalho`,
     * que explica por que a rejeição fica de fora.
     */
    if (movimentoEntregaTrabalho(dados.tipo)) {
      const destino = await app.prisma.usuario.findUnique({
        where: { id: dados.responsavelDestinoId },
        select: { nome: true, ativo: true, recebeAcao: true },
      })
      if (!destino) {
        throw new DadosInvalidos('O destino escolhido não existe no portal.')
      }
      if (!podeReceberAcao(destino)) {
        throw new DadosInvalidos(
          destino.ativo
            ? `${destino.nome} administra o portal e não participa da cadeia de ajuda — ` +
                'não recebe contramedida. Escolha alguém do nível.'
            : `${destino.nome} não está mais ativo no portal. Escolha outro responsável.`,
        )
      }
    }

    /**
     * O AGRUPAMENTO ACOMPANHA O NÍVEL — e não acompanhava.
     *
     * A abertura já trata `bucket.nivel === nivelAtual` como invariante, e
     * recusa o contrário com todas as letras: *"O agrupamento X é do nível Y, e
     * a ação está sendo aberta no Z"*. Só que `movimentar` trocava
     * `nivelAtual` e deixava `bucketId` para trás — então escalar do N4 para o
     * N3 produzia uma ação no N3 carregando "Construção", que é coluna do N4.
     *
     * Não derruba a ação do quadro (o bloco lista, não monta colunas), mas
     * mostra o rótulo errado na reunião: a ação aparece classificada numa
     * gerência quando o N3 organiza por indicador. Pego pelo analista em
     * 14/09/2026, na AC-0490.
     *
     * A dedução é a MESMA da abertura — `agrupamentoDeduzido` --, e é por isso
     * que ela virou função: duas cópias da regra é como elas divergem, e o
     * §7.72 já registrava esse cuidado para o responsável.
     */
    /*
     * SÓ ONDE O NÍVEL DEDUZ. No N4 e no CROSS o agrupamento é ESCOLHIDO -- são
     * as gerências e os setores de apoio --, e lá não há o que deduzir: não
     * existe "Geral" no N4, e tentar deduzir derrubava a REJEIÇÃO inteira, que
     * devolve a ação para baixo. Pego pela suíte, com 7 testes de rejeição
     * falhando de uma vez.
     */
    const agrupamento =
      dados.nivelDestino === acao.nivelAtual || criacaoExigeAgrupamento(dados.nivelDestino)
        ? null
        : await agrupamentoDeduzido(dados.nivelDestino, acao.pontoCausaId)

    await app.prisma.$transaction(async (tx) => {
      await tx.movimentacao.create({
        data: {
          contramedidaId: acao.id,
          tipo: dados.tipo,
          autorId: usuario.id,
          nivelOrigem: acao.nivelAtual,
          nivelDestino: dados.nivelDestino,
          responsavelDestinoId: dados.responsavelDestinoId,
          texto: dados.texto,
          motivo: dados.motivo ?? null,
          novoPrazo: dados.novoPrazo ?? null,
          resultadoIndicador: dados.resultado ?? null,
        },
      })
      await tx.contramedida.update({
        where: { id: acao.id },
        data: {
          nivelAtual: dados.nivelDestino,
          responsavelAtualId: dados.responsavelDestinoId,
          ...(agrupamento ? { bucketId: agrupamento.id } : {}),
          ...(dados.novoPrazo ? { prazo: dados.novoPrazo } : {}),
          ...(dados.concluir ? { concluidaEm: agora() } : {}),
        },
      })
    })

    await app.prisma.auditLog.create({
      data: {
        usuarioId: usuario.id,
        acao: `CONTRAMEDIDA_${dados.tipo}`,
        entidade: 'contramedida',
        entidadeId: acao.id,
        payload: { codigo: acao.codigo, destino: dados.nivelDestino },
        ip,
      },
    })
  }

  const corpoComTexto = z.object({ texto: z.string().min(1).max(4000) })

  r.post(
    '/api/v1/contramedidas/:codigo/escalar',
    {
      schema: {
        tags: ['Contramedidas'],
        summary: 'Escala um nível acima, ou para um setor CROSS (só N2)',
        params: z.object({ codigo: z.string() }),
        body: corpoComTexto.extend({
          destino: nivelEnum,
          motivo: z.string().max(500).optional(),
          bucketDestinoId: z.string().uuid().optional(),
          responsavelDestinoId: z.string().uuid().optional(),
        }),
        response: { 204: z.null(), 401: erroSchema, 403: erroSchema, 404: erroSchema },
      },
    },
    async (req, reply) => {
      const usuario = await app.autenticar(req)
      const acao = await carregar(app.prisma, req.params.codigo, usuario)
      const quem = exigirResponsavel(usuario, acao)

      const destinos = destinosDeEscalacao(quem, acao)
      if (!destinos.includes(req.body.destino)) {
        throw new NaoAutorizado(
          `Não é possível escalar de ${acao.nivelAtual} para ${req.body.destino}. ` +
            (destinos.length > 0 ? `Destinos válidos: ${destinos.join(', ')}.` : 'Sem destino.'),
        )
      }

      /**
       * Escalar para CROSS **mantém** o responsável — ver `politicas.ts`.
       *
       * Sem isso, o N2 escalaria para Suprimentos e perderia o poder de concluir
       * a própria ação, que ficaria sem dono: ninguém em CROSS pode escalar de
       * volta.
       */
      const transfere = escalacaoTransfereResponsavel(req.body.destino)
      const responsavelDestinoId = transfere
        ? (req.body.responsavelDestinoId ?? null)
        : usuario.id
      if (!responsavelDestinoId) {
        throw new DadosInvalidos('Escalar para outro nível exige indicar o novo responsável.')
      }

      await movimentar(
        usuario,
        acao,
        {
          tipo: 'ESCALACAO',
          nivelDestino: req.body.destino,
          responsavelDestinoId,
          texto: req.body.texto,
          motivo: req.body.motivo,
        },
        req.ip,
      )
      return reply.status(204).send(null)
    },
  )

  r.post(
    '/api/v1/contramedidas/:codigo/direcionar',
    {
      schema: {
        tags: ['Contramedidas'],
        summary: 'Passa a ação para outro N2, no mesmo nível',
        params: z.object({ codigo: z.string() }),
        body: corpoComTexto.extend({ responsavelDestinoId: z.string().uuid() }),
        response: { 204: z.null(), 401: erroSchema, 403: erroSchema, 404: erroSchema },
      },
    },
    async (req, reply) => {
      const usuario = await app.autenticar(req)
      const acao = await carregar(app.prisma, req.params.codigo, usuario)
      const quem = exigirResponsavel(usuario, acao)

      if (!podeDirecionar(quem, acao)) {
        throw new NaoAutorizado('Só o N2 pode direcionar contramedidas.')
      }

      const destino = await app.prisma.usuario.findUnique({
        where: { id: req.body.responsavelDestinoId },
      })
      if (!destino?.ativo) throw new DadosInvalidos('Destino não existe ou está inativo.')
      const alvo = {
        id: destino.id,
        nivel: nivelDaAcao(destino.nivel),
        filialId: destino.filialId,
      }
      if (!ehDestinoValidoDeDirecionamento(quem, alvo)) {
        throw new DadosInvalidos(
          'O destino precisa ser outro usuário de nível N2 — e não você mesmo.',
        )
      }

      await movimentar(
        usuario,
        acao,
        {
          tipo: 'DIRECIONAMENTO',
          // Direcionar troca de dono, não de nível.
          nivelDestino: nivelDaAcao(acao.nivelAtual),
          responsavelDestinoId: destino.id,
          texto: req.body.texto,
        },
        req.ip,
      )
      return reply.status(204).send(null)
    },
  )

  r.post(
    '/api/v1/contramedidas/:codigo/concluir',
    {
      schema: {
        tags: ['Contramedidas'],
        summary: 'Marca a contramedida como executada. O feedback vem depois.',
        params: z.object({ codigo: z.string() }),
        body: corpoComTexto,
        response: { 204: z.null(), 401: erroSchema, 403: erroSchema, 404: erroSchema },
      },
    },
    async (req, reply) => {
      const usuario = await app.autenticar(req)
      const acao = await carregar(app.prisma, req.params.codigo, usuario)
      exigirResponsavel(usuario, acao)

      /**
       * Concluir NÃO muda o nível (PLANO §7.3).
       *
       * Onde a ação foi resolvida é informação: se as abertas no N4 vivem sendo
       * concluídas no N2, a cadeia de ajuda não está resolvendo onde deveria, e
       * mover o nível apagaria esse sinal. Quem abriu volta a ver a ação pelo
       * feedback pendente, não por ela descer de nível.
       */
      await movimentar(
        usuario,
        acao,
        {
          tipo: 'CONCLUSAO',
          nivelDestino: acao.nivelAtual,
          // Conclusão não passa a bola: quem concluiu continua no registro.
          responsavelDestinoId: usuario.id,
          texto: req.body.texto,
          concluir: true,
        },
        req.ip,
      )
      return reply.status(204).send(null)
    },
  )

  // ── Rejeição ───────────────────────────────────────────────────────────────
  r.post(
    '/api/v1/contramedidas/:codigo/rejeitar',
    {
      schema: {
        tags: ['Contramedidas'],
        summary: 'Devolve a contramedida a quem a passou, com observação obrigatória',
        params: z.object({ codigo: z.string() }),
        /*
         * O MESMO corpo dos outros movimentos, e a observação é obrigatória por
         * `min(1)` -- não é um campo a mais que a tela pode omitir.
         *
         * Rejeitar sem dizer por quê devolve o problema e retém a informação:
         * quem recebe de volta fica sabendo que foi recusado e não o que
         * corrigir, e a próxima tentativa repete o mesmo erro. É a única razão
         * de a rejeição valer mais que um silêncio.
         */
        body: corpoComTexto,
        /*
         * 422 nos dois casos de "não dá para devolver" -- é o status de
         * `DadosInvalidos`, o mesmo que escalar e direcionar usam para destino
         * inválido. Declarar 400 aqui deixaria o contrato da rota mentindo
         * sobre a resposta real.
         */
        response: {
          204: z.null(),
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          422: erroSchema,
        },
      },
    },
    async (req, reply) => {
      const usuario = await app.autenticar(req)
      const acao = await carregar(app.prisma, req.params.codigo, usuario)
      exigirResponsavel(usuario, acao)

      /**
       * Devolve a QUEM PASSOU, e não ao nível de baixo. Ver `origemDaMao`.
       *
       * A rejeição é um movimento de troca de mão como a escalação: entra na
       * trilha (`TROCA_DE_MAO`) e os dias voltam a contar para quem recebeu.
       * Sem isso, a ação constaria parada com quem já a devolveu.
       */
      const destino = origemDaMao(acao)
      if (!destino) {
        throw new DadosInvalidos(
          'Não há a quem devolver esta contramedida: ela foi aberta por você e nunca foi repassada.',
        )
      }

      /*
       * O destino pode ter sido DESATIVADO desde que passou a ação. Devolver
       * para uma conta inativa esconde a ação de todo mundo: ela fica com um
       * responsável que não entra no portal, e sai das listas de quem poderia
       * agir. Melhor recusar e deixar a ação onde está, visível.
       */
      const pessoa = await app.prisma.usuario.findUnique({ where: { id: destino.responsavelId } })
      if (!pessoa?.ativo) {
        throw new DadosInvalidos(
          'Quem passou esta contramedida não está mais ativo no portal. Escale ou direcione em vez de devolver.',
        )
      }

      await movimentar(
        usuario,
        acao,
        {
          tipo: 'REJEICAO',
          nivelDestino: destino.nivel,
          responsavelDestinoId: destino.responsavelId,
          texto: req.body.texto,
        },
        req.ip,
      )
      return reply.status(204).send(null)
    },
  )

  // ── Atualização da ação ────────────────────────────────────────────────────
  r.post(
    '/api/v1/contramedidas/:codigo/atualizacoes',
    {
      schema: {
        tags: ['Contramedidas'],
        summary: 'Presta contas sem soltar a ação',
        params: z.object({ codigo: z.string() }),
        body: corpoComTexto.extend({ novoPrazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
        response: { 204: z.null(), 401: erroSchema, 403: erroSchema, 404: erroSchema },
      },
    },
    async (req, reply) => {
      const usuario = await app.autenticar(req)
      /**
       * Atualizar exige VER, não agir.
       *
       * Quem já foi responsável também presta contas — é o que resolve a cadeia
       * de três níveis: o N2 responde ao N3, e o N3 precisa poder repassar ao
       * N4. Exigir a responsabilidade atual calaria justamente quem escalou.
       */
      const acao = await carregar(app.prisma, req.params.codigo, usuario)

      /**
       * Só o responsável ATUAL mexe no prazo. Quem acompanha escreve, mas não
       * prorroga uma ação que não está com ele — senão duas pessoas mudam a
       * mesma data e a última ganha sem ninguém saber.
       */
      if (req.body.novoPrazo && acao.responsavelAtualId !== usuario.id) {
        throw new NaoAutorizado(
          'Só o responsável atual pode mudar o prazo. Você pode escrever a atualização sem alterá-lo.',
        )
      }

      await movimentar(
        usuario,
        acao,
        {
          tipo: 'ATUALIZACAO',
          nivelDestino: acao.nivelAtual,
          responsavelDestinoId: acao.responsavelAtualId,
          texto: req.body.texto,
          ...(req.body.novoPrazo
            ? { novoPrazo: new Date(`${req.body.novoPrazo}T00:00:00.000Z`) }
            : {}),
        },
        req.ip,
      )
      return reply.status(204).send(null)
    },
  )

  // ── Feedback ───────────────────────────────────────────────────────────────
  r.post(
    '/api/v1/contramedidas/:codigo/feedback',
    {
      schema: {
        tags: ['Contramedidas'],
        summary: 'Diz se o indicador respondeu. De quem abriu, depois de concluída.',
        params: z.object({ codigo: z.string() }),
        body: corpoComTexto,
        response: { 204: z.null(), 401: erroSchema, 403: erroSchema, 404: erroSchema },
      },
    },
    async (req, reply) => {
      const usuario = await app.autenticar(req)
      const acao = await carregar(app.prisma, req.params.codigo, usuario)

      /**
       * O feedback é o único movimento que NÃO passa por `podeAgir`: ele é de
       * quem abriu, não do responsável. Quem abriu abriu porque a variável de
       * controle dele ficou vermelha — é ele quem sabe dizer se respondeu.
       */
      if (!acao.concluidaEm) {
        throw new NaoAutorizado(
          'O feedback vem depois da conclusão: ainda não há o que avaliar nesta contramedida.',
        )
      }
      if (acao.criadoPorId !== usuario.id) {
        throw new NaoAutorizado(
          'O feedback é de quem abriu a contramedida, porque foi a variável de controle dele que ficou vermelha.',
        )
      }
      const jaTem = await app.prisma.movimentacao.findFirst({
        where: { contramedidaId: acao.id, tipo: 'FEEDBACK' },
      })
      if (jaTem) throw new NaoAutorizado('Esta contramedida já recebeu feedback.')

      await movimentar(
        usuario,
        acao,
        {
          tipo: 'FEEDBACK',
          nivelDestino: acao.nivelAtual,
          responsavelDestinoId: acao.responsavelAtualId,
          texto: req.body.texto,
        },
        req.ip,
      )
      return reply.status(204).send(null)
    },
  )
}


import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { acharFonte } from '../../fontes/fontes.mjs'
import { env } from '../../config/env.js'
import { DadosInvalidos } from '../../lib/erros.js'
import { MAX_DIAS_MANUAL_DETALHE } from '../ingestao/service.js'
import { exigirAdmin } from '../admin/guarda.js'
import { horarioDaFonte } from './agenda.js'
import {
  cargaAtual,
  cargaEmAndamento,
  executarCargaSql,
  janelaPadrao,
  ehFonteDax,
  executarCargaCadastro,
  executarCargaDax,
  FONTES_AGENDADAS,
  FONTES_DAX,
  FONTES_CADASTRO,
  FONTES_SQL,
} from './executar.js'

/**
 * Carga manual e histórico, para a tela de administração.
 *
 * O disparo é **assíncrono**: a consulta leva minutos e uma requisição HTTP
 * esperando por ela morreria no timeout do proxy antes de terminar — e o
 * administrador ficaria sem saber se gravou. Então a rota registra o pedido,
 * devolve 202, e o acompanhamento é pelo histórico, que lê `sync_execucao`.
 *
 * Só administrador. Uma carga apaga e regrava janelas inteiras de indicador;
 * quem pode disparar isso é quem pode configurar acesso.
 */

const erroSchema = z.object({
  erro: z.string(),
  codigo: z.string(),
  requestId: z.string().optional(),
})

/**
 * As fontes com JANELA — Oracle e Power BI juntas.
 *
 * Para a tela elas são iguais: ambas têm `janelaDias` e aceitam `de`/`ate`. O
 * que muda é de onde o dado vem, e isso é assunto do executor. Separá-las aqui
 * daria ao administrador duas seções que se operam do mesmo jeito.
 */
const FONTES_COM_JANELA = [...FONTES_SQL, ...FONTES_DAX] as const
const fonteSchema = z.enum(FONTES_COM_JANELA)
const fonteCadastroSchema = z.enum(FONTES_CADASTRO)
const ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * Teto da janela manual, POR FONTE — porque a retenção é por fonte.
 *
 * Pedir mais que a retenção carregaria dado que o expurgo apaga na mesma
 * transação: minutos de Oracle para gravar e apagar de imediato. E a consulta
 * leva ~90 s por mês, então o teto também protege de erro de digitação na data.
 *
 * Era um número só, 730, e enquanto as fontes eram Perdas e Movimentação ele
 * estava certo nas duas. `vendas-linha` e `vendedor-dia` gravam nas tabelas de
 * DETALHE, cujo teto manual é `MAX_DIAS_MANUAL_DETALHE` -- um teto de 730 ali
 * aceitaria um pedido de dois anos, rodaria vinte e quatro blocos e terminaria
 * com sessenta dias no banco. Sem erro nenhum, e com o administrador olhando
 * uma barra de progresso por meia hora.
 */
/** O maior dos tetos — só para o schema, que ainda não conhece a fonte. */
const TETO_ABSOLUTO = 730

const MAX_DIAS: Record<FonteComJanela, number> = {
  perdas: 730,
  movimentacao: 730,
  'vendas-linha': MAX_DIAS_MANUAL_DETALHE,
  'vendedor-dia': MAX_DIAS_MANUAL_DETALHE,
  vendas: 730,
  nps: 730,
}

/**
 * O último dia com dado, por fonte — cada uma escreve na sua tabela.
 *
 * Era um ternário `perdas ? fatoPerdas : fatoMovimentacao`, e com duas fontes
 * funcionava. Com quatro, as duas novas herdariam a data da movimentação: o
 * painel mostraria "atualizado até 31/08" para uma fonte que talvez esteja
 * parada há uma semana, e ninguém desconfiaria — o número está lá, plausível.
 *
 * O `Record<FonteComJanela, _>` faz o compilador cobrar a entrada quando uma
 * fonte nova entrar em `FONTES_SQL` **ou** em `FONTES_DAX` -- as duas compoem
 * `FONTES_COM_JANELA`.
 *
 * O comentario dizia `Record<FonteSql, _>` e "quando a fonte entrar em
 * FONTES_SQL", o que nomeava um tipo que nao e' o deste `Record` e prometia
 * cobranca pela metade: fonte nova em `FONTES_DAX` tambem quebra a compilacao
 * aqui, e e' bom que quebre.
 */
const ULTIMO_DIA: Record<FonteComJanela, (p: PrismaClient) => Promise<Date | null>> = {
  perdas: async (p) => (await p.fatoPerdas.aggregate({ _max: { data: true } }))._max.data,
  movimentacao: async (p) =>
    (await p.fatoMovimentacao.aggregate({ _max: { data: true } }))._max.data,
  'vendas-linha': async (p) =>
    (await p.fatoVendasLinha.aggregate({ _max: { data: true } }))._max.data,
  'vendedor-dia': async (p) =>
    (await p.fatoVendaVendedor.aggregate({ _max: { data: true } }))._max.data,
  vendas: async (p) => (await p.fatoVendas.aggregate({ _max: { data: true } }))._max.data,
  nps: async (p) => (await p.fatoNps.aggregate({ _max: { data: true } }))._max.data,
}

type FonteComJanela = (typeof FONTES_COM_JANELA)[number]

function ultimoDiaComDado(prisma: PrismaClient, nome: FonteComJanela): Promise<Date | null> {
  /*
   * Sem `!`, e o comentario que estava aqui explicava um que nao era preciso.
   *
   * Dizia "o `!` e' o `noUncheckedIndexedAccess`". Nao era: aquela opcao vale
   * para ASSINATURA DE INDICE (`Record<string, X>`), e nao para `Record` de
   * chaves literais como este -- indexar por `FonteComJanela`, que e' uniao de
   * literais, nunca produz `undefined`. O `!` calava um aviso que nao existia,
   * e o comentario dava a ele uma razao que soava correta.
   *
   * Achado pelo lint (`no-unnecessary-type-assertion`) na primeira vez que ele
   * rodou de verdade neste repositorio.
   */
  return ULTIMO_DIA[nome](prisma)
}

export async function cargaRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  r.get(
    '/api/v1/admin/cargas',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Fontes de origem Oracle, próximo disparo e histórico recente',
        response: {
          200: z.object({
            emAndamento: z.boolean(),
            /**
             * QUAL carga está rodando, desde quando, em que janela.
             *
             * `emAndamento` continua, e não foi trocado por este campo: ele é o
             * que a tela usa para desabilitar os botões, e trocar um booleano
             * por um objeto numa resposta que outras telas leem é mudança de
             * contrato sem necessidade.
             *
             * Existe porque a linha em `sync_execucao` só nasce depois que o
             * Oracle responde — durante a consulta, que é o que leva minutos, o
             * histórico não tem nada. Ver `CargaEmAndamento`.
             */
            cargaAtual: z
              .object({
                fonte: z.string(),
                /** Nulo nas fontes de cadastro, que são retrato e não janela. */
                de: z.string().nullable(),
                ate: z.string().nullable(),
                desde: z.string(),
              })
              .nullable(),
            fontes: z.array(
              z.object({
                fonte: fonteSchema,
                /** Janela do agendamento, em dias. */
                janelaDias: z.number().int(),
                horario: z.string(),
                /** `false` quando alguém mudou o horário pela tela. */
                horarioPadrao: z.boolean(),
                /** Login de quem mudou por último; nulo se nunca mudou. */
                horarioPor: z.string().nullable(),
                /** Nulo quando o agendamento está desligado (sem Oracle, ou teste). */
                proximo: z.string().nullable(),
                /** Último dia com dado no portal — o que a tela realmente mostra. */
                ultimoDiaComDado: z.string().nullable(),
                /**
                 * `false` = o portal só dispara à mão; quem agenda é o n8n.
                 *
                 * A tela precisa disso para não prometer horário onde não há.
                 * Ver `FONTES_AGENDADAS` em `carga/executar.ts`.
                 */
                agendada: z.boolean(),
              }),
            ),
            /**
             * As fontes de CADASTRO — retrato, sem janela.
             *
             * Lista à parte, e não misturada em `fontes`: elas não têm
             * `janelaDias`, `horario` nem `proximo`, e enfiá-las na mesma lista
             * obrigaria a inventar um valor para cada um desses campos. A tela
             * desenha as duas seções de formas diferentes porque elas SÃO
             * diferentes.
             */
            cadastro: z.array(
              z.object({
                fonte: fonteCadastroSchema,
                /** Quando o portal gravou esta fonte pela última vez, com sucesso. */
                ultimaCarga: z.string().nullable(),
              }),
            ),
            execucoes: z.array(
              z.object({
                id: z.string().uuid(),
                fonte: z.string(),
                status: z.enum(['EM_ANDAMENTO', 'SUCESSO', 'ERRO']),
                de: z.string(),
                ate: z.string(),
                iniciadoEm: z.string(),
                finalizadoEm: z.string().nullable(),
                gravadas: z.number().int(),
                removidas: z.number().int(),
                origem: z.string().nullable(),
                erro: z.string().nullable(),
              }),
            ),
          }),
          403: erroSchema,
        },
      },
    },
    async (req) => {
      await exigirAdmin(app, req)

      const proximos = new Map(app.agenda.proximos().map((p) => [p.fonte, p.quando]))

      const fontes = await Promise.all(
        FONTES_COM_JANELA.map(async (nome) => {
          const f = acharFonte(nome)
          /**
           * O último dia com dado, não a última execução com sucesso.
           *
           * São coisas diferentes e a distinção importa: uma carga pode ter
           * sucedido ontem e ainda assim o portal estar dois dias atrás, se a
           * origem não tinha o dia. É o número que corresponde ao que a tela
           * mostra.
           */
          const ultimo = await ultimoDiaComDado(app.prisma, nome)

          // Horário efetivo, com a mesma regra de precedência do agendamento —
          // por isso vem de `horarioDaFonte`, e não recalculado aqui.
          const h = await horarioDaFonte(app.prisma, nome)
          const salvo = h.padrao
            ? null
            : await app.prisma.cargaAgendamento.findUnique({
                where: { fonte: nome },
                include: { usuario: { select: { loginErp: true } } },
              })

          return {
            fonte: nome,
            janelaDias: f.janelaDias,
            horario: `${String(h.hora).padStart(2, '0')}:${String(h.minuto).padStart(2, '0')}`,
            horarioPadrao: h.padrao,
            horarioPor: salvo?.usuario?.loginErp ?? null,
            proximo: proximos.get(nome)?.toISOString() ?? null,
            ultimoDiaComDado: ultimo ? ultimo.toISOString().slice(0, 10) : null,
            agendada: (FONTES_AGENDADAS as readonly string[]).includes(nome),
          }
        }),
      )

      /*
       * A última execução COM SUCESSO de cada fonte de cadastro.
       *
       * Não é "último dia com dado" como nas fontes de janela: cadastro não tem
       * data de fato -- o vendedor está lotado numa área, e ponto. O que
       * responde "isto está atualizado?" é quando a carga rodou.
       */
      const cadastro = await Promise.all(
        FONTES_CADASTRO.map(async (nome) => {
          const ultima = await app.prisma.syncExecucao.findFirst({
            where: { fonte: nome, status: 'SUCESSO' },
            orderBy: { iniciadoEm: 'desc' },
            select: { finalizadoEm: true, iniciadoEm: true },
          })
          return {
            fonte: nome,
            ultimaCarga: (ultima?.finalizadoEm ?? ultima?.iniciadoEm)?.toISOString() ?? null,
          }
        }),
      )

      const execucoes = await app.prisma.syncExecucao.findMany({
        where: { fonte: { in: [...FONTES_COM_JANELA, ...FONTES_CADASTRO] } },
        orderBy: { iniciadoEm: 'desc' },
        take: 20,
      })

      return {
        emAndamento: cargaEmAndamento(),
        cargaAtual: cargaAtual(),
        fontes,
        cadastro,
        execucoes: execucoes.map((e) => ({
          id: e.id,
          fonte: e.fonte,
          status: e.status,
          de: e.periodoDe.toISOString().slice(0, 10),
          ate: e.periodoAte.toISOString().slice(0, 10),
          iniciadoEm: e.iniciadoEm.toISOString(),
          finalizadoEm: e.finalizadoEm?.toISOString() ?? null,
          gravadas: e.linhasGravadas,
          removidas: e.linhasRemovidas,
          origem: e.origemIp,
          // Truncado: a mensagem do Oracle pode ter centenas de linhas de stack,
          // e a tela precisa do começo, que é onde está a causa.
          erro: e.erro ? e.erro.slice(0, 400) : null,
        })),
      }
    },
  )

  r.post(
    '/api/v1/admin/cargas',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Dispara uma carga: por tamanho de janela em dias, ou por datas',
        body: z
          .object({
            fonte: fonteSchema,
            /**
             * Tamanho da janela em dias, terminando em D-1. É o modo simples da
             * tela: "recarregar os últimos 30 dias".
             */
            /*
             * O teto do schema é o MAIOR dos tetos: aqui ainda não se sabe a
             * fonte. O teto dela é cobrado na rota, com a mensagem que diz
             * qual é e por quê.
             */
            dias: z.number().int().positive().max(TETO_ABSOLUTO).optional(),
            /** Ou a janela explícita, para consertar um período específico. */
            de: z.string().regex(ISO).optional(),
            ate: z.string().regex(ISO).optional(),
          })
          /**
           * Um modo ou o outro, nunca os dois. Aceitar `dias` junto de `de`/`ate`
           * exigiria decidir qual ganha, e qualquer escolha surpreenderia metade
           * de quem chamasse.
           */
          .refine((b) => (b.dias === undefined) !== (b.de === undefined), {
            message: 'Informe `dias` OU o par `de`/`ate`, não os dois.',
          })
          .refine((b) => b.de === undefined || b.ate !== undefined, {
            message: 'Informe também `ate`.',
          }),
        response: {
          202: z.object({
            fonte: fonteSchema,
            de: z.string(),
            ate: z.string(),
            blocos: z.number().int(),
            aviso: z.string().nullable(),
          }),
          403: erroSchema,
          409: erroSchema,
          422: erroSchema,
        },
      },
    },
    async (req, reply) => {
      const admin = await exigirAdmin(app, req)
      const { fonte, dias, de, ate } = req.body

      if (cargaEmAndamento()) {
        return reply.status(409).send({
          erro:
            'Já existe uma carga em andamento. Ela consulta o Oracle e leva minutos; ' +
            'espere terminar antes de disparar outra.',
          codigo: 'CARGA_EM_ANDAMENTO',
          requestId: req.id,
        })
      }

      const janela =
        dias === undefined
          ? { de: de!, ate: ate! }
          : janelaPadrao({ janelaDias: dias }, new Date())

      if (janela.de > janela.ate) throw new DadosInvalidos('`de` é depois de `ate`.')

      const totalDias =
        (Date.parse(`${janela.ate}T00:00:00Z`) - Date.parse(`${janela.de}T00:00:00Z`)) / 86_400_000 +
        1
      const teto = MAX_DIAS[fonte]
      if (totalDias > teto) {
        throw new DadosInvalidos(
          `A janela pedida tem ${Math.round(totalDias)} dias e o teto de ${fonte} é ${teto} ` +
            '(a retenção desta fonte). Janela maior carregaria dado que o expurgo apaga em seguida.',
        )
      }

      await app.prisma.auditLog.create({
        data: {
          usuarioId: admin.id,
          acao: 'DISPARAR_CARGA',
          entidade: 'sync_execucao',
          entidadeId: fonte,
          ip: req.ip,
          payload: { ...janela, dias: dias ?? null },
        },
      })

      /**
       * Dispara e NÃO espera.
       *
       * A carga leva minutos; segurar a resposta até o fim significaria morrer no
       * timeout do proxy sem o administrador saber se gravou. O `catch` é
       * obrigatório: promessa solta que rejeita derruba o processo no Node.
       *
       * A falha fica registrada em `sync_execucao` com status ERRO — e isto
       * **passou a ser verdade em 10/09/2026**. Esta linha já afirmava o mesmo
       * e estava errada: só a falha DENTRO da transação de gravação era
       * registrada. Consulta ao Oracle com erro, teto de linhas, zero linha e
       * validação de cadastro morriam antes de a linha existir, e o log do
       * servidor era o único lugar onde a falha aparecia.
       *
       * Foi medido pelo sintoma: duas cargas manuais de `vendedor-dia`
       * recusadas por cadastro faltando, e zero linha em `sync_execucao` no
       * dia. Na tela, "carga em andamento" e depois nada.
       */
      const executar = ehFonteDax(fonte)
        ? executarCargaDax(app.prisma, fonte, janela, `admin:${admin.loginErp}`)
        : executarCargaSql(app.prisma, fonte, janela, `admin:${admin.loginErp}`)
      void executar.catch((e: unknown) => {
        app.log.error(
          { fonte, ...janela, erro: e instanceof Error ? e.message : String(e) },
          'carga manual FALHOU',
        )
      })

      const blocos = Math.ceil(totalDias / 31)
      return reply.status(202).send({
        fonte,
        ...janela,
        blocos,
        // O aviso existe porque a tela não tem como estimar isto sozinha, e uma
        // carga de 24 blocos parece travada para quem espera segundos.
        aviso:
          blocos > 1
            ? `${blocos} blocos de até 31 dias, em sequência. Perdas leva cerca de 90 s por bloco.`
            : null,
      })
    },
  )
  // ───────────────────────────────────────────────────────────────────────────
  // Cadastro: retrato, sem janela
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Rota SEPARADA, e não um campo opcional na de cima.
   *
   * A rota de janela tem um `refine` que diz a regra dela em voz alta: "`dias`
   * OU o par `de`/`ate`, nunca os dois". Cadastro não tem nenhum dos dois --
   * encaixá-lo ali obrigaria a afrouxar o `refine` para "zero, um ou outro", e o
   * schema deixaria de conseguir enunciar a própria regra. Duas rotas, dois
   * contratos, cada um verdadeiro sobre si.
   */
  r.post(
    '/api/v1/admin/cargas/cadastro',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Atualiza uma fonte de cadastro — retrato do Oracle, sem janela',
        body: z.object({ fonte: fonteCadastroSchema }),
        response: {
          202: z.object({ fonte: fonteCadastroSchema }),
          403: erroSchema,
          409: erroSchema,
          422: erroSchema,
        },
      },
    },
    async (req, reply) => {
      const admin = await exigirAdmin(app, req)
      const { fonte } = req.body

      if (cargaEmAndamento()) {
        return reply.status(409).send({
          erro:
            'Já existe uma carga em andamento. Ela consulta o Oracle e leva minutos; ' +
            'espere terminar antes de disparar outra.',
          codigo: 'CARGA_EM_ANDAMENTO',
          requestId: req.id,
        })
      }

      await app.prisma.auditLog.create({
        data: {
          usuarioId: admin.id,
          acao: 'DISPARAR_CARGA',
          entidade: 'sync_execucao',
          entidadeId: fonte,
          ip: req.ip,
          // Sem janela: o `null` é a informação, e não a ausência dela.
          payload: { cadastro: true, janela: null },
        },
      })

      // Dispara e não espera, pelo mesmo motivo da carga de janela.
      void executarCargaCadastro(app.prisma, fonte, `admin:${admin.loginErp}`).catch(
        (e: unknown) => {
          app.log.error(
            { fonte, erro: e instanceof Error ? e.message : String(e) },
            'atualização de cadastro FALHOU',
          )
        },
      )

      return reply.status(202).send({ fonte })
    },
  )

  // ───────────────────────────────────────────────────────────────────────────
  // Horário do agendamento
  // ───────────────────────────────────────────────────────────────────────────

  r.put(
    '/api/v1/admin/cargas/:fonte/horario',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Muda a hora da carga automática desta fonte',
        params: z.object({ fonte: fonteSchema }),
        body: z.object({
          /**
           * No fuso de `TZ_APP`, não em UTC.
           *
           * A regra é "03:15 em Recife". Guardar UTC faria o valor mudar de
           * significado se o fuso da aplicação mudasse, e obrigaria quem digita
           * a converter de cabeça.
           */
          hora: z.number().int().min(0).max(23),
          minuto: z.number().int().min(0).max(59),
        }),
        response: {
          200: z.object({
            fonte: fonteSchema,
            horario: z.string(),
            /** Quando a próxima carga passou a ser, já com o horário novo. */
            proximo: z.string().nullable(),
          }),
          403: erroSchema,
        },
      },
    },
    async (req) => {
      const admin = await exigirAdmin(app, req)
      const { fonte } = req.params
      const { hora, minuto } = req.body

      const antes = await horarioDaFonte(app.prisma, fonte)

      await app.prisma.cargaAgendamento.upsert({
        where: { fonte },
        create: { fonte, hora, minuto, atualizadoPor: admin.id },
        update: { hora, minuto, atualizadoPor: admin.id, atualizadoEm: new Date() },
      })

      /**
       * Reagenda AGORA, não no próximo disparo.
       *
       * Sem isto, o `setTimeout` já armado continuaria valendo: o administrador
       * salvaria 14:00, veria 14:00 na tela, e a carga rodaria às 03:15. É pior
       * que não deixar editar, porque a tela mentiria.
       */
      await app.agenda.reagendar(fonte)

      await app.prisma.auditLog.create({
        data: {
          usuarioId: admin.id,
          acao: 'ALTERAR_HORARIO_CARGA',
          entidade: 'carga_agendamento',
          entidadeId: fonte,
          ip: req.ip,
          payload: {
            antes: { hora: antes.hora, minuto: antes.minuto, padrao: antes.padrao },
            depois: { hora, minuto },
            fuso: env.TZ_APP,
          },
        },
      })

      const proximo = app.agenda.proximos().find((p) => p.fonte === fonte)?.quando ?? null

      return {
        fonte,
        horario: `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`,
        proximo: proximo?.toISOString() ?? null,
      }
    },
  )
  r.delete(
    '/api/v1/admin/cargas/:fonte/horario',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Volta ao horário padrão do código',
        params: z.object({ fonte: fonteSchema }),
        response: {
          200: z.object({
            fonte: fonteSchema,
            horario: z.string(),
            proximo: z.string().nullable(),
          }),
          403: erroSchema,
        },
      },
    },
    async (req) => {
      const admin = await exigirAdmin(app, req)
      const { fonte } = req.params

      const antes = await horarioDaFonte(app.prisma, fonte)

      /**
       * Apaga a linha em vez de gravar o valor do código nela.
       *
       * Digitar 03:15 na tela dá o mesmo horário HOJE, mas deixa um override: se
       * amanhã alguém mudar a hora em `fontes.mjs`, a linha ganha e a mudança do
       * código não tem efeito — sem ninguém entender por que. Ausência de linha é
       * o que significa "siga o padrão".
       */
      await app.prisma.cargaAgendamento.deleteMany({ where: { fonte } })
      await app.agenda.reagendar(fonte)

      const agoraVale = await horarioDaFonte(app.prisma, fonte)

      await app.prisma.auditLog.create({
        data: {
          usuarioId: admin.id,
          acao: 'ALTERAR_HORARIO_CARGA',
          entidade: 'carga_agendamento',
          entidadeId: fonte,
          ip: req.ip,
          payload: {
            antes: { hora: antes.hora, minuto: antes.minuto, padrao: antes.padrao },
            depois: { ...agoraVale, voltouAoPadrao: true },
            fuso: env.TZ_APP,
          },
        },
      })

      const proximo = app.agenda.proximos().find((p) => p.fonte === fonte)?.quando ?? null

      return {
        fonte,
        horario: `${String(agoraVale.hora).padStart(2, '0')}:${String(agoraVale.minuto).padStart(2, '0')}`,
        proximo: proximo?.toISOString() ?? null,
      }
    },
  )
}

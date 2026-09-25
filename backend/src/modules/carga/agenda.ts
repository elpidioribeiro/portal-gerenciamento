import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import fp from 'fastify-plugin'
import { acharFonte } from '../../fontes/fontes.mjs'
import { env } from '../../config/env.js'
import {
  ehFonteCadastro,
  ehFonteDax,
  executarCargaDax,
  enfileirar,
  executarCargaCadastro,
  executarCargaSql,
  janelaPadrao,
  FONTES_AGENDADAS,
  type FonteAgendavel,
} from './executar.js'

/**
 * Agendamento das cargas de origem Oracle, dentro do próprio portal.
 *
 * Substitui o Schedule Trigger do n8n, que saiu do caminho em 22/08/2026 junto
 * com os fluxos de Perdas e Movimentação. A alternativa era cron do sistema ou
 * CronJob do Kubernetes; ficou aqui por decisão do analista, e a consequência boa
 * é que a credencial do Oracle e o log da falha ficam num lugar só — o portal.
 *
 * Sem dependência de biblioteca de cron. A regra é "todo dia em HH:MM no fuso da
 * aplicação", e para isso um `setTimeout` recalculado a cada disparo basta.
 * `setInterval` de 24 h seria errado: o relógio escorrega com o horário de verão
 * e, depois de meses de processo vivo, o disparo acontece na hora errada.
 *
 * O horário é **editável pela tela** (`carga_agendamento`), com a hora de
 * `fontes.mjs` como padrão. A janela NÃO: `janelaDias` continua em código porque
 * é regra de negócio, não preferência — ver o comentário do modelo no
 * `schema.prisma`.
 */

export interface Horario {
  hora: number
  minuto: number
  /** `false` quando veio de `carga_agendamento`, ou seja alguém mudou. */
  padrao: boolean
}

declare module 'fastify' {
  interface FastifyInstance {
    agenda: {
      /** Próximo disparo de cada fonte, para a tela de administração. */
      proximos: () => Array<{ fonte: FonteAgendavel; quando: Date }>
      /**
       * Refaz o agendamento de uma fonte agora.
       *
       * Chamado pela rota depois de salvar o horário. Sem isto, o `setTimeout`
       * já armado continuaria valendo e a mudança só teria efeito no dia
       * seguinte — o administrador salvaria 14:00, veria 14:00 na tela, e a
       * carga rodaria às 03:15. Confusão pior que não deixar editar.
       */
      reagendar: (fonte: FonteAgendavel) => Promise<void>
      /** Ligado só quando há Oracle configurado e não é ambiente de teste. */
      ativo: boolean
    }
  }
}

/**
 * O horário efetivo: override do banco, ou o padrão do código.
 *
 * Exportada porque a rota de leitura mostra a mesma coisa, e recalcular lá
 * duplicaria a regra de precedência.
 */
export async function horarioDaFonte(prisma: PrismaClient, nome: FonteAgendavel): Promise<Horario> {
  const salvo = await prisma.cargaAgendamento.findUnique({ where: { fonte: nome } })
  if (salvo) return { hora: salvo.hora, minuto: salvo.minuto, padrao: false }

  const f = acharFonte(nome)
  return { hora: f.hora, minuto: f.minuto, padrao: true }
}

/** Milissegundos até o próximo HH:MM no fuso da aplicação. */
export function msAteProximo(hora: number, minuto: number, agora: Date, tz: string): number {
  /**
   * O cálculo é no fuso de `TZ_APP`, não no do processo.
   *
   * O servidor pode rodar em UTC e a regra "03:15" é de Recife. Sem converter, a
   * carga aconteceria às 00:15 local — dentro do dia anterior, com o dado de D-1
   * ainda incompleto na origem.
   */
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(agora)

  const p = (t: string) => Number(partes.find((x) => x.type === t)?.value ?? 0)

  const segundosAgora = p('hour') * 3600 + p('minute') * 60 + p('second')
  const segundosAlvo = hora * 3600 + minuto * 60

  const faltam =
    segundosAlvo > segundosAgora
      ? segundosAlvo - segundosAgora
      : segundosAlvo - segundosAgora + 86_400

  return faltam * 1000
}

export default fp(async function agendaPlugin(app: FastifyInstance) {
  const proximos = new Map<FonteAgendavel, Date>()
  const timers = new Map<FonteAgendavel, NodeJS.Timeout>()

  /**
   * Não agenda em teste nem sem Oracle configurado.
   *
   * Em teste, um `setTimeout` pendente segura o processo e a suíte não termina —
   * e uma carga disparando no meio dos testes escreveria no banco de teste. Sem
   * credencial do Oracle, cada disparo só produziria erro de configuração no log.
   */
  const ativo =
    !env.ehTeste &&
    Boolean(env.ORACLE_USER && env.ORACLE_PASSWORD && env.ORACLE_CONNECT_STRING)

  app.decorate('agenda', {
    proximos: () => [...proximos.entries()].map(([fonte, quando]) => ({ fonte, quando })),
    reagendar: async (fonte: FonteAgendavel) => {
      if (!ativo) return
      await agendar(fonte)
    },
    ativo,
  })

  if (!ativo) {
    app.log[env.ehTeste ? 'info' : 'warn'](
      env.ehTeste
        ? 'Agendamento de cargas desligado: NODE_ENV=test.'
        : 'Agendamento de cargas desligado: Oracle não configurado. ' +
            'Perdas e Movimentação não serão atualizadas automaticamente.',
    )
    return
  }

  async function agendar(nome: FonteAgendavel) {
    // Cancela o timer anterior antes de armar o novo. Sem isto, salvar o horário
    // duas vezes deixaria dois timers vivos e a carga rodaria duas vezes.
    const antigo = timers.get(nome)
    if (antigo) clearTimeout(antigo)

    const { hora, minuto, padrao } = await horarioDaFonte(app.prisma, nome)
    const espera = msAteProximo(hora, minuto, new Date(), env.TZ_APP)
    const quando = new Date(Date.now() + espera)
    proximos.set(nome, quando)

    const t = setTimeout(() => {
      void disparar(nome)
    }, espera)

    // Sem `unref`, o timer segura o processo aberto e o encerramento gracioso
    // espera até a próxima madrugada.
    t.unref()
    timers.set(nome, t)

    app.log.info(
      {
        fonte: nome,
        quando: quando.toISOString(),
        horaLocal: `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`,
        fuso: env.TZ_APP,
        padrao,
      },
      'carga agendada',
    )
  }

  async function disparar(nome: FonteAgendavel) {
    /*
     * Cadastro não tem janela: o SQL não recebe `:de` nem `:ate`. Calcular uma
     * para depois ignorá-la seria escrever no log um período que não filtrou
     * nada.
     */
    const cadastro = ehFonteCadastro(nome)
    const janela = cadastro ? null : janelaPadrao(acharFonte(nome), new Date())

    try {
      /*
       * ENFILEIRA, não recusa: se outra carga está rodando, esta espera a vez.
       * "Às 3h40" significa uma vez por dia, e não "às 3h40, se estiver livre".
       * Ver `enfileirar` em `executar.ts`.
       */
      const gravadas = await enfileirar(async () => {
        if (ehFonteCadastro(nome)) {
          const r = await executarCargaCadastro(app.prisma, nome, 'agenda')
          return { gravadas: r.gravadas, segundos: r.segundos }
        }
        // Power BI ou Oracle: a janela é a mesma, a origem é que muda.
        const r = ehFonteDax(nome)
          ? await executarCargaDax(app.prisma, nome, janela!, 'agenda')
          : await executarCargaSql(app.prisma, nome, janela!, 'agenda')
        return { gravadas: r.totalGravadas, segundos: r.segundos }
      })
      app.log.info(
        { fonte: nome, ...(janela ?? {}), ...gravadas },
        'carga agendada concluída',
      )
    } catch (e) {
      /**
       * Falha é logada e o agendamento CONTINUA.
       *
       * Um erro hoje — Oracle fora, rede caída, consulta lenta demais — não é
       * razão para parar de tentar amanhã. E a falha não fica só no log: o
       * `executarCarga` grava a execução com status ERRO em `sync_execucao`, que
       * é o que a tela de administração mostra.
       */
      app.log.error(
        { fonte: nome, ...(janela ?? {}), erro: e instanceof Error ? e.message : String(e) },
        'carga agendada FALHOU',
      )
    } finally {
      // Reagenda a partir do fim, não do início: uma carga que levou 8 minutos
      // não deve empurrar a próxima para 8 minutos depois do horário. E relê o
      // banco, então um horário salvo durante a carga já vale para a próxima.
      await agendar(nome)
    }
  }

  // Só o subconjunto agendado, não tudo que o executor sabe carregar. Ver
  // `FONTES_AGENDADAS` em `executar.ts`.
  for (const nome of FONTES_AGENDADAS) await agendar(nome)

  app.addHook('onClose', async () => {
    for (const t of timers.values()) clearTimeout(t)
  })
})

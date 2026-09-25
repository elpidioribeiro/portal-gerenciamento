import { describe, expect, it } from 'vitest'
import { msAteProximo } from '../../src/modules/carga/agenda.js'
import { janelaPadrao } from '../../src/modules/carga/executar.js'

/**
 * As duas contas do agendamento interno de cargas.
 *
 * Valem teste porque erram em silêncio. Uma carga que dispara na hora errada
 * ainda roda e ainda grava — só grava um dia que a origem não fechou. E uma
 * janela com um dia a mais ou a menos não falha em lugar nenhum: o portal só
 * fica com um buraco, ou reescreve um dia extra.
 */

const TZ = 'America/Recife'

/** Um instante UTC a partir da hora de Recife (UTC−3, sem horário de verão). */
const emRecife = (dia: number, h: number, m: number, s = 0) =>
  new Date(Date.UTC(2026, 7, dia, h + 3, m, s))

describe('msAteProximo', () => {
  const horas = (ms: number) => ms / 3_600_000

  /**
   * O caso que motivou converter o fuso: o servidor pode rodar em UTC e a regra
   * "03:15" é de Recife. Sem converter, a carga aconteceria às 00:15 local —
   * dentro do dia anterior, com o dado de D-1 ainda incompleto na origem.
   */
  it('conta a partir da hora no fuso da aplicação, não do processo', () => {
    // 01:00 em Recife = 04:00 UTC. Faltam 2h15 para 03:15 de Recife.
    expect(horas(msAteProximo(3, 15, emRecife(22, 1, 0), TZ))).toBeCloseTo(2.25, 3)
  })

  it('vai para o dia seguinte quando a hora já passou', () => {
    // 10:00 em Recife; 03:15 já passou, então faltam 17h15.
    expect(horas(msAteProximo(3, 15, emRecife(22, 10, 0), TZ))).toBeCloseTo(17.25, 3)
  })

  /**
   * Exatamente na hora conta como PASSADO, e é o certo: se contasse como agora,
   * o `setTimeout` receberia 0 e dispararia num laço enquanto o segundo durasse.
   */
  it('exatamente na hora agenda para amanhã', () => {
    expect(horas(msAteProximo(3, 15, emRecife(22, 3, 15), TZ))).toBeCloseTo(24, 3)
  })

  it('nunca devolve negativo nem zero', () => {
    for (const h of [0, 3, 12, 23]) {
      for (const m of [0, 15, 59]) {
        for (const agoraH of [0, 3, 12, 23]) {
          const ms = msAteProximo(h, m, emRecife(22, agoraH, 30), TZ)
          expect(ms, `${h}:${m} às ${agoraH}:30`).toBeGreaterThan(0)
          expect(ms).toBeLessThanOrEqual(86_400_000)
        }
      }
    }
  })

  /** Perdas 03:15 e Movimentação 03:20 são escalonadas de propósito. */
  it('preserva o escalonamento entre as duas fontes', () => {
    const agora = emRecife(22, 1, 0)
    const perdas = msAteProximo(3, 15, agora, TZ)
    const mov = msAteProximo(3, 20, agora, TZ)
    expect(mov - perdas).toBe(5 * 60_000)
  })
})

describe('janelaPadrao', () => {
  /** 22/08 às 10:00; D-1 é 21/08. */
  const hoje = new Date(Date.UTC(2026, 7, 22, 10, 0, 0))

  it('termina em D-1, não hoje', () => {
    expect(janelaPadrao({ janelaDias: 1 }, hoje).ate).toBe('2026-08-21')
  })

  /**
   * Contagem INCLUSIVA: `dias: 3` são 19, 20 e 21 — três datas.
   *
   * Corrige um fora-por-um herdado do fluxo do n8n, que fazia `de = D-1 − dias`
   * e abrangia `dias + 1` datas. Lá era invisível (reescrever um dia extra não
   * muda resultado); aqui o administrador digita o número e tem de recebê-lo.
   */
  it('conta os dias de forma inclusiva', () => {
    expect(janelaPadrao({ janelaDias: 1 }, hoje)).toEqual({
      de: '2026-08-21',
      ate: '2026-08-21',
    })
    expect(janelaPadrao({ janelaDias: 3 }, hoje)).toEqual({
      de: '2026-08-19',
      ate: '2026-08-21',
    })
  })

  it('atravessa mês e ano sem escorregar', () => {
    const emJaneiro = new Date(Date.UTC(2026, 0, 2, 10, 0, 0))
    expect(janelaPadrao({ janelaDias: 3 }, emJaneiro)).toEqual({
      de: '2025-12-30',
      ate: '2026-01-01',
    })
  })

  it('a janela de 730 dias cobre exatamente 730 datas', () => {
    const j = janelaPadrao({ janelaDias: 730 }, hoje)
    const dias = (Date.parse(`${j.ate}T00:00:00Z`) - Date.parse(`${j.de}T00:00:00Z`)) / 86_400_000
    expect(dias + 1).toBe(730)
  })
})

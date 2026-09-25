import { describe, expect, it } from 'vitest'
import {
  RETENCAO_DIAS_DETALHE,
  inicioDaJanelaViva,
  limiteDoDetalhe,
  retencaoEfetiva,
} from '../../src/modules/ingestao/service.js'

/**
 * As duas fronteiras de tempo da carga de detalhe — e elas não são a mesma.
 *
 * `limiteDoDetalhe` diz até onde o dado é GUARDADO. `inicioDaJanelaViva` diz
 * até onde ele é COMPARÁVEL com o agregado do Power BI, que tem atualização
 * incremental e congela partição antiga.
 *
 * Confundi-las custa caro nos dois sentidos: com a retenção curta o histórico
 * é destruído todo dia (§7.55); com a comparação aplicada a mês congelado, o
 * backfill inteiro é recusado por uma divergência que não é defeito de
 * ninguém — o agregado é a foto de janeiro e o detalhe é o de hoje.
 */

const em = (iso: string) => new Date(`${iso}T12:00:00.000Z`)
const dia = (d: Date) => d.toISOString().slice(0, 10)

describe('janela viva do Power BI', () => {
  it('vale o mês corrente e o anterior', () => {
    expect(dia(inicioDaJanelaViva(em('2026-09-03')))).toBe('2026-08-01')
    expect(dia(inicioDaJanelaViva(em('2026-09-30')))).toBe('2026-08-01')
    expect(dia(inicioDaJanelaViva(em('2026-08-01')))).toBe('2026-07-01')
  })

  /**
   * A virada do ano é onde uma regra escrita à mão erra.
   *
   * `Date.UTC` com mês -1 resolve sozinho; escrever `mes === 0 ? ...` é onde
   * aparece o janeiro que vira mês 13 do mesmo ano.
   */
  it('atravessa a virada do ano', () => {
    expect(dia(inicioDaJanelaViva(em('2026-01-15')))).toBe('2025-12-01')
    expect(dia(inicioDaJanelaViva(em('2026-02-01')))).toBe('2026-01-01')
  })

  /**
   * É MENSAL, não 60 dias corridos — a partição do refresh incremental é
   * mensal. Em 1º de março, 60 dias corridos alcançariam 31 de dezembro; a
   * regra mensal para em 1º de fevereiro, que é onde a partição viva começa.
   */
  it('não é uma janela de 60 dias corridos', () => {
    const inicio = inicioDaJanelaViva(em('2026-03-01'))
    expect(dia(inicio)).toBe('2026-02-01')

    const corridos = new Date(em('2026-03-01').getTime() - 60 * 86_400_000)
    expect(dia(corridos) < dia(inicio)).toBe(true)
  })
})

describe('retenção do detalhe', () => {
  /**
   * Guarda 60 dias — o CICLO CORRENTE, e não o histórico.
   *
   * O histórico é do `venda_area_mes`, consolidado por mês antes de o expurgo
   * alcançar o detalhe. Um ano de detalhe custa 506 MB para responder o que o
   * resumo responde em 592 kB.
   */
  /** O corte é MEIA-NOITE: com a hora corrente, `data < corte` levava junto o
   *  próprio dia do corte — 61 dias, não 60, e um a mais a cada carga. */
  it('corta em meia-noite, e não na hora da carga', () => {
    const corte = limiteDoDetalhe(em('2026-09-03'), RETENCAO_DIAS_DETALHE)
    expect(corte.toISOString()).toBe('2026-07-05T00:00:00.000Z')
  })

  it('guarda os 60 dias do ciclo corrente', () => {
    expect(dia(limiteDoDetalhe(em('2026-09-03'), RETENCAO_DIAS_DETALHE))).toBe('2026-07-05')
    expect(dia(limiteDoDetalhe(em('2026-03-01'), RETENCAO_DIAS_DETALHE))).toBe('2025-12-31')
  })

  /**
   * Cobre a janela viva do BI com folga, e é isso que precisa continuar
   * valendo: a conferência do detalhe contra o agregado só roda dentro dela, e
   * um detalhe mais curto que a janela viva deixaria dias comparáveis sem
   * detalhe para comparar.
   */
  it('alcança mais para trás do que a janela viva do BI', () => {
    for (const d of ['2026-09-03', '2026-03-01', '2026-01-15', '2026-12-31']) {
      expect(dia(limiteDoDetalhe(em(d), RETENCAO_DIAS_DETALHE)) <= dia(inicioDaJanelaViva(em(d))), d).toBe(
        true,
      )
    }
  })
})

/**
 * O ambiente pode AMPLIAR a retenção, e nunca encurtá-la.
 *
 * A variável existe para o backfill: carregar doze meses e consolidar o resumo
 * exige que o expurgo não apague o bloco antigo entre a gravação e a
 * consolidação. Se ela pudesse ENCURTAR, um erro de digitação em produção
 * apagaria detalhe -- e ninguém descobriria até precisar do dado.
 */
describe('a retenção pedida pelo ambiente', () => {
  it('amplia a janela quando pede mais', () => {
    expect(retencaoEfetiva(400)).toBe(400)
  })

  it('NÃO encurta quando pede menos', () => {
    expect(retencaoEfetiva(7)).toBe(RETENCAO_DIAS_DETALHE)
    expect(retencaoEfetiva(0)).toBe(RETENCAO_DIAS_DETALHE)
  })
})

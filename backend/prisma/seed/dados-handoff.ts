/**
 * Números literais do handoff (docs/handoff/README.md, seção "Dados da matriz").
 *
 * Este arquivo é a fonte da verdade do seed: tudo o mais é derivado daqui.
 * Se o handoff mudar, muda só aqui.
 */

/** Ordem das filiais na matriz, conforme o handoff. */
/**
 * As 9 filiais do GD, com o `cod_empresa` do sistema corporativo.
 *
 * O código precisa estar AQUI e não só na migration: o seed apaga e recria as
 * filiais, então um código gravado apenas por migration desaparece no primeiro
 * `db:seed` — e a tela de administração passa a mostrar "8" em vez de "CAM",
 * sem erro nenhum indicando o que se perdeu.
 *
 * É a mesma correspondência usada em toda a ingestão (`src/fontes/fontes.mjs`).
 */
export const FILIAIS = [
  // Nomes completos das nove, informados pelo analista em 31/08/2026.
  //
  // O handoff só trazia as siglas de seis delas, e o seed repetia a sigla no
  // lugar do nome ("LES" chamada de LES) com a nota de que era pendência de
  // cadastro. Era: `filial.nome` aparece na tela de login e no seletor de loja,
  // e "OES" não diz a ninguém que é Oeste.
  { sigla: 'CEN', nome: 'Centro', codigo: 1 },
  { sigla: 'NOR', nome: 'Norte', codigo: 2 },
  { sigla: 'SUL', nome: 'Sul', codigo: 3 },
  { sigla: 'LES', nome: 'Leste', codigo: 4 },
  { sigla: 'OES', nome: 'Oeste', codigo: 5 },
  { sigla: 'LIT', nome: 'Litoral', codigo: 6 },
  { sigla: 'SER', nome: 'Serra', codigo: 7 },
  { sigla: 'CAM', nome: 'Campo', codigo: 8 },
  { sigla: 'PRA', nome: 'Praia', codigo: 9 },
] as const

export type SiglaFilial = (typeof FILIAIS)[number]['sigla']

/** `[valor, desvio % sobre a meta]` por filial, na ordem de FILIAIS. */
export const MATRIZ = {
  vendas: [
    [280_000, -13],
    [485_000, 2],
    [620_000, 5],
    [310_000, 1],
    [265_000, -6],
    [398_000, 3],
    [175_000, -18],
    [224_000, -4],
    [512_000, 7],
  ],
  // Desvios recalculados para meta 75, a REAL (medida [Meta NPS] do dataset).
  // O handoff trazia -10, 1, 6, -1, 4, -4, -15, 0, 8, que sao os desvios contra
  // meta 80 — o mockup usava 80. Os VALORES nao mudaram; so' a referencia.
  //
  // O `verificarMetas()` pegou isso: trocar a meta sem recalcular a matriz
  // derrubou o seed com "valor 77 com meta 75 da 3%, mas o handoff diz -4%".
  nps: [
    [72, -4],
    [81, 8],
    [85, 13],
    [79, 5],
    [83, 11],
    [77, 3],
    [68, -9],
    [80, 7],
    [86, 15],
  ],
  // SINAL DA ORIGEM: perda e' negativa. O handoff trazia positivo, mas a
  // convencao da empresa — e de todos os dashboards — e' negativa, e o portal
  // discordar do resto seria pior que divergir do mockup.
  //
  // Com o valor negativo, o desvio inverte de sinal junto: 3,8 contra meta 4,0
  // era "5% abaixo da meta"; -3,8 contra meta -4,0 e' "5% ACIMA", porque perder
  // menos do que o limite e' estar melhor que ele.
  perdas: [
    [-3.8, 5],
    [-5.8, -45],
    [-3.5, 13],
    [-4.2, -5],
    [-3.9, 3],
    [-4.6, -15],
    [-5.1, -28],
    [-3.4, 15],
    [-3.7, 8],
  ],
  custo: [
    [16.8, -1],
    [17.5, 3],
    [16.1, -5],
    [17.1, 1],
    [16.5, -3],
    [18.2, 7],
    [17.8, 5],
    [16.9, -1],
    [16.3, -4],
  ],
} as const satisfies Record<string, ReadonlyArray<readonly [number, number]>>

// A aritmética de desvio é a MESMA de produção — reexportada de um lugar só
// para que seed e API não possam divergir. Ver src/lib/percentual.ts para as
// três armadilhas de ponto flutuante que ela resolve.
import { arredondar, desvioPercentual } from '../../src/lib/percentual.js'

export { arredondar, desvioPercentual }

/**
 * Metas globais. Descoberta ao conferir os números: para NPS, Perdas e Custo,
 * uma única meta reproduz **exatamente** os nove desvios do handoff — só
 * Vendas precisa de meta por filial. O "meta derivada por filial" do handoff
 * é, na prática, sobre Vendas.
 */
export const META_GLOBAL = {
  /** 75, nao os 80 do handoff: e' o que a medida [Meta NPS] do dataset devolve. */
  nps: 75,
  /** NEGATIVA, como a origem: e' o limite de perda que nao se deve furar. */
  perdas: -4.0,
  custo: 17.0,
} as const

/**
 * Metas de Vendas por filial, derivadas de `valor / (1 + desvio)` e arredondadas
 * para o milhar. `verificarMetas()` confirma que o desvio recalculado bate com
 * o handoff — se algum dia não bater, o seed falha em vez de gerar uma matriz
 * silenciosamente diferente do design.
 */
export const META_VENDAS: Record<SiglaFilial, number> = {
  CEN: 322_000,
  NOR: 475_000,
  SUL: 590_000,
  LES: 307_000,
  OES: 282_000,
  LIT: 386_000,
  SER: 213_000,
  CAM: 233_000,
  PRA: 478_000,
}

/** Meta do indicador para uma filial. */
export function metaDe(indicador: keyof typeof MATRIZ, sigla: SiglaFilial): number {
  if (indicador === 'vendas') return META_VENDAS[sigla]
  return META_GLOBAL[indicador]
}

/**
 * Confere que as metas escolhidas reproduzem os desvios do handoff.
 * Roda no início do seed: é barato e transforma um erro silencioso de dado
 * numa falha imediata e legível.
 */
export function verificarMetas(): void {
  const problemas: string[] = []

  for (const [indicador, linhas] of Object.entries(MATRIZ)) {
    linhas.forEach(([valor, desvioEsperado], i) => {
      const filial = FILIAIS[i]
      if (!filial) return
      const meta = metaDe(indicador as keyof typeof MATRIZ, filial.sigla)
      const calculado = arredondar(desvioPercentual(valor, meta))
      if (calculado !== desvioEsperado) {
        problemas.push(
          `${indicador} · ${filial.sigla}: valor ${valor} com meta ${meta} dá ${calculado}%, ` +
            `mas o handoff diz ${desvioEsperado}%`,
        )
      }
    })
  }

  if (problemas.length > 0) {
    throw new Error(
      `Metas do seed não reproduzem a matriz do handoff:\n  ${problemas.join('\n  ')}`,
    )
  }
}

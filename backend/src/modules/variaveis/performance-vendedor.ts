/**
 * Performance Vendedor — % dos vendedores da área que cumpriram meta.
 *
 * Módulo **puro**: recebe as linhas já carregadas, devolve a conta.
 *
 * Ver PLANO §7.14.
 */

import { SITAFA_DESLIGADO } from '../../lib/sitafa.js'

/**
 * A classificação do vendedor no mês. **Vem pronta da carga**
 * (`vendedor-situacao.sql`), não é calculada aqui.
 *
 * Chegou a ser reproduzida neste módulo, e foi removida em 27/08/2026: com a
 * coluna vindo da origem, a função virava uma SEGUNDA cópia da mesma regra, e
 * duas cópias divergem. Quem manda é o Oracle — é lá que o Power BI a define, e
 * é contra o Power BI que o número é conferido.
 *
 * O preço, e ele é real: a regra deixou de ser legível aqui dentro. Ela está no
 * cabeçalho do SQL, com as cinco perguntas na ordem em que valem.
 */
/*
 * A GRAFIA É A DO ENUM (`SEM_VENDA`), e não a humana (`SEM VENDA`).
 *
 * Era a humana até 03/09/2026, e as duas se encontravam num `as` nos pontos de
 * chamada -- que não converte nada. O Prisma entregava `SEM_VENDA`, a regra
 * comparava com `SEM VENDA`, a comparação nunca casava e **todo vendedor "sem
 * venda" entrava no denominador**: sem erro, com número plausível na tela, e com
 * o teste unitário verde porque ele passava a grafia humana à mão.
 *
 * Uma grafia só, a mesma do enum do banco e do schema de ingestão, e o `as`
 * deixa de ter o que esconder.
 */
export type HouveVenda = 'SEM_VENDA' | 'SUPERVISOR' | 'MES_EM_VIGOR' | 'COM_VENDA'

/** O que a conta precisa saber de um vendedor num mês. */
export interface VendedorNoMes {
  codVendedor: string
  /** Nula em conta genérica — não é pessoa, não tem matrícula. */
  matricula: string | null
  nome: string
  areaVenda: string
  ano: number
  mes: number
  /** `COTA_MENSAL`, de `vendedor-situacao.sql`. Zero significa sem meta definida. */
  meta: number
  /** Soma de `vendedor-dia.sql` no mês. **Não** vem de `VLR_VND_MES`. */
  realizado: number
  /** Situação funcional. Conta genérica já vem como 1 (ativa) da origem. */
  sitafa: number
  houveVenda: HouveVenda
}

/** Quem não está trabalhando. Ver `lib/sitafa.ts`. */
const SITAFA_INATIVO = SITAFA_DESLIGADO

/**
 * Quem entra no denominador. **Três condições, todas do analista** (27/08/2026):
 *
 *   `HOUVE_VENDA <> 'SEM_VENDA'` · `SITAFA <> 7` · `COTA_MENSAL > 0`
 *
 * Esta é a regra que fica no portal, e ela é DIFERENTE da classificação: a
 * classificação é do Power BI e vem pronta; quais categorias entram no
 * percentual é decisão do indicador, e mora aqui — legível, testada, e mudável
 * sem tocar em SQL.
 *
 * A terceira condição é a que mais muda o número e a mais fácil de esquecer:
 * vendedor sem meta definida não tem o que cumprir. Contá-lo como "não bateu"
 * afundaria a área por um cadastro em branco; como "bateu", inflaria. Fica de
 * fora, e a conta diz quantos ficaram.
 */
export function contaNoDenominador(v: VendedorNoMes): boolean {
  return v.houveVenda !== 'SEM_VENDA' && v.sitafa !== SITAFA_INATIVO && v.meta > 0
}

/** Bateu quem alcançou a própria meta. Igual conta como batida. */
export function bateuMeta(v: VendedorNoMes): boolean {
  return v.realizado >= v.meta
}

export interface PerformanceVendedor {
  areaVenda: string
  /** Vendedores que bateram a meta individual. */
  numerador: number
  /** Vendedores que contam no mês. */
  denominador: number
  /** `numerador / denominador` em %. Nulo quando ninguém conta. */
  percentual: number | null
  /**
   * Quantos ficaram de fora, e por quê. Vai para a tela.
   *
   * Sem isto, uma área com 18 vendedores mostrando "8 de 9" parece erro de
   * cálculo. O número é honesto — os outros 9 não tinham meta, ou estavam
   * inativos — mas só é crível se a tela puder dizer isso.
   */
  foraDaConta: { semMeta: number; inativos: number; outros: number }
}

export function performanceVendedor(vendedores: VendedorNoMes[]): PerformanceVendedor[] {
  const porArea = new Map<string, VendedorNoMes[]>()
  for (const v of vendedores) {
    const lista = porArea.get(v.areaVenda) ?? []
    lista.push(v)
    porArea.set(v.areaVenda, lista)
  }

  return [...porArea].map(([areaVenda, lista]) => {
    const contam = lista.filter(contaNoDenominador)
    const numerador = contam.filter(bateuMeta).length

    const fora = lista.filter((v) => !contaNoDenominador(v))
    return {
      areaVenda,
      numerador,
      denominador: contam.length,
      percentual: contam.length === 0 ? null : (numerador / contam.length) * 100,
      foraDaConta: {
        semMeta: fora.filter((v) => v.meta <= 0 && v.sitafa !== SITAFA_INATIVO).length,
        inativos: fora.filter((v) => v.sitafa === SITAFA_INATIVO).length,
        outros: fora.filter((v) => v.meta > 0 && v.sitafa !== SITAFA_INATIVO).length,
      },
    }
  })
}

/**
 * O rolo da gerência: soma numerador e denominador, **nunca promedia
 * percentuais**.
 *
 * Mesma regra de Performance Vendas. Promediar pesa uma área de 4 vendedores
 * igual a uma de 18, e o número da gerência deixa de ser o cumprimento dela.
 */
export function consolidarVendedor(itens: PerformanceVendedor[]): PerformanceVendedor | null {
  if (itens.length === 0) return null

  const numerador = itens.reduce((a, i) => a + i.numerador, 0)
  const denominador = itens.reduce((a, i) => a + i.denominador, 0)
  if (denominador === 0) return null

  return {
    areaVenda: '',
    numerador,
    denominador,
    percentual: (numerador / denominador) * 100,
    foraDaConta: {
      semMeta: itens.reduce((a, i) => a + i.foraDaConta.semMeta, 0),
      inativos: itens.reduce((a, i) => a + i.foraDaConta.inativos, 0),
      outros: itens.reduce((a, i) => a + i.foraDaConta.outros, 0),
    },
  }
}

import type { PrismaClient } from '@prisma/client'

/**
 * As variáveis de controle e pontos de causa REAIS do Gerenciamento Diário.
 *
 * Separado de `indicadores.ts` de propósito. Aquele arquivo traz o catálogo do
 * handoff — 12 variáveis inventadas, com valor, meta e pesos de Pareto
 * sintéticos, que existem para a tela ter o que mostrar antes de haver dado.
 * Misturar as duas coisas num arquivo só faria com que, daqui a três meses,
 * ninguém soubesse qual variável veio da operação e qual foi invenção de
 * protótipo — e a diferença importa: a inventada pode ser apagada, a real não.
 *
 * O que entra AQUI vem do analista, uma variável por vez. Por isso:
 *
 *  - **sem `valor`** — o número vem do cálculo semanal, não do seed;
 *  - **sem `meta`** — meta é dado de carga (`escopo: 'VARIAVEL'`), e inventar
 *    uma aqui faria a tela pintar verde ou vermelho por um palpite;
 *  - **sem peso de Pareto** — as ocorrências são MARCADAS por gente na reunião
 *    do N4, semana a semana. Gerar ocorrência sintética para uma variável real
 *    encheria o Pareto de causas que ninguém apontou.
 *
 * Ver PLANO.md §7.7.
 */
export interface VariavelGd {
  /** Código do indicador ao qual ela pendura. */
  indicador: string
  nome: string
  unidade: string
  sentido: 'MAIOR_MELHOR' | 'MENOR_MELHOR'
  /** Os pontos de causa, na ordem em que aparecem na tela de marcação. */
  pontosCausa: string[]
}

/**
 * A ORDEM DESTA LISTA É A ORDEM DA TELA.
 *
 * `semearVariaveisGd` grava `VariavelControle.ordem` a partir daqui, e a rota
 * do GD lê as variáveis por ela — então o seletor de "contando causas de"
 * desenha os botões nesta sequência, e o quadro abre contando a PRIMEIRA.
 *
 * Performance Vendas na frente por decisão do analista (11/09/2026): é a
 * pergunta do quadro — o resultado da área —, e Performance Vendedor explica
 * parte dela. Antes não havia ordem nenhuma, e quem escolhia era o banco.
 */
export const VARIAVEIS_GD: VariavelGd[] = [
  {
    indicador: 'vendas',
    /** % de cumprimento da meta de vendas das linhas da área. */
    nome: 'Performance Vendas',
    unidade: '%',
    sentido: 'MAIOR_MELHOR',
    /*
     * A grafia está como o analista a passou, de propósito: estes nomes são o
     * que a pessoa lê na tela de marcação, e "corrigir" para uma forma canônica
     * criaria distância entre o que ela reconhece e o que está gravado.
     *
     * Duas decisões do analista em 27/08/2026:
     *
     * **"Falta de produto" nas quatro.** A lista original tinha uma delas como
     * "Falta Produto". Os outros prefixos são substantivos — Pessoas, Preço —,
     * e "Falta Produto" é frase; numa lista lida de relance, misturar os dois
     * registros faz o item parecer de outra origem. E lê melhor com o
     * complemento: "Falta de produto - atraso..." é frase inteira.
     *
     * **"Pessoas -", sem complemento, ficou de FORA.** Chegou truncado na
     * lista; a intenção era um item aberto, para marcar o que não cabe nas
     * categorias fechadas. Adiado — item aberto sem nome pedia que a pessoa
     * inventasse o significado na hora, e dois supervisores inventariam
     * diferente. Volta quando tiver nome e regra.
     */
    pontosCausa: [
      'Pessoas - Quadro Incompleto',
      'Pessoas - Ausência/ Folgas',
      'Pessoas - Em desenvolvimento',
      'Preço - Loja X Concorrente',
      'Preço - Frete',
      'Falta de produto - não tem para abastecimento na loja',
      'Falta de produto - atraso para abastecimento na loja',
      'Falta de produto - quantidade insuficiente',
      'Falta de produto - produto não localizado (Dep. 17)',
      'Baixo Fluxo',
      'Condições Climáticas',
    ],
  },
  {
    indicador: 'vendas',
    /** % dos vendedores das linhas da área que cumpriram meta. */
    nome: 'Performance Vendedor',
    unidade: '%',
    sentido: 'MAIOR_MELHOR',
    pontosCausa: [
      'Colaboradores em desenvolvimento',
      'Saúde - Atestados',
      'Pessoal',
      'Escala de Folgas',
    ],
  },
]

/**
 * Grava o catálogo real, DEPOIS do sintético.
 *
 * `ordem` continua de onde o catálogo do handoff parou, para as reais
 * aparecerem no fim da lista do indicador enquanto as duas convivem. Quando as
 * sintéticas saírem, a ordem se reajusta sozinha na próxima execução.
 *
 * **A ordem se GRAVA TAMBÉM NO UPDATE, e antes não se gravava.** Só o `create`
 * a escrevia, então trocar a sequência de `VARIAVEIS_GD` não mudava nada numa
 * base que já existe — e todas existem. Reordenar o catálogo viraria uma
 * migração escrita à mão, ou um UPDATE manual em cada ambiente: exatamente o
 * tipo de passo que se esquece num deles. Rodando o seed, a base passa a
 * espelhar esta lista.
 */
export async function semearVariaveisGd(prisma: PrismaClient) {
  let total = 0
  let causas = 0

  /*
   * De onde a numeração das reais começa, por indicador.
   *
   * As SINTÉTICAS do handoff ficam antes, e por isso o `notIn`: se o máximo
   * incluísse as próprias reais, cada execução do seed as empurraria mais para
   * baixo — a lista andaria sozinha a cada `db:seed`.
   */
  const base = new Map<string, number>()
  /** Quantas reais do indicador já foram gravadas — a posição dentro do bloco. */
  const gravadas = new Map<string, number>()

  for (const v of VARIAVEIS_GD) {
    const indicador = await prisma.indicador.findUnique({ where: { codigo: v.indicador } })
    if (!indicador) {
      throw new Error(
        `A variável "${v.nome}" pendura no indicador "${v.indicador}", que não existe no catálogo.`,
      )
    }

    if (!base.has(indicador.id)) {
      const sinteticas = await prisma.variavelControle.aggregate({
        where: {
          indicadorId: indicador.id,
          nome: { notIn: VARIAVEIS_GD.filter((o) => o.indicador === v.indicador).map((o) => o.nome) },
        },
        _max: { ordem: true },
      })
      base.set(indicador.id, sinteticas._max.ordem ?? 0)
    }
    const posicao = (gravadas.get(indicador.id) ?? 0) + 1
    gravadas.set(indicador.id, posicao)
    const ordem = (base.get(indicador.id) ?? 0) + posicao

    const rVar = await prisma.variavelControle.upsert({
      where: { indicadorId_nome: { indicadorId: indicador.id, nome: v.nome } },
      update: { unidade: v.unidade, sentido: v.sentido, ordem },
      create: {
        indicadorId: indicador.id,
        nome: v.nome,
        unidade: v.unidade,
        sentido: v.sentido,
        ordem,
      },
    })
    total++

    for (const [i, nome] of v.pontosCausa.entries()) {
      await prisma.pontoCausa.upsert({
        where: { variavelControleId_nome: { variavelControleId: rVar.id, nome } },
        update: { ordem: i + 1 },
        create: { variavelControleId: rVar.id, nome, ordem: i + 1 },
      })
      causas++
    }
  }

  const vinculos = await vincularGerencias(prisma)
  console.log(
    `  variáveis do GD (reais): ${total}, com ${causas} pontos de causa, ` +
      `${vinculos} vínculos de gerência`,
  )
}

/**
 * Liga as gerências de venda às variáveis de venda.
 *
 * É o que faz a tela do N3 mostrar a seção Vendas para Construção e Não
 * Construção — e **não** mostrá-la para Depósito, que não vende. Sem o vínculo,
 * a categoria apareceria para todo mundo com um traço no lugar do número, que
 * se lê como dado faltando em vez de "a pergunta não se aplica".
 *
 * O critério é uma LISTA EXPLÍCITA das gerências que vendem, e não mais "o
 * nome contém Vendas". Aquilo funcionava enquanto as gerências do seed vinham
 * dos agrupamentos do handoff, chamadas `Vendas Construção`; agora elas se
 * chamam como a carga real as chama (`CONSTRUÇÃO`), e a palavra sumiu.
 *
 * Uma heurística que deixa de casar aqui não dá erro: ela apaga a seção Vendas
 * da tela do N3 e deixa um traço no lugar do número, que se lê como dado
 * faltando. Lista explícita erra alto, e não baixo.
 *
 * Continua sendo dado de seed, não regra de negócio — quando o vínculo real
 * for cadastrado (`gerencia_variavel`, §7.18), ele manda.
 */
async function vincularGerencias(prisma: PrismaClient): Promise<number> {
  const deVenda = await prisma.dimGerencia.findMany({
    where: { nome: { in: ['CONSTRUÇÃO', 'NÃO CONSTRUÇÃO'] } },
    select: { id: true },
  })
  const variaveis = await prisma.variavelControle.findMany({
    where: { nome: { in: VARIAVEIS_GD.map((v) => v.nome) }, indicador: { codigo: 'vendas' } },
    select: { id: true },
  })

  const dados = deVenda.flatMap((g) =>
    variaveis.map((v) => ({ gerenciaId: g.id, variavelControleId: v.id })),
  )
  if (!dados.length) return 0

  const { count } = await prisma.gerenciaVariavel.createMany({ data: dados, skipDuplicates: true })
  return count
}

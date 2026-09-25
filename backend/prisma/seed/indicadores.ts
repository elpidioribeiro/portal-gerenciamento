import type { PrismaClient } from '@prisma/client'
import { FILIAIS, META_GLOBAL, META_VENDAS } from './dados-handoff.js'

/**
 * Catálogo de indicadores, variáveis de controle e pontos de causa.
 *
 * As variáveis e causas vêm do handoff. O negócio ainda não definiu as
 * definitivas — quando definir, este catálogo é substituído. Ele existe agora
 * porque sem ele a tela de drill-down e o Pareto não têm o que desenhar, e são
 * metade do escopo da v1.
 *
 * `escalaY` e `regraStatus` são literais do handoff (seções "Escalas do eixo Y"
 * e "Dados da matriz").
 */

const INDICADORES = [
  {
    codigo: 'vendas',
    nome: 'Vendas',
    unidade: 'R$',
    sentido: 'MAIOR_MELHOR',
    // Vendas plota DESVIO, não reais. E a escala não é linear: 5 pontos acima
    // da meta ocupam 40px, mas 10 pontos abaixo ocupam os mesmos 40px — o
    // handoff dá mais resolução ao lado positivo. Por isso cada âncora carrega
    // `valor` numérico: a conversão valor→y interpola entre âncoras vizinhas,
    // e uma régua linear achataria metade do gráfico.
    escalaY: [
      { valor: 10, rotulo: '+10%', y: 20 },
      { valor: 5, rotulo: '+5%', y: 60 },
      { valor: 0, rotulo: '0% · meta', y: 100, meta: true },
      { valor: -10, rotulo: '−10%', y: 140 },
      { valor: -20, rotulo: '−20%', y: 180 },
    ],
    regraStatus: { critico: -10, risco: 0 },
    variaveis: [
      {
        nome: 'Ticket médio',
        unidade: 'R$',
        sentido: 'MAIOR_MELHOR',
        valor: 148,
        meta: 155,
        causas: [
          ['Queda em categorias de alto valor', 46],
          ['Menos itens de acabamento no carrinho', 31],
          ['Desconto médio acima do padrão', 17],
        ],
      },
      {
        nome: 'Conversão de loja',
        unidade: '%',
        sentido: 'MAIOR_MELHOR',
        valor: 31,
        meta: 35,
        causas: [
          ['Ruptura de gôndola em promoção', 44],
          ['Falta de vendedor no salão', 33],
          ['Fila no orçamento de projetos', 15],
        ],
      },
      {
        nome: 'Itens por cupom',
        unidade: 'un',
        sentido: 'MAIOR_MELHOR',
        valor: 4.2,
        meta: 4.0,
        causas: [
          ['Combos de obra sem exposição', 38],
          ['Cross-sell não aplicado no caixa', 29],
          ['Sortimento de complementos', 18],
        ],
      },
    ],
  },
  {
    codigo: 'nps',
    nome: 'NPS',
    unidade: 'pontos',
    sentido: 'MAIOR_MELHOR',
    // Meta 75, nao 80: o handoff dizia 80 e a medida oficial [Meta NPS] do
    // dataset devolve 75. O card de META ja lia do banco e mostrava 75 certo,
    // enquanto o eixo e a legenda do grafico — que saem daqui — diziam 80. Duas
    // telas discordando sobre a mesma meta.
    //
    // Ancoras calibradas no dado real: 126 pares filial-mes ficam entre 52,7 e
    // 85,0. Extremos semanais chegam a -7,7 e 100, mas sao das primeiras semanas
    // de julho/2025, quando havia pouca resposta — esticar o eixo por eles
    // achataria a variacao normal.
    escalaY: [
      { valor: 90, rotulo: '90 pts', y: 20 },
      { valor: 75, rotulo: '75 · meta', y: 73, meta: true },
      { valor: 60, rotulo: '60 pts', y: 134 },
      { valor: 45, rotulo: '45 pts', y: 180 },
    ],
    regraStatus: { critico: -10, risco: 0 },
    variaveis: [
      {
        nome: 'Tempo de fila',
        unidade: 'min',
        sentido: 'MENOR_MELHOR',
        valor: 6.4,
        meta: 4.0,
        causas: [
          ['Intervalos concentrados entre 17h e 19h', 44],
          ['Caixas de apoio não abertos', 27],
          ['Demora no autosserviço', 16],
        ],
      },
      {
        nome: 'Atendimento',
        unidade: 'pontos',
        sentido: 'MAIOR_MELHOR',
        valor: 82,
        meta: 80,
        causas: [
          ['Equipe nova sem treinamento completo', 41],
          ['Cobertura do salão aos sábados', 30],
          ['Tempo de resposta no pós-venda', 19],
        ],
      },
      {
        nome: 'Disponibilidade',
        unidade: 'pontos',
        sentido: 'MAIOR_MELHOR',
        valor: 76,
        meta: 85,
        causas: [
          ['Ruptura em itens de giro alto', 48],
          ['Atraso na reposição noturna', 26],
          ['Divergência de estoque no sistema', 14],
        ],
      },
    ],
  },
  {
    codigo: 'perdas',
    nome: 'Perdas % Mov',
    unidade: '% do movimento',
    // MAIOR_MELHOR apesar de "perder menos e' melhor": o valor e' NEGATIVO na
    // convencao da origem, entao -0,2% e' maior E melhor que -5,0%. Marcar
    // MENOR_MELHOR aqui pintaria de verde justamente a filial que perde mais.
    sentido: 'MAIOR_MELHOR',
    // Calibrado no dado REAL, nao no handoff. As ancoras de 3 a 6% do mockup
    // deixavam todos os pontos encostados no topo, porque a magnitude real e'
    // ~20x menor.
    //
    // Medido sobre 117 pares filial-mes: o pior mes da' -1,196% e o melhor
    // +0,127%. Mes positivo acontece e nao e' anomalia: o valor da origem vem
    // com sinal, e nada garante que o mes feche negativo.
    // O eixo vai de +0,25% a -1,25% para que os DOIS extremos caibam — um piso
    // em -0,80%, como eu tinha posto antes, prendia dezembro de NOR (-0,95%) na
    // borda e escondia justamente o pior mes do ano.
    //
    // Nao e' linear de proposito: a faixa perto da meta ganha mais pixel por
    // ponto que a cauda ruim, porque e' onde as filiais de fato se distinguem.
    //
    // O eixo sobe: perder menos fica mais alto, que e' a leitura natural.
    //
    // A ancora de meta e' -0,25%, a meta de 2025 e a mediana das de 2026. A meta
    // e' por FILIAL, entao a linha tracejada do grafico e' referencia visual do
    // patamar — a comparacao que vale e' a da celula, que usa a meta da propria
    // filial. Ancorar em -0,15 (a mais apertada) ou -0,35 (a mais folgada) faria
    // o tracejado mentir para sete das nove.
    escalaY: [
      { valor: 0.25, rotulo: '+0,25%', y: 20 },
      { valor: 0, rotulo: '0%', y: 56 },
      { valor: -0.25, rotulo: '−0,25% · meta', y: 92, meta: true },
      { valor: -0.75, rotulo: '−0,75%', y: 141 },
      { valor: -1.25, rotulo: '−1,25%', y: 180 },
    ],
    regraStatus: { critico: 20, risco: 0 },
    variaveis: [
      {
        nome: 'Quebra hortifrúti',
        unidade: '%',
        sentido: 'MENOR_MELHOR',
        valor: 2.4,
        meta: 1.2,
        causas: [
          ['Ruptura de frio na recepção', 41],
          ['Giro lento em promoção', 28],
          ['Erro de conferência', 19],
        ],
      },
      {
        nome: 'Avaria em estoque',
        unidade: '%',
        sentido: 'MENOR_MELHOR',
        valor: 1.9,
        meta: 1.5,
        causas: [
          ['Empilhamento acima do padrão', 39],
          ['Movimentação sem paleteira', 31],
          ['Embalagem inadequada do fornecedor', 17],
        ],
      },
      {
        nome: 'Furto identificado',
        unidade: '%',
        sentido: 'MENOR_MELHOR',
        valor: 1.5,
        meta: 1.5,
        causas: [
          ['Itens pequenos de alto valor expostos', 43],
          ['Cobertura de câmeras no corredor 7', 28],
          ['Conferência de saída', 16],
        ],
      },
    ],
  },
  {
    codigo: 'custo',
    nome: 'Custo',
    unidade: '% da receita',
    sentido: 'MENOR_MELHOR',
    escalaY: [
      { valor: 19.0, rotulo: '19,0%', y: 20 },
      { valor: 18.0, rotulo: '18,0%', y: 73 },
      { valor: 17.0, rotulo: '17,0% · meta', y: 127, meta: true },
      { valor: 16.0, rotulo: '16,0%', y: 180 },
    ],
    regraStatus: { critico: 20, risco: 0 },
    variaveis: [
      {
        nome: 'Horas extras',
        unidade: '%',
        sentido: 'MENOR_MELHOR',
        valor: 12,
        meta: 0,
        causas: [
          ['Retrabalho na conferência de transferências', 46],
          ['Janela de recebimento concentrada', 25],
          ['Absenteísmo no turno da tarde', 15],
        ],
      },
      {
        nome: 'Custo logístico',
        unidade: '%',
        sentido: 'MENOR_MELHOR',
        valor: 4.1,
        meta: 4.5,
        causas: [
          ['Frete de transferência entre filiais', 37],
          ['Ocupação baixa do veículo', 29],
          ['Rota de entrega sem otimização', 18],
        ],
      },
      {
        nome: 'Energia',
        unidade: '%',
        sentido: 'MENOR_MELHOR',
        valor: 2.8,
        meta: 3.0,
        causas: [
          ['Climatização fora do horário', 40],
          ['Iluminação do estacionamento', 27],
          ['Manutenção preventiva atrasada', 16],
        ],
      },
    ],
  },
] as const

export interface CatalogoSemeado {
  /** codigo do indicador → id */
  indicadores: Map<string, string>
  /** "indicador|variável" → id */
  variaveis: Map<string, string>
  /** "indicador|variável|causa" → id */
  causas: Map<string, string>
  /** "indicador|variável" → peso das causas, para gerar as ocorrências do Pareto */
  pesos: Map<string, Array<{ causaId: string; peso: number }>>
}

export async function semearCatalogo(
  prisma: PrismaClient,
  filiais: Map<string, string>,
  anos: number[],
): Promise<CatalogoSemeado> {
  const indicadores = new Map<string, string>()
  const variaveis = new Map<string, string>()
  const causas = new Map<string, string>()
  const pesos = new Map<string, Array<{ causaId: string; peso: number }>>()

  for (const [i, ind] of INDICADORES.entries()) {
    const rInd = await prisma.indicador.upsert({
      where: { codigo: ind.codigo },
      update: {
        nome: ind.nome,
        unidade: ind.unidade,
        sentido: ind.sentido,
        escalaY: ind.escalaY,
        regraStatus: ind.regraStatus,
        ordem: i + 1,
      },
      create: {
        codigo: ind.codigo,
        nome: ind.nome,
        unidade: ind.unidade,
        sentido: ind.sentido,
        escalaY: ind.escalaY,
        regraStatus: ind.regraStatus,
        ordem: i + 1,
      },
    })
    indicadores.set(ind.codigo, rInd.id)

    for (const [j, v] of ind.variaveis.entries()) {
      /*
       * INATIVAS, desde 31/08/2026 (§7.43).
       *
       * Estas variáveis são do handoff -- Ticket médio, Conversão de loja,
       * Itens por cupom e as nove dos outros indicadores. Elas não têm fato,
       * não têm ação, e nenhuma gerência as acompanha; ativas, apareciam como
       * chip clicável no drill-down do N2, ao lado das duas reais.
       *
       * As REAIS são as de `variaveis-gd.ts`, que nascem ativas e são
       * vinculadas às gerências logo em seguida.
       *
       * `ativo: false` e não `DELETE`: 2.592 metas de escopo VARIAVEL apontam
       * para elas, e o campo existe justamente para isto ("tira de vista sem
       * apagar").
       */
      const rVar = await prisma.variavelControle.upsert({
        where: { indicadorId_nome: { indicadorId: rInd.id, nome: v.nome } },
        update: { unidade: v.unidade, sentido: v.sentido, ordem: j + 1, ativo: false },
        create: {
          indicadorId: rInd.id,
          nome: v.nome,
          unidade: v.unidade,
          sentido: v.sentido,
          ordem: j + 1,
          ativo: false,
        },
      })
      const chaveVar = `${ind.codigo}|${v.nome}`
      variaveis.set(chaveVar, rVar.id)

      const listaPesos: Array<{ causaId: string; peso: number }> = []
      for (const [k, [nomeCausa, peso]] of v.causas.entries()) {
        /*
         * INATIVAS, desde 31/08/2026.
         *
         * Estas 36 causas são do handoff -- sintéticas, para as telas da v1
         * terem Pareto. As REAIS são as 15 que o analista passou, em
         * `variaveis-gd.ts`, e elas pendem só de Performance Vendedor e
         * Performance Vendas. Ativas, as duas listas se misturavam num seletor
         * de 51 itens, e quem abre uma ação escolhia entre a causa da reunião
         * dele e "Ocupação baixa do veículo".
         *
         * `ativo: false` e não `DELETE` porque é a convenção do schema para
         * aposentar ponto de causa: some da tela, o histórico fica. E porque a
         * ocorrência semeada (`pareto.ts`) pendura nelas -- apagar a causa
         * levaria junto o Pareto das telas da v1.
         */
        const rCausa = await prisma.pontoCausa.upsert({
          where: { variavelControleId_nome: { variavelControleId: rVar.id, nome: nomeCausa } },
          update: { ordem: k + 1, ativo: false },
          create: { variavelControleId: rVar.id, nome: nomeCausa, ordem: k + 1, ativo: false },
        })
        causas.set(`${chaveVar}|${nomeCausa}`, rCausa.id)
        listaPesos.push({ causaId: rCausa.id, peso })
      }
      pesos.set(chaveVar, listaPesos)

      // Meta da variável — a mesma em todas as filiais (o handoff só dá uma).
      for (const sigla of FILIAIS.map((f) => f.sigla)) {
        const filialId = filiais.get(sigla)!
        for (const ano of anos) {
          for (let mes = 1; mes <= 12; mes++) {
            await prisma.meta.upsert({
              where: {
                escopo_alvoId_filialId_ano_mes: {
                  escopo: 'VARIAVEL',
                  alvoId: rVar.id,
                  filialId,
                  ano,
                  mes,
                },
              },
              update: { valor: v.meta },
              create: {
                escopo: 'VARIAVEL',
                alvoId: rVar.id,
                filialId,
                ano,
                mes,
                valor: v.meta,
              },
            })
          }
        }
      }
    }
  }

  // Metas dos indicadores. Só Vendas tem meta por filial — para NPS, Perdas e
  // Custo uma única meta reproduz exatamente os nove desvios do handoff.
  for (const f of FILIAIS) {
    const filialId = filiais.get(f.sigla)!
    const metasPorIndicador: Record<string, number> = {
      vendas: META_VENDAS[f.sigla],
      nps: META_GLOBAL.nps,
      perdas: META_GLOBAL.perdas,
      custo: META_GLOBAL.custo,
    }

    for (const [codigo, valor] of Object.entries(metasPorIndicador)) {
      const alvoId = indicadores.get(codigo)!
      for (const ano of anos) {
        for (let mes = 1; mes <= 12; mes++) {
          await prisma.meta.upsert({
            where: {
              escopo_alvoId_filialId_ano_mes: {
                escopo: 'INDICADOR',
                alvoId,
                filialId,
                ano,
                mes,
              },
            },
            update: { valor },
            create: { escopo: 'INDICADOR', alvoId, filialId, ano, mes, valor },
          })
        }
      }
    }
  }

  return { indicadores, variaveis, causas, pesos }
}

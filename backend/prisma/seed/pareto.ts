import type { PrismaClient } from '@prisma/client'
import { FILIAIS } from './dados-handoff.js'
import type { CatalogoSemeado } from './indicadores.js'

/**
 * Marcações de ponto de causa — a origem do Pareto.
 *
 * O handoff mostra o Pareto como percentuais fixos (46 / 31 / 17). Aqui o
 * Pareto é `SUM(quantidade) GROUP BY ponto_causa`: a quantidade de cada
 * marcação é o peso do handoff, então o percentual reproduz o desenho e ainda
 * assim é dado de verdade — a tela de marcação do N4 só vai somar aqui, sem
 * nada mudar no cálculo.
 *
 * A marcação é por (ponto de causa, GERÊNCIA, ano, mês, semana) desde
 * 31/08/2026 (§7.29). As ÁREAS continuam sendo criadas aqui — os indicadores
 * são por área —, e como elas só existem depois da carga `vendas-linha`, que
 * nunca rodou, este seed cria as suas a partir da lista explícita abaixo.
 *
 * **Explícita, e não derivada dos agrupamentos N4.** Ela era, até 29/08/2026:
 * o handoff trazia o agrupamento com a gerência no `grupo` e a área no `nome`,
 * e o seed lia os dois de lá. Quando o agrupamento do N4 virou a gerência
 * (§7.28) essa leitura passou a devolver nada, e o seed quebrou -- que é o
 * comportamento certo de um acoplamento errado. São coisas diferentes: o
 * agrupamento é COLUNA DE QUADRO, cadastro do portal; a área de venda é
 * ESTRUTURA COMERCIAL, e vem da carga.
 *
 * **São sintéticas, e a carga as substitui sem conflito**: `dimensao_area_venda`
 * tem unicidade em (filial, nome), então a primeira carga real reaproveita a
 * mesma linha e apenas reafirma a gerência.
 *
 * Estas linhas NÃO são expurgadas: são registro histórico de ocorrência de
 * problema, e apagá-las deixaria contramedidas apontando para causa sem lastro.
 */
/**
 * A estrutura comercial sintética: gerência → área de venda.
 *
 * OS NOMES DE GERÊNCIA SÃO OS QUE A CARGA REAL PRODUZ -- `CONSTRUÇÃO`, `NÃO
 * CONSTRUÇÃO`, em caixa alta, como vêm de `vendas-linha`. Não é estética: o
 * agrupamento do N4 casa com a gerência pelo NOME (§7.28), e um seed que
 * chamasse a mesma gerência de "Vendas Construção" faria a tela do N3 achar
 * zero ação num banco semeado e todas num banco carregado. Duas consultas que
 * descrevem a mesma coisa têm de concordar sobre o que ela é.
 *
 * `OPERACIONAL` não vem de carga nenhuma -- a de vendas só conhece quem vende.
 * Ele está aqui porque é um quadro de GD que existe na reunião, e as "áreas"
 * dele são etapas, não seções de loja.
 */
const ESTRUTURA = [
  { gerencia: 'CONSTRUÇÃO', nome: 'Pisos e Revestimentos' },
  { gerencia: 'CONSTRUÇÃO', nome: 'Metais e Acessórios' },
  { gerencia: 'CONSTRUÇÃO', nome: 'Tintas e Químicos' },
  { gerencia: 'NÃO CONSTRUÇÃO', nome: 'Eletro' },
  { gerencia: 'NÃO CONSTRUÇÃO', nome: 'Móveis' },
  { gerencia: 'NÃO CONSTRUÇÃO', nome: 'Utilidades Domésticas' },
  { gerencia: 'OPERACIONAL', nome: 'Recebimento' },
  { gerencia: 'OPERACIONAL', nome: 'Expedição' },
  { gerencia: 'OPERACIONAL', nome: 'Entrega' },
] as const

export async function semearPareto(
  prisma: PrismaClient,
  filiais: Map<string, string>,
  pessoas: Map<string, string>,
  catalogo: CatalogoSemeado,
  hoje: Date,
) {
  const registrador = pessoas.get('João Nunes') ?? pessoas.values().next().value!

  /*
   * As GERÊNCIAS de cada filial — é contra elas que a marcação é gravada desde
   * 31/08/2026 (§7.29). As áreas continuam sendo criadas logo abaixo porque os
   * INDICADORES são por área; o que deixou de ser por área é a contagem.
   */
  const gerenciasPorFilial = new Map<string, string[]>()

  for (const f of FILIAIS) {
    const filialId = filiais.get(f.sigla)!
    const idsGerencia = new Set<string>()

    for (const ag of ESTRUTURA) {
      const gerencia = await prisma.dimGerencia.upsert({
        where: { filialId_nome: { filialId, nome: ag.gerencia } },
        update: {},
        create: { filialId, nome: ag.gerencia },
      })
      /*
       * `cd_area` é a identidade da área desde 27/08 (PLANO §7.14), e o seed
       * não tem código de verdade para dar — os de verdade vêm do
       * `ERP_AREA_VENDA`, na carga de `vendas-linha`.
       *
       * O prefixo `SEED:` é deliberado, e não decoração: um código inventado
       * que PARECESSE real seria indistinguível no banco, e a primeira carga de
       * verdade criaria a área ao lado da falsa, com o mesmo nome na tela.
       * Assim a origem de cada linha é legível num `SELECT`.
       */
      await prisma.dimAreaVenda.upsert({
        where: { filialId_cdArea: { filialId, cdArea: `SEED:${ag.nome}` } },
        update: { gerenciaId: gerencia.id, nome: ag.nome },
        create: { filialId, cdArea: `SEED:${ag.nome}`, nome: ag.nome, gerenciaId: gerencia.id },
      })
      idsGerencia.add(gerencia.id)
    }
    gerenciasPorFilial.set(f.sigla, [...idsGerencia])
  }

  /*
   * Espalha pelos três meses anteriores e pelas 4 primeiras semanas, para o
   * filtro por período do drill-down ter o que filtrar e a coluna "Ciclo" da
   * grade mostrar variação entre semanas.
   */
  const MESES_ATRAS = 3
  const linhas: Array<{
    pontoCausaId: string
    escopo: 'GERENCIA'
    alvoId: string
    ano: number
    mes: number
    semana: number
    quantidade: number
    registradoPorId: string
    registradoEm: Date
  }> = []

  for (const [iFilial, f] of FILIAIS.entries()) {
    const gerencias = gerenciasPorFilial.get(f.sigla)!

    for (const [chaveVar, pesos] of catalogo.pesos) {
      for (const [iCausa, { causaId, peso }] of pesos.entries()) {
        /*
         * Uma gerência por causa, rodando a lista. Espalhar a mesma causa por
         * todas encheria a grade de forma uniforme, e o Pareto ficaria plano —
         * o que não é dado, é ruído com aparência de dado.
         */
        const gerenciaId = gerencias[(iCausa + iFilial) % gerencias.length]!

        for (let k = 0; k < MESES_ATRAS; k++) {
          const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - k, 1))
          const ano = d.getUTCFullYear()
          const mes = d.getUTCMonth() + 1

          for (let semana = 1; semana <= 4; semana++) {
            // O peso do handoff distribuído pelas semanas, sem cair a zero —
            // quantidade zero não é marcação, é ausência dela, e a constraint
            // do banco recusa.
            const quantidade = Math.max(1, Math.round(peso / 4) - ((semana + k) % 2))

            linhas.push({
              pontoCausaId: causaId,
              /*
               * Contra a GERÊNCIA: o N4 conta as causas uma vez para a reunião
               * dele. Ver PLANO §7.29.
               */
              escopo: 'GERENCIA',
              alvoId: gerenciaId,
              ano,
              mes,
              semana,
              quantidade,
              registradoPorId: registrador,
              // Marcado na própria semana, não retroativamente — o dado
              // sintético não deve parecer correção feita depois.
              registradoEm: new Date(Date.UTC(ano, mes - 1, semana * 7, 9, chaveVar.length % 60)),
            })
          }
        }
      }
    }
  }

  const LOTE = 2_000
  for (let i = 0; i < linhas.length; i += LOTE) {
    await prisma.ocorrenciaPontoCausa.createMany({
      data: linhas.slice(i, i + LOTE),
      skipDuplicates: true,
    })
  }

  const total = await prisma.ocorrenciaPontoCausa.aggregate({ _sum: { quantidade: true } })
  console.log(
    `  ocorrencia_ponto_causa: ${linhas.length.toLocaleString('pt-BR')} marcações, ` +
      `${(total._sum.quantidade ?? 0).toLocaleString('pt-BR')} ocorrências`,
  )
}

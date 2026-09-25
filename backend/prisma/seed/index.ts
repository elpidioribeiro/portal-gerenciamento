import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'
import { verificarMetas } from './dados-handoff.js'
import { semearDominio } from './dominio.js'
import { semearCatalogo } from './indicadores.js'
import { semearFatos } from './fatos.js'
import { semearPareto } from './pareto.js'
import { semearPerfis } from './perfis.js'
import { semearVariaveisGd } from './variaveis-gd.js'

const prisma = new PrismaClient()

/** Início do histórico. Ver PLANO.md 5.2.2. */
const INICIO_HISTORICO = new Date(Date.UTC(2025, 0, 1))

/**
 * O seed apaga TODAS as tabelas fato antes de popular. Num banco que já recebeu
 * carga do Power BI, isso destrói dado real — hoje 5.331 linhas de Vendas e
 * 3.655 de NPS, que custaram um backfill de vários blocos para entrar, e que
 * nenhum comando reconstrói sozinho.
 *
 * Então: se houver sinal de ingestão real, o seed se recusa a rodar.
 *
 * O sinal é `sync_execucao` com origem diferente de `'seed'`. Os testes também
 * geram execuções assim (gravam de 127.0.0.1), e por isso existe o escape
 * `SEED_FORCAR` — usado pelo `tests/setup/global.ts`, onde apagar é justamente
 * o que se quer. Quem digita `npm run db:seed` na mão não tem o escape, e é
 * exatamente essa a pessoa que precisa ser barrada.
 */
async function recusarSeHouverDadoReal() {
  if (process.env.SEED_FORCAR === '1') return

  const reais = await prisma.syncExecucao.count({ where: { origemIp: { not: 'seed' } } })
  if (reais === 0) return

  const [vendas, nps] = await Promise.all([prisma.fatoVendas.count(), prisma.fatoNps.count()])

  throw new Error(
    [
      'Este banco tem dado REAL — o seed apagaria tudo.',
      '',
      `  ${reais} carga(s) de ingestão registradas`,
      `  ${vendas} linhas de vendas · ${nps} linhas de nps`,
      '',
      'O seed limpa todas as tabelas fato antes de popular, e o dado do Power BI',
      'não volta sozinho: precisaria de `npm run recarregar` bloco por bloco.',
      '',
      'Se é realmente isso que você quer, rode com SEED_FORCAR=1.',
    ].join('\n'),
  )
}

async function main() {
  // Antes de qualquer coisa: este banco pode ter dado real, e o seed apaga tudo.
  await recusarSeHouverDadoReal()

  // Falha cedo e legível se os números do handoff e as metas não fecharem.
  verificarMetas()
  console.log('Metas conferem com as 36 células da matriz do handoff.\n')

  const hoje = new Date()
  // `getUTCFullYear`, não `getFullYear`: INICIO_HISTORICO é construído com
  // Date.UTC, e ler com o método de hora local faz 01/01/2025 00:00 UTC virar
  // 31/12/2024 em UTC−3 — o seed criaria metas para 2024 inteiro.
  const anos: number[] = []
  for (let a = INICIO_HISTORICO.getUTCFullYear(); a <= hoje.getFullYear(); a++) anos.push(a)

  console.log('Limpando dados anteriores...')
  await limpar()

  const senhaHash = await argon2.hash(process.env.SEED_SENHA_PADRAO ?? 'portalgd', {
    type: argon2.argon2id,
  })

  console.log('Perfis corporativos (id_perfil → nível)...')
  await semearPerfis(prisma)

  console.log('Domínio (filiais, buckets, pessoas)...')
  const { filiais, buckets, pessoas } = await semearDominio(prisma, senhaHash)
  console.log(`  ${filiais.size} filiais · ${buckets.size} buckets · ${pessoas.size} pessoas`)

  console.log('Catálogo (indicadores, variáveis, causas, metas)...')
  const catalogo = await semearCatalogo(prisma, filiais, anos)
  console.log(
    `  ${catalogo.indicadores.size} indicadores · ${catalogo.variaveis.size} variáveis · ${catalogo.causas.size} causas`,
  )

  const marcos = pessoas.get('Marcos Leite')
  if (!marcos) throw new Error('Usuário Marcos Leite não foi criado')

  console.log(`Fatos diários (${INICIO_HISTORICO.toISOString().slice(0, 10)} → hoje)...`)
  await semearFatos({ prisma, filiais, usuarioId: marcos, hoje, inicio: INICIO_HISTORICO })

  console.log('Ocorrências de ponto de causa (Pareto)...')
  await semearPareto(prisma, filiais, pessoas, catalogo, hoje)

  /*
   * Depois do Pareto sintético, e de propósito: as reais não entram na geração
   * de ocorrência. Quem marca ponto de causa nelas é o N4, na reunião.
   */
  await semearVariaveisGd(prisma)

  console.log('\nSeed concluído.')
}

/**
 * Ordem inversa das dependências. Não uso TRUNCATE CASCADE porque ele
 * silenciosamente esvaziaria tabelas que eu não pretendia tocar.
 */
async function limpar() {
  await prisma.comentario.deleteMany()
  await prisma.movimentacao.deleteMany()
  await prisma.contramedida.deleteMany()
  /*
   * O resumo mensal sai ANTES do detalhe e do indicador: ele referencia filial,
   * indicador, área e gerência. Esquecê-lo aqui derruba a preparação do banco de
   * teste na FK do indicador -- que foi como este `deleteMany` nasceu.
   */
  await prisma.vendaAreaMes.deleteMany()
  await prisma.vendedorAreaMes.deleteMany()
  await prisma.fatoVendasLinha.deleteMany()
  await prisma.fatoVendas.deleteMany()
  await prisma.fatoNps.deleteMany()
  await prisma.fatoPerdas.deleteMany()
  await prisma.fatoMovimentacao.deleteMany()
  await prisma.fatoCusto.deleteMany()
  await prisma.syncExecucao.deleteMany()
  await prisma.meta.deleteMany()
  /*
   * A ocorrência sai ANTES do ponto de causa e da área de venda: ela referencia
   * os dois. A ordem aqui é a ordem das dependências, não a de leitura.
   */
  await prisma.gerenciaVariavel.deleteMany()
  await prisma.ocorrenciaPontoCausa.deleteMany()
  await prisma.pontoCausa.deleteMany()
  await prisma.variavelControle.deleteMany()
  await prisma.indicador.deleteMany()
  await prisma.dimLinha.deleteMany()
  await prisma.dimAreaVenda.deleteMany()
  await prisma.dimGerencia.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.usuario.deleteMany()
  await prisma.bucket.deleteMany()
  await prisma.filial.deleteMany()
  await prisma.perfilNivel.deleteMany()
}

main()
  .catch((e) => {
    console.error('\nSeed falhou:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

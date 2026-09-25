import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import {
  gravarAreaSupervisor,
  gravarDiasUteis,
  gravarVendedorArea,
  gravarVendedorSituacao,
} from './gravar-cadastro.js'
import {
  gravarMovimentacao,
  gravarNps,
  gravarVendas,
  gravarPerdas,
  gravarVendasLinha,
  gravarVendedorDia,
} from './gravar.js'
import {
  areaSupervisorSchema,
  diasUteisSchema,
  metasSchema,
  movimentacaoSchema,
  npsSchema,
  perdasSchema,
  respostaIngestaoSchema,
  vendasLinhaSchema,
  vendasSchema,
  vendedorAreaSchema,
  vendedorDiaSchema,
  vendedorSituacaoSchema,
} from './schemas.js'
import { gravarMetas } from './gravar-metas.js'
import { exigirTokenDeIngestao } from './token.guard.js'

/**
 * Ingestão n8n → portal. Ver `docs/n8n/README.md` para o contrato.
 *
 * Estas rotas ficam fora do fluxo de sessão de usuário: autenticam por
 * `X-Ingest-Token`, não por cookie.
 */


const erroSchema = z.object({
  erro: z.string(),
  codigo: z.string(),
  requestId: z.string().optional(),
})

export async function ingestaoRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  const opcoesComuns = {
    config: {
      // Limite próprio: o payload de ingestão é bem maior que o do resto da API.
      rateLimit: { max: 60, timeWindow: '1 minute' },
    },
    // 20 MB acomoda 2 anos de Perdas com folga.
    bodyLimit: 20 * 1_048_576,
  }


  // ── Vendas ─────────────────────────────────────────────────────────────────
  r.post(
    '/api/v1/ingest/vendas',
    {
      ...opcoesComuns,
      schema: {
        tags: ['Ingestão'],
        summary: 'Vendas por filial e dia (valor real, tendência e delta da meta)',
        body: vendasSchema,
        response: { 200: respostaIngestaoSchema, 401: erroSchema, 422: erroSchema },
      },
    },
    async (req) => {
      exigirTokenDeIngestao(req)
      const { periodo, linhas } = req.body
      const { avisos, ...resultado } = await gravarVendas(app.prisma, { periodo, linhas, origem: req.ip })

      return { fonte: 'vendas', ...resultado, avisos }
    },
  )

  // ── Vendas por linha ───────────────────────────────────────────────────────
  r.post(
    '/api/v1/ingest/vendas-linha',
    {
      ...opcoesComuns,
      schema: {
        tags: ['Ingestão'],
        summary: 'Detalhe de vendas por linha (60 dias) — valida a soma contra o agregado',
        body: vendasLinhaSchema,
        response: { 200: respostaIngestaoSchema, 401: erroSchema, 422: erroSchema },
      },
    },
    async (req) => {
      exigirTokenDeIngestao(req)
      const { periodo, linhas } = req.body
      const resultado = await gravarVendasLinha(app.prisma, { periodo, linhas, origem: req.ip })

      return { fonte: 'vendas-linha', ...resultado }
    },
  )

  // ── NPS ────────────────────────────────────────────────────────────────────
  r.post(
    '/api/v1/ingest/nps',
    {
      ...opcoesComuns,
      schema: {
        tags: ['Ingestão'],
        summary: 'Respostas de NPS por filial e dia',
        body: npsSchema,
        response: { 200: respostaIngestaoSchema, 401: erroSchema, 422: erroSchema },
      },
    },
    async (req) => {
      exigirTokenDeIngestao(req)
      const { periodo, linhas } = req.body
      const resultado = await gravarNps(app.prisma, { periodo, linhas, origem: req.ip })

      return { fonte: 'nps', ...resultado }
    },
  )

  // ── Perdas ─────────────────────────────────────────────────────────────────
  r.post(
    '/api/v1/ingest/perdas',
    {
      ...opcoesComuns,
      schema: {
        tags: ['Ingestão'],
        summary: 'Quebras por filial, dia, tipo e status (janela de 2 anos)',
        body: perdasSchema,
        response: { 200: respostaIngestaoSchema, 401: erroSchema, 422: erroSchema },
      },
    },
    async (req) => {
      exigirTokenDeIngestao(req)
      const { periodo, linhas } = req.body

      // A escrita vive em `gravar.ts`: esta rota e o agendamento interno do
      // portal gravam Perdas, e duas cópias divergiriam sem erro nenhum.
      const resultado = await gravarPerdas(app.prisma, { periodo, linhas, origem: req.ip })

      return { fonte: 'perdas', ...resultado }
    },
  )

  // ── Movimentação ───────────────────────────────────────────────────────────
  r.post(
    '/api/v1/ingest/movimentacao',
    {
      ...opcoesComuns,
      schema: {
        tags: ['Ingestão'],
        summary: 'Movimentação por filial e dia (denominador de Perdas)',
        body: movimentacaoSchema,
        response: { 200: respostaIngestaoSchema, 401: erroSchema, 422: erroSchema },
      },
    },
    async (req) => {
      exigirTokenDeIngestao(req)
      const { periodo, linhas } = req.body

      // Ver o comentário em /ingest/perdas: a escrita é compartilhada com o
      // agendamento interno.
      const resultado = await gravarMovimentacao(app.prisma, {
        periodo,
        linhas,
        origem: req.ip,
      })

      return { fonte: 'movimentacao', ...resultado }
    },
  )

  // ── Metas ──────────────────────────────────────────────────────────────────
  r.post(
    '/api/v1/ingest/metas',
    {
      ...opcoesComuns,
      schema: {
        tags: ['Ingestão'],
        summary: 'Metas por indicador, filial e competência',
        body: metasSchema,
        response: { 200: respostaIngestaoSchema, 401: erroSchema, 422: erroSchema },
      },
    },
    async (req) => {
      exigirTokenDeIngestao(req)
      const r = await gravarMetas(app.prisma, { linhas: req.body.linhas, origemIp: req.ip })
      return {
        syncId: r.syncId,
        fonte: 'metas',
        recebidas: r.recebidas,
        gravadas: r.gravadas,
        removidas: 0,
        expurgadas: 0,
        avisos: [],
      }
    },
  )

  // ── Performance Vendedor: cadastro do vendedor ─────────────────────────────
  r.post(
    '/api/v1/ingest/vendedor-area',
    {
      ...opcoesComuns,
      schema: {
        tags: ['Ingestão'],
        summary: 'Cadastro do vendedor e a área de venda dele (sem janela)',
        body: vendedorAreaSchema,
        response: { 200: respostaIngestaoSchema, 401: erroSchema, 422: erroSchema },
      },
    },
    async (req) => {
      exigirTokenDeIngestao(req)
      const { linhas } = req.body

      const resultado = await gravarVendedorArea(app.prisma, { linhas, origem: req.ip })

      return { fonte: 'vendedor-area', ...resultado }
    },
  )

  // ── Supervisor da área de venda ────────────────────────────────────────────
  r.post(
    '/api/v1/ingest/area-supervisor',
    {
      ...opcoesComuns,
      schema: {
        tags: ['Ingestão'],
        summary: 'Quem supervisiona cada área de venda (sem janela)',
        body: areaSupervisorSchema,
        response: { 200: respostaIngestaoSchema, 401: erroSchema, 422: erroSchema },
      },
    },
    async (req) => {
      exigirTokenDeIngestao(req)
      const { linhas } = req.body

      const resultado = await gravarAreaSupervisor(app.prisma, { linhas, origem: req.ip })

      return { fonte: 'area-supervisor', ...resultado }
    },
  )

  // ── Performance Vendedor: venda por dia ────────────────────────────────────
  r.post(
    '/api/v1/ingest/vendedor-dia',
    {
      ...opcoesComuns,
      schema: {
        tags: ['Ingestão'],
        summary: 'Venda do vendedor por dia (60 dias) — exige o cadastro carregado antes',
        body: vendedorDiaSchema,
        response: { 200: respostaIngestaoSchema, 401: erroSchema, 422: erroSchema },
      },
    },
    async (req) => {
      exigirTokenDeIngestao(req)
      const { periodo, linhas } = req.body
      const resultado = await gravarVendedorDia(app.prisma, { periodo, linhas, origem: req.ip })

      return { fonte: 'vendedor-dia', ...resultado }
    },
  )

  // ── Performance Vendedor: situação e cota do mês ───────────────────────────
  r.post(
    '/api/v1/ingest/vendedor-situacao',
    {
      ...opcoesComuns,
      schema: {
        tags: ['Ingestão'],
        summary: 'Situação e cota do vendedor por mês — SUBSTITUI as competências do lote',
        body: vendedorSituacaoSchema,
        response: { 200: respostaIngestaoSchema, 401: erroSchema, 422: erroSchema },
      },
    },
    async (req) => {
      exigirTokenDeIngestao(req)
      const { linhas } = req.body

      const resultado = await gravarVendedorSituacao(app.prisma, { linhas, origem: req.ip })

      return { fonte: 'vendedor-situacao', ...resultado }
    },
  )

  // ── Calendário de dias em que a loja abre ──────────────────────────────────
  r.post(
    '/api/v1/ingest/dias-uteis',
    {
      ...opcoesComuns,
      schema: {
        tags: ['Ingestão'],
        summary: 'Calendário por filial — confere o acumulado contra o QTUTIL da origem',
        body: diasUteisSchema,
        response: { 200: respostaIngestaoSchema, 401: erroSchema, 422: erroSchema },
      },
    },
    async (req) => {
      exigirTokenDeIngestao(req)
      const { linhas } = req.body

      const resultado = await gravarDiasUteis(app.prisma, { linhas, origem: req.ip })

      return { fonte: 'dias-uteis', ...resultado }
    },
  )
}

/**
 * Resolve (filial, código da área) → id, CRIANDO o que não existe.
 *
 * Usada por `vendedor-area` e por `metas`. As duas recusavam área desconhecida,
 * e a primeira carga real derrubou o argumento nas duas:
 *
 *  - 27 áreas de CEN têm vendedor no cadastro e não venderam na janela;
 *  - 7 áreas têm orçamento e não têm nem venda nem vendedor.
 *
 * Recusar não protegia nada — fazia o vendedor sumir do indicador de um lado e
 * derrubava 9.603 metas por causa de sete do outro. E a área não é inventada: o
 * código vem da origem e a gerência de `ERP_AREA_VENDA.TIPO_AREA`, o MESMO
 * cadastro que `vendas-linha` lê.
 *
 * O CONSERTO DE VERDADE É OUTRO, e está no PLANO: área de venda deveria ter
 * carga de CADASTRO própria, em vez de nascer como efeito colateral de um fato.
 * Três cargas tropeçaram no mesmo lugar antes de isso ficar claro — e esta
 * função é o remendo que segura enquanto o cadastro não existe.
 */

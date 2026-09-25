import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

/**
 * Frescor dos dados — alimenta o selo "ATUALIZADO" do header.
 *
 * O valor global é o **mais antigo** entre as fontes, não o mais recente.
 * O painel mostra os quatro indicadores lado a lado: se a carga de Perdas
 * falhou ontem, o painel inteiro está desatualizado, ainda que Vendas tenha
 * chegado hoje. Mostrar o mais recente daria uma impressão de frescor que os
 * números não têm — que é exatamente o erro que este selo existe para evitar.
 */

const FONTES = ['vendas', 'vendas-linha', 'nps', 'perdas', 'movimentacao'] as const

const respostaSchema = z.object({
  /** Instante do dado mais antigo entre as fontes. Nulo se nada carregou. */
  atualizadoEm: z.string().datetime().nullable(),
  /** true quando alguma fonte não tem carga bem-sucedida hoje. */
  algumaFonteAtrasada: z.boolean(),
  fontes: z.array(
    z.object({
      fonte: z.string(),
      atualizadoEm: z.string().datetime().nullable(),
      periodoDe: z.string().nullable(),
      periodoAte: z.string().nullable(),
      linhasGravadas: z.number().int().nullable(),
      atrasada: z.boolean(),
    }),
  ),
})

export async function syncRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  r.get(
    '/api/v1/sync/status',
    {
      schema: {
        tags: ['Operação'],
        summary: 'Frescor das cargas de dados',
        response: { 200: respostaSchema },
      },
    },
    async (req) => {
      await app.autenticar(req)

      const inicioDeHoje = new Date()
      inicioDeHoje.setHours(0, 0, 0, 0)

      type LinhaStatus = z.infer<typeof respostaSchema>['fontes'][number]

      const fontes: LinhaStatus[] = await Promise.all(
        FONTES.map(async (fonte): Promise<LinhaStatus> => {
          const ultima = await app.prisma.syncExecucao.findFirst({
            where: { fonte, status: 'SUCESSO' },
            orderBy: { finalizadoEm: 'desc' },
          })

          const quando = ultima?.finalizadoEm ?? null
          return {
            fonte,
            atualizadoEm: quando?.toISOString() ?? null,
            periodoDe: ultima?.periodoDe.toISOString().slice(0, 10) ?? null,
            periodoAte: ultima?.periodoAte.toISOString().slice(0, 10) ?? null,
            linhasGravadas: ultima?.linhasGravadas ?? null,
            atrasada: !quando || quando < inicioDeHoje,
          }
        }),
      )

      // Custo não vem do n8n: é lançamento manual de fechamento. Entra no
      // cálculo do frescor pelo último lançamento, não por sync_execucao.
      const ultimoCusto = await app.prisma.fatoCusto.findFirst({
        orderBy: { atualizadoEm: 'desc' },
        select: { atualizadoEm: true },
      })
      if (ultimoCusto) {
        fontes.push({
          fonte: 'custo (manual)',
          atualizadoEm: ultimoCusto.atualizadoEm.toISOString(),
          periodoDe: null,
          periodoAte: null,
          linhasGravadas: null,
          // Custo fecha uma vez por mês; cobrar carga diária dele seria alarme falso.
          atrasada: false,
        })
      }

      const carregadas = fontes.map((f) => f.atualizadoEm).filter((d): d is string => d !== null)

      return {
        atualizadoEm: carregadas.length > 0 ? carregadas.sort()[0]! : null,
        algumaFonteAtrasada: fontes.some((f) => f.atrasada),
        fontes,
      }
    },
  )
}

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

export async function healthRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  /** Liveness — o processo está de pé. Não toca no banco de propósito. */
  r.get(
    '/health',
    {
      schema: {
        tags: ['Operação'],
        summary: 'Liveness',
        response: { 200: z.object({ status: z.literal('ok'), versao: z.string() }) },
      },
    },
    async () => ({ status: 'ok' as const, versao: '0.1.0' }),
  )

  /*
   * QUAL COMMIT ESTA' NO AR. Publica, sem token de propósito: o objetivo é
   * conferir de fora se o deploy do GitOps já sincronizou (pipeline verde não é
   * código no ar — ver PLANO §7.83), e para isso a rota tem de responder antes
   * de qualquer login.
   *
   * O caminho é `/api/v1/…`, não a raiz como `/health` e `/ready`: o nginx da
   * tela só encaminha `/api` para o backend — o resto cai no SPA. `/health` na
   * raiz basta porque quem o chama é o orquestrador, dentro do pod; este aqui
   * precisa ser alcançável de fora.
   *
   * O valor vem de `APP_VERSION`, gravado na imagem em build-time pelo CI
   * (`--build-arg APP_VERSION=$CI_COMMIT_SHORT_SHA`, ver Dockerfile e o job
   * `imagem` do .gitlab-ci.yml). Build local, sem o arg: "dev" — não inventa um
   * commit que não existe.
   */
  r.get(
    '/api/v1/version',
    {
      schema: {
        tags: ['Operação'],
        summary: 'Commit em execução',
        response: { 200: z.object({ versao: z.string() }) },
      },
    },
    async () => ({ versao: process.env.APP_VERSION ?? 'dev' }),
  )

  /** Readiness — pronto para receber tráfego, o que exige o banco respondendo. */
  r.get(
    '/ready',
    {
      schema: {
        tags: ['Operação'],
        summary: 'Readiness (verifica o Postgres)',
        response: {
          200: z.object({ status: z.literal('ok'), banco: z.literal('ok') }),
          503: z.object({ status: z.literal('indisponivel'), banco: z.literal('erro') }),
        },
      },
    },
    async (_req, reply) => {
      try {
        await app.prisma.$queryRaw`SELECT 1`
        return { status: 'ok' as const, banco: 'ok' as const }
      } catch {
        return reply.status(503).send({ status: 'indisponivel' as const, banco: 'erro' as const })
      }
    },
  )
}

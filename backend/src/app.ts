import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import scalar from '@scalar/fastify-api-reference'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { env } from './config/env.js'
import authPlugin from './plugins/auth.js'
import errosPlugin from './plugins/erros.js'
import prismaPlugin from './plugins/prisma.js'
import { adminRoutes } from './modules/admin/routes.js'
import agendaPlugin from './modules/carga/agenda.js'
import { cargaRoutes } from './modules/carga/routes.js'
import { contramedidaRoutes } from './modules/contramedidas/routes.js'
import { variavelRoutes } from './modules/variaveis/routes.js'
import { authRoutes } from './modules/auth/routes.js'
import { healthRoutes } from './modules/health/routes.js'
import { indicadorRoutes } from './modules/indicadores/routes.js'
import { ingestaoRoutes } from './modules/ingestao/routes.js'
import { painelRoutes } from './modules/painel/routes.js'
import { pontosCausaRoutes } from './modules/pontos-causa/routes.js'
import { syncRoutes } from './modules/sync/routes.js'

/**
 * Monta a aplicação sem escutar em porta — assim os testes de integração usam
 * `app.inject()` sem subir servidor de verdade.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Em teste o log é desligado: uma linha JSON por requisição afoga a saída
    // do vitest e esconde qual asserção falhou.
    logger: env.ehTeste
      ? false
      : {
          level: env.LOG_LEVEL,
          ...(env.NODE_ENV === 'development'
            ? {
                transport: {
                  target: 'pino-pretty',
                  options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
                },
              }
            : {}),
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-ingest-token"]',
            '*.senha',
          ],
        },
    // Payload de ingestão é maior que o do resto da API; a rota de ingestão
    // sobrescreve este limite localmente.
    bodyLimit: 1_048_576,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(errosPlugin)
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true })
  await app.register(cookie)
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' })

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Portal GD — API',
        description:
          'Gerenciamento Diário · Acme Varejo. Os endpoints /ingest são consumidos pelo n8n; ver docs/n8n/.',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${env.PORT}` }],
    },
    transform: jsonSchemaTransform,
  })
  await app.register(scalar, { routePrefix: '/docs' })

  await app.register(prismaPlugin)
  await app.register(authPlugin)

  await app.register(contramedidaRoutes)
  await app.register(variavelRoutes)
  await app.register(healthRoutes)
  await app.register(authRoutes)
  await app.register(syncRoutes)
  await app.register(painelRoutes)
  await app.register(pontosCausaRoutes)
  await app.register(indicadorRoutes)
  await app.register(ingestaoRoutes)
  await app.register(adminRoutes)
  await app.register(cargaRoutes)
  // Depois das rotas: o agendamento usa app.prisma, e decora `agenda`, que as
  // rotas de carga leem em tempo de requisicao.
  await app.register(agendaPlugin)

  return app
}

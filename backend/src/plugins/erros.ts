import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod'
import { ErroApp } from '../lib/erros.js'

/**
 * Handler global. Duas regras:
 *  - stack trace só no log estruturado, nunca na resposta (vaza caminho de
 *    arquivo, versão de dependência e estrutura interna);
 *  - resposta sempre com a mesma forma, incluindo requestId, para o suporte
 *    conseguir cruzar o que o usuário viu com a linha do log.
 */
/**
 * O caminho do campo dentro de `params`, sem confiar na forma declarada.
 *
 * O tipo diz que `params.issue.path` sempre existe, e por isso o encadeamento
 * opcional era sinalizado como desnecessário. Mas a forma vem da biblioteca de
 * validação e muda entre versões — e este código roda DENTRO do tratador de
 * erro, onde uma exceção não tem quem a pegue: a resposta viraria 500 genérico
 * justamente quando o objetivo era explicar qual campo estava inválido.
 *
 * Verificação explícita, então, em vez de `?.` sobre um tipo que afirma não
 * precisar dele.
 */
function caminhoDoIssue(params: unknown): string {
  if (typeof params !== 'object' || params === null) return ''
  const issue: unknown = (params as Record<string, unknown>)['issue']
  if (typeof issue !== 'object' || issue === null) return ''
  const path: unknown = (issue as Record<string, unknown>)['path']
  return Array.isArray(path) ? path.join('.') : ''
}

export default fp(async function errosPlugin(app: FastifyInstance) {
  app.setErrorHandler((erro, req, reply) => {
    const requestId = req.id

    if (hasZodFastifySchemaValidationErrors(erro)) {
      req.log.info({ erro: erro.validation }, 'payload inválido')
      return reply.status(400).send({
        erro: 'Requisição inválida.',
        codigo: 'REQUISICAO_INVALIDA',
        detalhes: erro.validation.map((v) => ({
          campo: v.instancePath || caminhoDoIssue(v.params) || '(raiz)',
          mensagem: v.message,
        })),
        requestId,
      })
    }

    if (erro instanceof ErroApp) {
      req.log.info({ codigo: erro.codigo, status: erro.status }, erro.message)
      return reply.status(erro.status).send({
        erro: erro.message,
        codigo: erro.codigo,
        ...(erro.detalhes ? { detalhes: erro.detalhes } : {}),
        requestId,
      })
    }

    // Erros que o próprio Fastify levanta (rate limit, payload grande, CORS).
    // Depois do type guard acima, o TS estreita `erro` para unknown — daí a
    // checagem explícita em vez de acessar as propriedades direto.
    if (ehErroFastify(erro) && erro.statusCode < 500) {
      return reply.status(erro.statusCode).send({
        erro: erro.message,
        codigo: erro.code ?? 'ERRO_REQUISICAO',
        requestId,
      })
    }

    req.log.error({ err: erro }, 'erro não tratado')
    return reply.status(500).send({
      erro: 'Erro interno. Se persistir, informe o código abaixo ao suporte.',
      codigo: 'ERRO_INTERNO',
      requestId,
    })
  })

  function ehErroFastify(e: unknown): e is { statusCode: number; message: string; code?: string } {
    return (
      typeof e === 'object' &&
      e !== null &&
      'statusCode' in e &&
      typeof (e).statusCode === 'number'
    )
  }

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({
      erro: `Rota não encontrada: ${req.method} ${req.url}`,
      codigo: 'ROTA_NAO_ENCONTRADA',
      requestId: req.id,
    }),
  )
})

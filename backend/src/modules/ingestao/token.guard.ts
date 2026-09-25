import { timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { env } from '../../config/env.js'
import { NaoAutenticado, NaoAutorizado } from '../../lib/erros.js'

export const HEADER_TOKEN = 'x-ingest-token'

/**
 * Autenticação das rotas de ingestão.
 *
 * Não usa sessão de usuário: quem chama é o n8n, não uma pessoa. Um token em
 * header basta para tráfego interno sobre HTTPS, desde que comparado
 * corretamente.
 */
export function exigirTokenDeIngestao(req: FastifyRequest): void {
  const recebido = req.headers[HEADER_TOKEN]

  if (typeof recebido !== 'string' || recebido.length === 0) {
    throw new NaoAutenticado(`Header ${HEADER_TOKEN} ausente.`)
  }

  if (!iguaisEmTempoConstante(recebido, env.INGEST_TOKEN)) {
    // Mensagem idêntica à do header ausente: distinguir "token errado" de
    // "token ausente" já entrega ao atacante que ele acertou o formato.
    throw new NaoAutenticado(`Header ${HEADER_TOKEN} ausente.`)
  }

  if (env.ingestIpsPermitidos.length > 0 && !env.ingestIpsPermitidos.includes(req.ip)) {
    throw new NaoAutorizado(`Origem ${req.ip} não autorizada para ingestão.`)
  }
}

/**
 * Comparação em tempo constante.
 *
 * `a === b` sai no primeiro byte diferente, então o tempo de resposta revela
 * quantos caracteres iniciais estão corretos — dá para descobrir o token byte a
 * byte medindo latência. `timingSafeEqual` sempre percorre tudo.
 *
 * O comprimento é comparado antes porque `timingSafeEqual` lança com buffers de
 * tamanhos diferentes; o tamanho do token não é segredo.
 */
function iguaisEmTempoConstante(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

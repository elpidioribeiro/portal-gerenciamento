import { randomBytes, createHash, randomUUID } from 'node:crypto'
import type { PrismaClient, Usuario } from '@prisma/client'
import type { FastifyReply } from 'fastify'
import { env } from '../../config/env.js'

export const COOKIE_ACCESS = 'gd_sessao'
export const COOKIE_REFRESH = 'gd_refresh'

export interface PayloadJwt {
  sub: string
  nivel: string
  /** Só para exibição; a autorização sempre relê do banco. */
  nome: string
}

/**
 * Refresh token é opaco (não JWT) e guardado apenas como hash: um vazamento do
 * banco não permite forjar sessão. SHA-256 basta aqui — o token é aleatório de
 * 48 bytes, então não há o que quebrar por dicionário como haveria com senha.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function opcoesCookie(maxAgeSegundos: number) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: maxAgeSegundos,
  }
}

export class AuthService {
  constructor(private readonly prisma: PrismaClient) {}

  async abrirSessao(
    usuario: Usuario,
    reply: FastifyReply,
    contexto: { ip?: string | null; userAgent?: string | null },
    familiaId: string = randomUUID(),
  ) {
    const acesso = await reply.jwtSign(
      { sub: usuario.id, nivel: usuario.nivel, nome: usuario.nome } satisfies PayloadJwt,
      { expiresIn: env.ACCESS_TOKEN_TTL },
    )

    const refresh = randomBytes(48).toString('base64url')
    const expiraEm = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DIAS * 86_400_000)

    await this.prisma.refreshToken.create({
      data: {
        usuarioId: usuario.id,
        tokenHash: hashToken(refresh),
        familiaId,
        expiraEm,
        ip: contexto.ip ?? null,
        userAgent: contexto.userAgent ?? null,
      },
    })

    reply.setCookie(COOKIE_ACCESS, acesso, opcoesCookie(15 * 60))
    reply.setCookie(COOKIE_REFRESH, refresh, opcoesCookie(env.REFRESH_TOKEN_TTL_DIAS * 86_400))
  }

  /**
   * Rotação com detecção de reuso.
   *
   * Se um refresh já usado (ou revogado) reaparece, o cenário mais provável é
   * roubo de token: o legítimo e o atacante estão usando a mesma família. Não
   * há como distinguir quem é quem, então revogamos a família inteira e os dois
   * precisam logar de novo — o incômodo do usuário legítimo é preferível a
   * manter a sessão do atacante viva.
   */
  async rotacionar(
    refresh: string,
    reply: FastifyReply,
    contexto: { ip?: string | null; userAgent?: string | null },
  ) {
    const registro = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refresh) },
      include: { usuario: true },
    })

    if (!registro) return null

    if (registro.revogadoEm || registro.expiraEm < new Date()) {
      await this.prisma.refreshToken.updateMany({
        where: { familiaId: registro.familiaId, revogadoEm: null },
        data: { revogadoEm: new Date() },
      })
      return null
    }

    if (!registro.usuario.ativo) return null

    await this.prisma.refreshToken.update({
      where: { id: registro.id },
      data: { revogadoEm: new Date() },
    })

    await this.abrirSessao(registro.usuario, reply, contexto, registro.familiaId)
    return registro.usuario
  }

  async encerrarSessao(refresh: string | undefined, reply: FastifyReply) {
    if (refresh) {
      const registro = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: hashToken(refresh) },
      })
      if (registro) {
        await this.prisma.refreshToken.updateMany({
          where: { familiaId: registro.familiaId, revogadoEm: null },
          data: { revogadoEm: new Date() },
        })
      }
    }
    reply.clearCookie(COOKIE_ACCESS, { path: '/' })
    reply.clearCookie(COOKIE_REFRESH, { path: '/' })
  }
}

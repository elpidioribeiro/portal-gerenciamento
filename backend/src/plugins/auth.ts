import jwt from '@fastify/jwt'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { env } from '../config/env.js'
import { NaoAutenticado, NaoAutorizado } from '../lib/erros.js'
import { resolverNivelComAcesso } from '../modules/auth/nivel.js'
import { criarAuthProvider, type AuthProvider } from '../modules/auth/provider.js'
import { AuthService, COOKIE_ACCESS, type PayloadJwt } from '../modules/auth/service.js'
import type { Usuario } from '@prisma/client'

declare module 'fastify' {
  interface FastifyInstance {
    auth: AuthService
    authProvider: AuthProvider
    autenticar: (req: FastifyRequest) => Promise<Usuario>
  }
  interface FastifyRequest {
    usuario?: Usuario
  }
}

export default fp(async function authPlugin(app: FastifyInstance) {
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: { cookieName: COOKIE_ACCESS, signed: false },
    // Trava o algoritmo: sem isso um token forjado com `alg` diferente pode ser
    // aceito (confusão de algoritmo).
    verify: { algorithms: ['HS256'] },
    sign: { algorithm: 'HS256' },
  })

  app.decorate('auth', new AuthService(app.prisma))
  app.decorate('authProvider', criarAuthProvider(app.prisma, app.log))

  if (env.AUTH_DEV_BYPASS) {
    app.log.warn(
      { usuario: env.AUTH_DEV_USUARIO },
      'AUTH_DEV_BYPASS ligado: requisições sem sessão são atendidas como o usuário de desenvolvimento. ' +
        'A aplicação está SEM autenticação.',
    )
  }

  /**
   * Resolve o usuário da requisição. Sempre relê do banco em vez de confiar no
   * conteúdo do JWT: nível e status podem ter mudado desde a emissão do token,
   * e autorização baseada em claim velha é a forma clássica de manter acesso
   * depois de uma mudança de cargo ou desligamento.
   */
  app.decorate('autenticar', async (req: FastifyRequest): Promise<Usuario> => {
    if (req.usuario) return req.usuario

    try {
      const payload = await req.jwtVerify<PayloadJwt>()
      const usuario = await app.prisma.usuario.findUnique({ where: { id: payload.sub } })
      if (usuario?.ativo) {
        // O nível vem do id_perfil corporativo, resolvido a cada requisição:
        // uma correção no mapeamento (inclusive rebaixamento) vale na hora, em
        // vez de esperar a sessão expirar.
        const nivel = await resolverNivelComAcesso(app.prisma, usuario)
        req.usuario = { ...usuario, nivel }
        return req.usuario
      }
    } catch (e) {
      // NaoAutorizado vem da resolução de nível e é decisão de negócio — deve
      // chegar ao usuário com a mensagem explicando o porquê, não virar 401.
      if (e instanceof NaoAutorizado) throw e
      // Sem token, expirado ou inválido — cai no bypass de dev ou em 401.
    }

    if (env.AUTH_DEV_BYPASS) {
      const usuario = await app.prisma.usuario.findUnique({
        where: { loginErp: env.AUTH_DEV_USUARIO },
      })
      if (!usuario) {
        throw new NaoAutenticado(
          `AUTH_DEV_BYPASS aponta para "${env.AUTH_DEV_USUARIO}", que não existe. Rode: npm run db:seed`,
        )
      }
      /**
       * O bypass respeita `ativo`, como o login de verdade.
       *
       * Sem isto, desativar um usuário o bloqueava pela senha e pelo cookie, mas
       * não pelo bypass — que continuava atendendo como ele. A assimetria
       * apareceu ao neutralizar os usuários do seed no banco de
       * desenvolvimento: `ativo: false` em toda parte, menos aqui.
       *
       * O risco é pequeno (o boot recusa o bypass em produção), mas "desativado"
       * precisa significar a mesma coisa nos três caminhos.
       */
      if (!usuario.ativo) {
        throw new NaoAutenticado(
          `AUTH_DEV_BYPASS aponta para "${env.AUTH_DEV_USUARIO}", que está INATIVO. ` +
            'Escolha outro usuário ou reative-o.',
        )
      }
      req.usuario = usuario
      return usuario
    }

    throw new NaoAutenticado()
  })
})

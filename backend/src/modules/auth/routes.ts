import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { nivelNaApi, resolverNivelComAcesso } from './nivel.js'
import { ehAdmin, papelAdminDe } from './papel-admin.js'
import { COOKIE_REFRESH } from './service.js'

const usuarioSchema = z.object({
  id: z.string().uuid(),
  login: z.string(),
  nome: z.string(),
  iniciais: z.string(),
  cargo: z.string(),
  /**
   * Sem `N1` e `N5`: esses níveis saíram da hierarquia atendida em 24/08/2026.
   *
   * O enum do banco ainda os aceita — remover valor de enum no Postgres custa
   * recriar o tipo e reescrever seis colunas — mas o contrato da API não deve
   * prometer o que o produto não tem. Estreitar aqui faz um valor inesperado
   * falhar na serialização, alto e imediatamente, em vez de vazar para a tela.
   */
  nivel: z.enum(['N2', 'N3', 'N4', 'CROSS']),
  filial: z.string().nullable(),
  bucket: z.string().nullable(),
  /** URL ou base64 vindos da API de login. Nulo cai para as iniciais na tela. */
  foto: z.string().nullable(),
  /**
   * Administrador do portal: vê a área de administração e pode escolher a visão.
   *
   * Vai na resposta do login porque o front precisa saber se desenha o menu de
   * administração — e não pode decidir isso por nível: o administrador é N2, mas
   * nem todo N2 administra.
   */
  admin: z.boolean(),
  /**
   * O papel, quando o "sim ou não" acima não basta.
   *
   * `admin` continua na resposta e é DERIVADO deste campo — as seis leituras do
   * front que só querem saber se desenham o menu não precisam conhecer os
   * degraus. Só a tela que concede acesso lê `papelAdmin`, porque só ela
   * precisa distinguir quem pode conceder.
   */
  papelAdmin: z.enum(['NENHUM', 'ADMIN', 'MASTER']),
  /**
   * Falso em quem administra o portal sem participar da cadeia de ajuda.
   *
   * O front usa para duas coisas: não oferecer "deixar comigo" ao abrir uma
   * ação, e explicar por que as listas de "a fazer" estão sempre vazias.
   */
  recebeAcao: z.boolean(),
  /** true quando a sessão veio do bypass de desenvolvimento, não de um login. */
  sessaoDeDesenvolvimento: z.boolean(),
})

const erroSchema = z.object({
  erro: z.string(),
  codigo: z.string(),
  requestId: z.string().optional(),
})

export async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  async function comoResposta(usuario: NonNullable<Awaited<ReturnType<typeof app.prisma.usuario.findUnique>>>) {
    const [filial, bucket] = await Promise.all([
      usuario.filialId ? app.prisma.filial.findUnique({ where: { id: usuario.filialId } }) : null,
      usuario.bucketId ? app.prisma.bucket.findUnique({ where: { id: usuario.bucketId } }) : null,
    ])
    return {
      id: usuario.id,
      login: usuario.loginErp,
      nome: usuario.nome,
      iniciais: usuario.iniciais,
      cargo: usuario.cargo,
      nivel: nivelNaApi(usuario.nivel),
      foto: usuario.foto,
      filial: filial?.sigla ?? null,
      bucket: bucket?.nome ?? null,
      admin: ehAdmin(usuario),
      papelAdmin: papelAdminDe(usuario),
      recebeAcao: usuario.recebeAcao,
      sessaoDeDesenvolvimento: false,
    }
  }

  r.post(
    '/api/v1/auth/login',
    {
      config: {
        /*
         * Força bruta: 5 tentativas por 15 min POR IP — e só em produção.
         *
         * A chave é o IP, não "IP + login" como dizia o comentário anterior:
         * sem `keyGenerator` é isso que o plugin faz, e o comentário prometia
         * o que o código não entregava.
         *
         * A diferença não é acadêmica. Contando por IP, tentativas de contas
         * DIFERENTES somam na mesma cota, e login que deu CERTO também consome
         * — então conferir três acessos da mesma máquina travava quem conferia
         * por 15 minutos. Isso é o trabalho normal de quem desenvolve e de quem
         * dá suporte, e nenhum ataque se parece com isso.
         *
         * Desligado fora de produção porque é lá, e só lá, que a proteção vale
         * alguma coisa: no ambiente local o atacante seria o próprio dono da
         * máquina. `false` desliga o limite DESTA rota; o teto global de
         * 300/min em `app.ts` continua valendo para ela.
         */
        rateLimit: env.ehProducao ? { max: 5, timeWindow: '15 minutes' } : false,
      },
      schema: {
        tags: ['Autenticação'],
        summary: 'Autentica com credenciais corporativas',
        // Sem `filial`: a loja que valida a senha é fixa no servidor
        // (env.ERP_AUTH_FILIAL, NOR) — ver o comentário em provider.ts. Cliente
        // antigo que ainda mande `filial` não quebra: o Zod descarta o extra.
        body: z.object({
          login: z.string().min(1),
          senha: z.string().min(1),
        }),
        response: { 200: usuarioSchema, 401: erroSchema },
      },
    },
    async (req, reply) => {
      const autenticado = await app.authProvider.autenticar(req.body)

      /*
       * O ÚLTIMO PASSO DO DIÁRIO — ver `ErpAuthProvider.passo`.
       *
       * Aqui a credencial JÁ foi aceita. O que ainda pode recusar é o nível: o
       * `id_perfil` não estar em `perfil_nivel`, ou cair num nível sem tela.
       * São as duas recusas que mais parecem "senha errada" para quem está na
       * tela, e as únicas que o portal decide sozinho — daí valer o registro.
       */
      if (autenticado) {
        req.log.info(
          {
            login: 'diario',
            etapa: 'credencial-aceita',
            matricula: autenticado.loginErp,
            matriculaCorporativa: autenticado.matricula,
            idPerfil: autenticado.idPerfil,
          },
          'login: credencial-aceita',
        )
      }

      // Resolve o nível pelo id_perfil corporativo. Perfil não mapeado ou sem
      // tela no portal vira 403 com explicação, não login "bem-sucedido" que
      // depois esbarra em tela vazia.
      const usuario = autenticado
        ? { ...autenticado, nivel: await resolverNivelComAcesso(app.prisma, autenticado) }
        : null

      if (!usuario) {
        /*
         * Mensagem única para login inexistente e senha errada: dizer qual dos
         * dois falhou permite enumerar matrículas válidas da empresa.
         *
         * A frase é a mesma para fora e o LOG é específico: o `requestId` já
         * vai na resposta, então quem está na tela pode dizer o número e a
         * gente acha a linha exata que explica a recusa.
         */
        req.log.warn(
          { login: 'diario', etapa: 'recusado', motivo: 'a API não validou a credencial' },
          'login: recusado',
        )
        return reply.status(401).send({
          erro: 'Matrícula ou senha inválidas.',
          codigo: 'CREDENCIAIS_INVALIDAS',
          requestId: req.id,
        })
      }

      /*
       * GRAVA O NÍVEL RESOLVIDO NO CACHE QUE É `usuario.nivel`.
       *
       * A autorização segue resolvendo o nível a cada requisição (plugins/auth)
       * — isto NÃO muda, e é o que mantém "correção no mapeamento vale na hora".
       * Mas as consultas que LISTAM gente por nível — destinatários de ação
       * (`/destinatarios`), contagens do quadro — leem esta coluna e não têm
       * como resolver o perfil de cada uma das ~5 mil pessoas a cada chamada.
       *
       * O upsert de login cria todo usuário corporativo com `nivel: 'N4'`
       * inicial (ver provider) e nunca o atualizava. Resultado: um N3 que fez
       * login ficava gravado como N4 e SUMIA da lista do próprio nível — a
       * pessoa logava e não aparecia como destino, contra o que a tela promete
       * ("a pessoa só vira destino depois do primeiro login dela"). Gravar aqui,
       * onde o nível acabou de ser resolvido, fecha essa lacuna sem tocar na
       * resolução por requisição.
       */
      if (autenticado && usuario.nivel !== autenticado.nivel) {
        await app.prisma.usuario.update({
          where: { id: usuario.id },
          data: { nivel: usuario.nivel },
        })
      }

      req.log.info(
        { login: 'diario', etapa: 'entrou', matricula: usuario.loginErp, nivel: usuario.nivel },
        'login: entrou',
      )

      await app.auth.abrirSessao(usuario, reply, {
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      })
      await app.prisma.auditLog.create({
        data: { usuarioId: usuario.id, acao: 'LOGIN', entidade: 'usuario', entidadeId: usuario.id, ip: req.ip },
      })

      return comoResposta(usuario)
    },
  )

  r.post(
    '/api/v1/auth/refresh',
    {
      schema: {
        tags: ['Autenticação'],
        summary: 'Rotaciona a sessão',
        response: { 200: usuarioSchema, 401: erroSchema },
      },
    },
    async (req, reply) => {
      const refresh = req.cookies[COOKIE_REFRESH]
      const usuario = refresh
        ? await app.auth.rotacionar(refresh, reply, {
            ip: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          })
        : null

      if (!usuario) {
        return reply.status(401).send({
          erro: 'Sessão expirada. Entre novamente.',
          codigo: 'SESSAO_EXPIRADA',
          requestId: req.id,
        })
      }
      return comoResposta(usuario)
    },
  )

  r.post(
    '/api/v1/auth/logout',
    {
      schema: {
        tags: ['Autenticação'],
        summary: 'Encerra a sessão',
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      await app.auth.encerrarSessao(req.cookies[COOKIE_REFRESH], reply)
      return reply.status(204).send(null)
    },
  )

  r.get(
    '/api/v1/auth/me',
    {
      schema: {
        tags: ['Autenticação'],
        summary: 'Usuário da sessão corrente',
        response: { 200: usuarioSchema, 401: erroSchema },
      },
    },
    async (req) => {
      const usuario = await app.autenticar(req)
      const base = await comoResposta(usuario)
      // O front usa isso para exibir o aviso de sessão de desenvolvimento.
      return { ...base, sessaoDeDesenvolvimento: env.AUTH_DEV_BYPASS && !req.cookies[COOKIE_REFRESH] }
    },
  )
}

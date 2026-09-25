import type { Prisma } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { Conflito, DadosInvalidos, ErroApp, NaoEncontrado } from '../../lib/erros.js'
import { veTodasAsFiliais } from '../auth/escopo.js'
import { NIVEIS_COM_ACESSO, temAcessoAoPortal } from '../auth/nivel.js'
import { ehAncora, ehMaster, papelAdminDe } from '../auth/papel-admin.js'
import { exigirAdmin, exigirMaster } from './guarda.js'
import { listarPerfis, perfilExiste } from './perfis-oracle.js'
import { desativarUsuariosDoPerfil, sincronizarUsuariosDoPerfil } from './carga-usuarios.js'

/**
 * A área de administração.
 *
 * Existe para tirar do deploy as decisões de acesso que hoje só entrariam por
 * SQL. **São três cadastros, um por nível** (PLANO §7.20):
 *
 *   N4  →  `id_perfil` + variáveis de controle
 *   N3  →  `id_perfil`
 *   N2  →  matrícula, e ela vence o perfil
 *
 * A EMPRESA não entra em nenhum dos três: é a filial de quem loga que filtra o
 * que aparece.
 *
 * Também é o que **destrava desligar o `AUTH_DEV_BYPASS`**. O login real bloqueia
 * perfil sem nível, e há 447 perfis com gente trabalhando contra 8 classificados
 * — ligar `AUTH_PROVIDER=erp` hoje trancaria a empresa inteira do lado de fora,
 * o administrador incluído se não fosse a coluna `admin`.
 */

const nivelSchema = z.enum(NIVEIS_COM_ACESSO)
const papelSchema = z.enum(['NENHUM', 'ADMIN', 'MASTER'])

const erroSchema = z.object({
  erro: z.string(),
  codigo: z.string(),
  requestId: z.string().optional(),
})

/** Uma pessoa cadastrada como N2 por matrícula. Ver as rotas de matrícula. */
const matriculaSchema = z.object({
  matricula: z.number().int(),
  nivel: z.enum(['N1', 'N2', 'N3', 'N4', 'N5', 'CROSS']),
  descricao: z.string(),
  ativo: z.boolean(),
})

const perfilSchema = z.object({
  idPerfil: z.number().int(),
  /** Cargos que o perfil cobre, do mais numeroso ao menos. Ver perfis-oracle.ts. */
  cargos: z.array(z.string()),
  /**
   * Lotações do perfil. É o que distingue um `id_perfil` do outro quando o cargo
   * é o mesmo — "GERENTE ADJUNTO" tem quatro perfis, um por lotação.
   */
  lotacoes: z.array(z.string()),
  pessoas: z.number().int(),
  locais: z.number().int(),
  /** Nulo = não classificado = **bloqueado** no login. */
  nivel: nivelSchema.nullable(),
  /** Descrição gravada pelo administrador ao classificar. */
  descricao: z.string().nullable(),
  /** Classificação existente mas desligada: também bloqueia. */
  ativo: z.boolean(),
  /**
   * As variáveis de controle que este perfil acompanha — o que ele pode MARCAR.
   *
   * Só o N4 tem: o N3 lê a filial inteira e o N2 é corporativo. Um N4 com a
   * lista vazia entra no portal e não consegue marcar nada, e é por isso que a
   * tela recusa salvar assim.
   */
  variaveis: z.array(z.string().uuid()),
})

export async function adminRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>()

  // ───────────────────────────────────────────────────────────────────────────
  // Catálogo de perfis
  // ───────────────────────────────────────────────────────────────────────────

  r.get(
    '/api/v1/admin/perfis',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Catálogo de perfis corporativos com a classificação atual',
        response: {
          200: z.object({
            perfis: z.array(perfilSchema),
            resumo: z.object({
              total: z.number().int(),
              classificados: z.number().int(),
              bloqueados: z.number().int(),
              pessoasBloqueadas: z.number().int(),
            }),
          }),
          403: erroSchema,
        },
      },
    },
    async (req) => {
      await exigirAdmin(app, req)

      /**
       * Oracle e Postgres em paralelo: são bancos diferentes, uma espera não
       * precisa da outra. O catálogo é do RH e a classificação é do portal — o
       * cruzamento acontece aqui, em memória, porque não há como fazer JOIN
       * entre os dois.
       */
      const [doOracle, classificacoes] = await Promise.all([
        listarPerfis(),
        app.prisma.perfilNivel.findMany({
          include: { variaveis: { select: { variavelControleId: true } } },
        }),
      ])

      // Uma linha por `id_perfil` desde 28/08/2026: a lotacao saiu da chave
      // porque os quatro GERENTE ADJUNTO ja' sao quatro perfis diferentes.
      const porPerfil = new Map(classificacoes.map((c) => [c.idPerfil, c]))

      const perfis = doOracle.map((p) => {
        const c = porPerfil.get(p.idPerfil)
        /**
         * Classificado só conta quando o login deixaria entrar.
         *
         * Dois casos viram `null`, porque o efeito prático é o mesmo — acesso
         * negado — e mostrá-los como classificados esconderia perfis que
         * precisam de atenção:
         *
         *  - `ativo: false`, classificação desligada;
         *  - nível sem tela no portal (N1, N5, CROSS). A tabela aceita os seis
         *    níveis do modelo e esta API só escreve três, mas um INSERT por SQL
         *    pode ter deixado outro lá.
         *
         * A condição fica inteira na ternária, não numa variável: é o que faz o
         * `temAcessoAoPortal` estreitar `c.nivel` de `Nivel` para os três com
         * tela. Guardada num booleano, a narrowing se perde e o tipo não fecha.
         */
        return {
          ...p,
          nivel: c !== undefined && c.ativo && temAcessoAoPortal(c.nivel) ? c.nivel : null,
          descricao: c?.descricao ?? null,
          ativo: c?.ativo ?? false,
          variaveis: (c?.variaveis ?? []).map((v) => v.variavelControleId),
        }
      })

      const bloqueados = perfis.filter((p) => p.nivel === null)

      return {
        perfis,
        resumo: {
          total: perfis.length,
          classificados: perfis.length - bloqueados.length,
          bloqueados: bloqueados.length,
          // O número que dimensiona o trabalho: quantas pessoas não entram hoje.
          pessoasBloqueadas: bloqueados.reduce((a, p) => a + p.pessoas, 0),
        },
      }
    },
  )

  r.put(
    '/api/v1/admin/perfis/:idPerfil',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Classifica um perfil corporativo num nível do GD',
        params: z.object({ idPerfil: z.coerce.number().int().positive() }),
        body: z.object({
          nivel: nivelSchema,
          /**
           * As variáveis de controle que o perfil acompanha — o que ele pode
           * MARCAR. Substitui a lista inteira: o que não vier aqui é removido.
           *
           * **Obrigatória para o N4, e recusada para os outros.** O N4 é quem
           * marca ponto de causa, e um N4 sem variável entra no portal e não
           * consegue marcar nada — sem erro, só um clique que não faz efeito. O
           * N3 lê a filial inteira e o N2 é corporativo: guardar variáveis para
           * eles seria cadastro que a resolução ignora.
           */
          variaveis: z.array(z.string().uuid()).default([]),
          descricao: z.string().min(1).max(200),
          ativo: z.boolean().default(true),
        }),
        response: {
          200: z.object({ idPerfil: z.number().int(), nivel: nivelSchema, ativo: z.boolean() }),
          422: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (req) => {
      const admin = await exigirAdmin(app, req)
      const { idPerfil } = req.params
      const { nivel, variaveis, descricao, ativo } = req.body

      if (nivel === 'N4' && variaveis.length === 0) {
        throw new DadosInvalidos(
          'Escolha ao menos uma variável de controle: o N4 é quem marca ponto de causa, e ' +
            'sem variável ele entra no portal sem conseguir marcar nada.',
        )
      }
      if (nivel !== 'N4' && variaveis.length > 0) {
        throw new DadosInvalidos(
          `Variáveis de controle são do N4. O ${nivel} não marca ponto de causa — ` +
            'o N3 lê a filial inteira e o N2 é corporativo.',
        )
      }

      /**
       * Confere no Oracle antes de gravar. `id_perfil` digitado errado entra no
       * `perfil_nivel`, não casa com ninguém, não dá erro e desaparece no meio
       * dos outros — o administrador acharia que classificou.
       */
      if (!(await perfilExiste(idPerfil))) {
        throw new ErroApp(
          404,
          'NAO_ENCONTRADO',
          `O perfil ${idPerfil} não existe na view do RH, ou não tem ninguém trabalhando nele.`,
        )
      }

      const anterior = await app.prisma.perfilNivel.findUnique({
        where: { idPerfil },
        include: { variaveis: { select: { variavelControleId: true } } },
      })

      /*
       * Nível e variáveis na MESMA transação: são as duas metades de uma
       * decisão só. Gravar o nível e falhar nas variáveis deixaria um N4 sem
       * nada para marcar -- o estado que a validação acima recusa.
       *
       * As variáveis são substituídas por inteiro (apaga e insere) em vez de
       * um diff: a lista tem no máximo uma dúzia de itens, e comparar conjuntos
       * para poupar dois comandos custa mais em leitura do que economiza.
       */
      const salvo = await app.prisma.$transaction(async (tx) => {
        const linha = await tx.perfilNivel.upsert({
          where: { idPerfil },
          create: { idPerfil, nivel, descricao, ativo },
          update: { nivel, descricao, ativo },
        })
        await tx.perfilVariavel.deleteMany({ where: { idPerfil } })
        if (variaveis.length > 0) {
          await tx.perfilVariavel.createMany({
            data: variaveis.map((variavelControleId) => ({ idPerfil, variavelControleId })),
          })
        }
        return linha
      })

      /**
       * A CARGA roda aqui, e não num job noturno.
       *
       * Classificar um perfil é dizer "estas pessoas fazem parte do GD". Sem
       * trazê-las na mesma hora, elas existem no RH e não existem no portal --
       * foi exatamente isso que deixou o seletor de "escalar para o N3" vazio
       * com dez gerentes gerais cadastrados (§7.33).
       *
       * FORA da transação, e o erro não derruba a classificação: o Oracle é
       * outro sistema, e um timeout dele não pode desfazer a decisão que o
       * administrador acabou de tomar. A carga é reexecutável -- salvar o
       * perfil de novo tenta de novo.
       */
      let carga: Awaited<ReturnType<typeof sincronizarUsuariosDoPerfil>> | null = null
      try {
        carga = await sincronizarUsuariosDoPerfil(app.prisma, idPerfil, nivel)
      } catch (e) {
        req.log.error(
          { err: e, idPerfil },
          'Perfil classificado, mas a carga de usuários falhou. Salve o perfil de novo.',
        )
      }

      /**
       * Auditoria não é enfeite aqui: esta é a decisão que define quem vê o quê
       * na empresa, e ela é tomada por uma pessoa numa tela. Sem registro, um
       * acesso indevido não tem como ser explicado depois.
       */
      await app.prisma.auditLog.create({
        data: {
          usuarioId: admin.id,
          acao: 'CLASSIFICAR_PERFIL',
          entidade: 'perfil_nivel',
          entidadeId: String(idPerfil),
          ip: req.ip,
          // Antes e depois no mesmo payload: sem o "antes", o registro não
          // distingue classificação nova de mudança de nível — e mudança é
          // justamente o que interessa auditar.
          payload: {
            antes: anterior
              ? {
                  nivel: anterior.nivel,
                  descricao: anterior.descricao,
                  ativo: anterior.ativo,
                  variaveis: anterior.variaveis.map((v) => v.variavelControleId),
                }
              : null,
            depois: {
              nivel: salvo.nivel,
              descricao: salvo.descricao,
              ativo: salvo.ativo,
              variaveis,
            },
            /*
             * O RESULTADO DA CARGA, e `null` quando ela falhou.
             *
             * `carga` era atribuido e nunca lido -- achado do lint. A distincao
             * entre "sincronizou 12 pessoas" e "nao sincronizou ninguem porque
             * o Oracle caiu" ficava so' no log do servidor, que rotaciona; a
             * auditoria, que nao rotaciona, guardava apenas a classificacao.
             *
             * `null` e' informacao: diz que a decisao valeu e o efeito dela
             * ficou pendente ate' alguem salvar o perfil de novo.
             *
             * Espalhado num literal porque `ResultadoDaCarga` e' uma
             * `interface`, e o Json do Prisma exige indice implicito -- que
             * so' tipo anonimo tem. O `saida` da rota vizinha passa direto
             * porque ja' e' um tipo literal.
             */
            usuarios: carga === null ? null : { ...carga },
          },
        },
      })

      // `nivel` do corpo, nao `salvo.nivel`: o corpo ja' foi validado como um
      // dos tres niveis com tela, enquanto o do banco carrega os seis do modelo.
      return { idPerfil: salvo.idPerfil, nivel, ativo: salvo.ativo }
    },
  )

  r.delete(
    '/api/v1/admin/perfis/:idPerfil',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Remove a classificação de um perfil (volta a bloquear o login)',
        params: z.object({ idPerfil: z.coerce.number().int().positive() }),
        response: { 204: z.null(), 403: erroSchema, 404: erroSchema, 409: erroSchema },
      },
    },
    async (req, reply) => {
      const admin = await exigirAdmin(app, req)
      const { idPerfil } = req.params

      const atual = await app.prisma.perfilNivel.findUnique({ where: { idPerfil } })
      if (!atual) throw new NaoEncontrado(`Classificação do perfil ${idPerfil}`)

      /**
       * Remover a classificação do próprio perfil se tranca fora do portal — o
       * login resolve o nível a cada requisição, então o efeito é imediato e
       * não há como desfazer de dentro da aplicação.
       *
       * A coluna `admin` não salva: ela permite escolher a visão, não substitui
       * a resolução de nível.
       */
      if (admin.idPerfil === idPerfil) {
        throw new Conflito(
          'Este é o seu próprio perfil. Removê-lo te tranca fora do portal na próxima ' +
            'requisição, e não há como reverter de dentro da aplicação.',
        )
      }

      // As variáveis vão junto, por cascata: associação sem nível não vale
      // nada, já que sem nível a pessoa nem entra.
      await app.prisma.perfilNivel.delete({ where: { idPerfil } })

      /*
       * Quem a CARGA trouxe sai junto -- desativado, não apagado: a pessoa pode
       * já ter ação escalada para ela, e apagar a linha deixaria a ação sem
       * dono. Quem já entrou no portal fica: o login dele será recusado por
       * falta de nível, e essa recusa é do login, não desta rota. Ver §7.33.
       */
      const saida = await desativarUsuariosDoPerfil(app.prisma, idPerfil)
      await app.prisma.auditLog.create({
        data: {
          usuarioId: admin.id,
          acao: 'REMOVER_CLASSIFICACAO',
          entidade: 'perfil_nivel',
          entidadeId: String(idPerfil),
          ip: req.ip,
          payload: {
            antes: { nivel: atual.nivel, descricao: atual.descricao, ativo: atual.ativo },
            depois: null,
            /*
             * QUANTAS PESSOAS perderam o acesso, e quantas foram preservadas.
             *
             * `saida` era calculado e descartado -- o lint achou (`saida` nunca
             * lido). O registro dizia qual classificacao saiu e nao dizia o
             * efeito dela, que e' o que esta rota de fato faz: desativar gente.
             *
             * O comentario da auditoria da rota vizinha pede exatamente isto
             * ("sem registro, um acesso indevido nao tem como ser explicado
             * depois"), e sem o numero a pergunta "quem perdeu acesso naquele
             * dia" nao tem resposta no log.
             */
            usuarios: saida,
          },
        },
      })

      return reply.status(204).send(null)
    },
  )
  // ───────────────────────────────────────────────────────────────────────────
  // Catálogo de variáveis de controle, para o editor do perfil
  // ───────────────────────────────────────────────────────────────────────────

  r.get(
    '/api/v1/admin/variaveis',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Catálogo de variáveis de controle, agrupadas por indicador',
        response: {
          200: z.object({
            indicadores: z.array(
              z.object({
                codigo: z.string(),
                nome: z.string(),
                variaveis: z.array(
                  z.object({
                    id: z.string().uuid(),
                    nome: z.string(),
                    unidade: z.string(),
                  }),
                ),
              }),
            ),
          }),
          403: erroSchema,
        },
      },
    },
    async (req) => {
      await exigirAdmin(app, req)

      const indicadores = await app.prisma.indicador.findMany({
        orderBy: { ordem: 'asc' },
        include: { variaveis: { orderBy: { ordem: 'asc' } } },
      })

      return {
        indicadores: indicadores.map((i) => ({
          codigo: i.codigo,
          nome: i.nome,
          variaveis: i.variaveis.map((v) => ({ id: v.id, nome: v.nome, unidade: v.unidade })),
        })),
      }
    },
  )

  // ── O N2, por MATRÍCULA ────────────────────────────────────────────────────
  /*
   * O N2 não se cadastra por cargo, e sim pessoa a pessoa.
   *
   * Perfil é CARGO, e cargo nem sempre diz o papel no GD: Pedro Souto tem
   * `id_perfil` 11, associado a N3, e responde como N2. Sem isto a saída seria
   * reclassificar o perfil 11 inteiro, levando junto todo mundo com aquele
   * cargo. Por isso a matrícula VENCE o perfil. Ver PLANO §7.20.
   */
  r.get(
    '/api/v1/admin/matriculas',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Pessoas cadastradas como N2, o que prevalece sobre o perfil delas',
        response: {
          200: z.object({ matriculas: z.array(matriculaSchema) }),
          403: erroSchema,
        },
      },
    },
    async (req) => {
      await exigirAdmin(app, req)
      const linhas = await app.prisma.matriculaNivel.findMany({ orderBy: { matricula: 'asc' } })
      return {
        matriculas: linhas.map((m) => ({
          matricula: m.matricula,
          nivel: m.nivel,
          descricao: m.descricao,
          ativo: m.ativo,
        })),
      }
    },
  )

  r.put(
    '/api/v1/admin/matriculas/:matricula',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Cadastra uma pessoa como N2 — vence o nível do perfil dela',
        params: z.object({ matricula: z.coerce.number().int().positive() }),
        /*
         * O nível NÃO vem no corpo: a matrícula é o cadastro do N2, e é o único
         * nível que se cadastra assim. Ver PLANO §7.20 -- e o comentário do
         * modelo `MatriculaNivel` sobre por que a coluna continua existindo.
         */
        body: z.object({
          descricao: z.string().min(1).max(200),
          ativo: z.boolean().default(true),
        }),
        response: { 200: matriculaSchema, 403: erroSchema },
      },
    },
    async (req) => {
      const admin = await exigirAdmin(app, req)
      const { matricula } = req.params
      const { descricao, ativo } = req.body
      const nivel = 'N2' as const

      const atual = await app.prisma.matriculaNivel.findUnique({ where: { matricula } })
      const salvo = await app.prisma.matriculaNivel.upsert({
        where: { matricula },
        create: { matricula, nivel, descricao, ativo },
        update: { nivel, descricao, ativo },
      })

      await app.prisma.auditLog.create({
        data: {
          usuarioId: admin.id,
          acao: 'CLASSIFICAR_MATRICULA',
          entidade: 'matricula_nivel',
          entidadeId: String(matricula),
          ip: req.ip,
          // Antes e depois: sem o "antes", o registro não distingue cadastro
          // novo de reativação -- e reativação é o caso que se investiga.
          payload: { antes: atual, depois: { nivel, descricao, ativo } },
        },
      })

      return {
        matricula: salvo.matricula,
        nivel: salvo.nivel,
        descricao: salvo.descricao,
        ativo: salvo.ativo,
      }
    },
  )

  r.delete(
    '/api/v1/admin/matriculas/:matricula',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Tira o nível próprio da pessoa — ela volta a seguir o perfil',
        params: z.object({ matricula: z.coerce.number().int().positive() }),
        response: { 204: z.null(), 403: erroSchema, 404: erroSchema, 409: erroSchema },
      },
    },
    async (req, reply) => {
      const admin = await exigirAdmin(app, req)
      const { matricula } = req.params

      const atual = await app.prisma.matriculaNivel.findUnique({ where: { matricula } })
      if (!atual) throw new NaoEncontrado(`Nível próprio da matrícula ${matricula}`)

      /*
       * Mesma trava do perfil: tirar o próprio pode te trancar fora, e o nível
       * é resolvido a cada requisição -- não há como reverter de dentro.
       */
      if (admin.matricula === matricula) {
        throw new Conflito(
          'Esta é a sua própria matrícula. Removê-la te devolve ao nível do seu perfil na ' +
            'próxima requisição, e se ele não tiver acesso não há como reverter daqui.',
        )
      }

      await app.prisma.matriculaNivel.delete({ where: { matricula } })
      await app.prisma.auditLog.create({
        data: {
          usuarioId: admin.id,
          acao: 'DESCLASSIFICAR_MATRICULA',
          entidade: 'matricula_nivel',
          entidadeId: String(matricula),
          ip: req.ip,
          payload: { antes: atual },
        },
      })
      return reply.status(204).send(null)
    },
  )

  r.get(
    '/api/v1/admin/visoes',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Níveis e filiais que o administrador pode escolher ver',
        response: {
          200: z.object({
            niveis: z.array(
              z.object({
                nivel: nivelSchema,
                /** Se verdadeiro, escolher este nível exige também uma filial. */
                exigeFilial: z.boolean(),
              }),
            ),
            filiais: z.array(z.object({ sigla: z.string(), nome: z.string() })),
          }),
          403: erroSchema,
        },
      },
    },
    async (req) => {
      await exigirAdmin(app, req)

      const filiais = await app.prisma.filial.findMany({
        where: { tipo: 'FILIAL', ativa: true },
        orderBy: { ordem: 'asc' },
        select: { sigla: true, nome: true },
      })

      return {
        // A regra vive em escopo.ts; aqui ela é só declarada para o front montar
        // o seletor sem precisar conhecê-la.
        /*
         * `exigeFilial` sai da REGRA, não de uma lista repetida aqui.
         *
         * Escrito como `nivel === 'N4'`, ele não acompanhou a mudança de
         * 27/08/2026 que tirou o N3 dos corporativos — e o seletor continuaria
         * oferecendo "N3 · todas as filiais", que o servidor recusa.
         */
        niveis: NIVEIS_COM_ACESSO.map((nivel) => ({ nivel, exigeFilial: !veTodasAsFiliais(nivel) })),
        filiais,
      }
    },
  )

  // ── Quem administra o portal, e quem não recebe ação ───────────────────────
  /**
   * O CADASTRO DE ACESSO — o quarto cadastro desta área.
   *
   * Os três de cima (§7.20) dizem **o que a pessoa vê**. Este diz duas coisas
   * que não são nível: **o que ela configura** (`papelAdmin`) e **se trabalho
   * pode cair na mão dela** (`recebeAcao`). Pedido do analista em 14/09/2026.
   *
   * Até aqui isso era `scripts/admin.ts` rodando contra o banco — o que
   * funciona para um administrador e não para vários.
   */
  r.get(
    '/api/v1/admin/acessos',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Quem administra o portal, com o papel de cada um',
        /**
         * SEM BUSCA, a lista só mostra quem JÁ administra — e aí não há como
         * promover ninguém. Era o buraco: a tela listava o resultado e não
         * tinha como alcançar as outras 5 mil pessoas.
         *
         * Por nome, matrícula ou login. Não há "listar todo mundo": são
         * milhares, e uma lista de milhares para escolher um administrador é
         * pior do que nenhuma.
         */
        querystring: z.object({ busca: z.string().trim().min(2).optional() }),
        response: {
          200: z.object({
            /** Verdadeiro quando quem pergunta pode conceder e revogar. */
            souMaster: z.boolean(),
            acessos: z.array(
              z.object({
                matricula: z.number().int().nullable(),
                login: z.string(),
                nome: z.string(),
                cargo: z.string(),
                nivel: z.string(),
                papelAdmin: papelSchema,
                recebeAcao: z.boolean(),
                ativo: z.boolean(),
                /** A âncora não pode ser mexida por rota nenhuma. */
                ancora: z.boolean(),
              }),
            ),
          }),
          401: erroSchema,
          403: erroSchema,
        },
      },
    },
    async (req) => {
      const quem = await exigirAdmin(app, req)

      const { busca } = req.query

      /*
       * DOIS MODOS, e a diferenca e' o que a tela esta perguntando.
       *
       * Sem busca: quem ADMINISTRA e quem esta fora da cadeia -- os dois
       * conjuntos, porque e' o estado que o administrador quer conferir.
       *
       * Com busca: quem casa com o texto, administrando ou nao. E' por aqui
       * que alguem novo entra, e sem isto a tela so' mostrava o resultado sem
       * oferecer como chegar nele.
       */
      const numero = busca === undefined ? Number.NaN : Number(busca)
      const filtro: Prisma.UsuarioWhereInput =
        busca === undefined
          ? { OR: [{ papelAdmin: { not: 'NENHUM' } }, { recebeAcao: false }] }
          : {
              OR: [
                { nome: { contains: busca, mode: 'insensitive' } },
                { loginErp: { contains: busca.toLowerCase() } },
                ...(Number.isInteger(numero) ? [{ matricula: numero }] : []),
              ],
            }

      const pessoas = await app.prisma.usuario.findMany({
        where: filtro,
        // Teto na busca: ninguem escolhe administrador numa lista de mil nomes,
        // e quem nao achou refina o texto.
        ...(busca === undefined ? {} : { take: 30 }),
        orderBy: [{ papelAdmin: 'desc' }, { nome: 'asc' }],
        select: {
          matricula: true,
          loginErp: true,
          nome: true,
          cargo: true,
          nivel: true,
          papelAdmin: true,
          recebeAcao: true,
          ativo: true,
        },
      })

      return {
        souMaster: ehMaster(quem),
        acessos: pessoas.map((u) => ({
          matricula: u.matricula,
          login: u.loginErp,
          nome: u.nome,
          cargo: u.cargo,
          nivel: u.nivel,
          // O papel EFETIVO, e não a coluna: a âncora é MASTER mesmo que a
          // linha diga outra coisa, e a tela tem de mostrar o que vale.
          papelAdmin: papelAdminDe(u),
          recebeAcao: u.recebeAcao,
          ativo: u.ativo,
          ancora: ehAncora(u),
        })),
      }
    },
  )

  /**
   * Concede ou revoga o papel, e liga ou desliga a participação na cadeia.
   *
   * **Só o MASTER.** Sem esse degrau, conceder acesso seria transitivo: qualquer
   * administrador criaria outro, e revogaria quem o criou.
   *
   * Pela MATRÍCULA, como `matricula_nivel` — é a identidade estável, e o
   * `login_erp` muda na origem (§7.33).
   */
  r.put(
    '/api/v1/admin/acessos/:matricula',
    {
      schema: {
        tags: ['Administração'],
        summary: 'Define o papel de administração e se a pessoa recebe ação',
        params: z.object({ matricula: z.coerce.number().int().positive() }),
        body: z.object({
          papelAdmin: papelSchema,
          recebeAcao: z.boolean(),
        }),
        response: {
          200: z.object({ matricula: z.number().int(), papelAdmin: papelSchema, recebeAcao: z.boolean() }),
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          422: erroSchema,
        },
      },
    },
    async (req) => {
      const quem = await exigirMaster(app, req)
      const { matricula } = req.params
      const { papelAdmin, recebeAcao } = req.body

      const alvo = await app.prisma.usuario.findUnique({ where: { matricula } })
      if (!alvo) {
        throw new NaoEncontrado(
          `Matrícula ${matricula} não tem cadastro no portal. A pessoa precisa ter entrado ` +
            'ao menos uma vez, ou ter vindo na carga de usuários.',
        )
      }

      /**
       * A ÂNCORA NÃO PODE PERDER O PAPEL MASTER — mas só isso.
       *
       * A trava existe contra o estado irreversível: sem ela, o último master se
       * revoga por engano e **não existe tela capaz de desfazer**, porque
       * conceder papel exige um master. A saída seria um script contra o banco.
       *
       * Até 21/09/2026 ela recusava QUALQUER alteração na âncora, e era larga
       * demais: prendia junto o `recebe_acao`, que é inofensivo. Tirar a âncora
       * da cadeia de ajuda não deixa o portal sem quem conceda acesso — o papel
       * master continua de pé. O caso apareceu com a própria conta âncora presa
       * recebendo ação sem participar do GD, sem jeito pela tela.
       *
       * Agora a trava é ESTREITA: o papel da âncora é imutável (e nem se escreve
       * abaixo — `papelAdminDe` o calcula como MASTER, então um `UPDATE` por fora
       * também não a tranca para fora), mas o `recebe_acao` dela muda como o de
       * qualquer um. Ver `auth/papel-admin.ts`.
       */
      const ancora = ehAncora(alvo)
      if (ancora && papelAdmin !== 'MASTER') {
        throw new DadosInvalidos(
          'A conta de administração principal não pode perder o papel de master por aqui — ' +
            'é a trava que impede o portal ficar sem ninguém que conceda acesso, e mudá-la ' +
            'exige alteração no código. O "recebe ação" dela, porém, pode ser alterado normalmente.',
        )
      }

      /*
       * Quem administra e NAO recebe acao e' a categoria que isto existe para
       * criar. O contrario -- receber acao sem administrar -- e' todo mundo, e
       * tambem e' valido. Nao ha combinacao proibida aqui.
       *
       * Na ancora o `papelAdmin` NAO se escreve: ele e' computado (`papelAdminDe`
       * devolve MASTER de qualquer jeito), entao gravar a coluna seria ruido.
       * So' o `recebe_acao` dela e' persistido.
       */
      const atualizado = await app.prisma.usuario.update({
        where: { matricula },
        data: ancora ? { recebeAcao } : { papelAdmin, recebeAcao },
        select: { matricula: true, papelAdmin: true, recebeAcao: true },
      })

      await app.prisma.auditLog.create({
        data: {
          usuarioId: quem.id,
          acao: 'ACESSO_ALTERADO',
          entidade: 'usuario',
          entidadeId: alvo.id,
          payload: {
            matricula,
            de: { papelAdmin: papelAdminDe(alvo), recebeAcao: alvo.recebeAcao },
            para: { papelAdmin: papelAdminDe(atualizado), recebeAcao },
          },
          ip: req.ip,
        },
      })

      return {
        matricula: atualizado.matricula ?? matricula,
        // O papel EFETIVO, não a coluna: a âncora é MASTER mesmo com a linha
        // dizendo outra coisa. Igual à listagem.
        papelAdmin: papelAdminDe(atualizado),
        recebeAcao: atualizado.recebeAcao,
      }
    },
  )
}

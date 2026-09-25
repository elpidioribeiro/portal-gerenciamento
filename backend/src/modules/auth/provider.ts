import type { PrismaClient, Usuario } from '@prisma/client'
import type { FastifyBaseLogger } from 'fastify'
import argon2 from 'argon2'
import { SQL_USUARIO } from '../../fontes/fontes.mjs'
import { env } from '../../config/env.js'
import { NaoAutorizado } from '../../lib/erros.js'
import { consultar } from '../../lib/oracle.js'

/**
 * A validação de credencial fica atrás desta interface para que a troca do
 * mock pela API corporativa não toque em nenhuma outra parte do backend.
 */
export interface AuthProvider {
  readonly nome: string
  autenticar(entrada: { login: string; senha: string }): Promise<Usuario | null>
}

/**
 * Desenvolvimento: valida contra `usuario.senha_hash`, populado pelo seed.
 *
 * A comparação roda mesmo quando o login não existe (contra um hash descartável)
 * para que o tempo de resposta não revele quais matrículas são válidas — sem
 * isso, medir a latência enumera os usuários da empresa.
 */
export class MockAuthProvider implements AuthProvider {
  readonly nome = 'mock'
  /** Hash de valor arbitrário, só para consumir tempo no caminho do não-encontrado. */
  private hashFalso: string | null = null

  constructor(private readonly prisma: PrismaClient) {}

  async autenticar({ login, senha }: { login: string; senha: string }) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { loginErp: login.trim().toLowerCase() },
    })

    if (!usuario?.senhaHash || !usuario.ativo) {
      this.hashFalso ??= await argon2.hash('senha-inexistente', { type: argon2.argon2id })
      await argon2.verify(this.hashFalso, senha).catch(() => false)
      return null
    }

    const ok = await argon2.verify(usuario.senhaHash, senha).catch(() => false)
    return ok ? usuario : null
  }
}

/**
 * Resposta da API "Login Operações". Só os campos que o portal usa.
 *
 * `employeeId` e' `number | null`, e a diferenca importa: o corpo chega por
 * `json() as RespostaLogin`, um CAST -- ninguem valida nada. Declarar `number`
 * era afirmar sobre a API de outra equipe uma garantia que este codigo nao
 * tem, e a afirmacao tornava morta a unica checagem que existia contra o caso
 * (`employeeId !== null`, adiante). Achado pelo lint: "os tipos nao tem
 * intersecao".
 *
 * `null` aqui nao e' teorico: a matricula alimenta a consulta do perfil no
 * Oracle e a coluna UNIQUE `usuario.matricula`.
 */
interface RespostaLogin {
  login: string
  name: string
  initials: string
  employeeId: number | null
  role: string
  photo: string | null
}

/** Linha de `SQL_USUARIO`: o perfil corporativo da pessoa naquela empresa. */
interface PerfilOracle {
  ID_PERFIL: number | string
  COD_EMPRESA: number | string
  CARGO: string | null
  LOCAL: string | null
}

/**
 * Produção: API "Login Operações" (`POST /api/LoginUsuario`) + Oracle.
 *
 * São dois passos, e cada um responde uma pergunta diferente:
 *
 * 1. **A API valida a credencial.** Ela devolve nome, iniciais e matrícula —
 *    mas NÃO devolve `id_perfil`, que é o que o portal usa para decidir nível e
 *    quais variáveis a pessoa vê.
 * 2. **O Oracle diz o perfil**, por `(cd_usuario, cod_empresa)`. A empresa vem
 *    da filial escolhida na tela de login: a mesma pessoa tem perfis diferentes
 *    em lojas diferentes, e é isso que `hr_usuario_filiais` modela.
 *
 * O token JWT que a API devolve é **descartado**. O portal emite a própria
 * sessão, com o próprio segredo e a própria expiração — aceitar um token de
 * fora significaria confiar na rotação de chave de outro sistema para encerrar
 * uma sessão daqui.
 */
export class ErpAuthProvider implements AuthProvider {
  readonly nome = 'erp'

  /**
   * O DIÁRIO DO LOGIN — cada ponto onde ele pode recusar, com o motivo.
   *
   * Pedido do analista em 11/09/2026, depois de *"tá dando usuário e senha
   * errado, só que tá certo"*. Do lado de fora as recusas são todas iguais:
   * a tela mostra uma frase só, de propósito, para não permitir descobrir
   * quais matrículas existem na empresa. Só que essa mesma frase cobre pelo
   * menos cinco causas diferentes — API recusou, API fora, matrícula sem
   * perfil no Oracle, perfil em outra empresa, perfil sem nível no portal — e
   * sem registro nenhum não há como saber qual delas aconteceu.
   *
   * **A senha não entra aqui em nenhuma hipótese**, nem o corpo da resposta da
   * API. O que se registra é: quem tentou, contra qual filial, o que cada
   * passo respondeu.
   */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly log?: FastifyBaseLogger,
  ) {}

  /** Uma linha por passo, sempre com a mesma etiqueta, para achar no log. */
  private passo(etapa: string, dados: Record<string, unknown>) {
    this.log?.info({ login: 'diario', etapa, ...dados }, `login: ${etapa}`)
  }

  async autenticar({ login, senha }: { login: string; senha: string }): Promise<Usuario | null> {
    const matricula = login.trim().toLowerCase()
    /*
     * A LOJA QUE VALIDA A SENHA NÃO VEM MAIS DA TELA — é fixa (env.ERP_AUTH_FILIAL,
     * NOR por padrão). O cluster do portal só alcança a API da NOR, e a API da
     * NOR valida credencial corporativa de todo mundo; o perfil (nível, escopo)
     * vem do Oracle pela matrícula, não da loja que validou. Então o seletor de
     * filial saiu do login em 23/09/2026. A `sigla` daqui pra baixo é essa loja
     * fixa: decide a URL da API e desempata perfil de quem tem em mais de uma
     * empresa — nada mais.
     */
    const sigla = env.ERP_AUTH_FILIAL

    /**
     * A PORTA LOCAL, antes de tudo — usuários de teste (§7.40).
     *
     * Só alcança quem tem `senha_hash`, e o caminho corporativo **nunca grava
     * esse campo**: o `upsert` lá embaixo não o toca. Então nenhuma pessoa real
     * passa por aqui, com a chave ligada ou desligada — a porta existe e não
     * tem fechadura que sirva para elas.
     *
     * A filial não entra: o usuário de teste não pertence a uma API de loja, e
     * exigir a escolha certa na tela só criaria um erro sem sentido.
     *
     * `AUTH_TESTE_LOCAL` é recusada em produção no boot, como o bypass.
     */
    this.passo('inicio', { matricula, filial: sigla, portaLocalLigada: env.AUTH_TESTE_LOCAL })

    if (env.AUTH_TESTE_LOCAL) {
      const teste = await this.prisma.usuario.findUnique({ where: { loginErp: matricula } })
      this.passo('porta-local', {
        matricula,
        achou: teste !== null,
        temSenhaLocal: Boolean(teste?.senhaHash),
        ativo: teste?.ativo ?? null,
        /* Sem senha local, cai para a API corporativa -- que e' o caminho de
           todo usuario real, e nao um erro. */
        usaEstaPorta: Boolean(teste?.senhaHash && teste.ativo),
      })
      if (teste?.senhaHash && teste.ativo) {
        const ok = await argon2.verify(teste.senhaHash, senha).catch(() => false)
        /*
         * Recusa em vez de cair para a API: quem tem senha local É de teste, e
         * tentar a corporativa depois faria uma senha errada aqui virar uma
         * tentativa de login lá -- com a matrícula de teste, que não existe, mas
         * ainda assim uma tentativa que o sistema da empresa registra.
         */
        this.passo('porta-local-resultado', { matricula, senhaConfere: ok })
        if (!ok) throw new NaoAutorizado('Login ou senha inválidos.')
        return teste
      }
    }

    /**
     * Cada filial tem a PRÓPRIA API de login — `login-api.example.CEN`,
     * `...NOR`, e assim por diante. É por isso que a tela pede a filial antes da
     * senha: ela não é parâmetro da requisição, decide para quem perguntar.
     *
     * Só as 9 lojas têm API. `99-CORPORATIVO` e `Rede` existem no cadastro para
     * outros usos e não atendem login — recusar aqui, com o nome do que foi
     * escolhido, evita um erro de rede sem explicação.
     */
    /**
     * **A guarda olhava o FORMATO da URL, e não se a filial tem API.**
     *
     * A intenção está escrita acima desde sempre: `99-CORPORATIVO` e `Rede` não
     * atendem login, e recusar aqui evita um erro de rede sem explicação. Só
     * que a checagem era do texto — "parece uma URL, sem `{}` sobrando" —, e
     * `https://login-api.example.99-CORPORATIVO` passa nela. O pedido seguia
     * para a rede e morria em `ENOTFOUND`, que sobe como **500 "erro não
     * tratado"**: a tela mostra falha do portal sobre uma escolha errada de
     * filial, e quem está logando não tem como saber que era só trocar o
     * seletor.
     *
     * Medido no log em 11/09/2026, numa tentativa real do analista:
     * `getaddrinfo ENOTFOUND login-api.example.99-corporativo` → 500.
     *
     * Agora a pergunta é a certa e vem do CADASTRO, que é quem sabe: só `tipo
     * = FILIAL` tem API. A regra não fica cravada em código — filial nova entra
     * por INSERT, como tudo mais aqui.
     */
    const alvo = env.ERP_AUTH_URL?.replace('{filial}', sigla) ?? ''
    const cadastro = await this.prisma.filial.findUnique({
      where: { sigla },
      select: { tipo: true, ativa: true },
    })
    this.passo('api-alvo', {
      matricula,
      filial: sigla,
      alvo,
      tipo: cadastro?.tipo ?? 'não cadastrada',
      atendeLogin: cadastro?.tipo === 'FILIAL',
    })
    if (!/^https?:\/\/[^{}]+$/.test(alvo) || cadastro?.tipo !== 'FILIAL') {
      throw new NaoAutorizado(
        `A filial "${sigla}" não tem API de login. Escolha uma das 9 lojas — ` +
          'quem é do corporativo entra pela loja, e o perfil continua sendo o seu.',
      )
    }

    /**
     * A falha de REDE precisa dizer o que houve, e contra quem.
     *
     * Sem este `catch`, um `fetch` que não completa sobe como `TypeError: fetch
     * failed` e vira 500 "erro não tratado": o log guarda a pilha do `undici` e
     * não guarda **qual filial** foi tentada — que é a única coisa que
     * distingue "a API daquela loja está fora" de "o portal está quebrado".
     *
     * Os três casos que aparecem, e nenhum é senha errada:
     *
     *  - **certificado**: a cadeia de `login-api.example.*` é assinada pela CA
     *    interna `acmelabs`. O navegador confia porque lê a loja de certificados
     *    do Windows; o Node só passou a ler com `--use-system-ca`, que os
     *    scripts `dev` e `start` agora ligam. Sem ele: *unable to verify the
     *    first certificate*;
     *  - **DNS**: a filial escolhida não tem host (`ENOTFOUND`);
     *  - **tempo**: 15 s sem resposta.
     */
    let resposta: Response
    try {
      resposta = await fetch(`${alvo}/api/LoginUsuario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: matricula, password: senha }),
        // Sem teto, um login travado prende a requisição do usuário até o
        // timeout do navegador, sem nada no log dizendo onde parou.
        signal: AbortSignal.timeout(15_000),
      })
    } catch (e) {
      // A causa do `undici` é onde mora o motivo real; a mensagem de fora é
      // sempre "fetch failed", que não diz nada a ninguém.
      const causa = (e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message
      throw new Error(
        `Não foi possível falar com a API de login da filial ${sigla} (${alvo}): ${causa}. ` +
          'Não é credencial inválida.',
        { cause: e },
      )
    }

    /**
     * 401, 403 e 409 são recusas legítimas e viram `null`, que a rota traduz em
     * "Matrícula ou senha inválidas" — mensagem única de propósito, para não
     * permitir enumerar matrículas da empresa.
     *
     * Qualquer outro status é falha da API, não credencial errada, e sobe como
     * erro: responder "senha inválida" quando o serviço está fora manda a
     * pessoa trocar uma senha que está certa.
     */
    this.passo('api-respondeu', { matricula, filial: sigla, status: resposta.status })

    if (!resposta.ok) {
      if ([401, 403, 409].includes(resposta.status)) {
        /*
         * A API RECUSOU a credencial -- e e' bom saber que foi ELA, e nao o
         * portal. Do lado de fora as duas coisas sao a mesma frase.
         *
         * **O CORPO DA RECUSA vai junto**, cortado em 300 caracteres. É a
         * única coisa que separa *"esse login não existe nesta loja"* de
         * *"senha inválida"*, e a diferença decide o que fazer: a primeira se
         * resolve trocando a filial ou pedindo provisionamento; a segunda, não.
         * Sem isso, as duas causas chegam aqui como o mesmo `401` e cada
         * tentativa de descobrir qual é custa mais um erro de senha na conta
         * de alguém.
         *
         * Só na RECUSA. No sucesso o corpo traz nome, iniciais e foto — dado
         * pessoal que não tem por que morar no log.
         */
        const motivo = await resposta
          .text()
          .then((t) => t.slice(0, 300))
          .catch(() => '(sem corpo)')
        this.passo('api-recusou-credencial', {
          matricula,
          filial: sigla,
          status: resposta.status,
          respostaDaApi: motivo,
          nota: 'a recusa veio da API da filial, nao do portal',
        })
        return null
      }
      throw new Error(
        `API de login respondeu ${String(resposta.status)}. Não é credencial inválida: ` +
          'é falha do serviço de autenticação.',
      )
    }

    const dados = (await resposta.json()) as RespostaLogin

    /*
     * Sem matricula nao ha login, e falhar AQUI e' o ponto.
     *
     * A matricula alimenta a consulta do perfil no Oracle, umas linhas abaixo.
     * Com `null` aquela consulta volta vazia e o portal responde *"perfil nao
     * encontrado"* -- que manda procurar cadastro de perfil quando o problema
     * e' a resposta da API de login vindo sem o campo. Uma tarde perdida no
     * lugar errado.
     *
     * Nao e' credencial invalida (a senha foi aceita: a resposta veio 2xx),
     * entao nao pode devolver `null` como se fosse -- e' falha de servico.
     */
    if (dados.employeeId === null) {
      throw new Error(
        'A API de login aceitou a credencial e respondeu sem `employeeId`. ' +
          'Sem matrícula não há como achar o perfil — é falha do serviço de ' +
          'autenticação, e não credencial inválida.',
      )
    }
    const matriculaDaApi = dados.employeeId

    const registro = await this.prisma.filial.findUnique({ where: { sigla } })
    if (!registro) throw new NaoAutorizado(`Filial "${sigla}" não cadastrada no portal.`)

    /*
     * A linha que a pessoa já tem no portal, se tiver.
     *
     * Serve a UMA coisa: preservar o `cargo` quando nem a API nem o cadastro
     * corporativo o trazem naquele login (ver a cadeia de `cargo` mais abaixo).
     * O `id_perfil` NÃO vem daqui — vem do Oracle, logo adiante.
     *
     * Havia um `PENDENTE` neste lugar dizendo que `SQL_USUARIO` estava quebrada
     * (`ORA-00904`, `cod_empresa` inexistente em `hr_usuario_filiais`) e que o
     * login não conseguia resolver o perfil. **Estava obsoleto**: a consulta foi
     * migrada para `hr_vw_colaboradores`, e o comentário dela já registra
     * exatamente essa medição. O login resolve o perfil desde então.
     *
     * Removido em 31/08/2026, e não por limpeza: uma pendência resolvida que
     * continua escrita faz alguém re-resolver o problema, ou desconfiar de
     * código que funciona.
     */
    const cadastrado = await this.prisma.usuario.findUnique({ where: { loginErp: matricula } })

    /**
     * O `id_perfil` vem do Oracle, pela MATRÍCULA que a API devolve.
     *
     * A API valida a credencial e diz quem é a pessoa, mas não traz o perfil —
     * e é o perfil que decide nível e quais variáveis ela vê. O caminho é:
     * login na API, matrícula (`employeeId`) na resposta, e a matrícula somada à
     * empresa da filial escolhida dá o `id_perfil` no cadastro corporativo.
     */
    /**
     * O `id_perfil` vem do Oracle, pela MATRÍCULA que a API devolve.
     *
     * A API valida a credencial e diz quem é a pessoa; o perfil, que decide
     * nível e variáveis visíveis, está no cadastro corporativo.
     *
     * A busca é pela matrícula SOZINHA. A filial escolhida na tela decide qual
     * API valida a senha, **não onde a pessoa trabalha**: quem é do corporativo
     * (empresa 99) entra pela API de uma loja, e filtrar por ela não acharia
     * perfil nenhum. Foi exatamente o que aconteceu na primeira versão.
     */
    const { linhas } = await consultar<PerfilOracle>(SQL_USUARIO, {
      matricula: matriculaDaApi,
    })

    this.passo('oracle-perfil', {
      matricula,
      matriculaDaApi,
      linhas: linhas.length,
      perfis: linhas.map((l) => ({ idPerfil: l.ID_PERFIL, empresa: l.COD_EMPRESA, cargo: l.CARGO })),
    })

    if (linhas.length === 0) {
      throw new NaoAutorizado(
        'Sua matrícula não tem perfil ativo no cadastro corporativo. ' +
          'Fale com o RH se você acabou de mudar de cargo ou de setor.',
      )
    }

    /**
     * Mais de um perfil: a filial escolhida desempata.
     *
     * Medido: 5.185 das 5.186 pessoas têm perfil numa empresa só. A única
     * exceção não justifica pedir escolha a todo mundo — mas justifica não
     * chutar. Sem desempate possível, recusa dizendo onde há perfil.
     */
    const perfil =
      linhas.length === 1
        ? linhas[0]!
        : linhas.find((l) => Number(l.COD_EMPRESA) === registro.codigo)
    if (!perfil) {
      /*
       * Só cai aqui quem tem perfil em MAIS DE UMA empresa e nenhuma é a `sigla`
       * fixa da autenticação (NOR) — 1 pessoa em ~5,2 mil. O login não pede mais
       * a filial, então não dá pra mandar "escolha a correta"; é atendimento.
       */
      const onde = linhas.map((l) => String(l.COD_EMPRESA)).join(', ')
      throw new NaoAutorizado(
        `Sua matrícula tem perfil em mais de uma empresa (${onde}), e o portal não ` +
          'consegue decidir qual usar automaticamente. Fale com o suporte do Portal GD.',
      )
    }

    /**
     * `TRIM` porque o `nomloc` vem com espaço à direita em parte das linhas.
     *
     * Sem ele, o valor gravado aqui não casa com o que a tela de administração
     * gravou em `perfil_variavel`, e a pessoa não vê variável nenhuma — sem
     * erro nenhum aparecer. Está medido em `admin/perfis-oracle.ts`.
     */
    const nomloc = perfil.LOCAL?.trim() || null

    const idPerfil = Number(perfil.ID_PERFIL)
    if (!Number.isInteger(idPerfil)) {
      throw new Error(`id_perfil inesperado para ${matricula}: ${String(perfil.ID_PERFIL)}`)
    }

    /**
     * A filial gravada é a do PERFIL, não a escolhida no login.
     *
     * Gravar a escolhida poria "NOR" em quem é do corporativo só porque foi por
     * ali que a senha passou — e a filial do usuário decide o escopo de dados
     * que ele enxerga. Empresa que não é filial do GD (99, CDs) fica nula.
     */
    const filialDoPerfil = await this.prisma.filial.findUnique({
      where: { codigo: Number(perfil.COD_EMPRESA) },
    })

    /*
     * A descrição da classificação, para completar o cargo quando o RH não o
     * traz. Uma linha por `id_perfil` desde 28/08 -- a lotação saiu da chave,
     * ver PLANO §7.20.
     */
    const descricaoDoPerfil =
      (await this.prisma.perfilNivel.findUnique({ where: { idPerfil } }))?.descricao ?? null
    const roleUtil = dados.role.trim() && dados.role.trim().toUpperCase() !== 'UNKNOWN'
    const cargo =
      perfil.CARGO?.trim() ?? descricaoDoPerfil ?? cadastrado?.cargo ?? (roleUtil ? dados.role.trim() : null)

    /**
     * `admin` e `ativo` ficam de FORA do update, de propósito.
     *
     * São decisões do portal, não do sistema corporativo. Sobrescrevê-las aqui
     * faria um login bem-sucedido reativar quem foi desativado, e um `create`
     * com `admin: false` rebaixaria o administrador no primeiro login dele.
     */
    /**
     * ADOTA a linha que a carga deixou pronta, antes de fazer o upsert.
     *
     * A carga de usuários cria a pessoa com um `login_erp` provisório
     * (`carga:10001`), porque a view do RH não tem coluna de login (§7.33). Se
     * o upsert abaixo procurasse só pelo `login_erp` real, ele não acharia
     * nada e criaria uma SEGUNDA linha para a mesma pessoa — e a ação que foi
     * escalada para a linha da carga sumiria do quadro de quem acabou de
     * entrar.
     *
     * Casa pela MATRÍCULA, que é a única identidade que as duas pontas
     * compartilham. `origemCarga` volta a false: a partir daqui a pessoa tem
     * estado próprio, e a carga não mexe mais no `ativo` dela.
     *
     * Vale para QUALQUER divergência de login, não só para a linha da carga: a
     * matrícula é única desde 31/08, e alguém cujo `login_erp` mudou na origem
     * criaria uma segunda linha e esbarraria na unicidade. Reapontar o login da
     * linha existente é o que mantém uma pessoa, uma linha.
     */
    {
      /*
       * O bloco continua delimitado, e o `if (employeeId !== null)` que o
       * abria saiu: a guarda subiu para logo depois do parse da resposta, onde
       * falha com mensagem propria. Aqui ela era a segunda copia da mesma
       * pergunta -- e a que chegava tarde, depois de a consulta ao Oracle ja
       * ter sido feita com a matricula ausente.
       */
      const mesmaPessoa = await this.prisma.usuario.findUnique({
        where: { matricula: matriculaDaApi },
        select: { id: true, loginErp: true },
      })
      if (mesmaPessoa && mesmaPessoa.loginErp !== matricula) {
        await this.prisma.usuario.update({
          where: { id: mesmaPessoa.id },
          data: { loginErp: matricula, origemCarga: false },
        })
      }
    }

    return this.prisma.usuario.upsert({
      where: { loginErp: matricula },
      update: {
        nome: dados.name,
        iniciais: dados.initials.slice(0, 3),
        ...(cargo === null ? {} : { cargo }),
        foto: dados.photo,
        idPerfil,
        nomloc,
        // `employeeId` e' o numcad. Guardado porque `login_erp` NAO e' a
        // matricula: um e' `u10001abc`, o outro e' `10001`. E' pela matricula
        // que `MatriculaNivel` da' nivel proprio a uma pessoa.
        matricula: matriculaDaApi,
        filialId: filialDoPerfil?.id ?? null,
      },
      create: {
        loginErp: matricula,
        matricula: matriculaDaApi,
        nome: dados.name,
        iniciais: dados.initials.slice(0, 3),
        cargo: cargo ?? 'Não informado',
        foto: dados.photo,
        idPerfil,
        nomloc,
        filialId: filialDoPerfil?.id ?? null,
        // Resolvido a cada requisição a partir de `idPerfil`; este é só o valor
        // inicial. Ver modules/auth/nivel.ts.
        nivel: 'N4',
      },
    })
  }
}

export function criarAuthProvider(prisma: PrismaClient, log?: FastifyBaseLogger): AuthProvider {
  return env.AUTH_PROVIDER === 'erp' ? new ErpAuthProvider(prisma, log) : new MockAuthProvider(prisma)
}

import { z } from 'zod'

/**
 * Valida process.env no boot. Se faltar ou estiver malformado, o processo morre
 * aqui com uma mensagem clara — em vez de subir e falhar em produção na primeira
 * requisição que precisar da variável.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Fuso de todo cálculo de período. O banco guarda UTC. */
  TZ_APP: z.string().default('America/Recife'),

  DATABASE_URL: z.string().url(),

  AUTH_PROVIDER: z.enum(['mock', 'erp']).default('mock'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de ao menos 32 caracteres'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DIAS: z.coerce.number().int().positive().default(7),
  /**
   * O cookie de sessão só viaja em HTTPS.
   *
   * **NÃO É `z.coerce.boolean()`**, e a diferença não é estilo. `coerce` lê se
   * a string é VAZIA, não a palavra: medido, `"false"` vira `true`, `"0"` vira
   * `true`, e só a AUSÊNCIA da variável produz `false`. Ou seja, o único jeito
   * de desligar a marca era esquecer de configurá-la — que é exatamente o que o
   * chart fazia, porque a variável não estava lá.
   *
   * A leitura explícita é a mesma de `AUTH_DEV_BYPASS`, e pelo mesmo motivo:
   * uma flag de segurança não pode depender de coerção.
   */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SEED_SENHA_PADRAO: z.string().default('portalgd'),

  /**
   * MOLDE de URL, não URL fixa: há uma API de login POR FILIAL
   * (`https://login-api.example.CEN`, `...NOR`, ...), e a filial escolhida na
   * tela decide qual responde. Por isso a validação é de string com
   * `{filial}`, e não `.url()` — o molde não é URL válida enquanto o
   * marcador não for substituído.
   */
  ERP_AUTH_URL: z
    .string()
    .refine((v) => v === '' || v.includes('{filial}'), {
      message: 'ERP_AUTH_URL precisa conter {filial} — há uma API de login por filial.',
    })
    .optional()
    .or(z.literal('')),
  /**
   * A SIGLA da loja cuja API valida TODOS os logins.
   *
   * Há uma API de login por loja (`login-api.example.<SIGLA>`), mas o cluster
   * do portal roda no ambiente da NOR e só alcança a API da NOR — as das outras
   * lojas não têm rota de dentro do cluster (medido em 22/09/2026: login por CEN
   * e LES dava 500 no `fetch`, por NOR dava 401; ou seja, só a NOR responde).
   *
   * E a API da NOR valida credencial corporativa de QUALQUER pessoa — o perfil
   * (nível, escopo de dados) vem do Oracle pela matrícula, não da loja que
   * validou a senha. Então todo mundo entra pela NOR sem ver dado de outra loja.
   *
   * Por isso o login deixou de pedir a filial na tela e passou a fixar aqui.
   * Continua CONFIGURÁVEL para não cravar a topologia em código: se um dia o
   * cluster alcançar as outras APIs, é trocar esta variável, não recompilar.
   */
  ERP_AUTH_FILIAL: z.string().trim().min(1).default('NOR'),
  ERP_AUTH_TOKEN: z.string().optional(),

  /**
   * Oracle — leitura direta, sem passar pelo n8n.
   *
   * A senha vem do ambiente (secret do Kubernetes em produção, `<app>-creds` do
   * DevOps), nunca de arquivo no repositório. Ver
   * `credenciais-seguras.md` da estação 2 da esteira.
   *
   * Opcionais no schema e exigidas condicionalmente logo abaixo: com
   * `AUTH_PROVIDER=mock` o portal não toca no Oracle, e obrigar a credencial
   * impediria desenvolver sem acesso ao banco.
   */
  ORACLE_USER: z.string().optional(),
  ORACLE_PASSWORD: z.string().optional(),
  /** Ex.: `10.0.0.10:1521/orclpdb1`. */
  ORACLE_CONNECT_STRING: z.string().optional(),
  /**
   * Teto de linhas por consulta. NUNCA corta em silêncio: quem consulta compara
   * o total recebido com este número e avisa que veio truncado — número parcial
   * exibido como se fosse o total engana.
   */
  /**
   * Amplia a retenção do detalhe, e SÓ PARA CIMA.
   *
   * Existe para o backfill: carregar doze meses e consolidar o resumo exige que
   * o expurgo não apague o bloco antigo entre a gravação e a consolidação --
   * elas acontecem na mesma carga, nessa ordem.
   *
   * O clamp em `limiteDoDetalhe` é a parte que importa: um valor menor que 60
   * aqui é IGNORADO. Uma variável de ambiente que pudesse ENCURTAR a retenção
   * seria um jeito de apagar histórico por engano de digitação em produção, e
   * ninguém descobriria até precisar do dado.
   */
  RETENCAO_DIAS_DETALHE: z.coerce.number().int().positive().default(60),
  ORACLE_MAX_ROWS: z.coerce.number().int().positive().default(50_000),
  /**
   * Timeout por consulta, em segundos — o padrão, usado pelo caminho da API.
   *
   * Serve ao login, que resolve o nível por uma consulta de 15 ms. Curto de
   * propósito: aqui quem espera é uma requisição HTTP, e falhar rápido com 500 é
   * melhor que pendurar a página.
   */
  ORACLE_TIMEOUT_S: z.coerce.number().int().positive().default(60),
  /**
   * Timeout das consultas de INDICADOR (carga de fatos), em segundos.
   *
   * Vinte minutos, por decisão do analista. A consulta de Perdas leva 60 a 104
   * segundos para um mês — já estourou o teto de 60 numa medição — e o
   * dimensionamento é da ordem de minutos, não de segundos. Estas consultas
   * rodam por script ou por agendamento, sem ninguém esperando na tela.
   *
   * É variável SEPARADA e não um aumento do padrão: subir o teto do login para
   * 20 minutos deixaria a autenticação pendurada nesse tempo quando o Oracle
   * travasse, em vez de recusar.
   */
  ORACLE_TIMEOUT_CARGA_S: z.coerce.number().int().positive().default(1200),
  /**
   * Espera por conexão livre no pool, em segundos.
   *
   * NÃO acompanha nenhum dos dois acima: quem espera na fila ainda não começou
   * consulta nenhuma, e uma carga de 20 minutos ocupando o pool não é razão para
   * um login esperar 20 minutos por vaga.
   */
  ORACLE_FILA_TIMEOUT_S: z.coerce.number().int().positive().default(30),
  /** Teto do pool. `poolMin` é 0 fixo: o portal sobe com o banco fora. */
  ORACLE_POOL_MAX: z.coerce.number().int().positive().default(4),

  /**
   * Sessão automática em desenvolvimento: as requisições sem cookie são
   * atendidas como AUTH_DEV_USUARIO, para não precisar logar a cada teste.
   * Nunca é honrado em produção — ver a checagem logo abaixo.
   */
  AUTH_DEV_BYPASS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  AUTH_DEV_USUARIO: z.string().default('f00001mle'),
  /**
   * A PORTA LOCAL: usuários de teste entram por senha, sem a API corporativa.
   *
   * Existe para exercitar as três telas com N2, N3 e N4 de verdade -- pessoas
   * de teste não têm credencial no sistema da empresa, e criar uma lá para
   * testar tela seria pior do que esta porta.
   *
   * **Ela só alcança quem tem `senha_hash`**, e o login corporativo nunca
   * grava esse campo: o `upsert` do `ErpAuthProvider` não o toca. Então nenhuma
   * pessoa real pode entrar por aqui, ligada ou desligada.
   *
   * Nunca é honrada em produção — ver a checagem logo abaixo, a mesma do
   * bypass. A diferença entre as duas: o bypass dispensa a autenticação
   * inteira, esta ainda exige senha certa.
   */
  AUTH_TESTE_LOCAL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  INGEST_TOKEN: z.string().min(32, 'INGEST_TOKEN precisa de ao menos 32 caracteres'),
  INGEST_IPS_PERMITIDOS: z.string().default(''),

  /**
   * Os gatilhos do Power Automate que executam a consulta no Power BI.
   *
   * Opcionais no schema porque desenvolver sem eles é normal -- quem mexe em
   * contramedida não precisa de Vendas nem de NPS. Em PRODUÇÃO viram
   * obrigatórios, na checagem abaixo.
   *
   * ENTRARAM AQUI EM 15/09/2026, e a ausência tinha consequência: o portal
   * AGENDA Vendas e NPS sozinho (`FONTES_AGENDADAS`) e lê estas variáveis por
   * `process.env[fonte.endpointEnv]`, fora do schema. O boot passava com o
   * secret completo e a carga quebrava de madrugada, quando o agendamento
   * disparava -- longe de quem tinha acabado de subir.
   *
   * SÃO SEGREDO: a URL carrega assinatura, e quem a tiver executa consulta
   * arbitrária no Power BI da empresa. Vão no secret, nunca no `values.yaml`.
   */
  POWER_AUTOMATE_VENDAS: z.string().optional(),
  POWER_AUTOMATE_NPS: z.string().optional(),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
})

/**
 * As variáveis de gatilho do Power Automate, uma por dataset.
 *
 * ESCRITA À MÃO, e não derivada de `fontes.mjs`, de propósito: aquele módulo lê
 * os arquivos `.sql` do disco ao ser importado, e o `env.ts` é carregado antes
 * de tudo. Trocar uma checagem de configuração por I/O de arquivo no boot é
 * pior do que a lista repetida.
 *
 * O que impede a lista de envelhecer é `tests/unit/env-power-automate.test.ts`:
 * ele compara esta constante com os `endpointEnv` declarados em `fontes.mjs` e
 * falha se uma fonte nova entrar sem passar por aqui.
 */
export const ENVS_POWER_AUTOMATE = ['POWER_AUTOMATE_VENDAS', 'POWER_AUTOMATE_NPS'] as const

/**
 * Função pura para que a validação seja testável sem truque de recarregar
 * módulo — a versão anterior validava no topo do arquivo e só dava para
 * exercitar reimportando com cache-buster, que o Vite nem suporta.
 */
export function validarEnv(bruto: NodeJS.ProcessEnv) {
  const parsed = schema.safeParse(bruto)

  if (!parsed.success) {
    const detalhes = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(
      `Variáveis de ambiente inválidas:\n${detalhes}\n\nCopie .env.example para .env e preencha.`,
    )
  }

  /**
   * O bypass de autenticação é a única configuração deste projeto capaz de
   * abrir a aplicação inteira para qualquer um. Por isso a checagem **derruba
   * o boot** em vez de apenas ignorar a variável.
   *
   * Ignorar silenciosamente pareceria mais tolerante, mas esconderia um deploy
   * mal configurado: ninguém descobriria que o `.env` de produção veio com a
   * flag do ambiente de dev. Falhar aqui torna o erro impossível de não notar,
   * e o custo é um deploy que não sobe — exatamente o resultado desejado.
   */
  if (parsed.data.NODE_ENV === 'production' && parsed.data.AUTH_TESTE_LOCAL) {
    throw new Error(
      'AUTH_TESTE_LOCAL está ligado com NODE_ENV=production.\n' +
        'Ela permite entrar por senha local, sem passar pela autenticação da empresa.\n' +
        'Remova AUTH_TESTE_LOCAL do ambiente de produção.',
    )
  }

  if (parsed.data.NODE_ENV === 'production' && parsed.data.AUTH_DEV_BYPASS) {
    throw new Error(
      'AUTH_DEV_BYPASS está ligado com NODE_ENV=production.\n' +
        'Essa combinação daria acesso irrestrito à aplicação sem autenticação.\n' +
        'Remova AUTH_DEV_BYPASS do ambiente de produção.',
    )
  }

  /**
   * Com `AUTH_PROVIDER=erp` o login **precisa** do Oracle: a API da ERP valida a
   * credencial mas não devolve perfil, e sem perfil não há nível. Faltando a
   * conexão, todo login falharia — então o boot morre aqui, e não na primeira
   * pessoa que tentar entrar.
   *
   * Com `mock` nada disso é exigido: dá para desenvolver sem acesso ao banco.
   */
  /**
   * Em produção o CORS não pode ser curinga nem localhost.
   *
   * `*` com `credentials: true` é recusado pelos navegadores, então não abriria a
   * API — mas quebraria o portal inteiro sem dizer por quê, e alguém tentaria
   * "consertar" tirando o `credentials`, que é o que guarda a sessão em cookie
   * httpOnly. E `localhost` é o padrão de desenvolvimento: subir com ele
   * bloquearia o frontend de verdade, com sintoma de "a tela não carrega nada".
   *
   * As duas falham no BOOT, e não na primeira requisição do navegador — onde o
   * erro apareceria como problema de rede na aba do console de outra pessoa.
   */
  /**
   * Em produção o cookie de sessão PRECISA da marca `Secure`.
   *
   * Derruba o boot em vez de avisar, como as outras três travas — e aqui o
   * argumento é mais forte, porque a falha não dá sintoma nenhum: sem `Secure`
   * o portal funciona igual, e o cookie de acesso mais o de renovação de 7 dias
   * passam a trafegar em claro em qualquer requisição `http://` para o mesmo
   * host. Ninguém descobre olhando a tela.
   *
   * Achado da estação 5 em 12/09/2026: a variável não estava no `values.yaml`,
   * então produção caía no padrão `false`.
   */
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error(
      'COOKIE_SECURE não está ligado com NODE_ENV=production.\n' +
        'Sem ele o cookie de sessão e o de renovação trafegam sem a marca Secure, ' +
        'e vão em texto claro em qualquer requisição http:// para o mesmo host.\n' +
        'Defina COOKIE_SECURE=true no ambiente de produção.',
    )
  }

  /**
   * Em produção os gatilhos do Power Automate são obrigatórios.
   *
   * O portal agenda Vendas e NPS sozinho e chama estes endereços direto. Sem
   * eles o processo sobe inteiro, as sondas respondem, e a falha só aparece
   * quando o agendamento dispara -- de madrugada, com "POWER_AUTOMATE_VENDAS
   * ausente no ambiente" num log que ninguém está lendo. Os dois indicadores
   * param de atualizar e o sintoma é "o gráfico está velho", dias depois.
   *
   * Aqui é o mesmo desenho das outras travas: morre na partida, com o nome da
   * variável, enquanto quem subiu ainda está olhando.
   *
   * Fora de produção não exige: desenvolver sem acesso ao Power BI é normal, e
   * quem precisar de Vendas ou NPS descobre na hora de carregar, com a
   * mensagem de `endpointDa`.
   */
  if (parsed.data.NODE_ENV === 'production') {
    const faltando = ENVS_POWER_AUTOMATE.filter((nome) => {
      const v = parsed.data[nome]
      return v === undefined || v.trim() === ''
    })
    if (faltando.length > 0) {
      throw new Error(
        [
          `Faltando em produção: ${faltando.join(', ')}.`,
          'São os gatilhos do Power Automate que executam a consulta no Power BI — o portal',
          'agenda Vendas e NPS sozinho e chama estes endereços direto.',
          'Sem eles o portal sobe e as duas cargas falham no horário agendado.',
          'A credencial vem do secret do Kubernetes; local, do .env (que o Git ignora).',
        ].join('\n'),
      )
    }
  }

  if (parsed.data.NODE_ENV === 'production') {
    const origem = parsed.data.CORS_ORIGIN
    if (origem.trim() === '*') {
      throw new Error(
        'CORS_ORIGIN="*" com NODE_ENV=production.\n' +
          'Curinga é incompatível com credentials: true — o navegador recusa a resposta e o ' +
          'portal para de funcionar inteiro.\n' +
          'Use a origem exata do frontend, ex.: https://portal-gd.example.com',
      )
    }
    if (/localhost|127\.0\.0\.1/.test(origem)) {
      throw new Error(
        `CORS_ORIGIN="${origem}" com NODE_ENV=production.\n` +
          'Esse é o valor de desenvolvimento: o frontend real seria bloqueado, com sintoma de ' +
          '"a tela não carrega".\n' +
          'Use a origem exata do frontend deste ambiente.',
      )
    }
  }

  if (parsed.data.AUTH_PROVIDER === 'erp') {
    const faltando = (['ORACLE_USER', 'ORACLE_PASSWORD', 'ORACLE_CONNECT_STRING'] as const).filter(
      (k) => !parsed.data[k],
    )
    if (faltando.length > 0) {
      throw new Error(
        [
          `AUTH_PROVIDER=erp exige a conexão com o Oracle, e falta: ${faltando.join(', ')}.`,
          'O login resolve o nível do usuário por consulta no banco — sem ela, ninguém entra.',
          'Em produção a credencial vem do secret do Kubernetes; local, do .env (que o Git ignora).',
        ].join('\n'),
      )
    }
    if (!parsed.data.ERP_AUTH_URL) {
      throw new Error(
        'AUTH_PROVIDER=erp exige ERP_AUTH_URL — o molde do endpoint que valida a credencial, ' +
          'com {filial} no lugar da sigla. Ex.: https://login-api.{filial}.example.com',
      )
    }
  }

  return {
    ...parsed.data,
    ehProducao: parsed.data.NODE_ENV === 'production',
    ehTeste: parsed.data.NODE_ENV === 'test',
    ingestIpsPermitidos: parsed.data.INGEST_IPS_PERMITIDOS.split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
  } as const
}

export const env = validarEnv(process.env)

export type Env = typeof env

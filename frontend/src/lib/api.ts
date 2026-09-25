/**
 * Cliente HTTP do portal.
 *
 * `credentials: 'include'` em tudo: a sessão vive em cookie httpOnly, então o
 * JavaScript nunca vê o token — nem para enviá-lo. Isso é o que torna a sessão
 * imune a exfiltração por XSS.
 */

const BASE = '/api/v1'

export interface ErroApi {
  erro: string
  codigo: string
  requestId?: string
  detalhes?: unknown
}

/**
 * O servidor não respondeu — não é resposta de erro, é ausência de resposta.
 *
 * `fetch` lança `TypeError` quando não há conexão: backend parado, porta errada,
 * rede fora. Sem distinguir isso de uma resposta HTTP de erro, a tela de login
 * mostrava "Não foi possível entrar. Tente novamente." com o backend desligado —
 * indistinguível de senha errada. Já custou tempo real procurando credencial
 * quando o problema era o Postgres derrubado.
 */
export class SemConexao extends Error {
  readonly name = 'SemConexao'
  constructor(readonly causa: unknown) {
    super('Servidor indisponível.')
  }
}

export class FalhaApi extends Error {
  constructor(
    readonly status: number,
    readonly corpo: ErroApi,
  ) {
    super(corpo.erro)
    this.name = 'FalhaApi'
  }

  get naoAutenticado() {
    return this.status === 401
  }
}

/**
 * `HeadersInit` normalizado em objeto simples, para poder ser mesclado.
 *
 * Existe porque `HeadersInit` tem TRÊS formas — `Headers`, `string[][]` e
 * `Record<string, string>` — e espalhar as duas primeiras num objeto não
 * mescla nada: `{...new Headers()}` dá `{}`, e `{...[['a','b']]}` dá
 * `{ '0': ['a','b'] }`. Nenhum dos dois falha; os cabeçalhos simplesmente
 * não chegam.
 *
 * O `tests/api.test.ts` já tinha esta função para ler o que foi enviado. O
 * cliente, que é quem precisa dela para MONTAR, não tinha.
 */
function cabecalhosDe(h: HeadersInit | undefined): Record<string, string> {
  if (h === undefined) return {}
  if (h instanceof Headers) return Object.fromEntries(h.entries())
  if (Array.isArray(h)) return Object.fromEntries(h)
  return h
}

/** O corpo de erro que o servidor manda — reconhecido, não afirmado. */
function ehErroApi(v: unknown): v is ErroApi {
  return typeof v === 'object' && v !== null && typeof (v as { erro?: unknown }).erro === 'string'
}

/**
 * A RENOVAÇÃO DA SESSÃO — o portal deslogava sozinho aos 15 minutos.
 *
 * O servidor emite dois cookies: um de ACESSO que vale `ACCESS_TOKEN_TTL`
 * (15 minutos) e um de RENOVAÇÃO que vale 7 dias. O desenho é o cliente trocar
 * o segundo pelo primeiro quando ele vence — e o cliente **nunca trocava**. A
 * rota `/auth/refresh`, a rotação e o cookie de 7 dias existiam desde sempre,
 * sem ninguém chamar.
 *
 * O efeito, relatado pelo analista: *"com um tempo o usuário desloga sozinho,
 * tempo muito curto"*. Aos 15 minutos a primeira requisição voltava 401, o
 * `SessaoContext` lia isso como "não está logado" e a tela ia para o login --
 * no meio de uma reunião, com o formulário preenchido.
 *
 * **Uma tentativa só**, e é isso que evita o laço: se a renovação falhar, ou se
 * a requisição repetida voltar 401 de novo, o erro sobe e a tela manda para o
 * login -- que é o certo quando o cookie de 7 dias também venceu.
 *
 * **Uma renovação de cada vez.** Uma tela abre várias requisições juntas, e sem
 * isto todas as que levassem 401 chamariam `/auth/refresh` ao mesmo tempo. Como
 * a rotação INVALIDA o token usado, a primeira renovação derrubaria as outras --
 * e o resultado seria justamente o logout que esta função existe para evitar.
 * A promessa compartilhada faz as concorrentes esperarem a mesma renovação.
 */
let renovacaoEmCurso: Promise<boolean> | null = null

function renovarSessao(): Promise<boolean> {
  renovacaoEmCurso ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      renovacaoEmCurso = null
    })
  return renovacaoEmCurso
}

/*
 * As rotas de sessão NÃO tentam renovar.
 *
 * `/auth/login` responde 401 para senha errada, e renovar ali transformaria
 * "credencial inválida" numa ida ao `/refresh` que não tem o que fazer. E
 * `/auth/refresh` chamando a si mesmo seria o laço óbvio.
 */
const SEM_RENOVACAO = ['/auth/login', '/auth/refresh', '/auth/logout']

async function requisicao<T>(caminho: string, init?: RequestInit): Promise<T> {
  const resultado = await tentar<T>(caminho, init)
  if (!(resultado instanceof FalhaApi) || resultado.status !== 401) {
    if (resultado instanceof FalhaApi) throw resultado
    return resultado
  }
  if (SEM_RENOVACAO.some((r) => caminho.startsWith(r))) throw resultado

  const renovou = await renovarSessao()
  if (!renovou) throw resultado

  const segunda = await tentar<T>(caminho, init)
  if (segunda instanceof FalhaApi) throw segunda
  return segunda
}

/**
 * Uma tentativa. Devolve o erro da API em vez de lançá-lo, para quem chamou
 * poder decidir se renova e repete — falha de TRANSPORTE continua lançando,
 * porque aí não há sessão a renovar.
 */
async function tentar<T>(caminho: string, init?: RequestInit): Promise<T | FalhaApi> {
  let resposta: Response
  try {
    resposta = await fetch(`${BASE}${caminho}`, {
      /*
       * `...init` PRIMEIRO, e o que importa depois dele.
       *
       * Estava por último, e isso apagava as duas coisas que esta função
       * existe para garantir: um `init` com `headers` substituía o objeto
       * montado abaixo (levando o `Content-Type` embora), e um `init` com
       * `credentials` derrubaria o `include` -- que é o que faz o cookie de
       * sessão ser enviado.
       *
       * Nenhum chamador de hoje passa esses dois campos, então nada estava
       * quebrado. Mas a ordem dizia o contrário do que o código pretendia, e
       * o primeiro `requisicao(caminho, { headers })` teria descoberto isso
       * como "o portal deslogou sozinho".
       */
      ...init,
      credentials: 'include',
      /**
       * `Content-Type` só quando há corpo.
       *
       * Mandá-lo em requisição sem corpo faz o Fastify recusar com
       * `FST_ERR_CTP_EMPTY_JSON_BODY` — "Body cannot be empty when content-type
       * is set to 'application/json'". Quebrava TODO `DELETE` do cliente, e
       * passou despercebido porque os testes de DELETE foram por `curl`, que não
       * manda o header sozinho.
       */
      headers: {
        ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...cabecalhosDe(init?.headers),
      },
    })
  } catch (e) {
    // Só falha de TRANSPORTE cai aqui. Erro devolvido pelo servidor tem
    // resposta e segue o caminho normal, virando FalhaApi.
    throw new SemConexao(e)
  }

  if (resposta.status === 204) return undefined as T

  /*
   * `unknown`, e não o `any` que `.json()` devolve.
   *
   * Era `const corpo = await ...` — `any` —, e o `as ErroApi` abaixo afirmava
   * uma forma que ninguém tinha verificado. O `?? {...}` ao lado dele existia
   * justamente porque `corpo` PODE ser nulo (o `.catch` acima), mas o `as`
   * dizia ao compilador que não podia: o fallback era código morto aos olhos
   * do tipo, e vivo na execução.
   */
  const corpo: unknown = await resposta.json().catch(() => null)

  if (!resposta.ok) {
    return new FalhaApi(
      resposta.status,
      ehErroApi(corpo)
        ? corpo
        : { erro: 'Falha de comunicação com o servidor.', codigo: 'SEM_RESPOSTA' },
    )
  }

  return corpo as T
}

/**
 * Mensagem de erro para o usuário, distinguindo servidor fora de erro do servidor.
 *
 * Existe como função única porque a mesma confusão aparece nas três telas, e
 * "não foi possível carregar" com o backend desligado manda a pessoa procurar
 * defeito no lugar errado.
 */
export function mensagemDeErro(e: unknown, oQue: string): string {
  if (e instanceof SemConexao) {
    return `Servidor fora do ar — verifique se o backend está rodando.`
  }
  if (e instanceof FalhaApi) {
    if (e.status >= 500) return `O servidor falhou ao ${oQue}. Veja o log do backend.`
    return e.corpo.erro
  }
  return `Não foi possível ${oQue}.`
}

export const api = {
  get: <T>(caminho: string) => requisicao<T>(caminho),
  post: <T>(caminho: string, corpo?: unknown) =>
    requisicao<T>(caminho, {
      method: 'POST',
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    }),
  put: <T>(caminho: string, corpo?: unknown) =>
    requisicao<T>(caminho, {
      method: 'PUT',
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    }),
  delete: <T>(caminho: string) => requisicao<T>(caminho, { method: 'DELETE' }),
}

export interface UsuarioSessao {
  id: string
  login: string
  nome: string
  iniciais: string
  cargo: string
  // N1 e N5 saíram da hierarquia atendida em 24/08/2026. Espelha o schema da
  // resposta em backend/src/modules/auth/routes.ts.
  nivel: 'N2' | 'N3' | 'N4' | 'CROSS'
  filial: string | null
  bucket: string | null
  /** URL ou base64 da API de login. Nulo cai para as iniciais. */
  foto: string | null
  /**
   * Administrador do portal: vê a área de administração e escolhe a visão.
   *
   * Vem do servidor e **não é derivável do nível**: o administrador é N2, mas
   * nem todo N2 administra. Desenhar o menu por nível abriria a área para toda a
   * diretoria.
   */
  admin: boolean
  /**
   * O papel, quando o "sim ou não" acima não basta.
   *
   * `admin` é DERIVADO deste campo, e continua sendo o que as telas leem para
   * decidir se desenham o menu. Só a tela de acessos distingue os degraus:
   * `MASTER` concede e revoga o papel dos outros; `ADMIN` faz todo o resto.
   */
  papelAdmin: PapelAdmin
  /**
   * Falso em quem administra o portal sem participar da cadeia de ajuda.
   *
   * A tela usa para duas coisas: não oferecer "deixo comigo" ao abrir uma ação,
   * e explicar por que "a fazer" está sempre vazio — sem a frase, a pessoa
   * conclui que o portal quebrou.
   */
  recebeAcao: boolean
  /** true quando a sessão veio do bypass de desenvolvimento, não de um login. */
  sessaoDeDesenvolvimento: boolean
}

export type PapelAdmin = 'NENHUM' | 'ADMIN' | 'MASTER'

export interface AcessoDoPortal {
  matricula: number | null
  login: string
  nome: string
  cargo: string
  nivel: string
  papelAdmin: PapelAdmin
  recebeAcao: boolean
  ativo: boolean
  /** A conta de administração principal: nenhuma rota a altera. */
  ancora: boolean
}

/**
 * Monta o `src` da foto que vem da API de login.
 *
 * A API documenta o campo como "URL/base64", e o que ela manda de verdade é
 * base64 CRU — `iVBORw0KGgo...`, sem o prefixo `data:`. Um `<img>` com isso no
 * `src` não renderiza nada e não dá erro: a tag simplesmente fica vazia, e o
 * sintoma na tela é a foto "não aparecer".
 *
 * O tipo sai da assinatura do próprio conteúdo, e não de um palpite: `iVBORw0`
 * é PNG, `/9j/` é JPEG, `R0lGOD` é GIF. Errar o tipo no prefixo faz o navegador
 * recusar a imagem.
 */
export function fonteDaFoto(foto: string | null): string | null {
  if (!foto) return null
  const v = foto.trim()
  if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:')) return v

  const tipo = v.startsWith('iVBORw0')
    ? 'image/png'
    : v.startsWith('/9j/')
      ? 'image/jpeg'
      : v.startsWith('R0lGOD')
        ? 'image/gif'
        : null
  return tipo ? `data:${tipo};base64,${v}` : null
}

export const authApi = {
  me: () => api.get<UsuarioSessao>('/auth/me'),
  // `filial` é a sigla da loja escolhida; o servidor a traduz para o código que
  // a API de login central espera (o login de cada pessoa é por loja).
  login: (dados: { filial: string; login: string; senha: string }) =>
    api.post<UsuarioSessao>('/auth/login', dados),
  /*
   * `<undefined>`, e nao `<void>`: em 204 o `requisicao` devolve
   * `undefined as T`, e e' isso que chega a quem espera. `void` tambem
   * nao e' valido como argumento de tipo em chamada.
   */
  logout: () => api.post<undefined>('/auth/logout'),
}

/** Os três níveis que têm tela. Espelha NIVEIS_COM_ACESSO do backend. */
export type NivelComAcesso = 'N2' | 'N3' | 'N4'

/**
 * O recorte com que o servidor atendeu a requisição.
 *
 * Vem na resposta e **não é o que o seletor pediu**: quem decide é o servidor.
 * Uma tela que exibisse o nível a partir do próprio seletor mentiria no dia em
 * que a validação recusasse a escolha.
 */
export interface VisaoAplicada {
  nivel: NivelComAcesso
  filial: string | null
  /** Administrador vendo como outro nível — é o que liga a faixa de aviso. */
  simulada: boolean
}

export interface PerfilAdmin {
  idPerfil: number
  /**
   * Cargos que o perfil cobre, do mais numeroso ao menos.
   *
   * É lista porque `id_perfil` **não é cargo**: medido na view do RH, um cargo
   * aparece sob até 21 perfis e um perfil cobre até 8 cargos. 15% dos perfis têm
   * mais de um.
   */
  cargos: string[]
  /**
   * Lotações do perfil, da mais numerosa à menos.
   *
   * É o que **identifica** a linha quando o cargo repete: "GERENTE ADJUNTO" tem
   * quatro `id_perfil`, um por lotação (ATENDIMENTO E SERVICOS, OPERACIONAL,
   * VENDAS CONSTRUCAO, VENDAS NAO CONSTRUCAO). Sem ela na tabela são quatro
   * linhas idênticas e não há como saber qual classificar.
   */
  lotacoes: string[]
  pessoas: number
  locais: number
  /** Nulo = bloqueado no login. Inclui classificação inativa e nível sem tela. */
  nivel: NivelComAcesso | null
  descricao: string | null
  ativo: boolean
  /**
   * As variáveis de controle que este perfil acompanha — o que ele pode MARCAR.
   *
   * Só o N4 tem: o N3 lê a filial inteira e o N2 é corporativo, e nenhum dos
   * dois marca ponto de causa. Ver PLANO §7.20.
   */
  variaveis: string[]
}

export interface CatalogoPerfis {
  perfis: PerfilAdmin[]
  resumo: {
    total: number
    classificados: number
    bloqueados: number
    /** Pessoas que não entram hoje. É o número que dimensiona o trabalho. */
    pessoasBloqueadas: number
  }
}

export interface CatalogoVariaveis {
  indicadores: Array<{
    codigo: string
    nome: string
    variaveis: Array<{ id: string; nome: string; unidade: string }>
  }>
}

export interface VisoesDisponiveis {
  niveis: Array<{ nivel: NivelComAcesso; exigeFilial: boolean }>
  filiais: Array<{ sigla: string; nome: string }>
}

/** As fontes que o portal lê do Oracle. Vendas e NPS vêm do Power BI pelo n8n. */
/**
 * As fontes Oracle que o portal sabe carregar sozinho.
 *
 * Cresceu de duas para quatro em 01/09/2026. O espelho de `FONTES_SQL` no
 * backend -- se divergirem, a tela oferece o que a rota recusa.
 */
export type FonteSql =
  | 'perdas'
  | 'movimentacao'
  | 'vendas-linha'
  | 'vendedor-dia'
  | 'vendas'
  | 'nps'

export interface FonteCarga {
  fonte: FonteSql
  /**
   * Janela do agendamento, em dias. **Não é editável pela tela.**
   *
   * Não é preferência, é regra de negócio: Perdas usa 730 dias porque uma quebra
   * pendente vira aprovada meses depois e altera um dia já fechado; movimentação
   * usa 60 porque nota fiscal não se reclassifica assim.
   */
  janelaDias: number
  horario: string
  /** `false` quando alguém mudou o horário pela tela. */
  horarioPadrao: boolean
  /** Login de quem mudou por último; nulo se nunca mudou. */
  horarioPor: string | null
  /** Nulo quando o agendamento está desligado (Oracle não configurado). */
  proximo: string | null
  /**
   * Último dia com dado no portal — não a última carga bem-sucedida.
   *
   * São coisas diferentes: uma carga pode ter sucedido hoje e o portal ainda
   * estar dois dias atrás, se a origem não tinha o dia. Este é o número que
   * corresponde ao que o painel mostra.
   */
  ultimoDiaComDado: string | null
  /**
   * `false` = o portal só dispara à mão; quem agenda é o n8n.
   *
   * `vendas-linha` e `vendedor-dia` entraram no painel para disparo manual mas
   * continuam agendadas no n8n. Agendar dos dois lados carregaria a mesma
   * janela duas vezes por dia.
   */
  agendada: boolean
}

/**
 * As fontes de CADASTRO — retrato do Oracle, sem janela de datas.
 *
 * O SQL delas não recebe `de`/`ate`: uma consulta devolve o estado atual. Por
 * isso não têm horário nem janela, e o controle é um botão só.
 */
export type FonteCadastro =
  | 'vendedor-area'
  | 'area-supervisor'
  | 'vendedor-situacao'
  | 'dias-uteis'

export interface EstadoCadastro {
  fonte: FonteCadastro
  /**
   * Quando a carga rodou com sucesso pela última vez.
   *
   * Não é "último dia com dado" como nas fontes de janela: cadastro não tem
   * data de fato. O que responde "isto está atualizado?" é quando rodou.
   */
  ultimaCarga: string | null
}

export interface ExecucaoCarga {
  id: string
  fonte: string
  status: 'EM_ANDAMENTO' | 'SUCESSO' | 'ERRO'
  de: string
  ate: string
  iniciadoEm: string
  finalizadoEm: string | null
  gravadas: number
  removidas: number
  origem: string | null
  erro: string | null
}

export interface PainelCargas {
  emAndamento: boolean
  /**
   * QUAL carga está rodando, desde quando, em que janela — ou `null`.
   *
   * Existe porque a linha em `sync_execucao` só nasce depois que o Oracle
   * responde, e a consulta é o que leva minutos: durante ela o histórico está
   * vazio e a tela só sabia dizer "carga em andamento", sem o quê nem desde
   * quando. Medido em 10/09/2026: um disparo ficou 13 minutos invisível, e o
   * teto do Oracle é de 20.
   */
  cargaAtual: {
    fonte: string
    /** Nulo nas fontes de cadastro, que são retrato e não janela. */
    de: string | null
    ate: string | null
    desde: string
  } | null
  fontes: FonteCarga[]
  cadastro: EstadoCadastro[]
  execucoes: ExecucaoCarga[]
}

export interface CargaDisparada {
  fonte: FonteSql
  de: string
  ate: string
  blocos: number
  aviso: string | null
}

/** Uma pessoa com nível próprio. Ver `adminApi.matriculas`. */
export interface NivelDaMatricula {
  /** `numcad`, a matrícula. NÃO é o login: um é `u10001abc`, o outro é `10001`. */
  matricula: number
  /** Sempre `N2` hoje: a matrícula É o cadastro do N2. */
  nivel: 'N1' | 'N2' | 'N3' | 'N4' | 'N5' | 'CROSS'
  descricao: string
  ativo: boolean
}

export const adminApi = {
  perfis: () => api.get<CatalogoPerfis>('/admin/perfis'),
  cargas: () => api.get<PainelCargas>('/admin/cargas'),
  /**
   * Dispara e volta em 202 — não espera a carga terminar.
   *
   * Ela leva minutos; esperar morreria no timeout do proxy sem dizer se gravou.
   * O acompanhamento é pelo histórico.
   */
  dispararCarga: (dados: { fonte: FonteSql } & ({ dias: number } | { de: string; ate: string })) =>
    api.post<CargaDisparada>('/admin/cargas', dados),
  /** Retrato do cadastro, agora. Sem janela — ver `FonteCadastro`. */
  atualizarCadastro: (fonte: FonteCadastro) =>
    api.post<{ fonte: FonteCadastro }>('/admin/cargas/cadastro', { fonte }),
  /** Muda a hora da carga automática. Hora no fuso da aplicação, não em UTC. */
  salvarHorario: (fonte: FonteSql, horario: { hora: number; minuto: number }) =>
    api.put<{ fonte: FonteSql; horario: string; proximo: string | null }>(
      `/admin/cargas/${fonte}/horario`,
      horario,
    ),
  /**
   * Volta ao horário do código.
   *
   * Existe além de "digitar o valor padrão" porque as duas coisas não são
   * iguais: um override com o mesmo valor anularia uma mudança futura no código
   * sem ninguém entender por quê.
   */
  restaurarHorario: (fonte: FonteSql) =>
    api.delete<{ fonte: FonteSql; horario: string; proximo: string | null }>(
      `/admin/cargas/${fonte}/horario`,
    ),
  /**
   * Classifica o perfil e diz de quais variáveis ele responde, de uma vez.
   *
   * São as duas metades de uma decisão só ("este cargo é N4, e acompanha
   * isto"), e o servidor grava as duas na mesma transação. `variaveis` é
   * obrigatória no N4 e recusada nos outros níveis.
   */
  classificar: (
    idPerfil: number,
    dados: {
      nivel: NivelComAcesso
      /** Substitui o conjunto inteiro: o que não vier aqui sai. */
      variaveis: string[]
      descricao: string
      ativo?: boolean
    },
  ) =>
    api.put<{ idPerfil: number; nivel: NivelComAcesso; ativo: boolean }>(
      `/admin/perfis/${idPerfil}`,
      dados,
    ),
  desclassificar: (idPerfil: number) => api.delete<undefined>(`/admin/perfis/${idPerfil}`),
  variaveis: () => api.get<CatalogoVariaveis>('/admin/variaveis'),
  matriculas: () => api.get<{ matriculas: NivelDaMatricula[] }>('/admin/matriculas'),
  /**
   * Cadastra a pessoa como **N2** — e isso vence o nível do perfil dela.
   *
   * O nível não é parâmetro: a matrícula é o cadastro do N2. Perfil é cargo, e
   * cargo nem sempre diz o papel no GD — alguém com o `id_perfil` de gerente
   * geral pode responder como N2. Sem isto a saída seria reclassificar o perfil
   * inteiro, levando junto todo mundo com aquele cargo.
   */
  salvarMatricula: (matricula: number, dados: { descricao: string; ativo?: boolean }) =>
    api.put<NivelDaMatricula>(`/admin/matriculas/${matricula}`, dados),
  removerMatricula: (matricula: number) =>
    api.delete<undefined>(`/admin/matriculas/${matricula}`),
  visoes: () => api.get<VisoesDisponiveis>('/admin/visoes'),
}

// ─────────────────────────────────────────────────────────────────────────────
// Contramedidas
// ─────────────────────────────────────────────────────────────────────────────

export type NivelAcao = 'N2' | 'N3' | 'N4' | 'CROSS'

/**
 * STATUS é da AÇÃO: quatro valores, iguais para quem quer que abra a tela.
 *
 * "Escalada" não está aqui de propósito — ela descreve a relação de QUEM OLHA
 * com a ação, não o estado dela, e vive no filtro. Ver PLANO §7.5.
 *
 * Quem calcula é o servidor, em `politicas.statusDe`. A tela não recalcula: uma
 * segunda derivação envelheceria sozinha, e "atraso mascarado" é exatamente o
 * defeito que essa duplicação produziria de novo.
 */
export type StatusAcao =
  | 'EM_ANDAMENTO'
  | 'ATRASADA'
  /**
   * Devolvida a quem a passou, e ainda não retomada (§7.69).
   *
   * Vem ANTES de `ATRASADA` no servidor, e só lá: aqui não se recalcula status.
   */
  | 'REJEITADA'
  | 'AGUARDANDO_FEEDBACK'
  | 'CONCLUIDA'

export interface ResumoAcao {
  codigo: string
  /**
   * Quem abriu foi quem está olhando.
   *
   * Separa "aguardando feedback" de "aguardando o MEU feedback": sem isto, uma
   * ação concluída pelo N4 aparece em *A fazer* do N3, que não tem feedback a
   * dar nela.
   */
  criadoPorMim: boolean
  /**
   * A ação está NA MINHA MÃO — e não apenas no meu nível.
   *
   * É o que separa "a fazer" de "direcionada": `direcionar` troca o dono e
   * mantém o nível, e abrir ação para um par (§7.72) faz o mesmo. Sem isto a
   * lista supunha que ação no meu nível era minha.
   */
  souOResponsavel: boolean
  /**
   * Quem ABRIU, e não quem executa: o N2 abre para o N4, e o quadro do N4 ganha
   * um card que ele não criou. `criadoPorMim` responde outra pergunta.
   */
  abertaPor: { nome: string; nivel: NivelAcao }
  titulo: string
  nivelAtual: NivelAcao
  prioridade: 'ALTA' | 'MEDIA' | 'BAIXA'
  prazo: string
  criadoEm: string
  concluidaEm: string | null
  filial: string
  /** A COLUNA do quadro. `grupo` é o sobretítulo, e só o N4 o tem preenchido. */
  agrupamento: { nome: string; grupo: string | null }
  indicador: string | null
  responsavel: string
  status: StatusAcao
  sla: 'CRITICO' | 'RISCO' | 'OK'
  diasEmAberto: number
  /** Por onde passou, com o tempo em cada nível. Um passo = nunca escalada. */
  trilha: Array<{ nivel: NivelAcao; quem: string; dias: number }>
}

export interface MovimentacaoAcao {
  tipo:
    | 'ESCALACAO'
    | 'ATUALIZACAO'
    | 'DIRECIONAMENTO'
    | 'CONCLUSAO'
    | 'FEEDBACK'
    | 'REVISAO'
    | 'REJEICAO'
  criadoEm: string
  autor: string
  nivelOrigem: NivelAcao
  nivelDestino: NivelAcao
  motivo: string | null
  texto: string
  resultado: 'META_ATINGIDA' | 'MELHORA_PARCIAL' | 'SEM_EFEITO' | null
}

/** O que ESTE usuário pode fazer. Vem do servidor; a tela não recalcula. */
export interface PermissoesAcao {
  /** Prestar contas sem soltar a ação. Falso em ação concluída ou rejeitada. */
  podeAtualizar: boolean
  podeEscalar: boolean
  destinosDeEscalacao: NivelAcao[]
  podeDirecionar: boolean
  podeDarFeedback: boolean
  podeConcluir: boolean
  /** Estar com a ação E ter a quem devolver — as duas coisas. Ver `origemDaMao`. */
  podeRejeitar: boolean
}

export interface DetalheAcao {
  contramedida: ResumoAcao & {
    comentarioAbertura: string
    origem: string | null
    pdcRef: string | null
  }
  movimentacoes: MovimentacaoAcao[]
  permissoes: PermissoesAcao
}

export const acoesApi = {
  /**
   * `gerenciaId` traz as ações daquela gerência — o bloco "o que já está sendo
   * feito" da reunião do N3. Filtra pelas áreas de venda dela, que no N4 são os
   * agrupamentos.
   */
  lista: (params?: {
    filial?: string
    nivel?: NivelAcao
    codigo?: string
    gerenciaId?: string
    /** As ações de UMA variável de controle — ver §7.43. */
    variavelControleId?: string
  }) => {
    const q = new URLSearchParams()
    if (params?.filial) q.set('filial', params.filial)
    if (params?.nivel) q.set('nivel', params.nivel)
    if (params?.codigo) q.set('codigo', params.codigo)
    if (params?.gerenciaId) q.set('gerenciaId', params.gerenciaId)
    if (params?.variavelControleId) q.set('variavelControleId', params.variavelControleId)
    const s = q.toString()
    return api.get<{ contramedidas: ResumoAcao[] }>(`/contramedidas${s ? `?${s}` : ''}`)
  },
  detalhe: (codigo: string) => api.get<DetalheAcao>(`/contramedidas/${codigo}`),
  /** Presta contas sem soltar a ação. `novoPrazo` só o responsável atual. */
  atualizar: (codigo: string, dados: { texto: string; novoPrazo?: string }) =>
    api.post<null>(`/contramedidas/${codigo}/atualizacoes`, dados),
  /** A contramedida foi executada. Não registra resultado — isso é o feedback. */
  concluir: (codigo: string, dados: { texto: string }) =>
    api.post<null>(`/contramedidas/${codigo}/concluir`, dados),
  /** De quem abriu, depois de concluída, uma vez só. Texto livre. */
  feedback: (codigo: string, dados: { texto: string }) =>
    api.post<null>(`/contramedidas/${codigo}/feedback`, dados),
  /**
   * Devolve a ação a QUEM A PASSOU, com observação obrigatória.
   *
   * O destino não vem daqui: o servidor o descobre do último repasse
   * (`origemDaMao`). Mandá-lo pela tela deixaria o cliente escolher para quem
   * a ação volta, e a resposta certa está no histórico, não na interface.
   */
  rejeitar: (codigo: string, dados: { texto: string }) =>
    api.post<null>(`/contramedidas/${codigo}/rejeitar`, dados),
  /**
   * `responsavelDestinoId` é obrigatório quando o destino muda de nível — a
   * política recusa escalação sem dono novo, e o 422 vem do servidor. O tipo
   * o deixa opcional porque escalar para o mesmo nível (CROSS) não o exige.
   */
  escalar: (
    codigo: string,
    dados: { texto: string; destino: NivelAcao; responsavelDestinoId?: string; motivo?: string },
  ) => api.post<null>(`/contramedidas/${codigo}/escalar`, dados),
  direcionar: (codigo: string, dados: { texto: string; responsavelDestinoId: string }) =>
    api.post<null>(`/contramedidas/${codigo}/direcionar`, dados),

  /** Tudo o que o formulário de abrir ação precisa, numa chamada. */
  opcoes: () => api.get<OpcoesDeAbertura>('/contramedidas/opcoes'),

  /**
   * Os agrupamentos de um nível — as colunas do quadro.
   *
   * A LOJA NÃO ENTRA, em nível nenhum. Ela entrava enquanto o agrupamento do
   * N4 era a área de venda (73 na rede, cada loja com a sua grafia); desde
   * 29/08/2026 ele é a GERÊNCIA, que são três e valem para a rede toda. Ver
   * PLANO §7.28.
   */
  agrupamentos: (nivel: NivelAcao) =>
    api.get<{ agrupamentos: Agrupamento[] }>(`/contramedidas/agrupamentos?nivel=${nivel}`),

  /**
   * Quem pode receber a ação, num nível e numa filial.
   *
   * Separada de `opcoes` porque depende das duas escolhas — listar todas as
   * combinações traria gente que ninguém vai ver.
   */
  destinatarios: (nivel: NivelAcao, filial: string | null) => {
    const q = new URLSearchParams({ nivel })
    if (filial) q.set('filial', filial)
    return api.get<{ destinatarios: Destinatario[] }>(`/contramedidas/destinatarios?${q.toString()}`)
  },

  abrir: (dados: {
    titulo: string
    /** Obrigatório só no N4 — nos outros níveis é o elo opcional com o GD. */
    pontoCausaId?: string
    filial: string
    nivel: NivelAcao
    /**
     * Só quando se abre para o nível ABAIXO — no próprio nível a ação é sua,
     * exceto no N2, que é corporativo e escolhe entre pares.
     */
    responsavelId?: string
    /** Só em N4 e CROSS — em N2 e N3 o servidor deduz pelo GD da causa. */
    bucketId?: string
    /** `YYYY-MM-DD`. */
    prazo: string
    prioridade: Prioridade
    comentarioAbertura: string
    origem?: string
  }) => api.post<{ codigo: string }>('/contramedidas', dados),
}

export type Prioridade = 'ALTA' | 'MEDIA' | 'BAIXA'

export const ROTULO_PRIORIDADE: Record<Prioridade, string> = {
  ALTA: 'Alta',
  MEDIA: 'Média',
  BAIXA: 'Baixa',
}

export interface Agrupamento {
  id: string
  nome: string
  /**
   * Um nível acima, quando existe. Hoje é sempre nulo: era ele que guardava a
   * gerência enquanto o agrupamento do N4 era a área de venda, e agora o
   * agrupamento É a gerência.
   */
  grupo: string | null
}

export interface Destinatario {
  id: string
  nome: string
  cargo: string | null
  filial: string | null
}

export interface OpcoesDeAbertura {
  /** Os níveis em que ESTE usuário pode abrir. Vem da política do servidor. */
  niveis: Array<{
    nivel: NivelAcao
    /**
     * No CROSS a ação fica com quem abriu — não se indica ninguém.
     * No próprio nível também não, EXCETO no N2, que é corporativo.
     */
    exigeResponsavel: boolean
    /** N2 e CROSS: a ação nasce no corporativo, e a loja não se escolhe. */
    ehCorporativa: boolean
    /** Só no N4 marcar a causa é obrigatório; nos outros é elo opcional. */
    exigePontoCausa: boolean
    /** N4 e CROSS escolhem o agrupamento; N2 e N3 o recebem deduzido do GD. */
    exigeAgrupamento: boolean
  }>
  filiais: Array<{ sigla: string; nome: string }>
  /**
   * A linha do cadastro que representa o corporativo — o valor que o campo
   * Loja assume sozinho quando o destino é N2 ou CROSS. Vem do servidor para a
   * tela não cravar `'99-CORPORATIVO'` no código.
   */
  filialCorporativa: { sigla: string; nome: string } | null
  /**
   * A gerência de quem pede — o PADRÃO do campo, não um limite. O gerente abre
   * na dele e pode trocar: a loja é uma só, e o problema de uma área raramente
   * para na fronteira da gerência.
   */
  minhaGerencia: string | null
  prioridades: Prioridade[]
  /** A ação nasce de uma CAUSA — é o elo do ciclo do GD. */
  causas: Array<{ id: string; nome: string; variavel: string; indicador: string }>
}

/**
 * A COR de cada status — uma só, para as três telas que o mostram.
 *
 * Morava só no `CardAcao`, e a tela de detalhe desenhava o chip NEUTRO para
 * todos os cinco: na lista a ação rejeitada saía laranja e, ao clicar nela, o
 * mesmo estado aparecia em cinza, indistinguível de "Concluída". O rótulo já
 * era compartilhado daqui; a cor não era, e foi assim que as duas divergiram.
 *
 * Classes do Tailwind e não hex: são os mesmos tokens do resto do portal.
 */
export const COR_STATUS: Record<StatusAcao, string> = {
  EM_ANDAMENTO: 'bg-andamento-bg border-andamento-borda text-andamento-texto',
  ATRASADA: 'bg-critico-bg border-critico-borda text-critico-texto',
  /*
    REJEITADA na paleta de ESCALAÇÃO, e não na de crítico: rejeitar não é erro,
    é a cadeia de ajuda devolvendo com observação. O vermelho é do prazo
    vencido, e os dois andam juntos com frequência -- em vermelho os dois,
    ninguém distingue qual é qual.
  */
  REJEITADA: 'bg-escala-bg border-escala-borda text-escala-texto',
  AGUARDANDO_FEEDBACK: 'bg-risco-bg border-risco-borda text-risco-texto',
  CONCLUIDA: 'bg-ok-bg border-ok-borda text-ok-texto',
}

export const ROTULO_STATUS: Record<StatusAcao, string> = {
  EM_ANDAMENTO: 'Em andamento',
  ATRASADA: 'Atrasada',
  REJEITADA: 'Rejeitada',
  AGUARDANDO_FEEDBACK: 'Aguardando feedback',
  CONCLUIDA: 'Concluída',
}

// ─────────────────────────────────────────────────────────────────────────────
// Variáveis de controle e pontos de causa — a reunião do N4
// ─────────────────────────────────────────────────────────────────────────────

/** Cinco colunas na grade, mesmo em mês de quatro semanas. */
export const SEMANAS_NO_MES = 5

export interface LinhaDaGrade {
  id: string
  nome: string
  /** Índice 0 = S1. */
  semanas: number[]
  total: number
}

export interface GradeMarcacao {
  /** Decidido pelo SERVIDOR. A tela não recalcula quem pode marcar. */
  podeMarcar: boolean
  pontosCausa: LinhaDaGrade[]
}

/** Uma série por variável: cada KPI tem a sua faísca. */
export interface SerieDaVariavel {
  /** Percentual da gerência em cada semana. `null` = sem conta naquela semana. */
  gerencia: Array<number | null>
  areas: Array<{ areaVendaId: string; serie: Array<number | null> }>
}

export interface SerieSemanal {
  /** As semanas que o mês TEM — podem ser 4 ou 5, e as pontas podem ser parciais. */
  semanas: Array<{ numero: number; de: string; ate: string }>
  vendedor: SerieDaVariavel
  vendas: SerieDaVariavel
}

export interface ItemPareto {
  pontoCausaId: string
  nome: string
  quantidade: number
  percentual: number
  acumulado: number
  /** Entra antes dos 80% acumulados — os poucos vitais. */
  vital: boolean
}

export interface AreaPerformance {
  areaVendaId: string
  nome: string
  supervisor: string | null
  /** Projeção de fechamento do mês. */
  numerador: number
  /** Meta do mês. Nula = não cadastrada, e aí o percentual também é nulo. */
  denominador: number | null
  percentual: number | null
}

/** Quantos ficaram fora do denominador, e por quê. A tela precisa disto. */
export interface ForaDaConta {
  semMeta: number
  inativos: number
  outros: number
}

export interface AreaVendedor {
  areaVendaId: string
  nome: string
  supervisor: string | null
  /** Vendedores que alcançaram a cota rateada até o corte. */
  numerador: number
  /** Vendedores que contam no mês. Zero = ninguém, e o percentual é nulo. */
  denominador: number
  percentual: number | null
  foraDaConta: ForaDaConta
}

/**
 * A resposta de `performance-vendas`. NOMEADA, como a do Vendedor.
 *
 * Estava embutida na chamada, e por isso quem quisesse guardá-la tinha de
 * redigitar a forma -- que é como duas versões dela passam a envelhecer em
 * separado.
 */
export interface PerformanceVendas {
  /** Dia até onde a conta foi. Vendas e Vendedor têm cortes independentes. */
  corte: string | null
  areas: AreaPerformance[]
  gerencia: { numerador: number; denominador: number; percentual: number } | null
}

export interface PerformanceVendedor {
  /**
   * O corte da conta. **Nulo significa "não dá para responder"** — falta o
   * calendário, ou o mês ainda não começou.
   *
   * Nunca desenhe 0% quando ele vier nulo: seria afirmar que ninguém bateu
   * meta, quando o que se sabe é que não há como comparar.
   */
  corte: { data: string; diasUteisDecorridos: number; diasUteisDoMes: number } | null
  areas: AreaVendedor[]
  gerencia: {
    numerador: number
    denominador: number
    percentual: number | null
    foraDaConta: ForaDaConta
  } | null
}

export interface Gerencia {
  id: string
  nome: string
  /**
   * Esta é a gerência de quem está logado — o quadro abre nela.
   *
   * Falso em todas quando o portal não sabe qual é, e aí o quadro abre na
   * primeira e a pessoa escolhe no seletor.
   */
  minha: boolean
  /**
   * Por NOME. **Não é a ordem da tela.**
   *
   * A reunião do N4 abre pela área de PIOR DESEMPENHO (§7.59), e esse número
   * não está aqui — vem de `performance-vendas`. Quem ordena é a tela, que tem
   * as duas respostas. Este campo entrega o CONJUNTO, com uma ordem estável
   * para a resposta não mudar de sequência entre chamadas iguais.
   */
  areasVenda: { id: string; nome: string; supervisor: string | null }[]
  /**
   * Agrupadas por INDICADOR — é a categoria do quadro (Vendas, Operacional…).
   * Categoria sem variável não vem, e a tela não a desenha: quadro mostra o
   * que se acompanha, não o que se pretende acompanhar. Ver PLANO §7.11.
   */
  categorias: {
    indicador: string
    nome: string
    variaveis: {
      id: string
      nome: string
      unidade: string
      sentido: 'MAIOR_MELHOR' | 'MENOR_MELHOR'
      /** Meta da variável na competência. Nula = não cadastrada, e a tela omite o "/meta". */
      meta: number | null
    }[]
  }[]
}

/** `ano`, `mes` e a `semana` quando houver — a semana move o corte da conta. */
function periodoQuery(p: { ano: number; mes: number; semana?: number }): string {
  const q = new URLSearchParams({ ano: String(p.ano), mes: String(p.mes) })
  if (p.semana !== undefined) q.set('semana', String(p.semana))
  return q.toString()
}

/**
 * Um mês na série do histórico da gerência.
 *
 * `vendas` e `vendedor` são NULOS de propósito quando o mês não tem dado, e
 * nunca zero: zero é um resultado, ausência não é, e o gráfico desenha os dois
 * de formas diferentes.
 */
export interface MesDoHistorico {
  ano: number
  mes: number
  /** `2026-03`. */
  competencia: string
  /** `mar/26`, para o eixo. */
  rotulo: string
  /**
   * O mês ainda correndo.
   *
   * A comparação é contra a meta do MÊS INTEIRO: no dia 2 a barra é baixa por
   * construção, e sem marcação ela se lê como o pior mês do ano.
   */
  emCurso: boolean
  vendas: { percentual: number; vendido: number; meta: number; dias: number } | null
  vendedor: { percentual: number; naMeta: number; apurados: number } | null
}

export interface HistoricoMensal {
  meses: MesDoHistorico[]
  /**
   * Até onde CADA série alcança — `null` quando ainda não há nenhum mês.
   *
   * As duas têm origens diferentes: Vendas vem do resumo mensal e cresce; o
   * Vendedor depende do detalhe, que retém 60 dias. A tela usa isto para dizer
   * "ainda não há histórico" em vez de desenhar um buraco sem explicação.
   */
  alcance: { vendas: string | null; vendedor: string | null }
}

export const variaveisApi = {
  /**
   * A grade de marcação. Ver PLANO §7.59.
   *
   * Com `areaVendaId`, é a da ÁREA — a que se preenche na reunião. Sem ele, é a
   * SOMA da gerência, que vem com `podeMarcar: false`: não existe onde gravar.
   */
  grade: (
    variavelId: string,
    p: { ano: number; mes: number; gerenciaId: string; areaVendaId?: string },
  ) =>
    api.get<GradeMarcacao>(
      `/variaveis/${variavelId}/marcacoes?ano=${p.ano}&mes=${p.mes}&gerenciaId=${p.gerenciaId}` +
        (p.areaVendaId === undefined ? '' : `&areaVendaId=${p.areaVendaId}`),
    ),
  /**
   * O Pareto da GERÊNCIA — a soma das áreas dela.
   *
   * O N4 e o N3 chamam ESTA rota, não uma cada um: é o mesmo número nas duas
   * telas por construção, e não por coincidência. O Pareto não diz de qual área
   * a causa veio: essa resposta volta com o N5, não com um campo.
   */
  pareto: (variavelId: string, p: { ano: number; mes: number; gerenciaId: string }) =>
    api.get<{ total: number; itens: ItemPareto[] }>(
      `/variaveis/${variavelId}/pareto?ano=${p.ano}&mes=${p.mes}&gerenciaId=${p.gerenciaId}`,
    ),
  /**
   * O mesmo Pareto, da LOJA inteira — soma as gerências dela.
   *
   * É o drill-down do N2 (§7.43): ele não olha gerência, olha a loja. A rota é
   * a mesma e aceita um alvo dos dois, nunca os dois juntos — uma gerência já
   * está dentro de uma filial, e pedir as duas seria pedir para alguém
   * combiná-las.
   */
  /**
   * A série semanal da variável na FILIAL — soma numerador e denominador das
   * gerências, nunca a média dos percentuais. Ver §7.44.
   *
   * `422` quando a variável não tem cálculo próprio: só Performance Vendedor e
   * Performance Vendas têm. A tela trata isso como "sem série", não como erro.
   */
  serieDaFilial: (
    variavelId: string,
    p: { ano: number; mes: number; filial: string },
  ) =>
    api.get<{
      semanas: Array<{ numero: number; de: string; ate: string }>
      serie: Array<number | null>
      /*
       * O gráfico já CONVERTIDO — a régua mora em `lib/escala.ts`, no servidor,
       * e é a mesma que o indicador usa. Converter na tela seria uma segunda
       * conversão, e a linha da variável ficaria em altura diferente da do
       * indicador para o mesmo percentual.
       */
      escalaY: Array<{ valor: number; rotulo: string; y: number; meta?: boolean }>
      yMeta: number
      pontos: Array<{ rotulo: string; valor: number | null; y: number | null }>
      /** O par percentual/fração da semana mais recente com resposta. */
      resumo: {
        semana: number
        percentual: number
        numerador: number
        denominador: number
        delta: number | null
        /** O que a fração conta — a unidade `%` não responde isso. */
        conta: 'PESSOAS' | 'REAIS'
        /**
         * O desdobramento: gerência, e as áreas dentro dela. Piores primeiro.
         *
         * O número da loja diz que está em 95% e não diz ONDE — numa reunião a
         * pergunta seguinte é sempre essa.
         */
        gerencias: Array<{
          nome: string
          percentual: number | null
          numerador: number
          denominador: number
          areas: Array<{
            nome: string
            supervisor: string | null
            percentual: number | null
            numerador: number
            denominador: number
          }>
        }>
      } | null
      variavel: { nome: string; unidade: string }
    }>(
      `/filiais/${encodeURIComponent(p.filial)}/variaveis/${variavelId}/serie-semanal?ano=${p.ano}&mes=${p.mes}`,
    ),
  paretoDaFilial: (variavelId: string, p: { ano: number; mes: number; filial: string }) =>
    api.get<{ total: number; itens: ItemPareto[] }>(
      `/variaveis/${variavelId}/pareto?ano=${p.ano}&mes=${p.mes}&filial=${encodeURIComponent(p.filial)}`,
    ),
  /**
   * Grava a grade de uma ÁREA DE VENDA de uma vez, com as quantidades
   * ABSOLUTAS.
   *
   * Só as células que MUDARAM: mandar a grade inteira reescreveria o
   * `registradoEm` de quem não foi tocado, e o histórico de quem marcou o quê
   * viraria o carimbo do último salvamento.
   */
  gravarGrade: (
    variavelId: string,
    dados: {
      gerenciaId: string
      /** Obrigatório: conta-se dentro da área, e a soma é só de leitura. */
      areaVendaId: string
      ano: number
      mes: number
      celulas: Array<{ pontoCausaId: string; semana: number; quantidade: number }>
    },
  ) => api.put<{ gravadas: number; apagadas: number }>(`/variaveis/${variavelId}/marcacoes`, dados),
  /**
   * Cria um ponto de causa NA VARIÁVEL — não na área nem na gerência.
   *
   * Quem pode marcar pode criar (decisão do analista, 10/09/2026): a causa nova
   * aparece na reunião, e é lá que ela tem nome. O alcance é a variável inteira,
   * então o ponto nasce visível em todas as áreas e nas outras filiais que a
   * acompanham — é o que mantém o Pareto comparável entre elas.
   *
   * 409 quando já existe um ATIVO com o mesmo nome. Se o que existe está
   * desativado, o servidor REATIVA e devolve 201 com o mesmo `id`.
   */
  criarPontoCausa: (variavelId: string, nome: string) =>
    api.post<{ id: string; nome: string; ativo: boolean; ordem: number }>(
      `/variaveis/${variavelId}/pontos-causa`,
      { nome },
    ),
  /**
   * `semana` MOVE O CORTE: "como estávamos no fim da S2".
   *
   * Ausente = o mês até D-1. O quadro sempre manda a semana selecionada — sem
   * ela, trocar de semana no cabeçalho não mudava número nenhum, que foi
   * exatamente a divergência com o protótipo (PLANO §7.22).
   */
  performanceVendas: (gerenciaId: string, p: { ano: number; mes: number; semana?: number }) =>
    api.get<PerformanceVendas>(`/gerencias/${gerenciaId}/performance-vendas?${periodoQuery(p)}`),
  performanceVendedor: (gerenciaId: string, p: { ano: number; mes: number; semana?: number }) =>
    api.get<PerformanceVendedor>(
      `/gerencias/${gerenciaId}/performance-vendedor?${periodoQuery(p)}`,
    ),
  /**
   * As cinco semanas — a faísca ao lado do KPI.
   *
   * Vem do MESMO cálculo do KPI, uma vez por semana: o ponto da semana
   * selecionada é o número grande ao lado dele, e há teste disso.
   */
  serieSemanal: (gerenciaId: string, p: { ano: number; mes: number }) =>
    api.get<SerieSemanal>(`/gerencias/${gerenciaId}/serie-semanal?${periodoQuery(p)}`),
  /**
   * As gerências da filial, com áreas de venda e variáveis.
   *
   * A filial sai da VISÃO, não de um parâmetro próprio desta rota. Era
   * `filial=`, com regra só dela — "o N2 informa, os outros usam a própria" —,
   * e quem administra sem ser N2 de nascença não conseguia abrir o quadro de
   * loja nenhuma. Agora é a mesma `visaoNivel`/`visaoFilial` do painel.
   */
  gerencias: (p: { visao?: URLSearchParams; ano?: number; mes?: number } = {}) => {
    const q = new URLSearchParams()
    for (const [k, v] of p.visao ?? []) q.set(k, v)
    // `ano`/`mes` trazem a META de cada variável na competência — sem eles ela
    // vem nula e a tela mostra o percentual sem o "/85%" ao lado.
    if (p.ano !== undefined) q.set('ano', String(p.ano))
    if (p.mes !== undefined) q.set('mes', String(p.mes))
    const s = q.toString()
    return api.get<{ gerencias: Gerencia[] }>(`/gerencias${s ? `?${s}` : ''}`)
  },
  /**
   * A série mensal da gerência — os dois quadros da parede do N4.
   *
   * `meses` conta a partir do corrente para trás, inclusive.
   */
  historicoMensal: (gerenciaId: string, p: { meses?: number; visao?: URLSearchParams } = {}) => {
    const q = new URLSearchParams()
    for (const [k, v] of p.visao ?? []) q.set(k, v)
    if (p.meses !== undefined) q.set('meses', String(p.meses))
    const s = q.toString()
    return api.get<HistoricoMensal>(`/gerencias/${gerenciaId}/historico-mensal${s ? `?${s}` : ''}`)
  },

  /**
   * O MESMO histórico, no escopo da LOJA — as áreas de todas as gerências
   * somadas. É o gráfico do N3.
   */
  historicoMensalDaLoja: (
    filial: string,
    p: { meses?: number; visao?: URLSearchParams } = {},
  ) => {
    const q = new URLSearchParams()
    for (const [k, v] of p.visao ?? []) q.set(k, v)
    if (p.meses !== undefined) q.set('meses', String(p.meses))
    const s = q.toString()
    return api.get<HistoricoMensal>(`/filiais/${filial}/historico-mensal${s ? `?${s}` : ''}`)
  },
}

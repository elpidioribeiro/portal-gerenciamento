/**
 * Tipos de `fontes.mjs`, para o `recarregar.ts` do backend consumir sob
 * `strict`. O módulo em si é `.mjs` porque `gerar-fluxos.mjs` roda com `node`
 * puro, sem passar por compilador.
 */

/** Uma linha crua da resposta do Power BI, com nomes de coluna como chaves. */
export type LinhaBruta = Record<string, unknown>

export declare const iso: (v: unknown) => string
export declare const num: (v: unknown) => number
export declare const inteiro: (v: unknown) => number
export declare const sigla: (v: unknown) => string
/** Código da filial → sigla: 1 → "CEN". Perdas e Movimentação vêm como número. */
export declare const siglaDoCodigo: (v: unknown) => string
export declare const campo: (linha: LinhaBruta, ...nomes: string[]) => unknown
export declare const extrairLinhas: (itens: Array<{ json: unknown }>) => LinhaBruta[]

export declare function fonteDosHelpers(): string
export declare function fonteDoMapeamento(mapear: unknown): string

export interface Fonte {
  arquivo: string
  titulo: string
  /** Nome no endpoint: `/api/v1/ingest/<fonte>`. */
  fonte: string
  janelaDias: number
  hora: number
  minuto: number
  /**
   * `false` enquanto a consulta for esqueleto com `<sua medida>` dentro. A
   * recarga se recusa a executar — DAX inválida devolve zero linha, e zero
   * linha numa substituição de janela apaga o período sem repor nada.
   */
  pronta: boolean
  /**
   * Variável do `.env` com o gatilho do Power Automate do dataset.
   *
   * `null` em toda fonte que NÃO é do Power BI -- hoje 8 das 10, que vão ao
   * Oracle direto. A declaração dizia `string` até 15/09/2026, e era falsa: o
   * `fontes.mjs` escreve `endpointEnv: null` nelas desde sempre.
   *
   * A mentira tinha custo real. `endpointDa` faz `if (!fonte.endpointEnv)`
   * para recusar fonte sem gatilho, e pelo tipo antigo essa guarda parecia
   * morta -- quem fosse "limpar" a condição tiraria a única checagem que
   * separa "fonte do Power BI" de "fonte do Oracle", e o erro viraria um
   * `fetch(undefined)`.
   */
  endpointEnv: string | null
  nota?: string
  /**
   * De onde a consulta é executada. `'dax'` vai ao Power BI pelo gatilho do
   * Power Automate; `'sql'` vai direto ao Oracle por um nó do n8n — é o caso de
   * Movimentação, cuja medida no Power BI só responde no grão mensal.
   */
  tipo: 'dax' | 'sql'
  /** Recebe EXPRESSÕES DAX de data, não datas. `null` em fontes `sql`. */
  dax: ((de: string, ate: string) => string) | null
  /**
   * SQL no Oracle. CONSTANTE, não função: a janela entra por bind parameter
   * (`:de`, `:ate`) no nó Oracle do n8n, em vez de ser interpolada no texto
   * como o DAX precisa. `null` em fontes `dax`.
   */
  sql: string | null
  mapear: (l: LinhaBruta) => Record<string, unknown>
  /** Metas não têm janela: são por competência (ano/mês). */
  /**
   * Consulta de META no ORACLE, quando a origem da meta é o banco e não o BI.
   *
   * Existe porque a meta por ÁREA DE VENDA só vive em `ERP_META_COTA_VENDAS`:
   * o modelo do Power BI não a expõe nesse grão. Sem janela -- meta é por
   * competência.
   */
  sqlMeta?: string | null
  daxMeta: (() => string) | null
  /**
   * Recebe o LOTE, não uma linha: a meta de NPS é uma constante única que
   * precisa ser expandida para filial × ano × mês, e um mapeamento por linha
   * não consegue transformar 1 linha em 216.
   */
  montarMetas: ((linhas: LinhaBruta[]) => Array<Record<string, unknown>>) | null
}

/** As 9 filiais do GD. O dataset de NPS traz outras que o portal não conhece. */
export declare const FILIAIS_GD: Array<{ cod: number; sigla: string }>

export declare const FONTES: Fonte[]
export declare function acharFonte(nome: string): Fonte

/**
 * Perfil do usuário no Oracle, por `(matricula, cod_empresa)`.
 *
 * Constante, com binds `:matricula` e `:empresa`. Usada em dois lugares que
 * precisam concordar: o fluxo `06-usuario` do n8n e o `ErpAuthProvider`, que a
 * executa direto. Ficar aqui é o que impede as duas cópias divergirem.
 */
export declare const SQL_USUARIO: string
/** `'2026-08-19'` -> `DATE ( 2026, 8, 19 )`. */
export declare function expressaoData(iso: string): string

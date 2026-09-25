/**
 * Definição de cada fonte de ingestão: a consulta DAX e o mapeamento da
 * resposta para o contrato do portal.
 *
 * Fonte ÚNICA de verdade, consumida por dois lugares:
 *
 * - `gerar-fluxos.mjs`, que embute as duas coisas nos nós de código do n8n
 *   (a carga diária, agendada);
 * - `backend/scripts/recarregar.ts`, que executa a mesma consulta na mão para
 *   consertar histórico (a carga sob demanda).
 *
 * Por que não duas cópias: o fluxo diário só reescreve os últimos 60 dias em
 * Vendas e NPS, então todo conserto de dado antigo passa pela recarga manual.
 * Se as duas rotas tivessem DAX própria, uma correção aplicada num lado gravaria
 * números calculados por regra diferente da do outro — e sem erro nenhum, porque
 * as duas rodam. Já custou caro neste projeto duas vezes: a aritmética de
 * percentual duplicada entre seed e produção, e a meta do período divergindo
 * entre painel e gráfico. Nos dois casos o sintoma foi o mesmo, dois números
 * para o mesmo fato e nenhuma pista de qual estava certo.
 *
 * Como as duas rotas compartilham:
 *
 * - `dax(de, ate)` recebe EXPRESSÕES DAX de data, não datas. O gerador passa o
 *   placeholder `${dax(de)}`, que o nó do n8n interpola em tempo de execução; a
 *   recarga passa `DATE ( 2025, 5, 12 )` direto. Mesma função, mesma consulta.
 * - `mapear` é função de verdade. A recarga chama; o gerador serializa com
 *   `toString()` e cola no nó. Por isso os comentários que precisam chegar ao
 *   n8n moram DENTRO do corpo — comentário acima da função não sobrevive ao
 *   `toString()`.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Lê um SQL de `sql/<nome>.sql`, ao lado deste arquivo.
 *
 * As consultas SQL moram em arquivo e não em template string por dois motivos.
 * Perdas tem quase 400 linhas, e embutir isso aqui afogaria a definição das
 * fontes. E arquivo `.sql` roda **identico** em qualquer cliente — a conferência
 * contra o Power BI foi feita assim, colando o mesmo arquivo, e ter de extrair de
 * uma string JavaScript para conferir é a fricção que faz ninguém conferir.
 *
 * Leitura síncrona no carregamento do módulo: são dois arquivos pequenos, e o
 * módulo já é síncrono para todo o resto.
 */
const lerSql = (nome) =>
  readFileSync(path.resolve(import.meta.dirname, 'sql', `${nome}.sql`), 'utf8')

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — funções reais aqui, texto no nó do n8n via `fonteDosHelpers()`
// ─────────────────────────────────────────────────────────────────────────────

export const iso = (v) => {
  // Aceita Date ou string; o Power BI devolve "2025-05-12T00:00:00".
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

export const num = (v) => Number(v ?? 0)

export const inteiro = (v) => Math.round(Number(v ?? 0))

export const sigla = (v) => {
  // Tira o prefixo numerico da filial: o portal cadastra so' a sigla, e sem
  // isso a carga falha com "Filial desconhecida: 1.CEN".
  //
  // Dois formatos, porque cada dataset escreve do seu jeito:
  //   dFilial (vendas) -> "1.CEN"
  //   fNPS             -> "1 - CEN"
  // Nao da' para tratar so' um: com "1 - CEN" o corte no ponto devolveria a
  // string inteira e o portal recusaria o lote todo.
  //
  // O padrao exige DIGITOS antes do separador, entao uma sigla que por acaso
  // contenha ponto ou hifen nao e' mutilada. O trim tambem importa: coluna CHAR
  // vem com espacos a direita.
  return String(v ?? '')
    .trim()
    .replace(/^\d+\s*[.\-]\s*/, '')
    .trim()
}

export const siglaDoCodigo = (v) => {
  // Converte o CODIGO da filial na sigla: 1 -> "CEN", 6 -> "LIT".
  //
  // O dataset de Perdas devolve `dFiliais[Dig. Empresa]` como numero puro
  // ("1", "6"), e o SQL de movimentacao devolve `FILIAL` idem — diferente do
  // texto com prefixo que Vendas ("1.CEN") e NPS ("1 - CEN") mandam. Usar
  // `sigla` aqui devolveria "1", e a ingestao recusaria com "Filial
  // desconhecida: 1".
  //
  // Codigo fora da lista devolve string vazia em vez de inventar sigla: a
  // ingestao recusa o lote e diz qual filial nao conhece, que e' melhor que
  // gravar dado de loja errada.
  const cod = Number(String(v ?? '').trim())
  const f = FILIAIS_GD.find((x) => x.cod === cod)
  return f ? f.sigla : ''
}

/**
 * As 9 filiais do GD, com o codigo que a origem usa.
 *
 * Existe porque o dataset de NPS tem MAIS filiais que o portal: no canal Loja
 * vem tambem 81-OBC, 82-OSAL, 92-CAB e 93-ALH, com 8 a 87 avaliacoes contra
 * milhares das lojas — nao sao lojas do GD. E a ingestao recusa o lote INTEIRO
 * quando aparece sigla que ela nao conhece, entao sem filtrar a carga de NPS
 * nunca passa.
 *
 * Filtrar na consulta e nao afrouxar a ingestao e' deliberado: aquele erro e' a
 * rede que pega sigla trocada no mapeamento, e desliga-lo para resolver uma
 * diferenca de ESCOPO trocaria um problema visivel por um invisivel.
 *
 * Custo: abrir loja nova exige cadastrar no portal e acrescentar aqui.
 */
export const FILIAIS_GD = [
  { cod: 1, sigla: 'CEN' },
  { cod: 2, sigla: 'NOR' },
  { cod: 3, sigla: 'SUL' },
  { cod: 4, sigla: 'LES' },
  { cod: 5, sigla: 'OES' },
  { cod: 6, sigla: 'LIT' },
  { cod: 7, sigla: 'SER' },
  { cod: 8, sigla: 'CAM' },
  { cod: 9, sigla: 'PRA' },
]

export const campo = (linha, ...nomes) => {
  // Busca um campo tolerando variacao de caixa no nome da coluna: o Power BI
  // devolve o nome como esta' no modelo, e nao como escrito na consulta —
  // pedimos dCalendario[Date] e voltou dCALENDARIO[Date]. Sem isso o campo vem
  // undefined e a data chega como "undefined" no portal.
  for (const n of nomes) {
    if (linha[n] !== undefined) return linha[n]
  }
  const chaves = Object.keys(linha)
  for (const n of nomes) {
    const achou = chaves.find((k) => k.toLowerCase() === n.toLowerCase())
    if (achou !== undefined) return linha[achou]
  }
  return undefined
}

export const extrairLinhas = (itens) => {
  // Tres formatos possiveis de resposta: a acao do conector Power BI devolve
  // firstTableRows; o REST puro devolve results[0].tables[0].rows; e um fluxo
  // pode ja' devolver o array pronto. Tratar os tres evita descobrir o formato
  // por tentativa.
  const brutos = itens.map((i) => i.json)

  const doConector = brutos.flatMap((j) => j?.firstTableRows ?? [])
  if (doConector.length > 0) return doConector

  const doRest = brutos.flatMap((j) => j?.results?.[0]?.tables?.[0]?.rows ?? [])
  if (doRest.length > 0) return doRest

  for (const c of ['value', 'linhas', 'rows', 'body']) {
    const unico = brutos.length === 1 ? brutos[0]?.[c] : null
    if (Array.isArray(unico)) return unico
  }

  return brutos
}

/**
 * Os helpers como TEXTO, para colar no nó de código do n8n.
 *
 * Serializado das funções acima em vez de mantido como string à parte: uma
 * string à parte seria uma segunda cópia, exatamente o que este módulo existe
 * para eliminar.
 */
export function fonteDosHelpers() {
  const fns = { iso, num, inteiro, sigla, siglaDoCodigo, campo, extrairLinhas }
  return [
    // Vai junto porque `montarMetas` do NPS a referencia, e a funcao chega ao
    // no' do n8n por `toString()` — sem a constante no escopo, ela estouraria
    // com "FILIAIS_GD is not defined". Repetir a lista dentro da funcao seria a
    // duplicacao que este modulo existe para evitar.
    `const FILIAIS_GD = ${JSON.stringify(FILIAIS_GD)}`,
    ...Object.entries(fns).map(([nome, fn]) => `const ${nome} = ${fn.toString()}`),
  ].join('\n\n')
}

/**
 * Corpo de uma função de mapeamento, como TEXTO, para colar no `.map(...)` do nó.
 *
 * `extrairLinhas(...).map(${fonteDoMapeamento(f.mapear)})` no nó do n8n executa
 * a mesma função que a recarga chama direto.
 */
export function fonteDoMapeamento(mapear) {
  return mapear.toString()
}

// ─────────────────────────────────────────────────────────────────────────────
// Consultas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vendas: valor realizado do dia e projeção de fechamento do mês.
 *
 * A projeção é calculada aqui, não vem de medida pronta:
 *   (vendido no mês até o dia / dias úteis decorridos) × dias úteis do mês
 *
 * Conferido contra o dashboard: para CEN em 18/08 dá 14.217.827, o mesmo valor
 * da medida oficial Projecao_Mes.
 */
const daxVendas = (de, ate) => `-- Consulta DAX no dataset do Power BI (Resultado de Vendas).
-- As datas do filtro vem da janela calculada no no anterior.
EVALUATE
VAR _Inicio = ${de}
VAR _Fim    = ${ate}
RETURN
SUMMARIZECOLUMNS (
    dCalendario[Date],
    dFilial[NUM_FILIAL],
    dFilial[FILIAL],
    FILTER ( dCanal_Venda, dCanal_Venda[NUM_CANAL] <> "2" ),
    KEEPFILTERS (
        FILTER (
            ALL ( dCalendario[Date] ),
            dCalendario[Date] >= _Inicio && dCalendario[Date] <= _Fim
        )
    ),
    "VALOR_REAL", SUM ( 'fVENDA'[VALOR_TOTAL] ),
    "TENDENCIA",
        VAR _Dia = MAX ( dCalendario[Date] )
        VAR _Cod = VALUE ( MAX ( dFilial[NUM_FILIAL] ) )
        -- ALL(dCalendario) e' essencial: sem ele a janela do filtro externo se
        -- combina com este acumulado, e o mes parcial no inicio da janela soma
        -- so' a parte que cai dentro dela. O numerador viria com poucos dias e
        -- o divisor com o mes inteiro de dias uteis — projecao muito abaixo da
        -- real, sem erro nenhum. So' aparece quando a janela nao comeca no dia 1.
        VAR _Vendido =
            CALCULATE (
                SUM ( 'fVENDA'[VALOR_TOTAL] ),
                FILTER (
                    ALL ( dCalendario ),
                    dCalendario[Date] >= DATE ( YEAR ( _Dia ), MONTH ( _Dia ), 1 )
                        && dCalendario[Date] <= _Dia
                )
            )
        -- Dias uteis sao por filial e vem da dSEGU INVERTIDA, que nao tem
        -- relacionamento no modelo — dai o LOOKUPVALUE.
        VAR _Trab =
            LOOKUPVALUE (
                'dSEGU INVERTIDA'[ACUMULADO_DIA],
                'dSEGU INVERTIDA'[DATA.], _Dia,
                'dSEGU INVERTIDA'[COD_EMPRESA], _Cod
            )
        VAR _Uteis =
            LOOKUPVALUE (
                'dSEGU INVERTIDA'[QTUTIL_DIA],
                'dSEGU INVERTIDA'[DATA.], _Dia,
                'dSEGU INVERTIDA'[COD_EMPRESA], _Cod
            )
        RETURN
            DIVIDE ( _Vendido, _Trab ) * _Uteis
)`

/**
 * Meta de vendas: tabela ORCADO_LJA.
 *
 * O `CANAL_VENDA <> 2` é obrigatório: o realizado exclui esse canal, e somar a
 * meta de todos daria meta inflada e desvio negativo demais. Conferido contra o
 * dashboard — com o canal 2 fora, CEN em ago/2026 dá 15,89 M, exatamente a meta
 * implícita na medida oficial Perc_GAP_Mes.
 *
 * Não recebe janela: metas são por competência (ano/mês), não por dia.
 */
const daxMetaVendas = () => `-- Meta de vendas (ORCADO_LJA). ANO e MES sao TEXTO nessa tabela.
EVALUATE
SUMMARIZECOLUMNS (
    'ORCADO_LJA'[COD_EMPRESA],
    'ORCADO_LJA'[ANO],
    'ORCADO_LJA'[MES],
    FILTER ( 'ORCADO_LJA', 'ORCADO_LJA'[CANAL_VENDA] <> 2 ),
    FILTER ( 'ORCADO_LJA', VALUE ( 'ORCADO_LJA'[ANO] ) >= YEAR ( TODAY () ) - 1 ),
    "FILIAL", LOOKUPVALUE ( dFilial[FILIAL], dFilial[NUM_FILIAL], MAX ( 'ORCADO_LJA'[COD_EMPRESA] ) ),
    "META", SUM ( 'ORCADO_LJA'[ORCADO_VND] )
)`

/**
 * Movimentação: SQL direto no Oracle, NÃO no Power BI. **Só venda.**
 *
 * A medida `[Movimentação Total]` do dataset de Perdas só existe no grão MENSAL
 * — medido: no grão diário devolve zero linha, com ou sem os filtros de negócio.
 * Como `fato_movimentacao` é diária e o gráfico semanal de Perdas precisa da
 * semana, a origem passa a ser o banco.
 *
 * Consulta da área, com uma mudança: a janela.
 *
 * - **Bind parameters** `:de` e `:ate`, não datas interpoladas na string. O nó
 *   Oracle do n8n suporta bind (`options.params.values`), e isso elimina de uma
 *   vez a superfície de injeção e a ambiguidade de formato. Por isso `sql` é uma
 *   CONSTANTE e não uma função — diferente de `dax`, que precisa da data dentro
 *   do texto porque o Power Automate recebe a consulta pronta.
 * - `TO_DATE(:de, 'YYYY-MM-DD')` explícito. Passar a data sem máscara dependeria
 *   do `NLS_DATE_FORMAT` da sessão, e o n8n pode conectar com outro — aí a
 *   consulta erra, ou pior, lê como mês/dia e traz o período errado sem falhar.
 * - `< :ate + 1` em vez de `BETWEEN`. Se `DATEMISSAO` tiver componente de hora,
 *   `BETWEEN` perderia tudo depois da meia-noite do último dia.
 *
 * O `WHERE FILIAL <= 9` já restringe às filiais do GD, então aqui não precisa
 * do filtro por `FILIAIS_GD` que o NPS exige.
 *
 * **Custo de transferência foi avaliado e NÃO entra.** A consulta da área para
 * ele (`TIPOSAIDA` 11 e 17, `SUM(CUETOT)` de `SAIDM_IT`) filtra
 * `COD_EMPRESA >= 80`, ou seja é de CD — as 9 filiais do GD são 1..9. Chegou a
 * ser somado por `UNION ALL` e foi desfeito.
 *
 * A pista que apontava para transferência era outra coisa: o portal parecia
 * divergir do dashboard em ~5%, e a causa era o **dashboard estar com
 * movimentação desatualizada**. O SQL nunca esteve errado.
 */
const SQL_MOVIMENTACAO = lerSql('movimentacao')

// ─────────────────────────────────────────────────────────────────────────────
// Consulta sob demanda: dados do usuário no login
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Perfil do usuário, para o portal resolver o nível no login.
 *
 * NÃO é ingestão: o portal chama, espera e usa a resposta na hora. A API de
 * login da ERP valida a credencial e devolve `id` e `company.companyId`, mas
 * **não devolve `id_perfil`** — o `role` dela vem `"UNKNOWN"` até para
 * diretoria, e `permissions` vem vazio. Sem este SQL não há como saber se a
 * pessoa é N2, N3 ou N4.
 *
 * Consequência aceita e registrada: **o login passa a depender do n8n estar no
 * ar.** Se ele cair, ninguém entra no portal.
 *
 * `INNER JOIN`, não `LEFT`: quem não está em `hr_vw_colaboradores` não devolve
 * linha, e o portal recusa o login. Alguém recém-contratado, ainda não propagado
 * para a view, não entra — é consequência do inner join, e foi aceita. Entrar
 * com nível indefinido seria pior: não se saberia o que a pessoa pode ver.
 *
 * A chave é `(cd_usuario, cod_empresa)`, que garante UMA linha. `hr_usuario_filiais`
 * é plural: filtrar só por usuário devolveria uma linha por filial de acesso.
 *
 * CONFIRMAR: esta é a leitura de "inner join com o cod_empresa e cod_usuario
 * força apenas uma linha" — o join permanece em `matricula = numcad` e o
 * `cod_empresa` entra no WHERE. Se o certo for `cod_empresa` também na condição
 * do join, é uma linha de ajuste.
 */
export const SQL_USUARIO = `-- Perfil do usuario no cadastro corporativo, pela MATRICULA.
--
-- A matricula vem da API de login (campo employeeId). NAO filtra por empresa:
-- a filial escolhida na tela decide qual API valida a senha, nao onde a pessoa
-- trabalha. Quem e' do corporativo (cod_empresa 99) entra pela API de uma loja
-- e nao teria perfil se o filtro existisse -- foi o que aconteceu na primeira
-- versao desta consulta.
--
-- Devolve cod_empresa para o portal desempatar: 5.185 das 5.186 pessoas tem
-- perfil em UMA empresa so', e a unica excecao e' resolvida pela filial
-- escolhida.
--
-- Le hr_vw_colaboradores, nao hr_usuario_filiais: aquela tabela vive no banco
-- de cada loja e nao existe no BI (medido: ORA-00904 em cod_empresa).
--
-- sitafa <> 7 e' quem esta trabalhando -- CORRIGIDO em 31/08/2026.
--
-- Era sitafa = 1, e o banco mostra o tamanho do erro: 5.219 pessoas tem sitafa
-- 1, mas outras 390 estao em atividade com sitafa 2, 3, 4, 6, 8 ou 14. Todas
-- elas eram barradas no login com a mensagem de "perfil nao classificado" --
-- que manda procurar um cadastro que esta' certo.
--
-- O unico codigo que sai e' o 7, com 476 pessoas. performance-vendedor.ts ja'
-- dizia isso (SITAFA_INATIVO = 7) enquanto esta consulta dizia o contrario; a
-- definicao agora mora em lib/sitafa.ts, uma so' para os tres lugares que
-- perguntam.
SELECT id_perfil        AS ID_PERFIL,
       cod_empresa      AS COD_EMPRESA,
       TRIM(titred)     AS CARGO,
       TRIM(nomloc)     AS LOCAL
  FROM hr_vw_colaboradores
 WHERE sitafa <> 7
   AND numcad = :matricula
   AND id_perfil IS NOT NULL
 ORDER BY cod_empresa`

/**
 * Fluxos de CONSULTA — webhook entra, resposta sai.
 *
 * Separados de `FONTES` porque a forma é outra: ingestão é o n8n empurrando para
 * o portal, e aqui é o portal perguntando e esperando. O gerador monta os dois,
 * com nós diferentes.
 */
export const CONSULTAS = [
  /*
   * VAZIA desde 31/08/2026 -- e a ausencia e' a decisao.
   *
   * Havia uma consulta aqui, `06-usuario`: o perfil corporativo pela matricula,
   * exposto como webhook para o portal chamar durante o login. O portal NUNCA
   * chamou. Ele importa `SQL_USUARIO` deste arquivo e consulta o Oracle direto
   * (`auth/provider.ts`), pelo mesmo `lib/oracle.ts` que ja' recusa qualquer
   * coisa que nao seja SELECT.
   *
   * O fluxo era, entao, uma SEGUNDA COPIA do mesmo SQL -- exatamente o risco que
   * o teste `fluxos-atualizados` existe para policiar. E ele mordeu: a correcao
   * de `sitafa <> 7` (§7.33) foi feita no JSON gerado, e o teste a apagou ao
   * regenerar; depois, corrigida na fonte, ela passou a valer no login na hora,
   * enquanto o fluxo exportado seguia dizendo o contrario para quem o lesse.
   *
   * Decisao do analista: "nao quero precisar do n8n pra isso". O login nao
   * precisa, e nao precisava ha' tempo -- o que faltava era apagar a copia.
   *
   * A MAQUINARIA FICA. O gerador continua sabendo montar um fluxo de consulta
   * (webhook -> Oracle -> resposta), que e' uma forma diferente da ingestao
   * (n8n empurra e ninguem espera). Se um dia algo fora do portal precisar
   * perguntar ao Oracle, o caminho existe. O que nao pode e' haver uma copia
   * sem dono.
   */
]

// ─────────────────────────────────────────────────────────────────────────────
// Fontes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `pronta: false` marca fonte cuja consulta ainda é esqueleto com `<sua
 * medida>` dentro. O gerador emite o fluxo de qualquer forma (é o rascunho que
 * a pessoa vai preencher no n8n), mas a recarga se RECUSA a executar — mandar
 * DAX inválida ao Power BI devolveria zero linha, e zero linha numa substituição
 * de janela apaga o período sem repor nada.
 *
 * `endpointEnv` é a variável do .env com o gatilho do Power Automate. Uma por
 * DATASET, não por fonte: vendas e vendas-linha saem do mesmo dataset e
 * compartilham o gatilho, enquanto NPS mora em outro e tem o seu.
 */
export const FONTES = [
  {
    arquivo: '01-vendas',
    titulo: 'Portal GD · Vendas',
    fonte: 'vendas',
    tipo: 'dax',
    janelaDias: 60,
    hora: 3,
    minuto: 0,
    pronta: true,
    endpointEnv: 'POWER_AUTOMATE_VENDAS',
    dax: daxVendas,
    sql: null,
    mapear: (l) => ({
      // A DAX devolve a filial como "1.CEN"; o portal usa so' a sigla.
      filial: sigla(campo(l, 'dFilial[FILIAL]', 'FILIAL')),
      data: iso(campo(l, 'dCalendario[Date]', 'DATA')),
      valorReal: num(campo(l, '[VALOR_REAL]', 'VALOR_REAL')),
      tendencia: num(campo(l, '[TENDENCIA]', 'TENDENCIA')),
      // deltaMeta e' OPCIONAL: o portal calcula o desvio pela meta que este
      // mesmo fluxo carrega. Se um dia houver medida de GAP no modelo,
      // acrescente aqui — lembrando que o Power BI guarda percentual como
      // FRACAO (-0.105) e o portal espera pontos percentuais (-10.5), dai o
      // x100:  deltaMeta: num(campo(l, '[DELTA_META]')) * 100,
    }),
    daxMeta: daxMetaVendas,
    montarMetas: (linhas) =>
      linhas.map((l) => ({
        indicador: 'vendas',
        filial: sigla(campo(l, '[FILIAL]', 'FILIAL')),
        ano: inteiro(campo(l, 'ORCADO_LJA[ANO]', 'ANO')),
        mes: inteiro(campo(l, 'ORCADO_LJA[MES]', 'MES')),
        valor: num(campo(l, '[META]', 'META')),
      })),
  },
  {
    arquivo: '02-vendas-linha',
    titulo: 'Portal GD · Vendas por linha',
    fonte: 'vendas-linha',
    /**
     * ORACLE, não DAX (27/08/2026).
     *
     * O placeholder anterior era uma DAX inventada sobre `dTipo[Linha + Desc]`,
     * dimensão que nunca foi conferida no modelo. O analista trouxe a consulta
     * real do Oracle, que traz o que a DAX não tinha: **área de venda e
     * gerência**, do cadastro `ERP_AREA_LINHA` / `ERP_AREA_VENDA`.
     *
     * A gerência sai de `AV.TIPO_AREA` — 'C' e 'N'. Só existem os dois, o que
     * confirma que Depósito não vende.
     */
    tipo: 'sql',
    janelaDias: 60,
    hora: 3,
    minuto: 30,
    pronta: true,
    // Sem gatilho de Power Automate: a consulta é do Oracle, executada pelo
    // próprio portal.
    endpointEnv: null,
    nota:
      'Roda DEPOIS de Vendas: o portal valida a soma do detalhe contra o ' +
      'agregado e recusa se divergir. Linha sem area de venda cadastrada ' +
      'DESAPARECE da consulta (os dois JOIN sao INNER) e a soma nao fecha — ' +
      'falha alto, mas exige que o cadastro de area cubra toda linha que vende.',
    dax: null,
    /**
     * CONSTANTE e não função, como perdas e movimentação: a janela entra por
     * bind (`:de`, `:ate`), não interpolada no texto. Data interpolada
     * dependeria do `NLS_DATE_FORMAT` da sessão e poderia trazer o período
     * errado sem falhar.
     */
    sql: lerSql('vendas-linha'),
    mapear: (l) => ({
      // `siglaDoCodigo`, e nao `sigla`: a consulta devolve COD_EMPRESA como
      // NUMERO (1..9), como perdas e movimentacao -- nao o texto com prefixo
      // que as fontes de Power BI mandam.
      //
      // Estava `sigla(campo(l, 'FILIAL'))`, herdado de quando esta fonte era
      // DAX e um no' do n8n traduzia antes. O no' sumiu junto com o fluxo, e a
      // coluna FILIAL nunca existiu no SQL: `campo` devolvia undefined, `sigla`
      // devolvia string vazia, e a ingestao recusava as 27 mil linhas com
      // "String must contain at least 1 character". Falhou alto, na primeira
      // carga real (27/08/2026).
      filial: siglaDoCodigo(campo(l, 'COD_EMPRESA', 'cod_empresa')),
      data: iso(campo(l, 'DATA', 'data')),
      gerencia: String(campo(l, 'GERENCIA', 'gerencia') ?? '').trim(),
      // O CODIGO identifica a area no portal; o nome e' rotulo, atualizado a
      // cada carga. Trocado em 27/08: pelo nome, corrigir uma grafia no
      // cadastro corporativo criava area NOVA na carga seguinte.
      cdArea: String(campo(l, 'CD_AREA', 'cd_area') ?? '').trim(),
      areaVenda: String(campo(l, 'AREA_VENDA', 'area_venda') ?? '').trim(),
      // `linha` saiu em 18/09/2026, junto com o grão por linha de produto.
      // Ver o cabeçalho de `sql/vendas-linha.sql`.
      valor: num(campo(l, 'VALOR_TOTAL', 'valor_total')),
    }),
    daxMeta: null,
    /**
     * A META por AREA DE VENDA sai do ORACLE, nao do Power BI.
     *
     * Por isso `sqlMeta` e nao `daxMeta`: `ERP_META_COTA_VENDAS` e' a origem, e
     * o modelo do BI nao expoe meta nesse grao. E' o denominador de Performance
     * Vendas (PLANO 7.10 e 7.13).
     *
     * Sem janela -- meta e' por competencia, e reenviar a mesma e' operacao
     * normal. O portal faz upsert por (escopo, alvo, filial, ano, mes).
     */
    sqlMeta: lerSql('metas-area-venda'),
    montarMetas: (linhas) =>
      linhas.map((l) => ({
        indicador: 'vendas',
        filial: siglaDoCodigo(campo(l, 'COD_EMPRESA', 'cod_empresa')),
        ano: inteiro(campo(l, 'ANO', 'ano')),
        mes: inteiro(campo(l, 'MES', 'mes')),
        valor: num(campo(l, 'META', 'meta')),
        // O CODIGO resolve a area no portal. A descricao vem junto na consulta
        // so' para a mensagem de erro quando a area nao existir la'.
        cdArea: String(campo(l, 'CD_AREA', 'cd_area') ?? '').trim(),
        areaVenda: String(campo(l, 'AREA_VENDA', 'area_venda') ?? '').trim(),
        gerencia: String(campo(l, 'GERENCIA', 'gerencia') ?? '').trim(),
      })),
  },
  {
    arquivo: '03-nps',
    titulo: 'Portal GD · NPS',
    fonte: 'nps',
    tipo: 'dax',
    janelaDias: 60,
    hora: 3,
    minuto: 10,
    pronta: true,
    endpointEnv: 'POWER_AUTOMATE_NPS',
    nota:
      'Dataset PROPRIO, diferente do de Vendas — o gatilho do Power Automate e outro. ' +
      'Traz as CONTAGENS, nao o NPS calculado: percentual pronto nao pode ser ' +
      'reagregado para semana ou mes.',
    dax: (de, ate) => `-- Contagens de NPS por filial e dia, canal Loja.
--
-- Traz PROMOTOR / NEUTRO / DETRATOR separados, nao o NPS pronto: o portal
-- recalcula (P - D) / (P + N + D) sobre os TOTAIS do periodo. Guardar o
-- percentual impediria reagregar para semana e mes.
--
-- Conferido: nas 27 linhas de 10 a 12/08/2026, P+N+D bate com COUNTROWS(fNPS)
-- e (P-D)/(P+N+D)*100 reproduz a medida oficial [NPS Final] em todas.
--
-- O filtro de filial nao e' opcional: no canal Loja o dataset traz tambem
-- 81-OBC, 82-OSAL, 92-CAB e 93-ALH, que nao existem no portal — e a ingestao
-- recusa o lote INTEIRO ao ver sigla desconhecida.
EVALUATE
VAR _Inicio = ${de}
VAR _Fim    = ${ate}
RETURN
CALCULATETABLE (
    SUMMARIZECOLUMNS (
        fNPS[COD-FILIAL PEDIDO],
        dCalendario[Date],
        KEEPFILTERS (
            FILTER (
                ALL ( dCalendario[Date] ),
                dCalendario[Date] >= _Inicio && dCalendario[Date] <= _Fim
            )
        ),
        "PROMOTORES", CALCULATE ( COUNTROWS ( fNPS ), fNPS[Classificação NPS] = "PROMOTOR" ),
        "NEUTROS",    CALCULATE ( COUNTROWS ( fNPS ), fNPS[Classificação NPS] = "NEUTRO" ),
        "DETRATORES", CALCULATE ( COUNTROWS ( fNPS ), fNPS[Classificação NPS] = "DETRATOR" )
    ),
    fNPS[Canal] = "Loja",
    fNPS[COD-FILIAL PEDIDO]
        IN { ${FILIAIS_GD.map((f) => `"${f.cod} - ${f.sigla}"`).join(', ')} }
)`,
    mapear: (l) => ({
      // A coluna vem como "1 - CEN" neste dataset, e como "1.CEN" no de vendas;
      // `sigla` trata os dois.
      filial: sigla(campo(l, 'fNPS[COD-FILIAL PEDIDO]', 'COD-FILIAL PEDIDO')),
      data: iso(campo(l, 'dCalendario[Date]', 'DATA')),
      // Faixa sem nenhuma resposta no dia vem BLANK do DAX, que `inteiro`
      // converte para 0 — e zero detrator e' informacao, nao ausencia.
      qtdPromotores: inteiro(campo(l, '[PROMOTORES]', 'PROMOTORES')),
      qtdNeutros: inteiro(campo(l, '[NEUTROS]', 'NEUTROS')),
      qtdDetratores: inteiro(campo(l, '[DETRATORES]', 'DETRATORES')),
    }),

    /**
     * A meta de NPS é **75, fixa para todas as lojas** — a medida `[Meta NPS]`
     * é constante e não depende de contexto nenhum.
     *
     * Por isso a consulta devolve UMA linha, e a expansão para a grade
     * (filial × ano × mês) acontece do lado do portal: quais anos preencher é
     * decisão de RETENÇÃO do portal (ano corrente + anterior), não informação
     * que o Power BI tenha. Pedir a grade ao Power BI significaria trazer ~5.400
     * linhas diárias para extrair 216 metas.
     */
    daxMeta: () => `-- Meta de NPS: constante, igual para todas as lojas.
-- Uma linha so'; o portal expande para filial x ano x mes.
EVALUATE ROW ( "META", [Meta NPS] )`,
    montarMetas: (linhas) => {
      const valor = num(campo(linhas[0] ?? {}, '[META]', 'META'))
      if (!valor) throw new Error('A medida [Meta NPS] voltou vazia ou zero.')

      // Ano corrente e anterior, a mesma retencao do portal (ANOS_RETIDOS = 1).
      // Calculado na hora, e nao fixo em 2025/2026, para nao parar de cobrir o
      // ano novo silenciosamente na virada.
      const atual = new Date().getFullYear()
      const metas = []
      for (const ano of [atual - 1, atual]) {
        for (let mes = 1; mes <= 12; mes++) {
          for (const f of FILIAIS_GD) {
            metas.push({ indicador: 'nps', filial: f.sigla, ano, mes, valor })
          }
        }
      }
      return metas
    },
  },
  {
    arquivo: '04-perdas',
    titulo: 'Portal GD · Perdas',
    fonte: 'perdas',
    /**
     * Origem passou de Power BI para ORACLE em 22/08/2026, por decisão do
     * analista. O caminho antigo era Power Automate → DAX → n8n → portal.
     *
     * A troca só foi possível depois de o SQL **reproduzir o Power BI ao
     * centavo**: 01 a 20/08/2026, as 9 filiais fechando com diferença 0,00, e QI
     * e QNI também. Faltavam três filtros de definição do indicador, todos
     * encontrados nessa conferência:
     *
     *  1. **Despesas Internas** — `linha NOT LIKE 'X%'`. A consulta original
     *     cortava só `'XB%'` e deixava as outras dentro: 28,7 mil de 73,7 mil de
     *     diferença.
     *  2. **TIPO LOCAL-AJUSTE = LJA** — não existia. Pouco em valor (8 linhas de
     *     e-commerce), mas é a definição.
     *  3. **NEGOCIACAO fora** — era exatamente o resto, -44.997,27, e por isso
     *     toda a diferença aparecia em QI.
     *
     * Reconferir é `npm run comparar:perdas`.
     */
    tipo: 'sql',
    janelaDias: 730,
    hora: 3,
    minuto: 15,
    pronta: true,
    // Sem gatilho de Power Automate: a consulta é do Oracle, executada pelo
    // próprio portal. A variável some junto com o fluxo do n8n.
    endpointEnv: null,
    nota:
      'Janela de 2 ANOS, nao 60 dias: o valor de um dia ja fechado MUDA quando ' +
      'uma quebra pendente e aprovada depois. Origem ORACLE (direto, sem n8n) ' +
      'desde 22/08/2026 — o SQL reproduz o Power BI ao centavo.',
    dax: null,
    /**
     * ~380 linhas, em `sql/perdas.sql`.
     *
     * CONSTANTE e não função, como movimentação: a janela entra por bind (`:de`,
     * `:ate`), não interpolada no texto. Data interpolada dependeria do
     * `NLS_DATE_FORMAT` da sessão e poderia trazer o período errado sem falhar.
     *
     * Leva 60 a 104 segundos por mês — usa o perfil `carga` do
     * `lib/oracle.ts`, com teto de 20 minutos, e não o teto de 60 s da API.
     */
    sql: lerSql('perdas'),
    mapear: (l) => ({
      // O SQL devolve a filial como NUMERO (1..9), como movimentacao. A DAX
      // antiga devolvia `dFiliais[Dig. Empresa]`, tambem numero — mesmo formato,
      // outra origem.
      filial: siglaDoCodigo(campo(l, 'FILIAL')),
      data: iso(campo(l, 'DATA', 'DATA_ENTRADA')),
      // QI = quebra identificada, QNI = nao identificada. Os dois unicos valores
      // possiveis: o SQL classifica EXCESSO e EXTRAVIO como QNI, DANO como QI, e
      // NEGOCIACAO nao entra.
      tipoQuebra: String(campo(l, 'TIPO_QUEBRA') ?? '')
        .trim()
        .toUpperCase(),
      // Constante. O SQL nao filtra status porque nao precisa: a conferencia
      // mostrou que `[Perda Total]` sem filtro de status E' o aprovado, identico
      // linha por linha, e o SQL reproduz esse numero. Nao ha' PENDENTE nesta
      // origem.
      status: 'APROVADA',
      // SINAL PRESERVADO, como vem da origem. E' a convencao que a empresa usa
      // nos dashboards — inverter aqui faria o portal discordar de todo o resto.
      //
      // Nenhum sinal esta associado a um tipo: QI (identificada) e QNI (nao
      // identificada) podem vir positivas ou negativas. Medido em agosto/2026:
      // QNI veio POSITIVA (+694,93) porque o excesso superou o extravio.
      //
      // Consequencia: `perdas` e' MAIOR_MELHOR, nao MENOR_MELHOR, e a meta e'
      // NEGATIVA. Com valores negativos "menor e' melhor" mente: entre -0,2% e
      // -5,0% o menor e' o PIOR. Ver o comentario de sentido em indicadores.ts.
      valor: num(campo(l, 'VALOR')),
    }),
    daxMeta: null,
    montarMetas: null,
  },
  {
    arquivo: '05-movimentacao',
    titulo: 'Portal GD · Movimentação',
    fonte: 'movimentacao',
    // 60 dias, nao 730 como Perdas. A janela longa de Perdas existe porque uma
    // quebra PENDENTE vira APROVADA meses depois e altera um dia ja fechado —
    // nota fiscal emitida nao se reclassifica assim. O historico entra por
    // backfill (webhook com {de, ate}), uma vez.
    //
    // Muda a janela de ATUALIZACAO, nao a de RETENCAO: a tabela continua
    // guardando 2 anos. E como Vendas e NPS, o preco e' que um buraco mais
    // antigo que 60 dias so' se conserta por recarga manual.
    janelaDias: 60,
    hora: 3,
    minuto: 20,
    // Conferida: 19 de 20 meses batendo ao centavo com o Power BI depois de
    // remover o filtro de CANAL_VENDA. A divergencia do mes restante era
    // dashboard desatualizado, nao a consulta.
    pronta: true,
    // Sem Power Automate: consulta do Oracle, executada pelo proprio portal.
    endpointEnv: null,
    /**
     * Origem é o ORACLE, não o Power BI.
     *
     * Não foi escolha: a medida `[Movimentação Total]` do dataset de Perdas só
     * responde no grão MENSAL. Medido — no diário devolve zero linha, com ou
     * sem os filtros de negócio. Como `fato_movimentacao` é diária e o gráfico
     * semanal de Perdas precisa da semana, a origem tem de ser o banco.
     *
     * Consequência: `dax` é `null` e a consulta vive em `sql`. E `sql` é uma
     * CONSTANTE, não uma função: a janela entra por bind parameter (`:de`,
     * `:ate`) no nó Oracle, em vez de ser interpolada no texto como o DAX
     * precisa fazer.
     */
    tipo: 'sql',
    nota:
      'Denominador de Perdas % Mov; sem ele o indicador nao existe. Origem: ' +
      'ORACLE (no Oracle Database), nao Power BI — a medida do dataset de ' +
      'Perdas so responde no grao mensal. Janela de 60 dias; o historico entra ' +
      'por backfill via webhook: POST { "de": "2025-01-01", "ate": "..." }.',
    dax: null,
    sql: SQL_MOVIMENTACAO,
    mapear: (l) => ({
      // O SQL devolve a filial como NUMERO (1..9), nao como texto com prefixo.
      filial: siglaDoCodigo(campo(l, 'FILIAL')),
      data: iso(campo(l, 'DATEMISSAO', 'DATA')),
      valor: num(campo(l, 'MOVIMENTACAO', 'MOVIMENTAÇÃO')),
    }),
    daxMeta: null,
    montarMetas: null,
  },
  {
    arquivo: '07-vendedor-area',
    titulo: 'Portal GD \u00b7 Vendedor e area',
    fonte: 'vendedor-area',
    /**
     * CADASTRO, nao fato: e' quem existe HOJE, e por isso nao tem janela.
     *
     * RODA ANTES de `vendedor-dia` e `vendedor-situacao` -- as duas apontam
     * para `dimensao_vendedor`, que so' nasce aqui, e sao RECUSADAS se
     * chegarem primeiro. Nao e' convencao: e' a unica carga que traz a area, e
     * `area_venda_id` e' obrigatoria.
     *
     * E depende de `vendas-linha` ter rodado, porque a AREA nasce la'. Cadeia
     * inteira: vendas-linha -> vendedor-area -> vendedor-dia/situacao.
     */
    tipo: 'sql',
    janelaDias: null,
    hora: 3,
    minuto: 40,
    pronta: true,
    endpointEnv: null,
    nota:
      'Cadastro, sem janela. Roda DEPOIS de vendas-linha (a area nasce la) e ' +
      'ANTES de vendedor-dia e vendedor-situacao (o vendedor nasce aqui). ' +
      'Vendedor sem area cadastrada nao sai da consulta -- o JOIN e INNER.',
    dax: null,
    sql: lerSql('vendedor-area'),
    mapear: (l) => ({
      filial: siglaDoCodigo(campo(l, 'COD_EMPRESA', 'cod_empresa')),
      codVendedor: String(campo(l, 'COD_VENDEDOR', 'cod_vendedor') ?? '').trim(),
      // Nula em conta generica: ponto de venda nao e' pessoa e nao tem
      // matricula. E' ponte para o colaborador, nunca chave.
      matricula: campo(l, 'MATRICULA', 'matricula') == null
        ? null
        : String(campo(l, 'MATRICULA', 'matricula')).trim(),
      nome: String(campo(l, 'NOME', 'nome') ?? '').trim(),
      cdArea: String(campo(l, 'CD_AREA', 'cd_area') ?? '').trim(),
      areaVenda: String(campo(l, 'AREA_VENDA', 'area_venda') ?? '').trim(),
      gerencia: String(campo(l, 'GERENCIA', 'gerencia') ?? '').trim(),
    }),
    daxMeta: null,
    montarMetas: null,
  },
  {
    arquivo: '11-area-supervisor',
    titulo: 'Portal GD · Supervisor da area',
    fonte: 'area-supervisor',
    /**
     * CADASTRO, sem janela. Roda DEPOIS de `vendas-linha` ou de
     * `vendedor-area` -- e' uma delas que cria a area; esta so' escreve o nome
     * do supervisor nela.
     */
    tipo: 'sql',
    janelaDias: null,
    hora: 3,
    minuto: 42,
    pronta: true,
    endpointEnv: null,
    nota:
      'Grava o campo `supervisor` de dimensao_area_venda. Area desconhecida e ' +
      'RECUSA: aqui nao vem gerencia, e area sem gerencia nao existe no portal.',
    dax: null,
    sql: lerSql('area-supervisor'),
    mapear: (l) => ({
      filial: siglaDoCodigo(campo(l, 'COD_EMPRESA', 'cod_empresa')),
      cdArea: String(campo(l, 'CD_AREA', 'cd_area') ?? '').trim(),
      areaVenda: String(campo(l, 'AREA_VENDA', 'area_venda') ?? '').trim(),
      gerencia: String(campo(l, 'GERENCIA', 'gerencia') ?? '').trim(),
      // NOMFUN, o nome da PESSOA no cadastro de colaborador -- nao AGTV.NOME,
      // que e' rotulo de conta de venda. Nulo quando ninguem casou.
      supervisor: campo(l, 'SUPERVISOR', 'supervisor') == null
        ? null
        : String(campo(l, 'SUPERVISOR', 'supervisor')).trim() || null,
    }),
    daxMeta: null,
    montarMetas: null,
  },
  {
    arquivo: '08-vendedor-dia',
    titulo: 'Portal GD \u00b7 Venda por vendedor',
    fonte: 'vendedor-dia',
    tipo: 'sql',
    janelaDias: 60,
    hora: 3,
    minuto: 45,
    pronta: true,
    endpointEnv: null,
    nota:
      'Realizado de Performance Vendedor. A medida e LIQUIDA (venda - devolucao ' +
      '+ refaturamento) e os filtros sao outros: a soma NAO bate com ' +
      'vendas-linha, e nao deve. Exige vendedor-area carregado antes.',
    dax: null,
    sql: lerSql('vendedor-dia'),
    mapear: (l) => ({
      filial: siglaDoCodigo(campo(l, 'COD_EMPRESA', 'cod_empresa')),
      data: iso(campo(l, 'DATA', 'data')),
      codVendedor: String(campo(l, 'COD_VENDEDOR', 'cod_vendedor') ?? '').trim(),
      // Aceita NEGATIVO: dia em que a devolucao supera a venda fecha negativo
      // de verdade. Forcar para positivo mudaria o numero sem sintoma nenhum.
      valor: num(campo(l, 'VALOR', 'valor')),
    }),
    daxMeta: null,
    montarMetas: null,
  },
  {
    arquivo: '09-vendedor-situacao',
    titulo: 'Portal GD \u00b7 Situacao e cota do vendedor',
    fonte: 'vendedor-situacao',
    /**
     * Por COMPETENCIA, nao por dia: `janelaDias` e' nulo e a substituicao e'
     * dos meses presentes no lote.
     *
     * E TEM de ser substituicao. `HOUVE_VENDA` e' calculada com SYSDATE na
     * origem: enquanto o mes corre todo mundo e' MES EM VIGOR, e quando fecha
     * a MESMA linha vira COM VENDA ou SEM VENDA. So'-insercao congelaria o mes
     * como MES EM VIGOR e o denominador nunca mais mudaria.
     */
    tipo: 'sql',
    janelaDias: null,
    hora: 3,
    minuto: 50,
    pronta: true,
    endpointEnv: null,
    nota:
      'Situacao e COTA por mes. Recarregar o mes CORRENTE todo dia e o mes ' +
      'anterior ao menos uma vez depois de fechado: HOUVE_VENDA muda de rotulo ' +
      'na virada do mes. Exige vendedor-area carregado antes.',
    dax: null,
    sql: lerSql('vendedor-situacao'),
    mapear: (l) => ({
      filial: siglaDoCodigo(campo(l, 'COD_EMPRESA', 'cod_empresa')),
      codVendedor: String(campo(l, 'COD_VENDEDOR', 'cod_vendedor') ?? '').trim(),
      ano: inteiro(campo(l, 'ANO', 'ano')),
      mes: inteiro(campo(l, 'MES', 'mes')),
      meta: num(campo(l, 'META', 'meta')),
      sitafa: inteiro(campo(l, 'SITAFA', 'sitafa')),
      // 'MES EM VIGOR' -> 'MES_EM_VIGOR'. O acento sai porque o enum do
      // Postgres nao o tem -- e um rotulo com acento viraria valor novo.
      houveVenda: String(campo(l, 'HOUVE_VENDA', 'houve_venda') ?? '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ /g, '_')
        .toUpperCase(),
    }),
    daxMeta: null,
    montarMetas: null,
  },
  {
    arquivo: '10-dias-uteis',
    titulo: 'Portal GD \u00b7 Dias uteis por filial',
    fonte: 'dias-uteis',
    tipo: 'sql',
    janelaDias: null,
    hora: 3,
    minuto: 55,
    pronta: true,
    endpointEnv: null,
    nota:
      'Calendario por FILIAL: Norte abre domingo e Gustavo nao. A ' +
      'ingestao confere o acumulado contra o QTUTIL da origem nos meses ' +
      'completos, e recusa o lote se divergir.',
    dax: null,
    sql: lerSql('dias-uteis'),
    mapear: (l) => ({
      filial: siglaDoCodigo(campo(l, 'COD_EMPRESA', 'cod_empresa')),
      data: iso(campo(l, 'DATA', 'data')),
      diaUtil: inteiro(campo(l, 'DIA_UTIL', 'dia_util')) === 1,
      acumuladoDia: inteiro(campo(l, 'ACUMULADO_DIA', 'acumulado_dia')),
      // O QTUTIL da ORIGEM. E' contra ele que a ingestao confere a contagem
      // derivada das marcas de FERIADO<n>.
      uteisDoMes: inteiro(campo(l, 'QTUTIL', 'qtutil')),
    }),
    daxMeta: null,
    montarMetas: null,
  },
]

/** Fonte por nome, com erro que lista as válidas. */
export function acharFonte(nome) {
  const f = FONTES.find((x) => x.fonte === nome)
  if (!f) {
    throw new Error(
      `Fonte desconhecida: "${nome}". Válidas: ${FONTES.map((x) => x.fonte).join(', ')}.`,
    )
  }
  return f
}

/** `'2026-08-19'` -> `DATE ( 2026, 8, 19 )`. */
export function expressaoData(iso) {
  const [a, m, d] = String(iso).split('-')
  return `DATE ( ${Number(a)}, ${Number(m)}, ${Number(d)} )`
}

import { consultar } from '../../lib/oracle.js'
import { TRABALHANDO } from '../../lib/sitafa.js'

/**
 * O catálogo de perfis corporativos, lido de `hr_vw_colaboradores`.
 *
 * O portal não guarda esta lista: ela é do RH e muda quando o RH muda. O que o
 * portal guarda é a CLASSIFICAÇÃO (`perfil_nivel`) e as ASSOCIAÇÕES
 * (`perfil_variavel`) — decisões próprias, sobre chaves de fora.
 *
 * Três coisas medidas na view, todas contraintuitivas o bastante para valerem
 * registro:
 *
 * **1. `SITAFA = 1` é quem está trabalhando, não `0`.** A view tem 6.061 linhas
 * distribuídas em SITAFA 1 (5.223), 7, 2, 3, 6, 4, 14 e 8 — nenhuma em 0. Uma
 * consulta filtrando por zero volta vazia e parece "nenhum resultado" em vez de
 * "filtro errado".
 *
 * **2. `id_perfil` é cargo × LOTAÇÃO, e `nomloc` é a lotação — não a filial.**
 *
 * Foi o analista quem apontou, e o dado confirma. "GERENTE ADJUNTO" tem quatro
 * `id_perfil`, um por setor:
 *
 * | perfil | nomloc | |
 * |---|---|---|
 * | 16 | ATENDIMENTO E SERVICOS | 7 pessoas em 7 empresas |
 * | 17 | OPERACIONAL | 5 em 5 |
 * | 18 | VENDAS CONSTRUCAO | 9 em 8 |
 * | 19 | VENDAS NAO CONSTRUCAO | 6 em 6 |
 *
 * Cada perfil **atravessa as filiais**. A filial é o `cod_empresa` (1 a 9 são as
 * do GD, 99 corporativo, 8x/9xxx os CDs), e ela não entra nesta chave.
 *
 * Consequência para a granularidade: 372 dos 447 perfis (83%) têm **uma lotação
 * só**, e nesses o `nomloc` é implicado pelo `id_perfil` — não há o que escolher.
 * O par só discrimina nos 75 restantes, e sobretudo em VENDEDOR (21 lotações) e
 * ATENDENTE (27), que são os cargos de piso de loja repartidos por departamento.
 * No total, 447 perfis produzem 602 pares.
 *
 * Consequência para a leitura da tela: `cargos` é LISTA porque a relação também
 * não é 1:1 na outra direção — o `id_perfil` 229 cobre 8 cargos (ELETRICISTA,
 * PINTOR, SERRALHEIRO…). Rotular com um cargo escolhido a esmo faria o
 * administrador classificar a coisa errada.
 *
 * **3. Os campos vêm com espaço à direita.** `titred` traz espaço sobrando em
 * 1.239 das 6.061 linhas, `nomloc` em 4. O tipo declarado é VARCHAR2, então o
 * padding vem do dado, não da coluna — `TRIM` em toda leitura, sempre. Sem isso
 * o `nomloc` gravado no `perfil_variavel` não casa com o do login, e a pessoa
 * não vê variável nenhuma sem erro nenhum aparecer.
 */



export interface PerfilCorporativo {
  idPerfil: number
  /** Cargos que o perfil cobre, do mais numeroso ao menos. Ver item 2. */
  cargos: string[]
  /**
   * Lotações do perfil, da mais numerosa à menos.
   *
   * Vem no catálogo, e não só na tela de associação, porque **é o que distingue
   * um perfil do outro**. "GERENTE ADJUNTO" tem quatro `id_perfil` — 16, 17, 18,
   * 19 — todos com o mesmo cargo e uma lotação só cada. Sem a lotação na lista,
   * o administrador vê quatro linhas idênticas e não tem como saber qual
   * classificar.
   */
  lotacoes: string[]
  /** Pessoas trabalhando neste perfil. */
  pessoas: number
  /** Quantas lotações distintas o perfil atinge. */
  locais: number
}

/**
 * Catálogo inteiro, uma linha por `id_perfil`.
 *
 * São 447 perfis com gente trabalhando (462 contando os que só têm afastado), o
 * que cabe numa resposta só — paginar aqui só atrasaria a tela, porque o
 * administrador precisa BUSCAR no conjunto todo para achar o cargo que quer
 * classificar.
 *
 * Perfil sem ninguém trabalhando fica fora. Ele reaparece se alguém voltar do
 * afastamento, e classificar perfil vazio é trabalho sem efeito — nenhum login
 * passa por ele hoje.
 */
export async function listarPerfis(): Promise<PerfilCorporativo[]> {
  /**
   * Três níveis porque as contagens têm grãos diferentes.
   *
   * `pessoas` e `locais` são por perfil; `cargos` precisa da contagem por cargo
   * para ordenar. Somar as contagens por cargo daria o total do perfil apenas se
   * ninguém aparecesse em dois cargos — e alguém aparece (ver abaixo). Por isso
   * `totais` conta de novo, do zero, no grão do perfil.
   *
   * A chave da pessoa é `cod_empresa || numcad`, não `numcad` sozinho: medido, a
   * matrícula 99993 tem duas linhas, em duas empresas e dois perfis. `numcad` é
   * único por empresa, não globalmente, e contar só por ele funde os dois
   * registros num só.
   *
   * `LISTAGG` ordenado por contagem antes de nome: o primeiro item é o que a tela
   * mostra quando não couber tudo, e o cargo mais numeroso descreve melhor o
   * perfil do que o primeiro em ordem alfabética.
   */
  /**
   * `PESSOAS` e `LOCAIS` como `number | string`, e não `number`.
   *
   * O genérico de `consultar` é uma AFIRMAÇÃO nossa sobre o que o driver
   * devolve, não uma garantia dele. Medido, `node-oracledb` devolve NUMBER como
   * `number` — mas o próprio driver tem configuração para devolver string
   * (`fetchAsString`), e uma soma acima do inteiro seguro do JS é candidata a
   * isso. Declarar `number` puro tornaria o `Number()` "redundante" para o
   * compilador, e removê-lo trocaria soma por concatenação de texto no dia em
   * que a origem passasse do limite — sem erro nenhum, com o total errado.
   */
  const { linhas, truncado } = await consultar<{
    ID_PERFIL: number | string
    CARGOS: string
    LOTACOES: string
    PESSOAS: number | string
    LOCAIS: number | string
  }>(
    `WITH base AS (
       SELECT id_perfil,
              TRIM(titred) AS cargo,
              TRIM(nomloc) AS lotacao,
              cod_empresa || '/' || numcad AS pessoa
         FROM hr_vw_colaboradores
        WHERE ${TRABALHANDO} AND id_perfil IS NOT NULL
     ),
     por_cargo AS (
       SELECT id_perfil, cargo, COUNT(DISTINCT pessoa) AS quantos
         FROM base GROUP BY id_perfil, cargo
     ),
     por_lotacao AS (
       SELECT id_perfil, lotacao, COUNT(DISTINCT pessoa) AS quantos
         FROM base GROUP BY id_perfil, lotacao
     ),
     totais AS (
       SELECT id_perfil,
              COUNT(DISTINCT pessoa) AS pessoas,
              COUNT(DISTINCT lotacao) AS locais
         FROM base GROUP BY id_perfil
     ),
     /* Agregadas em SEPARADO e reunidas por id_perfil depois. Juntar as duas
        listas num JOIN só multiplicaria as linhas (cargos × lotações), e o
        LISTAGG repetiria cada nome uma vez por combinação. */
     cargos AS (
       SELECT id_perfil,
              LISTAGG(cargo, '|') WITHIN GROUP (ORDER BY quantos DESC, cargo) AS lista
         FROM por_cargo GROUP BY id_perfil
     ),
     lotacoes AS (
       SELECT id_perfil,
              LISTAGG(lotacao, '|') WITHIN GROUP (ORDER BY quantos DESC, lotacao) AS lista
         FROM por_lotacao GROUP BY id_perfil
     )
     SELECT t.id_perfil AS ID_PERFIL,
            c.lista AS CARGOS,
            l.lista AS LOTACOES,
            t.pessoas AS PESSOAS,
            t.locais AS LOCAIS
       FROM totais t
       JOIN cargos c ON c.id_perfil = t.id_perfil
       JOIN lotacoes l ON l.id_perfil = t.id_perfil
      ORDER BY t.id_perfil`,
  )

  /**
   * Truncado aqui seria catálogo incompleto exibido como completo — o
   * administrador não acharia um perfil e concluiria que ele não existe. O teto
   * é de 50.000 linhas contra 447 esperadas, então isto só dispara se a view
   * mudar de natureza.
   */
  if (truncado) {
    throw new Error(
      'O catálogo de perfis voltou truncado do Oracle. Exibi-lo incompleto faria ' +
        'perfis desaparecerem da busca sem aviso. Aumente ORACLE_MAX_ROWS.',
    )
  }

  return linhas.map((l) => ({
    idPerfil: Number(l.ID_PERFIL),
    cargos: l.CARGOS.split('|'),
    lotacoes: l.LOTACOES.split('|'),
    pessoas: Number(l.PESSOAS),
    locais: Number(l.LOCAIS),
  }))
}

export interface LocalDoPerfil {
  nomloc: string
  pessoas: number
  /**
   * Empresas em que este `(perfil, lotação)` ocorre, em ordem de código.
   *
   * Código e não quantidade de pessoas: a ordem do código é a ordem das filiais
   * (1 CEN, 2 NOR, 3 SUL…), que é como a tela lista filial em todo o resto do
   * portal. Ordenar por gente daria uma lista embaralhada a cada perfil.
   */
  empresas: Array<{ codEmpresa: number; pessoas: number }>
}

/**
 * Os escopos de um perfil: cada lotação e, dentro dela, cada empresa.
 *
 * Existe porque a associação é pelo TRIO `(id_perfil, nomloc, cod_empresa)`, e as
 * três partes têm de vir da fonte — o administrador não pode digitá-las. Duas
 * proporções medidas moldam a tela:
 *
 * - **83% dos perfis têm uma lotação só** (o `id_perfil` já é específico dela);
 * - **69% dos pares `(perfil, lotação)` existem em uma empresa só.**
 *
 * Nos dois casos não há o que escolher, e a tela seleciona sozinha. O peso está
 * nos 54 pares que atravessam as 9 filiais — e para esses a API grava várias
 * empresas por requisição, senão seria o mesmo clique nove vezes.
 *
 * Listar os escopos reais evita associação a um trio que não ocorre. Ela nunca
 * casaria com ninguém no login, e o sintoma seria a pessoa sem variável nenhuma,
 * sem erro nenhum aparecer.
 */
export async function listarLocaisDoPerfil(idPerfil: number): Promise<LocalDoPerfil[]> {
  const { linhas } = await consultar<{
    NOMLOC: string
    COD_EMPRESA: number | string
    PESSOAS: number | string
  }>(
    `SELECT TRIM(nomloc) AS NOMLOC, cod_empresa AS COD_EMPRESA,
            COUNT(DISTINCT numcad) AS PESSOAS
       FROM hr_vw_colaboradores
      WHERE ${TRABALHANDO} AND id_perfil = :idPerfil AND nomloc IS NOT NULL
      GROUP BY TRIM(nomloc), cod_empresa
      ORDER BY 1, 2`,
    { idPerfil },
  )

  /**
   * Agrupa em memória em vez de duas consultas.
   *
   * `COUNT(DISTINCT numcad)` basta aqui, sem compor com a empresa: dentro de uma
   * empresa a matrícula é única — a duplicidade medida (99993) era entre
   * empresas diferentes, e aqui a empresa já é a chave do grupo.
   */
  const porLotacao = new Map<string, LocalDoPerfil>()
  for (const l of linhas) {
    let atual = porLotacao.get(l.NOMLOC)
    if (!atual) {
      atual = { nomloc: l.NOMLOC, pessoas: 0, empresas: [] }
      porLotacao.set(l.NOMLOC, atual)
    }
    atual.pessoas += Number(l.PESSOAS)
    atual.empresas.push({ codEmpresa: Number(l.COD_EMPRESA), pessoas: Number(l.PESSOAS) })
  }

  // Lotação com mais gente primeiro: é a que o administrador provavelmente quer.
  return [...porLotacao.values()].sort((a, b) => b.pessoas - a.pessoas)
}

/**
 * Um perfil existe na view? Usado antes de gravar classificação.
 *
 * Sem esta checagem, um `id_perfil` digitado errado entra no `perfil_nivel` e
 * fica lá para sempre: não casa com ninguém, não dá erro, e some no meio dos
 * outros. Falha cedo é mais barato.
 */
export async function perfilExiste(idPerfil: number): Promise<boolean> {
  const { linhas } = await consultar<{ N: number | string }>(
    `SELECT COUNT(*) AS N FROM hr_vw_colaboradores
      WHERE ${TRABALHANDO} AND id_perfil = :idPerfil`,
    { idPerfil },
  )
  return Number(linhas[0]?.N ?? 0) > 0
}

/**
 * Quais das empresas pedidas realmente ocorrem no `(id_perfil, nomloc)`.
 *
 * Devolve as que existem, não um booleano: quem chama precisa dizer **quais**
 * foram recusadas. Uma gravação de nove filiais em que duas não ocorrem tem de
 * apontar as duas, e não recusar o lote inteiro sem dizer qual é o problema.
 *
 * `TRIM` na comparação porque o `nomloc` que chega já veio normalizado, mas o da
 * view não — ver o item 3 do bloco no topo.
 */
export async function empresasQueExistem(
  idPerfil: number,
  nomloc: string,
  empresas: number[],
): Promise<Set<number>> {
  if (empresas.length === 0) return new Set()

  /**
   * `IN` por BIND, um por empresa — nada de lista interpolada no texto.
   *
   * A versão anterior interpolava, e era defensável: os valores já vinham
   * validados como inteiros pelo schema da rota e eram filtrados de novo aqui.
   * Mas "seguro porque validei antes" é a frase que precede todo incidente de
   * injeção: a validação está em outro arquivo, e nada obriga o próximo chamador
   * a repeti-la. O driver não aceita array direto em `IN`, então os nomes são
   * montados — o que dá um SQL com `:e0, :e1, ...` e zero texto vindo de fora.
   */
  const inteiras = empresas.filter(Number.isInteger)
  if (inteiras.length === 0) return new Set()

  const nomes = inteiras.map((_, i) => `:e${i}`).join(', ')
  const bindsEmpresas = Object.fromEntries(inteiras.map((e, i) => [`e${i}`, e]))

  const { linhas } = await consultar<{ COD_EMPRESA: number | string }>(
    `SELECT DISTINCT cod_empresa AS COD_EMPRESA FROM hr_vw_colaboradores
      WHERE ${TRABALHANDO} AND id_perfil = :idPerfil AND TRIM(nomloc) = :nomloc
        AND cod_empresa IN (${nomes})`,
    { idPerfil, nomloc, ...bindsEmpresas },
  )

  return new Set(linhas.map((l) => Number(l.COD_EMPRESA)))
}

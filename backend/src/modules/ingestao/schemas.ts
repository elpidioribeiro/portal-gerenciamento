import { z } from 'zod'

/**
 * Contrato dos payloads que o n8n envia.
 *
 * O portal define a forma e valida tudo: dado que entra errado no banco não dá
 * sintoma na hora, só semanas depois, quando alguém questiona um número no
 * painel da diretoria. É mais barato recusar a carga.
 */

/** Data no formato ISO `YYYY-MM-DD`, sem hora. */
const dataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'data inválida')

const sigla = z.string().min(1).max(20)

/** Envelope comum: a janela que este lote SUBSTITUI. */
export const periodoSchema = z
  .object({ de: dataIso, ate: dataIso })
  .refine((p) => p.de <= p.ate, { message: '`de` não pode ser depois de `ate`' })

function envelope<T extends z.ZodTypeAny>(linha: T) {
  return z.object({
    periodo: periodoSchema,
    /**
     * `min(1)`: lote VAZIO é recusado, e a recusa é do servidor.
     *
     * A ingestão SUBSTITUI a janela — apaga o período e grava o que chegou.
     * Lote vazio, portanto, apaga dado bom e não repõe nada. Uma consulta que
     * falhou sem erro (coluna renomeada na origem, filtro que deixou de casar,
     * credencial expirada devolvendo lista vazia) tem exatamente esse formato.
     *
     * A trava já existia nos dois clientes — `recarregar.ts` e o nó de código do
     * n8n abortam antes de enviar. Não bastava: **quem apaga é o servidor**, e
     * ele aceitava. Descoberto ao testar a rotação do `INGEST_TOKEN` com um
     * payload vazio; a janela escolhida por acaso não tinha dado, e por sorte
     * nada se perdeu.
     *
     * Se um dia for preciso esvaziar uma janela de propósito, que seja por um
     * caminho que diga isso no nome — não por um lote vazio que parece carga
     * normal.
     */
    linhas: z.array(linha).min(1, 'lote vazio apagaria a janela sem repor nada').max(200_000),
  })
}

const naoNegativo = z.number().finite().nonnegative()

export const vendasSchema = envelope(
  z.object({
    filial: sigla,
    data: dataIso,
    valorReal: naoNegativo,
    tendencia: naoNegativo,
    /**
     * Desvio % da tendência sobre a meta, calculado na origem.
     * Opcional: sem ele, o portal calcula a partir da própria meta cadastrada.
     */
    deltaMeta: z.number().finite().optional(),
  }),
)

export const vendasLinhaSchema = envelope(
  z.object({
    filial: sigla,
    data: dataIso,
    /**
     * A hierarquia de venda, obrigatória desde 26/08/2026.
     *
     *   gerência     Construção / Não Construção — escopo do gerente adjunto
     *     areaVenda  tem supervisor, e é O GRÃO do fato
     *
     * Antes a ingestão criava toda linha numa área literal `(não classificada)`,
     * e por isso a dimensão existia sem nunca ter tido conteúdo de verdade — o
     * escopo do N4 não tinha como sair do dado.
     *
     * HAVIA UM TERCEIRO NÍVEL, a `linha` de produto, e ele era o grão até
     * 18/09/2026. Saiu porque nenhuma tela o lia: a única consulta que toca o
     * fato agrupa por área e descarta o resto. Guardava 33 vezes mais registro
     * do que a pergunta exige, e foi o que estourou a memória do pod em
     * produção. Ver o cabeçalho de `sql/vendas-linha.sql`.
     */
    gerencia: z.string().min(1),
    /**
     * O CÓDIGO da área no cadastro corporativo (`ERP_AREA_VENDA.CD_AREA`), que
     * é a identidade dela no portal desde 27/08/2026. `areaVenda` virou rótulo,
     * reafirmado a cada carga.
     *
     * Antes a identidade era o nome, e isso tinha um custo que só apareceria
     * tarde: corrigir a grafia no cadastro corporativo faria a próxima carga
     * criar uma área NOVA — meta órfã de um lado, área sem meta do outro, e
     * nenhum erro em lugar nenhum.
     */
    cdArea: z.string().min(1),
    areaVenda: z.string().min(1),
    valor: naoNegativo,
  }),
)

export const npsSchema = envelope(
  z.object({
    filial: sigla,
    data: dataIso,
    qtdPromotores: z.number().int().nonnegative(),
    qtdNeutros: z.number().int().nonnegative(),
    qtdDetratores: z.number().int().nonnegative(),
  }),
)

/**
 * Perdas é a ÚNICA fonte que aceita valor negativo, e não é frouxidão.
 *
 * O valor vem da origem **com sinal**, e nenhum sinal está associado a um tipo
 * de quebra: `QI` (identificada) e `QNI` (não identificada) podem vir positivas
 * ou negativas, sem nada pré-determinado.
 *
 * Recusar negativo derrubaria a carga inteira num dia desses. Forçar para
 * positivo seria pior: mudaria o número sem sintoma nenhum, e o total deixaria
 * de fechar com a origem.
 */
export const perdasSchema = envelope(
  z.object({
    filial: sigla,
    data: dataIso,
    tipoQuebra: z.enum(['QI', 'QNI']),
    status: z.enum(['PENDENTE', 'APROVADA']),
    valor: z.number().finite(),
  }),
)

export const movimentacaoSchema = envelope(
  z.object({ filial: sigla, data: dataIso, valor: naoNegativo }),
)

/**
 * Metas não têm janela de datas: são por competência (ano/mês), mudam
 * raramente e a carga é sob demanda. Por isso o envelope é diferente.
 */
export const metasSchema = z.object({
  linhas: z
    .array(
      z.object({
        indicador: z.enum(['vendas', 'nps', 'perdas', 'custo']),
        filial: sigla,
        ano: z.number().int().min(2000).max(2100),
        mes: z.number().int().min(1).max(12),
        valor: z.number().finite(),
        /**
         * Meta de ÁREA DE VENDA, quando presente.
         *
         * Sem ela, a meta é do indicador inteiro na filial — o comportamento de
         * sempre. Com ela, a meta é da área, no escopo `AREA_VENDA`, e é o
         * denominador de Performance Vendas (PLANO §7.10).
         *
         * A área é identificada pelo CÓDIGO, não por id nem por nome: quem
         * manda é uma consulta do Oracle, que não conhece os uuid do portal, e
         * o código é o mesmo par (filial, `cdArea`) que `vendas-linha` cria.
         *
         * A área é CRIADA se não existir, e isso mudou em 27/08/2026 -- ver
         * `areaVenda` e `gerencia` abaixo.
         */
        cdArea: z.string().min(1).optional(),
        /**
         * Rótulo e gerência da área, obrigatórios quando `cdArea` vem.
         *
         * A regra era recusar área desconhecida, com o argumento de que uma
         * área inventada receberia meta que nunca casaria com venda -- ficaria
         * no denominador para sempre, sem numerador.
         *
         * A primeira carga real derrubou o argumento: **7 áreas têm orçamento e
         * não venderam nem têm vendedor na janela**. Recusar não protegia nada
         * -- derrubava as 9.603 metas por causa de sete.
         *
         * E a área não é inventada: `cdArea` é código da origem, e a gerência
         * vem de `ERP_AREA_VENDA.TIPO_AREA`, o MESMO cadastro que `vendas-linha`
         * lê. Área com meta e sem venda aparece no quadro com gap de -100%, que
         * é informação, não erro.
         *
         * O conserto de verdade é outro, e está no PLANO: **área de venda
         * deveria ter carga de CADASTRO própria**, em vez de nascer de fato.
         * Três cargas tropeçaram no mesmo lugar antes de isso ficar claro.
         */
        areaVenda: z.string().min(1).optional(),
        gerencia: z.string().min(1).optional(),
      }),
    )
    .max(50_000),
})

// ─────────────────────────────────────────────────────────────────────────────
// Performance Vendedor — quatro cargas. Ver PLANO §7.14 e §7.15.
//
// A ORDEM IMPORTA, e não é convenção: `fato_venda_vendedor` e `vendedor_mes`
// apontam para `dimensao_vendedor`, que só nasce em `vendedor-area`. Quem
// chegar antes é RECUSADO, com a mensagem dizendo o que rodar primeiro —
// nunca criado pela metade, porque um vendedor sem área não entra em
// denominador nenhum e some do indicador sem nada acusar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cadastro do vendedor. Sem janela: é quem existe HOJE, não um fato datado.
 *
 * CRIA a área de venda quando ela não existe, e isso mudou em 27/08/2026.
 *
 * A regra era "a área nasce em `vendas-linha`, onde vem acompanhada do
 * movimento que a justifica". A primeira carga real mostrou o custo: 27 áreas
 * de CEN têm vendedor no cadastro e não tiveram venda na janela -- TELEVENDAS
 * entre elas. Recusar fazia o vendedor **sumir do indicador**, que é
 * exatamente o que a ordem das cargas existe para impedir.
 *
 * O argumento contra criar aqui não se sustenta: a gerência vem do MESMO
 * cadastro corporativo que `vendas-linha` lê (`ERP_AREA_VENDA.TIPO_AREA`), não
 * de um palpite. Metas continua recusando, e lá o argumento vale -- meta de
 * área inventada ficaria no denominador para sempre, sem numerador.
 */
export const vendedorAreaSchema = z.object({
  linhas: z
    .array(
      z.object({
        filial: sigla,
        /** `AGTV.CODIGO`. A chave — não a matrícula, que pode ser nula. */
        codVendedor: z.string().min(1),
        /** Nula em conta genérica: ponto de venda não é pessoa. */
        matricula: z.string().min(1).nullable(),
        nome: z.string().min(1),
        /** Código da área no cadastro corporativo. Ver `vendasLinhaSchema`. */
        cdArea: z.string().min(1),
        /** Rótulo da área. Reafirmado a cada carga, como em `vendas-linha`. */
        areaVenda: z.string().min(1),
        /** Construção / Não Construção, de `TIPO_AREA`. */
        gerencia: z.string().min(1),
      }),
    )
    .min(1, 'lote vazio')
    .max(50_000),
})

/**
 * Quem supervisiona cada área de venda.
 *
 * Grava um CAMPO de `dimensao_area_venda`, não uma tabela própria: o supervisor
 * é atributo da área, e uma tabela para ele exigiria uma junção a mais em toda
 * leitura do quadro para exibir um nome.
 *
 * `supervisor` é NULO quando a área existe e não tem ninguém casado no cadastro
 * de colaborador. Nulo é resposta -- a tela mostra "sem supervisor cadastrado",
 * que é diferente de a área não aparecer.
 *
 * CRIA a área quando ela não existe -- a consulta traz gerência de
 * `ERP_AREA_VENDA.TIPO_AREA`, o mesmo cadastro que `vendas-linha` lê. Três
 * áreas de CEN têm supervisor e não têm venda nem vendedor; recusar por causa
 * delas derrubava as 173 linhas do lote.
 *
 * É a TERCEIRA carga a precisar disso, depois de `vendedor-area` e de `metas`.
 * O conserto de verdade está no PLANO: área de venda deveria ter carga de
 * CADASTRO própria, em vez de nascer como efeito colateral de outra coisa.
 */
export const areaSupervisorSchema = z.object({
  linhas: z
    .array(
      z.object({
        filial: sigla,
        cdArea: z.string().min(1),
        areaVenda: z.string().min(1),
        gerencia: z.string().min(1),
        supervisor: z.string().min(1).nullable(),
      }),
    )
    .min(1, 'lote vazio')
    .max(10_000),
})

/**
 * Venda do vendedor por dia.
 *
 * `valor` aceita NEGATIVO, e não é frouxidão: a medida é `LIQUIDA` (venda
 * menos devolução mais refaturamento), e um dia em que a devolução supera a
 * venda fecha negativo de verdade. Recusar derrubaria a carga; forçar para
 * positivo mudaria o número sem sintoma nenhum.
 */
export const vendedorDiaSchema = envelope(
  z.object({
    filial: sigla,
    data: dataIso,
    codVendedor: z.string().min(1),
    valor: z.number().finite(),
  }),
)

/**
 * Situação e cota do vendedor no mês.
 *
 * Sem janela de DATAS — o grão é competência. A substituição é por (ano, mês)
 * dos meses presentes no lote, e tem de ser SUBSTITUIÇÃO: `houveVenda` é
 * calculada com `SYSDATE` na origem, então a mesma linha muda de rótulo quando
 * o mês fecha. Carga só-inserção congelaria o mês como `MES_EM_VIGOR` e o
 * denominador nunca mais mudaria.
 */
export const vendedorSituacaoSchema = z.object({
  linhas: z
    .array(
      z.object({
        filial: sigla,
        codVendedor: z.string().min(1),
        ano: z.number().int().min(2000).max(2100),
        mes: z.number().int().min(1).max(12),
        /** `COTA_MENSAL`. Zero significa sem meta, e fica FORA do denominador. */
        meta: z.number().finite().nonnegative(),
        sitafa: z.number().int(),
        houveVenda: z.enum(['SEM_VENDA', 'SUPERVISOR', 'MES_EM_VIGOR', 'COM_VENDA']),
      }),
    )
    .min(1, 'lote vazio')
    .max(200_000),
})

/**
 * Calendário de dias em que a loja abre, por filial.
 *
 * `uteisDoMes` é o `QTUTIL` da ORIGEM, e `acumuladoDia` é derivado das marcas
 * de `FERIADO<n>`. A ingestão confere um contra o outro nos meses completos —
 * é a única defesa contra uma leitura errada das marcas, e ela já pegou um mês
 * de cadastro incompleto na conferência de 27/08.
 */
export const diasUteisSchema = z.object({
  linhas: z
    .array(
      z.object({
        filial: sigla,
        data: dataIso,
        diaUtil: z.boolean(),
        /** Dias úteis decorridos no mês até e inclusive este dia. */
        acumuladoDia: z.number().int().min(0).max(31),
        /** `QTUTIL`: dias úteis do mês, como a origem conta. */
        uteisDoMes: z.number().int().min(0).max(31),
      }),
    )
    .min(1, 'lote vazio')
    .max(50_000),
})

export const respostaIngestaoSchema = z.object({
  syncId: z.string().uuid(),
  fonte: z.string(),
  recebidas: z.number().int(),
  gravadas: z.number().int(),
  removidas: z.number().int(),
  expurgadas: z.number().int(),
  avisos: z.array(z.string()),
})

export type Vendas = z.infer<typeof vendasSchema>
export type VendasLinha = z.infer<typeof vendasLinhaSchema>
export type Nps = z.infer<typeof npsSchema>
export type Perdas = z.infer<typeof perdasSchema>
export type Movimentacao = z.infer<typeof movimentacaoSchema>
export type Metas = z.infer<typeof metasSchema>

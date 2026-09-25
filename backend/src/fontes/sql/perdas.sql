-- Ajustes de inventario (perdas) direto do Oracle.
--
-- Consulta do analista, candidata a substituir o caminho atual
-- (Power Automate -> DAX no Power BI -> n8n). Guardada em arquivo, e nao numa
-- string de TypeScript, por dois motivos: tem 300 linhas, e assim da' para
-- rodar identica em qualquer cliente SQL quando alguem precisar conferir.
--
-- Os dois `:de` / `:ate` sao bind da JANELA, como TEXTO 'YYYY-MM-DD'. A versao
-- original tinha as datas escritas dentro da consulta (`>= DATE '2026-01-01'`),
-- o que serve para uma conferencia pontual mas nao para carga recorrente.
--
-- `TO_DATE(:de, 'YYYY-MM-DD')` explicito, e nao bind de data cru, pela mesma
-- razao de movimentacao: sem mascara, a leitura depende do NLS_DATE_FORMAT da
-- sessao, e uma sessao com formato diferente le mes/dia trocado e traz o periodo
-- errado SEM FALHAR. Bind de string com mascara nao tem essa ambiguidade — e o
-- `:ate + 1` sem TO_DATE nem compila (ORA-00932, medido).
--
-- `<  :ate + 1` em vez de BETWEEN: se a coluna de data tiver componente de hora,
-- BETWEEN perderia tudo depois da meia-noite do ultimo dia.

WITH
usuarios AS (
    SELECT cd_usuario, nm_usuario, cd_empresa
    FROM erp.hr_usuario_filiais
    GROUP BY cd_usuario, nm_usuario, cd_empresa
),

lotes_inventario AS (
    SELECT DISTINCT
        l02.cd_empresa,
        l02.lote,
        l02.tipo,
        CASE l02.tipo
            WHEN 'X' THEN 'EXTRAVIO'
            WHEN 'C' THEN 'EXCESSO'
            WHEN 'D' THEN 'DANO'
            WHEN 'R' THEN 'ROUBO'
            WHEN 'N' THEN 'NEGOCIACAO'
            WHEN 'T' THEN 'CONCENTRADO'
            WHEN 'E' THEN 'ENTREGA'
            WHEN 'G' THEN 'SAIDA GERENCIAL'
            WHEN 'H' THEN 'ENTRADA GERENCIAL'
        END AS desc_tipo,
        l02.data,
        l02.observ,
        l01.produto,
        l02.situac,
        c.no_contagem,
        c.seq_produto,
        c.data_solicitacao,
        c.contador1,
        c.data_contagem1,
        c.contador2,
        c.data_contagem2,
        c.obs1,
        lj.cd_justificativa,
        ja.descricao_justificativa,
        lj.qtde,
        u.nm_usuario AS lib_nivel1,
        u2.nm_usuario AS lib_nivel2,
        l02.origem,
        l02.modalidade
    FROM lotinv_it l01
    JOIN lotinv l02
        ON l01.lote = l02.lote
        AND l01.cd_empresa = l02.cd_empresa
    LEFT JOIN erp_contagem c
        ON c.no_lote_ajuste = l01.lote
        AND c.codigo_produto = SUBSTR(l01.produto, 1, LENGTH(l01.produto) - 1)
        AND c.cod_empresa = l01.cd_empresa
    LEFT JOIN lotinv_it_just lj
        ON lj.lote = l01.lote
        AND lj.tipo = l01.tipo
        AND lj.cd_empresa = l01.cd_empresa
        AND lj.produto = l01.produto
    LEFT JOIN erp_justific_ajuste_contagem ja
        ON ja.cod_justificativa = lj.cd_justificativa
    LEFT JOIN usuarios u
        ON u.cd_usuario = l02.usuario_liberacao_nivel1
        AND u.cd_empresa = l02.cd_empresa
    LEFT JOIN usuarios u2
        ON u2.cd_usuario = l02.usuario_liberacao_nivel2
        AND u2.cd_empresa = l02.cd_empresa
),

-- ATENCAO: na consulta original esta janela tinha corte proprio
-- (`>= DATE '2026-08-01'`), diferente do corte das entradas e saidas
-- (`>= DATE '2026-01-01'`). Como estas notas alimentam a classificacao
-- 'TRASPORTADORA', e essa classificacao e' EXCLUIDA no fim, o corte mais curto
-- fazia a exclusao nao valer para nada anterior a agosto — sem sintoma.
-- Aqui as duas usam a mesma janela.
notas_transportadora AS (
    SELECT
        et.cod_empresa,
        et.num_nota_dev,
        et.produto
    FROM entr_it et
    WHERE et.num_nota_dev != '0'
        AND et.tipo = 8
        AND et.data_entrada >= TO_DATE(:de, 'YYYY-MM-DD')
),

vendedores_nota AS (
    SELECT
        cgc_emitente,
        numnota,
        cod_empresa,
        serie,
        MAX(vendedor) AS vendedor_max
    FROM entr
    GROUP BY cgc_emitente, numnota, cod_empresa, serie
),

usuarios_lanc_nota AS (
    SELECT
        ee.cgc_emitente,
        ee.numnota,
        ee.serie,
        ee.cod_empresa,
        MAX(u.nm_usuario) AS nm_usuario_max
    FROM entr ee
    INNER JOIN usuarios u
        ON u.cd_usuario = ee.vendedor
        AND u.cd_empresa = ee.cod_empresa
    GROUP BY ee.cgc_emitente, ee.numnota, ee.serie, ee.cod_empresa
),

funcionarios_hist AS (
    SELECT DISTINCT
        nome,
        TRUNC(dt_referencia) AS dt_ref,
        ccusto_descricao,
        cargo
    FROM indicadores.c_ind_funcionarios_v_hist
),

entradas_ajustes AS (
    SELECT
        e01.cod_empresa,
        TO_CHAR(e01.num_nota) AS num_nota,
        e01.cgc_emitente,
        e01.serie,
        e01.data_entrada,
        e01.numpedido,
        e01.tipo AS tipo_entrada,
        p01.fantas,
        u.nm_usuario AS comprador,
        p01.linha,
        e01.produto || p01.digito AS prod,
        p01.descricao,
        e01.local_entrada,
        CASE
            WHEN e01.local_entrada IN ('2','3','7','8','10','11')
            THEN l03.centro_custo
            ELSE '1560'
        END AS ccusto_prod,
        e01.quantidade,
        ROUND(e01.quantidade * DECODE(NVL(e01.conversao,0),0,1,e01.conversao) * e01.preco_unit, 2) AS valor,
        vn.vendedor_max AS usu_lanc,
        CASE
            WHEN nt.num_nota_dev IS NOT NULL THEN 'TRASPORTADORA'
            ELSE uln.nm_usuario_max
        END AS nome_usu,
        l01.lote,
        l01.tipo,
        l01.desc_tipo,
        l01.data,
        l01.observ,
        l01.produto AS produto_lote,
        l01.situac,
        l01.no_contagem,
        l01.seq_produto,
        l01.data_solicitacao,
        l01.contador1,
        l01.data_contagem1,
        l01.contador2,
        l01.data_contagem2,
        l01.obs1,
        l01.lib_nivel1,
        l01.lib_nivel2,
        l01.origem,
        l01.modalidade,
        CASE
            WHEN l01.lote IS NOT NULL AND l01.situac = 'A' THEN 'AJUSTE DA CONTAGEM'
            WHEN l01.lote IS NOT NULL AND l01.situac IS NULL THEN 'PROCESSO'
            ELSE 'LANCAMENTO EXCESSO'
        END AS tipo_mov,
        l01.cd_justificativa AS cd_justificativa_1,
        l01.descricao_justificativa AS descricao_justificativa_1,
        l01.qtde AS qtde_justificativa,
        ROUND(l01.qtde * e01.preco_unit, 2) AS valor_justif
    FROM entr_it e01
    JOIN prod p01
        ON p01.codigo = e01.produto
    JOIN linha l03
        ON p01.linha = l03.codigo
    LEFT JOIN usuarios u
        ON u.cd_usuario = p01.comprador
        AND u.cd_empresa = e01.cod_empresa
    LEFT JOIN lotes_inventario l01
        ON l01.cd_empresa = e01.cod_empresa
        AND l01.lote = e01.numpedido
        AND SUBSTR(l01.produto, 1, LENGTH(l01.produto) - 2) = e01.produto
    LEFT JOIN notas_transportadora nt
        ON nt.num_nota_dev = e01.num_nota_dev
        AND nt.produto = e01.produto
        AND nt.cod_empresa = e01.cod_empresa
    LEFT JOIN vendedores_nota vn
        ON vn.cgc_emitente = e01.cgc_emitente
        AND vn.numnota = e01.num_nota
        AND vn.cod_empresa = e01.cod_empresa
        AND vn.serie = e01.serie
    LEFT JOIN usuarios_lanc_nota uln
        ON uln.cgc_emitente = e01.cgc_emitente
        AND uln.numnota = e01.num_nota
        AND uln.serie = e01.serie
        AND uln.cod_empresa = e01.cod_empresa
    WHERE e01.tipo = 8
        AND e01.data_entrada >= TO_DATE(:de, 'YYYY-MM-DD')
        AND e01.data_entrada <  TO_DATE(:ate, 'YYYY-MM-DD') + 1
        AND NVL(p01.lg_servico, ' ') != 'S'
        -- "Despesas Internas" da DAX e' toda linha que comeca com X, nao so' XB.
        -- A consulta original cortava apenas 'XB%' e deixava as outras dentro.
        AND p01.linha NOT LIKE 'X%'
),

saidas_ajustes AS (
    SELECT
        it.cod_empresa,
        it.numnota AS num_nota,
        m.cnpj_origem AS cgc_emitente,
        m.serie,
        it.dataemissao AS data_entrada,
        it.numped AS numpedido,
        it.tiposaida AS tipo_entrada,
        p.fantas,
        u.nm_usuario AS comprador,
        p.linha,
        SUBSTR(it.produto, 1, LENGTH(it.produto) - 1) AS prod,
        it.descricao,
        m.depos_emit AS local_entrada,
        ' ' AS ccusto_prod,
        it.qtsv * -1 AS quantidade,
        ROUND(it.qtsv * DECODE(NVL(it.conversao,0),0,1,it.conversao) * it.prcunit, 2) AS valor,
        it.codvend AS usu_lanc,
        CASE
            WHEN nt.num_nota_dev IS NOT NULL THEN 'TRASPORTADORA'
            ELSE u_vend.nm_usuario
        END AS nome_usu,
        l02.lote,
        l02.tipo,
        l02.desc_tipo,
        l02.data,
        l02.observ,
        l02.produto AS produto_lote,
        l02.situac,
        l02.no_contagem,
        l02.seq_produto,
        l02.data_solicitacao,
        l02.contador1,
        l02.data_contagem1,
        l02.contador2,
        l02.data_contagem2,
        l02.obs1,
        l02.lib_nivel1,
        l02.lib_nivel2,
        l02.origem,
        l02.modalidade,
        CASE
            WHEN l02.lote IS NOT NULL AND l02.situac = 'A' THEN 'AJUSTE DA CONTAGEM'
            WHEN l02.lote IS NOT NULL AND l02.situac IS NULL THEN 'PROCESSO'
            ELSE 'SAIDAS DIVERSAS'
        END AS tipo_mov,
        l02.cd_justificativa AS cd_justificativa_1,
        l02.descricao_justificativa AS descricao_justificativa_1,
        l02.qtde AS qtde_justificativa,
        ROUND(l02.qtde * it.prcunit, 2) AS valor_justif
    FROM saidm_it it
    JOIN saidm m
        ON m.numnota = it.numnota
        AND m.cod_empresa = it.cod_empresa
    JOIN prod p
        ON p.codigo = SUBSTR(it.produto, 1, LENGTH(it.produto) - 2)
    LEFT JOIN usuarios u
        ON u.cd_usuario = p.comprador
        AND u.cd_empresa = it.cod_empresa
    JOIN lotes_inventario l02
        ON l02.lote = it.numped
        AND l02.produto = it.produto
        AND l02.cd_empresa = it.cod_empresa
    LEFT JOIN notas_transportadora nt
        ON nt.num_nota_dev = it.numnota
        AND SUBSTR(nt.produto, 1, LENGTH(nt.produto) - 2) = SUBSTR(it.produto, 1, LENGTH(it.produto) - 2)
    LEFT JOIN usuarios u_vend
        ON u_vend.cd_usuario = it.codvend
        AND u_vend.cd_empresa = it.cod_empresa
    WHERE it.tiposaida = 8
        AND it.dataemissao >= TO_DATE(:de, 'YYYY-MM-DD')
        AND it.dataemissao <  TO_DATE(:ate, 'YYYY-MM-DD') + 1
        AND NVL(p.lg_servico, ' ') != 'S'
        AND p.linha NOT LIKE 'X%'
),

ajustes_completos AS (
    SELECT * FROM entradas_ajustes
    UNION ALL
    SELECT * FROM saidas_ajustes
),

base AS (
    SELECT
        TRUNC(aj.data_entrada)         AS data_entrada,
        aj.descricao                   AS descricao,
        aj.fantas                      AS fantas,
        aj.cod_empresa                 AS cod_empresa,
        TO_CHAR(aj.cod_empresa)        AS filial,
        aj.linha                       AS linha,
        aj.origem                      AS origem,
        aj.modalidade                  AS modalidade,
        aj.prod                        AS prod,
        aj.local_entrada               AS local_entrada,
        aj.situac                      AS situac,
        aj.tipo_mov                    AS tipo_mov,
        NVL(aj.qtde_justificativa, aj.quantidade) AS quantidad_corrigida2,

        CASE
            WHEN aj.nome_usu = hf.nome
                AND hf.ccusto_descricao LIKE '%Auditoria%' THEN 'AUDITORIA'
            WHEN aj.nome_usu = 'TRASPORTADORA' THEN 'RETORNO TRANSPORT'
            WHEN aj.nome_usu LIKE '%AUTOCENTRO%' THEN 'AUTOCENTRO'
            WHEN aj.nome_usu IN ('ADMINISTRADOR', 'ADMINISTRADOR TESTE') THEN 'TI'
            WHEN aj.nome_usu = hf.nome
                AND hf.ccusto_descricao IN (
                    'Tecnologia da Informação',
                    'TI ERP – Corporativo',
                    'FCX Lab – Corporativo',
                    'TI Infra/Segurança da Informação - Corporativo',
                    'Tecnologia da Informação - Corporativo',
                    'Projeto SAP- Corp.',
                    'TI Suporte a Sistemas - Corporativo',
                    'TI Integração de Dados - Corporativo'
                ) THEN 'TI'
            WHEN aj.nome_usu = 'PISTOLA ETIQUETA MOBILE' THEN 'CAIXA'
            WHEN aj.nome_usu IS NULL
                AND aj.local_entrada > 0
                AND aj.local_entrada < 100 THEN 'CAIXA'
            ELSE 'OPERAÇÕES'
        END AS ajustes_realizado_por,

        CASE
            WHEN aj.linha IN ('QGL', 'QGJ') THEN 'SUCATA'
            WHEN aj.desc_tipo IS NULL
                AND aj.tipo_mov = 'LANCAMENTO EXCESSO' THEN 'EXCESSO'
            ELSE aj.desc_tipo
        END AS tipo_de_mov,

        (CASE WHEN aj.quantidade > 0 THEN
            (CASE WHEN aj.valor_justif IS NULL THEN aj.valor ELSE aj.valor_justif END)
         ELSE 0 END) +
        (CASE WHEN aj.quantidade < 0 THEN
            (CASE WHEN aj.valor_justif IS NULL THEN aj.valor ELSE aj.valor_justif END) * -1
         ELSE 0 END) AS valor_contabil

    FROM ajustes_completos aj
    LEFT JOIN funcionarios_hist hf
        ON hf.nome = aj.nome_usu
        AND hf.dt_ref = TRUNC(aj.data_entrada)
),

detalhe AS (
    SELECT
        b.cod_empresa                                                  AS cod_empresa,
        b.data_entrada                                                 AS data_entrada,
        b.linha                                                        AS linha,
        b.situac                                                       AS situac,
        b.tipo_mov                                                     AS tipo_mov,
        b.tipo_de_mov                                                  AS tipo_de_mov,
        b.valor_contabil                                               AS valor_contabil,
        CASE
            WHEN b.tipo_de_mov IN ('EXCESSO', 'EXTRAVIO') THEN 'QNI'
            WHEN b.tipo_de_mov IN ('DANO', 'NEGOCIACAO')  THEN 'QI'
            ELSE 'OUTROS'
        END                                                            AS tipo_quebra,
        CASE
            WHEN b.origem = 'VENDA ECOMMERCE' THEN 'ECO'
            WHEN b.cod_empresa >= 80          THEN 'CD'
            ELSE 'LJA'
        END                                                            AS tipo_empresa
    FROM base b
    WHERE b.ajustes_realizado_por NOT IN ('AUTOCENTRO', 'RETORNO TRANSPORT')
        -- NEGOCIACAO fora, por definicao do indicador (decisao do analista).
        -- Era a ultima diferenca contra o Power BI: -44.997,27 na janela de
        -- 01 a 20/08, exatamente o total que sobrava, e toda ela em QI.
        AND b.tipo_de_mov IN ('DANO', 'EXCESSO', 'EXTRAVIO')
        -- `dTipoLocal[TIPO LOCAL-AJUSTE] = "LJA"` da DAX. Sem isto, o e-commerce
        -- entra na conta da loja.
        AND (CASE
                WHEN b.origem = 'VENDA ECOMMERCE' THEN 'ECO'
                WHEN b.cod_empresa >= 80          THEN 'CD'
                ELSE 'LJA'
             END) = 'LJA'
)

-- ============================================================================
-- Grao de saida: FILIAL x DIA x TIPO DE QUEBRA — o mesmo de `fato_perdas`.
--
-- `status` nao vem daqui: e' constante 'APROVADA', posta pelo mapeador. O
-- caminho antigo (DAX) chegou a devolver PENDENTE e GERAL, e a conferencia
-- mostrou que `[Perda Total]` sem filtro de status E' o aprovado, identico linha
-- por linha. Este SQL reproduz esse numero ao centavo nas 9 filiais.
--
-- Para DIAGNOSTICAR divergencia, acrescente `tipo_de_mov` e `situac` ao SELECT e
-- ao GROUP BY: e' assim que se descobriu que a diferenca de -44.997,27 contra o
-- Power BI era NEGOCIACAO inteira. Fora do diagnostico eles nao sobem, porque o
-- portal grava no grao acima e coluna a mais aqui viraria linha duplicada la'.
-- ============================================================================
SELECT
    cod_empresa         AS FILIAL,
    data_entrada        AS DATA,
    tipo_quebra         AS TIPO_QUEBRA,
    SUM(valor_contabil) AS VALOR
FROM detalhe
WHERE cod_empresa BETWEEN 1 AND 9
GROUP BY cod_empresa, data_entrada, tipo_quebra
ORDER BY 1, 2, 3

-- Venda do VENDEDOR, por DIA.
--
-- É o realizado de Performance Vendedor. Ver PLANO §7.14.
--
-- Grão: (empresa, dia, vendedor). Nada de linha, produto, pedido ou cliente --
-- a pergunta da tela é "quanto esse vendedor vendeu", e o resto só multiplica
-- linha.
--
-- POR QUE DAQUI E NÃO DE `VENDA163`: aquela é TABELA de grão MENSAL
-- (`MES_VND`, `ANO_VND`, `VLR_VND_MES`) -- conferido em `ALL_OBJECTS`, é tabela
-- e não view, então não há SQL de origem para descer até o dia. O dia só existe
-- em `SAIDM_IT`, a MESMA origem de `vendas-linha.sql`.
--
-- ENXUGADO a partir da consulta do analista. O que saiu, e por que pôde sair:
--
--  * As duas CTE intermediárias (`vendedor_dia`, `vendedor_dia_2`) e o `RANK()`.
--    Existiam para contar PEDIDOS sem duplicar (`QTD_PEDIDOS_UNICOS`) -- um
--    pedido aparece uma vez por linha, e o rank marcava a primeira. Sem contagem
--    de pedido, não há o que desduplicar: `SUM` é associativo, e somar direto no
--    grão final dá o mesmo número que somar por pedido e depois somar os pedidos.
--  * `LINHA`, `PRODUTO`, `CLIENTE`, `AUTOSERVICO`, `TIPO_VENDA`, `SIT_CLIENTE`,
--    `QTD_DEVOL`, `NUMPED`. Estavam no GROUP BY e por isso o resultado tinha
--    muitas linhas por (empresa, dia, vendedor).
--  * `AREA_VENDA` e a `MV_VENDEDOR_AREA_HIST`. A área do vendedor não pertence
--    ao FATO -- ela vem de `vendedor-area.sql`, e por um motivo: repetida aqui,
--    todo dia da janela grava a área vigente HOJE, e a mesma venda mudaria de
--    área retroativamente quando o vendedor fosse transferido.
--  * `MES`, `ANO`, `MES_ANO`. Saem da data; guardar derivado ao lado da origem
--    é como os dois discordam.
--
-- ATENÇÃO -- A SOMA DAQUI **NÃO** BATE COM `vendas-linha.sql`, DE PROPÓSITO:
--
--   1. A MEDIDA É OUTRA. Aqui é `LIQUIDA` (venda menos devolução mais
--      refaturamento); lá é `VALOR_TOTAL` (com despesa, juro, frete e ICMS ST).
--      É a medida contra a qual a `COTA_MENSAL` do vendedor foi orçada, então é
--      ela que vale para "bateu a meta".
--   2. OS FILTROS SÃO OUTROS. A consulta do analista não tem `TIPODOC`,
--      `CANAL_VENDA <> 2`, linha começando com X, nem empresas 92/99 fora.
--
-- Ou seja: **Σ vendedores ≠ Σ áreas**, e isso é esperado. Não existe validação
-- de soma cruzada entre as duas cargas, e não deve existir -- seria uma
-- conferência entre dois indicadores diferentes.
--
-- UMA DIFERENÇA DELIBERADA da consulta original, e a única: `NVL(SI.STATUS,'0')`
-- no lugar de `NVL(SI.STATUS,'')`. Em Oracle string vazia É NULL, então
-- `NVL(STATUS,'') <> 'C'` avalia NULL para todo item de STATUS nulo -- e o item
-- **cai fora em silêncio**. Com `'0'` ele fica, como em `vendas-linha.sql`.
-- CONFERIR contra o BI: se o número de referência for o do Power BI, ele está
-- descartando esses itens e a diferença vai aparecer aqui.
--
-- A janela entra por bind (:de, :ate), não interpolada: data interpolada
-- dependeria do NLS_DATE_FORMAT da sessão e poderia trazer o período errado sem
-- falhar. Mesma decisão de perdas, movimentação e vendas-linha.

SELECT SI.COD_EMPRESA                       AS COD_EMPRESA
     , TRUNC(SI.DATAEMISSAO)                AS DATA
     , SI.CODVEND                           AS COD_VENDEDOR
     /*
      * A MATRÍCULA vem do próprio cadastro de vendedor. É a chave que liga às
      * outras três consultas e ao colaborador.
      *
      * Pode ser NULA: conta genérica ("VENDA BALCÃO" e afins) é ponto de venda,
      * não pessoa, e não tem matrícula. Por isso `COD_VENDEDOR` vai junto -- é o
      * que sempre existe, e é por ele que o portal casa as quatro consultas
      * quando a matrícula falta.
      */
     , A.MATRICULA                          AS MATRICULA
     /*
      * LIQUIDA, a medida do analista: venda, menos o devolvido no mês, mais o
      * refaturado. O desconto é rateado pela quantidade em cada parcela.
      *
      * Divide por `SI.QTSV` sem guarda, exatamente como no original. Item de
      * TIPOSAIDA 1 com quantidade zero estouraria ORA-01476 -- a consulta roda
      * em produção, então não acontece. Um NULLIF aqui não seria defesa: NULL se
      * propagaria pela soma e mudaria o número em silêncio, que é pior.
      */
     , SUM( ROUND(((SI.QTSV * SI.PRCUNIT) - SI.VALDESC), 2)
          - ( (NVL(SI.QTD_DEVOL_MES, 0) * SI.PRCUNIT)
              - ROUND((SI.VALDESC / SI.QTSV * NVL(SI.QTD_DEVOL_MES, 0)), 2) )
          + ( (NVL(SI.QTDE_REFAT, 0) * SI.PRCUNIT)
              - ROUND((SI.VALDESC / SI.QTSV * NVL(SI.QTDE_REFAT, 0)), 2) )
        )                                   AS VALOR
  FROM SAIDM_IT SI
  JOIN SAIDM SM
    ON SM.DATEMISSAO  = SI.DATAEMISSAO
   AND SM.NUMNOTA     = SI.NUMNOTA
   AND SM.TIPOSAIDA   = SI.TIPOSAIDA
   AND SM.COD_EMPRESA = SI.COD_EMPRESA
  /*
   * INNER, como no original: venda de código que não existe no cadastro de
   * vendedor não tem a quem ser atribuída.
   */
  /*
   * AGTV com a REGRA DE EMPRESA CORPORATIVA, igual a `vendedor-area.sql` e
   * `vendedor-situacao.sql`: quando `COD_EMPRESA_CORP` existe e é outra, a
   * linha não vale. Sem isto, 14 vendedores tinham venda aqui e não existiam no
   * cadastro -- a mesma assimetria, pela quarta vez.
   */
  JOIN ( SELECT A1.*
           FROM AGTV A1
          WHERE A1.COD_EMPRESA = NVL(A1.COD_EMPRESA_CORP, A1.COD_EMPRESA)
       ) A
    ON A.COD_EMPRESA = SI.COD_EMPRESA
   AND A.CODIGO      = SI.CODVEND
  /*
   * O MESMO RECORTE DE ÁREA de `vendedor-area.sql` e `vendedor-situacao.sql`:
   * só TIPO_AREA 'C' ou 'N'.
   *
   * AS QUATRO CONSULTAS TÊM DE CONCORDAR SOBRE QUEM É VENDEDOR. Existe um
   * terceiro tipo, `'I'` -- 24 áreas e 225 vendedores nas nove lojas, entre
   * elas TELEVENDAS, VENDA DIRETA, BANHEIRAS e LANCHONETE --, que não tem
   * gerente adjunto no GD e ficou de fora por decisão do analista (27/08/2026).
   *
   * Sem este join, 157 vendedores tinham venda aqui e não existiam no cadastro,
   * e a ingestão recusava o lote. Foi o terceiro lugar onde a mesma assimetria
   * apareceu, depois do `99` e da situação: **exclusão que existe num lado e
   * não no outro não gera erro -- gera número.**
   *
   * Consequência aceita: a venda de TELEVENDAS não entra em
   * `fato_venda_vendedor`. É coerente -- aqueles vendedores não estão no
   * indicador, e somar a venda deles sem contá-los no denominador seria pior.
   */
  JOIN ERP.ERP_AREA_VENDA AV
    ON AV.CD_AREA    = A.AREA_VENDA
   AND AV.CD_EMPRESA = A.COD_EMPRESA
   AND AV.TIPO_AREA  IN ('C', 'N')
 WHERE SI.TIPOSAIDA = 1
   AND SM.DATEMISSAO >= TO_DATE(:de,  'YYYY-MM-DD')
   AND SM.DATEMISSAO <  TO_DATE(:ate, 'YYYY-MM-DD') + 1
   -- '99' é o código de venda sem vendedor identificado.
   AND SI.CODVEND <> '99'
   AND NVL(SI.STATUS, '0') <> 'C'
   /*
    * AS 9 LOJAS DO GD, por inclusão. Ver o comentário longo em
    * `vendas-linha.sql`: `siglaDoCodigo` devolve string vazia para código que
    * não conhece, e a ingestão recusa o lote inteiro. Filtrar aqui é a mesma
    * decisão já tomada no NPS.
    */
   AND SI.COD_EMPRESA IN (1, 2, 3, 4, 5, 6, 7, 8, 9)
 GROUP BY SI.COD_EMPRESA
        , TRUNC(SI.DATAEMISSAO)
        , SI.CODVEND
        , A.MATRICULA
 ORDER BY 1, 2, 3

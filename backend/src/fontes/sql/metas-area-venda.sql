-- Meta de vendas por ÁREA DE VENDA, mês e filial.
--
-- É o denominador de Performance Vendas. Ver PLANO §7.10 e §7.13.
--
-- Enxugado a partir da consulta do analista. Duas correções não são cosméticas:
--
-- **O GROUP BY tinha mais colunas do que o SELECT.** Agrupava também por
-- `AV.TIPO_AREA`, `SUBSTR(MC.LINHA,1,1)` e `L.DESCR`. O resultado saía com
-- VÁRIAS linhas por (empresa, mês, área) -- uma por letra de linha e por
-- descrição --, e cada uma trazia só um pedaço da meta. A tabela `meta` do
-- portal é única em (escopo, alvo, filial, ano, mês): as linhas colidiriam, e a
-- área ficaria com a meta da última que entrasse, não com a soma.
--
-- **Os JOIN eram LEFT, e aqui isso é pior do que parece.** Linha sem área
-- cadastrada devolve `CD_AREA` nulo, e a meta dela cairia num grupo NULO --
-- meta que não pertence a área nenhuma, sem erro nenhum.
--
-- E há uma assimetria que seria silenciosa e cara: `vendas-linha.sql` usa INNER,
-- então linha sem área SOME do realizado. Se a meta usasse LEFT, a mesma linha
-- entraria no denominador e não no numerador -- Performance Vendas apareceria
-- pior do que é, para sempre, sem nada acusar. **Os dois lados precisam tratar
-- linha não classificada do mesmo jeito**, e aqui o jeito é excluir.
--
-- `LINHA L` saiu inteiro: era LEFT, não filtrava, e só entrava no GROUP BY
-- partindo as linhas por `L.DESCR`.
--
-- FILTROS MANTIDOS: linha começando com X fora, e empresas 92, 99 e 999 fora.
-- (A consulta de vendas exclui 92 e 99; 999 não aparece lá. Vale conferir se
-- falta em uma das duas.)
--
-- Sem janela: meta é por competência, e reenviar a mesma é operação normal. O
-- portal faz upsert por (escopo, alvo, filial, ano, mês).

SELECT MC.COD_EMPRESA                              AS COD_EMPRESA
     , EXTRACT(YEAR  FROM MC.DTREFERENCIA)         AS ANO
     , EXTRACT(MONTH FROM MC.DTREFERENCIA)         AS MES
     -- O CÓDIGO é o que resolve a área no portal; a descrição vai junto só
     -- para a mensagem de erro quando a área não existir lá.
     , AV.CD_AREA                                  AS CD_AREA
     , AV.DESCRICAO                                AS AREA_VENDA
     , CASE AV.TIPO_AREA
         WHEN 'C' THEN 'CONSTRUÇÃO'
         WHEN 'N' THEN 'NÃO CONSTRUÇÃO'
       END                                         AS GERENCIA
     , SUM(MC.ORCAMENTO_LINHA)                     AS META
  FROM ERP_META_COTA_VENDAS MC
  JOIN ERP.ERP_AREA_LINHA AL
    ON AL.CD_EMPRESA = MC.COD_EMPRESA
   AND AL.CD_LINHA   = MC.LINHA
  JOIN ERP.ERP_AREA_VENDA AV
    ON AV.CD_EMPRESA = MC.COD_EMPRESA
   AND AV.CD_AREA    = AL.CD_AREA
 WHERE SUBSTR(MC.LINHA, 1, 1) <> 'X'
   /*
    * AS 9 LOJAS DO GD, por INCLUSÃO -- era `NOT IN (92, 99, 999)`, e deixava
    * passar 80, 81, 93 e 94. Ver o comentário longo em `vendas-linha.sql`: a
    * ingestão recusa o lote inteiro ao ver sigla que não conhece.
    *
    * Com a inclusão, a diferença do 999 entre esta consulta e a de vendas
    * (registrada no PLANO como proposital) deixa de existir: as duas passam a
    * dizer a MESMA coisa, e dizê-la do mesmo jeito.
    */
   AND MC.COD_EMPRESA IN (1, 2, 3, 4, 5, 6, 7, 8, 9)
 GROUP BY MC.COD_EMPRESA
        , EXTRACT(YEAR  FROM MC.DTREFERENCIA)
        , EXTRACT(MONTH FROM MC.DTREFERENCIA)
        , AV.CD_AREA
        , AV.DESCRICAO
        , AV.TIPO_AREA
 ORDER BY 1, 2, 3, 4

-- Vendas por ÁREA DE VENDA, com GERÊNCIA.
--
-- Origem do numerador de Performance Vendas e do desdobramento das telas do N3
-- e do N4. Ver PLANO §7.9 e §7.10.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O GRÃO DEIXOU DE SER A LINHA DE PRODUTO EM 18/09/2026.
--
-- Até aqui esta consulta devolvia uma linha por (empresa, dia, LINHA DE
-- PRODUTO), e o portal somava por área ao ler. Guardava ~5.200 registros por
-- dia para responder uma pergunta que precisa de ~180.
--
-- NINGUÉM LIA A LINHA. A única consulta do sistema que toca `fato_venda_linha`
-- faz `groupBy(areaVendaId)` e descarta o resto; `dimensao_linha`, com 11.767
-- registros, não era lida por tela nenhuma. Confirmado com o analista: o grão
-- por linha de produto não estava previsto para nada.
--
-- O QUE CUSTAVA: um bloco de 7 dias dava ~37 mil registros e matava o pod de
-- produção por falta de memória (`OOMKilled`, 18/09/2026). A retenção de 60
-- dias do detalhe existia pelo mesmo motivo.
--
-- MEDIDO ANTES DE MUDAR, contra o Oracle, na janela de 08 a 10/09/2026:
--
--     por linha: 15.729 registros      por área: 477 registros     (33x menos)
--     total:     R$ 23.985.450,20      total:    R$ 23.985.450,20
--     diferença por (filial, data, área): R$ 0,0000 em 477 chaves
--
-- OS DOIS JOIN DE LINHA CONTINUAM, e não são sobra:
--   ERP_AREA_LINHA  é o que LIGA a linha de produto à área -- sem ele não há
--                   como agrupar por área.
--   DIM_LINHA       é FILTRO, como já dizia o comentário mais abaixo.
--
-- A tabela continua se chamando `fato_venda_linha`, por decisão do analista:
-- renomear encareceria a GMUD sem mudar comportamento. O nome descreve a
-- ORIGEM (a venda é lida a partir da linha), não mais o grão.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Enxugado a partir da consulta do analista. O que saiu e por quê:
--
--  * CODVEND, CODFORN, PRODUTO, DESCRICAO, AUTOSERVICO, TIPO_VENDA e
--    SIT_CLIENTE. Estavam no GROUP BY e por isso o resultado tinha MUITAS linhas
--    por (empresa, dia, linha) -- uma por vendedor por produto. A ingestão exige
--    chave única e recusaria a carga inteira. Aqui o grão é o que o portal
--    precisa, e o valor vem somado. (A chave era `filial+data+linha` até
--    18/09/2026; hoje é `filial+data+area`.)
--
--  * Os LEFT JOIN com AGTV, ERP_AREA_VENDA (do vendedor), FORN, PROD e AGTC.
--    Eram juntados e nunca selecionados -- custo sem resultado.
--
--    `DIM_LINHA` parecia o mesmo caso e NÃO ERA: também é INNER e nunca
--    selecionado, mas é FILTRO -- confirmado pelo analista em 27/08. Voltou.
--    Fica como lembrete de que "juntado e nunca selecionado" descreve duas
--    coisas diferentes, e só uma delas é sobra.
--
--  * LINHA_1_NIVEL, MES e ANO. O primeiro não era usado; os outros dois saem da
--    data, e guardar o derivado ao lado da origem é como os dois discordam.
--
-- O QUE FICOU, e é regra de negócio, não sobra:
--
--  * TIPOSAIDA = 1 -- só venda.
--  * STATUS: exclui C e D, com a exceção de D quando CODENTREG <> 101.
--  * TIPODOC fora de FL, IM, AR, RT e 79.
--  * CANAL_VENDA <> 2 -- a MESMA regra que a DAX de Vendas aplica. Sem ela o
--    detalhe não fecharia com o agregado, e a ingestão recusa.
--  * Linha começando com X -- fora.
--  * Empresas 99 e 92 -- fora (corporativo e CD).
--  * Item de valor zero -- fora, como no original.
--
-- ATENÇÃO AOS DOIS JOIN OBRIGATÓRIOS: ERP_AREA_LINHA e ERP_AREA_VENDA são INNER.
-- Linha sem área de venda cadastrada DESAPARECE da carga -- e aí a soma do
-- detalhe não bate com o agregado de Vendas e a ingestão recusa o lote inteiro.
-- Isso é bom: falha alto em vez de carregar venda pela metade. Mas significa que
-- o cadastro de área precisa cobrir toda linha que vende.
--
-- A janela entra por bind (:de, :ate) como TEXTO, com TO_DATE e máscara
-- EXPLÍCITA -- a mesma forma de movimentacao.sql e perdas.sql.
--
-- Bind de data cru (`BETWEEN :de AND :ate`) parecia equivalente e não é: o
-- `recarregar` passa a janela como string 'YYYY-MM-DD', e o Oracle a converte
-- pelo NLS_DATE_FORMAT da SESSÃO. Estourou ORA-01861 na primeira execução real
-- (27/08/2026). Com a máscara, não depende de sessão nenhuma.
--
-- `< :ate + 1` em vez de BETWEEN: se DATEMISSAO tiver componente de hora,
-- BETWEEN perderia tudo depois da meia-noite do último dia.

SELECT SI.COD_EMPRESA                       AS COD_EMPRESA
     , TRUNC(SI.DATAEMISSAO)                AS DATA
     -- O CÓDIGO identifica a área no portal desde 27/08; a descrição é rótulo.
     , AV.CD_AREA                           AS CD_AREA
     , AV.DESCRICAO                         AS AREA_VENDA
     , CASE AV.TIPO_AREA
         WHEN 'C' THEN 'CONSTRUÇÃO'
         WHEN 'N' THEN 'NÃO CONSTRUÇÃO'
       END                                  AS GERENCIA
     , SUM( NVL(SI.PRCTOTAL, 0)
          + NVL(SI.VALODESP, 0)
          + NVL(SI.JUROCOND, 0)
          + NVL(SI.VALFRETE, 0)
          + NVL(SI.ICMSRET,  0)
          - NVL(SI.VALDESC,  0) )            AS VALOR_TOTAL
  FROM SAIDM_IT SI
  JOIN SAIDM SM
    ON SM.DATEMISSAO  = SI.DATAEMISSAO
   AND SM.NUMNOTA     = SI.NUMNOTA
   AND SM.TIPOSAIDA   = SI.TIPOSAIDA
   AND SM.COD_EMPRESA = SI.COD_EMPRESA
  JOIN ERP.ERP_AREA_LINHA AL
    ON AL.CD_LINHA  = SI.LINHA
   AND AL.CD_EMPRESA = SI.COD_EMPRESA
  JOIN ERP.ERP_AREA_VENDA AV
    ON AV.CD_AREA    = AL.CD_AREA
   AND AV.CD_EMPRESA = AL.CD_EMPRESA
  /*
   * FILTRO, e é intencional -- confirmado pelo analista em 27/08/2026.
   *
   * Nada sai daqui: `DIM_LINHA` restringe a carga às linhas presentes nela.
   * Cheguei a removê-lo por parecer sobra (INNER e nunca selecionado), e teria
   * sido um erro caro do jeito mais discreto possível: a carga traria linha a
   * mais, a soma do detalhe não fecharia com o agregado de Vendas, e a ingestão
   * recusaria o lote inteiro com uma mensagem que apontaria para o lugar errado.
   *
   * Sem `CD_EMPRESA` na condição, como no original: `DIM_LINHA` é dimensão
   * global de linha, não por filial.
   */
  JOIN DIM_LINHA L
    ON L.CD_GRUPO = SI.LINHA
 WHERE SI.TIPOSAIDA = 1
   AND SM.DATEMISSAO >= TO_DATE(:de,  'YYYY-MM-DD')
   AND SM.DATEMISSAO <  TO_DATE(:ate, 'YYYY-MM-DD') + 1
   AND ( NVL(SI.STATUS, '0') NOT IN ('C', 'D')
      OR (NVL(SI.STATUS, '0') = 'D' AND NVL(SM.CODENTREG, 0) <> 101) )
   AND SM.TIPODOC NOT IN ('FL', 'IM', 'AR', 'RT', '79')
   AND NVL(SM.CANAL_VENDA, 1) <> 2
   AND SUBSTR(SI.LINHA, 1, 1) <> 'X'
   /*
    * AS 9 LOJAS DO GD, por INCLUSÃO e não por exclusão.
    *
    * Era `NOT IN ('99','92')`, e não bastava: entravam também 80, 81, 93 e 94
    * -- CDs e corporativo, que não são lojas do GD. `siglaDoCodigo` devolve
    * string vazia para código que não conhece, e a ingestão recusou as 27 mil
    * linhas de uma vez (medido em 27/08/2026, primeira carga real).
    *
    * Filtrar aqui e não afrouxar a ingestão é a mesma decisão do NPS: aquele
    * erro é a rede que pega sigla trocada no mapeamento, e desligá-lo para
    * resolver uma diferença de ESCOPO trocaria um problema visível por um
    * invisível.
    *
    * Espelha `FILIAIS_GD` em `fontes.mjs`, e o custo é o mesmo já registrado
    * lá: abrir loja nova exige cadastrar nos dois lugares.
    */
   AND SI.COD_EMPRESA IN (1, 2, 3, 4, 5, 6, 7, 8, 9)
   AND ( NVL(SI.PRCTOTAL, 0) + NVL(SI.VALODESP, 0) + NVL(SI.JUROCOND, 0)
       + NVL(SI.VALFRETE, 0) + NVL(SI.ICMSRET, 0) - NVL(SI.VALDESC, 0) ) <> 0
 GROUP BY SI.COD_EMPRESA
        , TRUNC(SI.DATAEMISSAO)
        , AV.CD_AREA
        , AV.DESCRICAO
        , AV.TIPO_AREA
 ORDER BY 1, 2, 3

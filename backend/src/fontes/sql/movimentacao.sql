-- Movimentacao diaria por filial. Consulta da area, com janela por bind.
--
-- SO' VENDA. Custo de transferencia (TIPOSAIDA 11 e 17, CUETOT) NAO entra: ele e'
-- de CD, nao de loja — a consulta da area filtra COD_EMPRESA >= 80, e as 9
-- filiais do GD sao 1..9. Foi testado somar as duas parcelas e desfeito.
SELECT * FROM (
SELECT CASE
    WHEN S.EMPRESA_RETIRADA IS NULL THEN
    S.COD_EMPRESA
    ELSE
    S.EMPRESA_RETIRADA
    END AS FILIAL,
    S.DATEMISSAO,
    SUM(DECODE(SIT.TIPOSAIDA,
    1,
    (((NVL(SIT.PRCTOTAL, 0) + NVL(SIT.VALODESP, 0) +
    NVL(SIT.JUROCOND, 0) + NVL(SIT.VALFRETE, 0))
    -NVL(SIT.VALDESC, 0))),
    0)) AS MOVIMENTACAO
    FROM SAIDM S
    JOIN SAIDM_IT SIT
    ON S.NUMNOTA = SIT.NUMNOTA
    AND S.COD_EMPRESA = SIT.COD_EMPRESA
    LEFT JOIN PROD P
    ON SUBSTR(SIT.PRODUTO, 1, LENGTH(SIT.PRODUTO) - 2) = P.CODIGO
    WHERE ((NVL(S.STATUS, '0') != 'C' AND NVL(S.STATUS, '0') != 'D') OR
    (NVL(S.STATUS, '0') = 'D' AND NVL(S.CODENTREG, 0) != 101))
    AND (S.TIPODOC NOT IN ('FL', 'IM', 'AR', 'RT', '79'))
    AND (SIT.TIPOSAIDA IN (1, 10))
    -- SEM filtro de CANAL_VENDA: regra alterada pela area em 21/08/2026. Antes
    -- era CANAL_VENDA IN (1,3). Mudou o valor de TODO o historico, entao exige
    -- recarga da janela inteira, nao do trecho recente.
    AND SUBSTR(P.LINHA, 1, 1) <> 'X'
    AND S.DATEMISSAO >= TO_DATE(:de, 'YYYY-MM-DD')
    AND S.DATEMISSAO <  TO_DATE(:ate, 'YYYY-MM-DD') + 1
    GROUP BY CASE
    WHEN S.EMPRESA_RETIRADA IS NULL THEN
    S.COD_EMPRESA
    ELSE
    S.EMPRESA_RETIRADA
    END,
    S.DATEMISSAO)
WHERE FILIAL <= 9

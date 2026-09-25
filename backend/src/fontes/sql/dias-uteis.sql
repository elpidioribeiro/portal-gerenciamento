-- Calendário de dias em que a loja ABRE, por filial e dia.
--
-- Ver PLANO §7.15. É o que permite ratear a cota mensal do vendedor até um dia
-- ou até o fim de uma semana.
--
-- Traduz para SQL a consulta Power Query da `dSEGU INVERTIDA`. A tabela `SEGU`
-- guarda o mês **na horizontal** -- uma coluna `FERIADO1..FERIADO31` por dia --,
-- e o Power Query desdobra isso em linhas com `UnpivotOtherColumns`. Aqui é
-- `UNPIVOT`, que é a mesma operação.
--
-- ┌────────────────────────────────────────────────────────────────────────────┐
-- │ NÃO SE SUPÕE NADA SOBRE DIA DA SEMANA. QUEM DECIDE É A TABELA.
-- │
-- │ `FERIADO<n>` é código de TIPO DE DIA, não um sim/não: `0` é dia em que a
-- │ loja abre, e qualquer outro valor é dia em que não abre. São 32 valores
-- │ distintos na base, não dois.
-- │
-- │ E o calendário é DE CADA FILIAL. Medido na origem em 27/08/2026:
-- │
-- │     filial 1, agosto/2026   QTUTIL 26   os cinco domingos marcados
-- │     filial 2, agosto/2026   QTUTIL 31   NENHUM dia marcado
-- │
-- │ Norte abre domingo. Uma regra de "domingo não conta" escrita aqui
-- │ inflaria a cota diária dela em ~19%, e a loja inteira apareceria fora da
-- │ meta todo dia -- por uma suposição minha sobre varejo.
-- │
-- │ Eu escrevi essa suposição, generalizando de uma filial só, e o analista a
-- │ derrubou no mesmo dia. Fica registrado porque o número teria sido
-- │ plausível: ninguém olha um percentual baixo e desconfia do calendário.
-- │
-- │ A rede: a consulta devolve `QTUTIL` (a contagem da origem) ao lado de
-- │ `UTEIS_CALCULADOS` (a derivada das marcas), e a ingestão recusa o lote se
-- │ divergirem -- o princípio de `validarSomaContraAgregado`. 304 de 305 meses
-- │ batem em 2025-2026.
-- └────────────────────────────────────────────────────────────────────────────
--
-- POR QUE ISTO NÃO REABRE A DECISÃO DE §7.10. Com o calendário em mãos, o
-- portal *poderia* reimplementar a fórmula de projeção do BI. Não vai: o motivo
-- de não reimplementar nunca foi só a falta do calendário -- é que **duas
-- fórmulas divergem**, e a divergência apareceria como "a soma das áreas não
-- bate com a filial" numa tela onde os dois números ficam lado a lado. O fator
-- extraído da tendência continua garantindo a igualdade por construção.
--
-- O QUE ESTA CONSULTA FAZ E O POWER QUERY NÃO: descarta o dia inexistente pela
-- DATA, não por erro de conversão. `FERIADO31` existe em fevereiro como coluna,
-- e o Power Query o elimina com `RemoveRowsWithErrors` depois de tentar
-- converter "31/2/2026". Aqui o `LAST_DAY` corta antes -- em Oracle a conversão
-- inválida levanta ORA-01839 e derrubaria a consulta inteira.
--
-- `LAST_DAY` e não `NUMDIAS`: `NUMDIAS` parece ser a quantidade de dias do mês,
-- mas depender disso seria confiar num campo cujo significado eu não confirmei
-- para decidir quais linhas existem.
--
-- Empresa 99 fora, como no original.

WITH mes_na_horizontal AS (
    SELECT COD_EMPRESA
         , ANO
         , MES
         , QTUTIL
         , NUMDIAS
         , FERIADO1,  FERIADO2,  FERIADO3,  FERIADO4,  FERIADO5,  FERIADO6
         , FERIADO7,  FERIADO8,  FERIADO9,  FERIADO10, FERIADO11, FERIADO12
         , FERIADO13, FERIADO14, FERIADO15, FERIADO16, FERIADO17, FERIADO18
         , FERIADO19, FERIADO20, FERIADO21, FERIADO22, FERIADO23, FERIADO24
         , FERIADO25, FERIADO26, FERIADO27, FERIADO28, FERIADO29, FERIADO30
         , FERIADO31
      FROM SEGU
     /*
      * A janela entra como :de / :ate, a MESMA convenção das outras fontes --
      * o `recarregar` e o nó do n8n passam sempre esse par.
      *
      * Mas o corte é por MÊS INTEIRO, não pelos dias da janela: a ingestão só
      * confere `UTEIS_CALCULADOS` contra `QTUTIL` em mês completo, e um mês
      * partido pela janela desligaria justamente a checagem que protege a
      * leitura de `FERIADO<n>`.
      */
     WHERE TO_DATE(ANO || '-' || MES || '-01', 'YYYY-MM-DD')
           BETWEEN TRUNC(TO_DATE(:de,  'YYYY-MM-DD'), 'MM')
               AND TRUNC(TO_DATE(:ate, 'YYYY-MM-DD'), 'MM')
       AND COD_EMPRESA IN (1, 2, 3, 4, 5, 6, 7, 8, 9)
),
por_dia AS (
    SELECT COD_EMPRESA, ANO, MES, QTUTIL, NUMDIAS, DIA, MARCA
      FROM mes_na_horizontal
    UNPIVOT ( MARCA FOR DIA IN (
              FERIADO1  AS  1, FERIADO2  AS  2, FERIADO3  AS  3, FERIADO4  AS  4
            , FERIADO5  AS  5, FERIADO6  AS  6, FERIADO7  AS  7, FERIADO8  AS  8
            , FERIADO9  AS  9, FERIADO10 AS 10, FERIADO11 AS 11, FERIADO12 AS 12
            , FERIADO13 AS 13, FERIADO14 AS 14, FERIADO15 AS 15, FERIADO16 AS 16
            , FERIADO17 AS 17, FERIADO18 AS 18, FERIADO19 AS 19, FERIADO20 AS 20
            , FERIADO21 AS 21, FERIADO22 AS 22, FERIADO23 AS 23, FERIADO24 AS 24
            , FERIADO25 AS 25, FERIADO26 AS 26, FERIADO27 AS 27, FERIADO28 AS 28
            , FERIADO29 AS 29, FERIADO30 AS 30, FERIADO31 AS 31 ) )
),
com_data AS (
    SELECT P.COD_EMPRESA
         , P.ANO
         , P.MES
         , P.DIA
         , P.QTUTIL
         , P.NUMDIAS
         , P.MARCA
         , TO_DATE(P.DIA || '/' || P.MES || '/' || P.ANO, 'DD/MM/RRRR') AS DATA
         /*
          * A marca da origem, sem interpretação: `0` é dia em que a loja abre.
          *
          * `TO_CHAR` para não depender de a coluna ser NUMBER ou CHAR, e
          * `NVL(...,'0')` porque nulo aqui é ausência de marca -- a mesma
          * leitura que o zero.
          */
         , CASE WHEN NVL(TRIM(TO_CHAR(P.MARCA)), '0') = '0' THEN 1 ELSE 0
           END                                                          AS DIA_UTIL
      FROM por_dia P
     WHERE P.DIA <= EXTRACT( DAY FROM
                             LAST_DAY( TO_DATE(P.MES || '/' || P.ANO, 'MM/RRRR') ) )
)
SELECT COD_EMPRESA                          AS COD_EMPRESA
     , DATA                                 AS DATA
     , DIA_UTIL                             AS DIA_UTIL
     /*
      * Dias úteis decorridos no mês ATÉ E INCLUSIVE este dia. É por ele que a
      * cota é rateada: cota_até_o_dia = COTA_MENSAL × ACUMULADO ÷ QTUTIL.
      */
     , SUM(DIA_UTIL) OVER ( PARTITION BY COD_EMPRESA, ANO, MES
                                ORDER BY DIA
                          )                 AS ACUMULADO_DIA
     -- Dias úteis do mês, COMO A ORIGEM CONTA. É o divisor do rateio.
     , QTUTIL                               AS QTUTIL
     /*
      * A mesma contagem, feita por mim. A ingestão compara com QTUTIL e recusa
      * o lote se divergir -- é o que torna a suposição acima segura.
      */
     , SUM(DIA_UTIL) OVER ( PARTITION BY COD_EMPRESA, ANO, MES )
                                            AS UTEIS_CALCULADOS
  FROM com_data
 ORDER BY 1, 2

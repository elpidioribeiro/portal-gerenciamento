-- A marcação de ponto de causa passa a ser POR GERÊNCIA (PLANO §7.26).
--
-- Os indicadores continuam por área de venda -- é a linha do quadro, com
-- supervisor e número próprio. A MARCAÇÃO não: o N4 conta as causas uma vez
-- para a reunião dele, não uma vez por área. Decisão do analista (29/08/2026).
--
-- O escopo já existia. `GERENCIA` foi criado em §7.19 prevendo a gerência
-- operacional, que não tem área de venda -- e serve aqui sem alteração de
-- estrutura: muda o valor gravado, não a forma da tabela.

-- ─────────────────────────────────────────────────────────────────────────────
-- O que já foi marcado sobe para a gerência da área
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Somando: duas áreas da MESMA gerência com a mesma causa na mesma semana
-- viram uma linha só, e o total tem de ser preservado. Sem o `SUM` a segunda
-- violaria a unicidade de (ponto, escopo, alvo, ano, mês, semana) -- ou pior,
-- passaria e o Pareto perderia a diferença.
--
-- `registrado_por` e `registrado_em` vêm da marcação MAIS RECENTE do grupo: com
-- contador editável o que interessa é quem mexeu por último, que é a mesma
-- regra que a gravação já usa.
CREATE TEMP TABLE marcacao_migrada AS
SELECT dav."gerencia_id"                      AS alvo_id,
       o."ponto_causa_id",
       o."ano",
       o."mes",
       o."semana",
       SUM(o."quantidade")::INTEGER           AS quantidade,
       (ARRAY_AGG(o."registrado_por_id" ORDER BY o."registrado_em" DESC))[1] AS registrado_por_id,
       MAX(o."registrado_em")                 AS registrado_em
  FROM "ocorrencia_ponto_causa" o
  JOIN "dimensao_area_venda" dav ON dav."id" = o."alvo_id"
 WHERE o."escopo" = 'AREA_VENDA'
 GROUP BY dav."gerencia_id", o."ponto_causa_id", o."ano", o."mes", o."semana";

DELETE FROM "ocorrencia_ponto_causa" WHERE "escopo" = 'AREA_VENDA';

INSERT INTO "ocorrencia_ponto_causa"
  ("id", "ponto_causa_id", "escopo", "alvo_id", "ano", "mes", "semana",
   "quantidade", "registrado_por_id", "registrado_em")
SELECT gen_random_uuid(), "ponto_causa_id", 'GERENCIA', alvo_id, "ano", "mes",
       "semana", quantidade, registrado_por_id, registrado_em
  FROM marcacao_migrada;

DROP TABLE marcacao_migrada;

-- ─────────────────────────────────────────────────────────────────────────────
-- O valor `AREA_VENDA` FICA no enum
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Ninguém grava com ele hoje, e mesmo assim ele não sai. Três razões:
--
--  - remover valor de enum no Postgres exige recriar o tipo e reescrever a
--    coluna, com a trigger de validação junto -- caro para um ganho nenhum;
--  - a trigger `fnc_valida_alvo_ocorrencia` valida os dois, e o `CASE` dela é
--    explícito de propósito: um escopo sem ramo levanta erro em vez de passar
--    sem validação;
--  - ele volta a fazer sentido no dia em que uma gerência tiver unidade abaixo
--    definida -- o depósito com doca, turno ou setor. Ver §7.18.

COMMENT ON COLUMN "ocorrencia_ponto_causa"."escopo" IS
  'Contra o que a ocorrencia foi marcada. Hoje o portal so'' grava GERENCIA: o '
  'N4 conta as causas uma vez para a reuniao dele, nao uma por area de venda. '
  'AREA_VENDA continua valido no enum e volta a ser usado quando uma gerencia '
  'tiver unidade abaixo definida.';

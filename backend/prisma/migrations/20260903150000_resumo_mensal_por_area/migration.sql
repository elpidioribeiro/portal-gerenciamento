-- Resumo MENSAL da venda por area: o historico que o detalhe nao pode guardar.
--
-- `fato_venda_linha` retem 60 dias porque e detalhe do ciclo corrente. Um ano
-- dela sao ~2 milhoes de linhas e 506 MB (medido em 03/09/2026); o mesmo ano
-- resumido por (area, mes) sao ~2.200 linhas.
--
-- Por AREA e nao por gerencia: e o grao mais fino que ainda e minusculo, e a
-- gerencia sai somando. Sem a META, que ja vive em `meta` por (area,
-- competencia) e nao e expurgada -- duas copias divergiriam.
CREATE TABLE "venda_area_mes" (
  "id"            UUID           NOT NULL DEFAULT gen_random_uuid(),
  "filial_id"     UUID           NOT NULL,
  "indicador_id"  UUID           NOT NULL,
  "area_venda_id" UUID           NOT NULL,
  "gerencia_id"   UUID           NOT NULL,
  "ano"           INTEGER        NOT NULL,
  "mes"           INTEGER        NOT NULL,
  "vendido"       DECIMAL(18, 2) NOT NULL,
  "dias"          INTEGER        NOT NULL,
  "atualizado_em" TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venda_area_mes_pk" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "venda_area_mes_uk01"
  ON "venda_area_mes" ("filial_id", "area_venda_id", "indicador_id", "ano", "mes");
CREATE INDEX "venda_area_mes_idx01" ON "venda_area_mes" ("filial_id", "ano", "mes");
CREATE INDEX "venda_area_mes_idx02" ON "venda_area_mes" ("gerencia_id");

ALTER TABLE "venda_area_mes" ADD CONSTRAINT "venda_area_mes_filial_fk"
  FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "venda_area_mes" ADD CONSTRAINT "venda_area_mes_indicador_fk"
  FOREIGN KEY ("indicador_id") REFERENCES "indicador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "venda_area_mes" ADD CONSTRAINT "venda_area_mes_area_fk"
  FOREIGN KEY ("area_venda_id") REFERENCES "dimensao_area_venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "venda_area_mes" ADD CONSTRAINT "venda_area_mes_gerencia_fk"
  FOREIGN KEY ("gerencia_id") REFERENCES "dimensao_gerencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- POPULA a partir do detalhe que esta carregado AGORA.
--
-- Esta e a unica janela em que isso e possivel sem repetir 35 blocos de Oracle:
-- o backfill do ano acabou de rodar, e a retencao do detalhe volta para 60 dias
-- logo em seguida. Depois disso o passado so voltaria pela origem.
INSERT INTO "venda_area_mes"
  ("filial_id", "indicador_id", "area_venda_id", "gerencia_id", "ano", "mes", "vendido", "dias")
SELECT
  l."filial_id",
  l."indicador_id",
  l."area_venda_id",
  l."gerencia_id",
  EXTRACT(YEAR  FROM l."data")::INTEGER,
  EXTRACT(MONTH FROM l."data")::INTEGER,
  SUM(l."valor"),
  COUNT(DISTINCT l."data")
FROM "fato_venda_linha" l
GROUP BY 1, 2, 3, 4, 5, 6;

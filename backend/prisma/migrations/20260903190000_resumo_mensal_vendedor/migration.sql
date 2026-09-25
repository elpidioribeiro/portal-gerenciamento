-- Resumo MENSAL de Performance Vendedor: o historico que o detalhe nao guarda.
--
-- Mesmo problema de `venda_area_mes` (§7.56) e mesma forma. O que muda e' a
-- razao: `fato_venda_linha` era grande demais para guardar um ano;
-- `fato_venda_vendedor` e' pequeno, mas o REALIZADO dele e' expurgado aos 60
-- dias, e sem realizado nao ha "bateu a meta". Um mes velho recalculado depois
-- do expurgo daria realizado zero para todo mundo e o indicador desabaria para
-- 0% -- sem erro, com numero plausivel na tela.
--
-- Guarda a CONTA JA FEITA (aptos e na_meta), e nao os insumos, porque a regra de
-- quem entra no denominador (`contaNoDenominador`: houveVenda <> 'SEM VENDA',
-- sitafa <> 7, meta > 0) mora no TypeScript e e' onde deve continuar morando.
-- Guardar insumos exigiria uma segunda copia da regra em SQL para le-los.
CREATE TABLE "vendedor_area_mes" (
  "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
  "filial_id"     UUID         NOT NULL,
  "area_venda_id" UUID         NOT NULL,
  "gerencia_id"   UUID         NOT NULL,
  "ano"           INTEGER      NOT NULL,
  "mes"           INTEGER      NOT NULL,
  "aptos"         INTEGER      NOT NULL,
  "na_meta"       INTEGER      NOT NULL,
  "dias"          INTEGER      NOT NULL,
  "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendedor_area_mes_pk" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendedor_area_mes_uk01"
  ON "vendedor_area_mes" ("filial_id", "area_venda_id", "ano", "mes");
CREATE INDEX "vendedor_area_mes_idx01" ON "vendedor_area_mes" ("filial_id", "ano", "mes");
CREATE INDEX "vendedor_area_mes_idx02" ON "vendedor_area_mes" ("gerencia_id");

ALTER TABLE "vendedor_area_mes" ADD CONSTRAINT "vendedor_area_mes_filial_fk"
  FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendedor_area_mes" ADD CONSTRAINT "vendedor_area_mes_area_fk"
  FOREIGN KEY ("area_venda_id") REFERENCES "dimensao_area_venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendedor_area_mes" ADD CONSTRAINT "vendedor_area_mes_gerencia_fk"
  FOREIGN KEY ("gerencia_id") REFERENCES "dimensao_gerencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

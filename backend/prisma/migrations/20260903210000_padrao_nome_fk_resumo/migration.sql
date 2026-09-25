-- Adequa as FKs dos dois resumos mensais ao padrao de nomenclatura.
--
-- O padrao e `<tabela>_<tabela_referenciada>_FK` -- o nome INTEIRO da tabela
-- referenciada, como em `dimensao_linha_dimensao_area_venda_FK`. Os dois
-- resumos nasceram com a forma curta (`_area_fk`, `_gerencia_fk`), que nao
-- diz para onde a chave aponta quando lida no catalogo, longe do codigo.
--
-- Renomear constraint nao move dado nem revalida a chave: altera so o nome no
-- catalogo.
ALTER TABLE "venda_area_mes"
  RENAME CONSTRAINT "venda_area_mes_area_fk" TO "venda_area_mes_dimensao_area_venda_fk";
ALTER TABLE "venda_area_mes"
  RENAME CONSTRAINT "venda_area_mes_gerencia_fk" TO "venda_area_mes_dimensao_gerencia_fk";

ALTER TABLE "vendedor_area_mes"
  RENAME CONSTRAINT "vendedor_area_mes_area_fk" TO "vendedor_area_mes_dimensao_area_venda_fk";
ALTER TABLE "vendedor_area_mes"
  RENAME CONSTRAINT "vendedor_area_mes_gerencia_fk" TO "vendedor_area_mes_dimensao_gerencia_fk";

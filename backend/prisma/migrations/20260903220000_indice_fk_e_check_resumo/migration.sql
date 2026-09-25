-- Adequa os dois resumos mensais ao padrao de criacao de tabelas (secao 7).
--
-- Duas exigencias do padrao ficaram de fora quando as tabelas nasceram:
--
--   1. "Para toda chave estrangeira deve ser criado um indice com as mesmas
--      colunas da chave." Faltavam cinco. O indice composto (filial_id, ano,
--      mes) NAO satisfaz a regra para a FK de filial: sao outras colunas,
--      mesmo que o Postgres use o prefixo dele na pratica. E' tambem o que o
--      GMUD 2 fez para as tabelas antigas -- `fato_venda_linha` tem
--      `filial_id` liderando a UK e ganhou `IDX02 (filial_id)` de todo jeito.
--
--   2. "Colunas com dominio de valores definido devem possuir constraint de
--      check." `ano` e `mes` tem dominio, e nenhum dos dois tinha guarda.
--
-- O CK03 do vendedor nao vem do padrao, vem deste projeto: `na_meta` e' o
-- numerador de `na_meta / aptos`, e sem a trava um numerador maior que o
-- denominador daria PERCENTUAL ACIMA DE 100% na parede da reuniao -- o tipo de
-- numero que ninguem confere porque parece so estranho. O banco passa a
-- recusar.

-- Indices das chaves estrangeiras
CREATE INDEX venda_area_mes_idx03 ON public.venda_area_mes (area_venda_id);
CREATE INDEX venda_area_mes_idx04 ON public.venda_area_mes (indicador_id);
CREATE INDEX venda_area_mes_idx05 ON public.venda_area_mes (filial_id);

CREATE INDEX vendedor_area_mes_idx03 ON public.vendedor_area_mes (area_venda_id);
CREATE INDEX vendedor_area_mes_idx04 ON public.vendedor_area_mes (filial_id);

-- Dominio da competencia
ALTER TABLE public.venda_area_mes
  ADD CONSTRAINT venda_area_mes_ck01 CHECK (mes BETWEEN 1 AND 12);
ALTER TABLE public.venda_area_mes
  ADD CONSTRAINT venda_area_mes_ck02 CHECK (ano BETWEEN 2000 AND 2100);

ALTER TABLE public.vendedor_area_mes
  ADD CONSTRAINT vendedor_area_mes_ck01 CHECK (mes BETWEEN 1 AND 12);
ALTER TABLE public.vendedor_area_mes
  ADD CONSTRAINT vendedor_area_mes_ck02 CHECK (ano BETWEEN 2000 AND 2100);

-- O numerador nunca passa do denominador
ALTER TABLE public.vendedor_area_mes
  ADD CONSTRAINT vendedor_area_mes_ck03 CHECK (na_meta >= 0 AND na_meta <= aptos);

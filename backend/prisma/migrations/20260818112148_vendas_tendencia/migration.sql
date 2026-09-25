-- Vendas passa a trazer tres colunas com papeis distintos:
--   valor_real  o vendido no dia (soma para formar o mes fechado)
--   tendencia   previsao de fechamento vigente naquele dia
--   delta_meta  desvio % da tendencia sobre a meta, calculado na origem
--
-- `valor` e RENOMEADO para `valor_real` em vez de recriado: o dado existente
-- ja e o realizado diario, e dropar a coluna o perderia sem necessidade.
--
-- As duas colunas novas entram com DEFAULT temporario para nao travar em
-- tabela populada; o default e removido em seguida, deixando-as obrigatorias
-- como o schema declara. Sem isso a migration falharia em qualquer ambiente
-- que ja tenha dados.
ALTER TABLE "fato_vendas" RENAME COLUMN "valor" TO "valor_real";

ALTER TABLE "fato_vendas" ADD COLUMN "tendencia" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "fato_vendas" ADD COLUMN "delta_meta" DECIMAL(9,4) NOT NULL DEFAULT 0;

ALTER TABLE "fato_vendas" ALTER COLUMN "tendencia" DROP DEFAULT;
ALTER TABLE "fato_vendas" ALTER COLUMN "delta_meta" DROP DEFAULT;

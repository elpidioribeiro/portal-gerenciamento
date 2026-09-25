-- Converte os UNIQUE dos dois resumos de INDICE em CONSTRAINT.
--
-- O padrao (secao 7) pede constraint: "para a criacao de constraints UNIQUE, o
-- nome da constraint deve ser composto pelo nome da tabela seguido do sufixo
-- _UKNN". O Prisma emite `CREATE UNIQUE INDEX` para `@@unique`, e as duas
-- tabelas nasceram assim.
--
-- Na pratica o Postgres cria o mesmo indice por baixo da constraint, com o
-- mesmo nome -- a unicidade era garantida do mesmo jeito. O que muda e' que
-- `pg_constraint` passa a conhece-la, e principalmente que a estrutura destas
-- tabelas em desenvolvimento passa a ser IDENTICA a que o script da GMUD cria
-- em producao. Duas estruturas parecidas mas diferentes e' o comeco de uma
-- divergencia que ninguem procura.
--
-- Trocar e' instantaneo aqui (algumas milhares de linhas) e nao abre janela sem
-- unicidade: `ADD CONSTRAINT` recria o indice antes do commit, e a transacao da
-- migracao mantem as duas operacoes juntas.

DROP INDEX public.venda_area_mes_uk01;
ALTER TABLE public.venda_area_mes
  ADD CONSTRAINT venda_area_mes_uk01
  UNIQUE (filial_id, area_venda_id, indicador_id, ano, mes);

DROP INDEX public.vendedor_area_mes_uk01;
ALTER TABLE public.vendedor_area_mes
  ADD CONSTRAINT vendedor_area_mes_uk01
  UNIQUE (filial_id, area_venda_id, ano, mes);

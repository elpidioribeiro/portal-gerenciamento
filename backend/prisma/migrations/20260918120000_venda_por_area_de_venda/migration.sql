-- O grao de `fato_venda_linha` deixa de ser a LINHA DE PRODUTO.
--
-- Ate aqui a tabela guardava uma linha por (filial, dia, LINHA DE PRODUTO,
-- indicador) -- ~5.200 registros por dia. Passa a guardar por AREA DE VENDA:
-- ~180 por dia, 33 vezes menos.
--
-- POR QUE: nenhuma tela lia a linha de produto. A unica consulta do sistema que
-- toca esta tabela (`performance-vendas`) faz `groupBy(areaVendaId)` e descarta
-- o resto; `dimensao_linha` nao era lida por tela nenhuma. Confirmado com o
-- analista em 18/09/2026: o grao por linha nao estava previsto para nada.
--
-- O QUE CUSTAVA: um bloco de 7 dias dava ~37 mil registros e matou o pod de
-- producao por falta de memoria (`OOMKilled`, exitCode 137, 5 reinicios em
-- 18/09/2026). A retencao de 60 dias do detalhe existia pelo mesmo motivo.
--
-- EQUIVALENCIA MEDIDA CONTRA O ORACLE antes de mudar, janela 08 a 10/09/2026:
--   por linha 15.729 registros / por area 477  -- totais iguais ao centavo
--   (R$ 23.985.450,20), diferenca de R$ 0,0000 em 477 chaves.
--
-- `dimensao_linha` NAO E' REMOVIDA. Fica orfa e congelada, por decisao do
-- analista -- ver o comentario dela no schema.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. COLAPSA O DADO EXISTENTE PARA O GRAO NOVO.
--
-- E' o passo que nao pode ser esquecido: o dado atual tem varias linhas por
-- (filial, data, area, indicador), e a chave unica nova as recusaria. Somar
-- ANTES de trocar a chave e' o que permite a migracao rodar com a tabela cheia.
--
-- Guarda o valor somado na PRIMEIRA linha de cada grupo e apaga as demais, em
-- vez de recriar a tabela: preserva `sync_id` e `atualizado_em`, que apontam
-- para a execucao que trouxe o dado.
-- ─────────────────────────────────────────────────────────────────────────────
WITH somado AS (
  SELECT filial_id, indicador_id, data, area_venda_id,
         SUM(valor) AS total,
         -- `MIN(id)` nao existe para uuid no Postgres; ordenar como texto da' um
         -- representante estavel do grupo, que e' tudo o que se precisa aqui.
         MIN(id::text)::uuid AS manter
    FROM public.fato_venda_linha
   GROUP BY filial_id, indicador_id, data, area_venda_id
)
UPDATE public.fato_venda_linha f
   SET valor = s.total
  FROM somado s
 WHERE f.id = s.manter
   AND f.valor <> s.total;

DELETE FROM public.fato_venda_linha f
 USING (
   SELECT filial_id, indicador_id, data, area_venda_id, MIN(id::text)::uuid AS manter
     FROM public.fato_venda_linha
    GROUP BY filial_id, indicador_id, data, area_venda_id
 ) s
 WHERE f.filial_id     = s.filial_id
   AND f.indicador_id  = s.indicador_id
   AND f.data          = s.data
   AND f.area_venda_id = s.area_venda_id
   AND f.id <> s.manter;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A CHAVE UNICA PASSA A SER POR AREA.
--
-- Nesta ordem: a nova so' pode ser criada depois do passo 1, e a velha so' pode
-- cair depois -- deixar a tabela sem chave unica entre os dois comandos abriria
-- uma janela em que uma carga concorrente duplicaria sem reclamar.
--
-- INDICE, E NAO CONSTRAINT. O `@@unique` do Prisma cria `fato_venda_linha_uk01`
-- como UNIQUE INDEX, e nao como constraint -- conferido no catalogo antes de
-- escrever. A primeira versao desta migracao usava `ALTER TABLE ... DROP
-- CONSTRAINT` e teria falhado. Vale para a GMUD de producao tambem.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX fato_venda_linha_uk02
    ON public.fato_venda_linha (filial_id, data, area_venda_id, indicador_id);

DROP INDEX public.fato_venda_linha_uk01;

ALTER INDEX public.fato_venda_linha_uk02 RENAME TO fato_venda_linha_uk01;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A COLUNA SAI, com a chave estrangeira e o indice dela.
--
-- O indice `idx03` existia so' para a FK; sem a coluna, ele nao tem o que
-- indexar. O Postgres derrubaria os dois junto com a coluna, mas explicito e'
-- melhor: quem ler a migracao ve o que desapareceu.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fato_venda_linha
  DROP CONSTRAINT fato_venda_linha_dimensao_linha_fk;

DROP INDEX IF EXISTS public.fato_venda_linha_idx03;

ALTER TABLE public.fato_venda_linha
  DROP COLUMN linha_id;

COMMENT ON TABLE public.fato_venda_linha IS 'Venda por filial, dia e AREA DE VENDA, com a gerencia do dia. O nome guarda a origem (a venda e lida a partir da linha de produto), e nao o grao -- que deixou de ser a linha em 18/09/2026.';

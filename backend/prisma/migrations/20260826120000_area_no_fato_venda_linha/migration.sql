-- A area entra no modelo: dimensao_area (era dimensao_area_venda) e a coluna
-- area_id na fato de venda por linha.
--
-- PLANO 7.8.
--
-- POR QUE A AREA VAI TAMBEM NA FATO, e nao so' na dimensao de linha:
-- a linha pode MUDAR de area. Se o vinculo existisse so' em dimensao_linha,
-- reclassificar "Eletro" de Nao Construcao para Construcao reescreveria o
-- passado -- as vendas de marco passariam a contar para a area de hoje, e o
-- historico do GD mudaria sozinho sem ninguem ter mexido em fato nenhum.
-- Guardar a area no fato congela a classificacao do dia em que a venda
-- aconteceu, que e' o unico jeito de a serie historica continuar verdadeira.
--
-- A area passa a vir da CARGA. Ate' aqui a ingestao criava toda linha numa
-- area literal "(nao classificada)", entao dimensao_area_venda existia mas
-- nunca teve area de verdade. Ver o comentario de ordem das operacoes abaixo.

-- 1. Renomeia a dimensao e todos os objetos dependentes.
ALTER TABLE dimensao_area_venda RENAME TO dimensao_area;

ALTER TABLE dimensao_area RENAME CONSTRAINT dimensao_area_venda_pk TO dimensao_area_pk;
-- uk01 e' INDICE unico, nao constraint: o padrao de nomenclatura foi aplicado
-- com CREATE UNIQUE INDEX. Por isso ALTER INDEX, e nao RENAME CONSTRAINT.
ALTER INDEX dimensao_area_venda_uk01 RENAME TO dimensao_area_uk01;
ALTER TABLE dimensao_area RENAME CONSTRAINT dimensao_area_venda_filial_fk TO dimensao_area_filial_fk;
ALTER INDEX dimensao_area_venda_idx01 RENAME TO dimensao_area_idx01;

ALTER TABLE dimensao_linha RENAME COLUMN area_venda_id TO area_id;
ALTER TABLE dimensao_linha
  RENAME CONSTRAINT dimensao_linha_dimensao_area_venda_fk TO dimensao_linha_dimensao_area_fk;

-- 2. A area no fato.
--
-- Entra NULL e so' depois vira NOT NULL: a coluna e' obrigatoria daqui para a
-- frente, mas as linhas ja' gravadas nao tem area -- foram carregadas quando a
-- ingestao ainda jogava tudo em "(nao classificada)". O passo 3 as classifica
-- pela area da propria linha, que e' a melhor informacao disponivel sobre elas.
ALTER TABLE fato_venda_linha ADD COLUMN area_id uuid;

-- 3. Preenche o que ja' existe a partir da dimensao de linha.
UPDATE fato_venda_linha f
   SET area_id = l.area_id
  FROM dimensao_linha l
 WHERE l.id = f.linha_id
   AND f.area_id IS NULL;

ALTER TABLE fato_venda_linha ALTER COLUMN area_id SET NOT NULL;

-- ON UPDATE CASCADE / ON DELETE RESTRICT: e' o que as outras FKs desta tabela
-- ja' usam, e o que o Prisma gera por padrao. Sem as clausulas o Postgres cria
-- NO ACTION, e o `migrate diff` passa a acusar drift para sempre.
ALTER TABLE fato_venda_linha
  ADD CONSTRAINT fato_venda_linha_dimensao_area_fk
  FOREIGN KEY (area_id) REFERENCES dimensao_area (id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX fato_venda_linha_idx06 ON fato_venda_linha (area_id);

-- 4. Comentarios, no padrao de nomenclatura.
COMMENT ON TABLE dimensao_area IS 'Area do GD dentro da filial (Construcao, Nao Construcao, Deposito). Agrupa linhas.';
COMMENT ON COLUMN dimensao_area.supervisor IS 'Nome do supervisor da area. Texto da origem, nao vinculo com usuario.';
COMMENT ON COLUMN dimensao_linha.area_id IS 'Area a que a linha pertence HOJE. Dominio em dimensao_area.';
COMMENT ON COLUMN fato_venda_linha.area_id IS 'Area no dia da venda. Congelada de proposito: reclassificar a linha nao reescreve o passado.';

-- A hierarquia de venda ganha o nivel de cima, e a area de venda volta a se
-- chamar area de venda.
--
-- PLANO 7.9.
--
--   gerencia            Construcao / Nao Construcao  -- escopo do adjunto (N4)
--     area_venda        tem SUPERVISOR. Ex.: Pisos e Revestimentos
--       linha           grao da venda
--
-- DUAS CORRECOES NUMA MIGRACAO SO':
--
-- 1. A migracao 20260826120000 renomeou dimensao_area_venda para dimensao_area
--    por leitura errada da estrutura: eu tratei "Pisos e Revestimentos" como
--    linha, quando e' area de venda. O nome original estava certo -- ela tem
--    supervisor e agrupa linhas -- e volta.
--
-- 2. Entra dimensao_gerencia, que nao existia em lugar nenhum a nao ser como
--    texto em agrupamento.grupo. E' o escopo do gerente adjunto: o supervisor
--    responde a ele conforme a AREA DE VENDA dele estar alocada ali.
--
-- A alocacao mora na AREA DE VENDA, nao na linha: a linha herda. Um lugar so'
-- para manter, e reclassificar uma area de venda move as linhas dela junto --
-- que e' o comportamento certo, porque foi a area que mudou de gerencia.

-- 1. Desfaz o rename equivocado.
ALTER TABLE dimensao_area RENAME TO dimensao_area_venda;
ALTER TABLE dimensao_area_venda RENAME CONSTRAINT dimensao_area_pk TO dimensao_area_venda_pk;
ALTER TABLE dimensao_area_venda RENAME CONSTRAINT dimensao_area_filial_fk TO dimensao_area_venda_filial_fk;
ALTER INDEX dimensao_area_uk01 RENAME TO dimensao_area_venda_uk01;
ALTER INDEX dimensao_area_idx01 RENAME TO dimensao_area_venda_idx01;

ALTER TABLE dimensao_linha RENAME COLUMN area_id TO area_venda_id;
ALTER TABLE dimensao_linha
  RENAME CONSTRAINT dimensao_linha_dimensao_area_fk TO dimensao_linha_dimensao_area_venda_fk;

ALTER TABLE fato_venda_linha RENAME COLUMN area_id TO area_venda_id;
ALTER TABLE fato_venda_linha
  RENAME CONSTRAINT fato_venda_linha_dimensao_area_fk TO fato_venda_linha_dimensao_area_venda_fk;

-- 2. A gerencia.
CREATE TABLE dimensao_gerencia (
  id        uuid NOT NULL,
  filial_id uuid NOT NULL,
  nome      text NOT NULL,
  CONSTRAINT dimensao_gerencia_pk PRIMARY KEY (id),
  CONSTRAINT dimensao_gerencia_filial_fk FOREIGN KEY (filial_id) REFERENCES filial (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE UNIQUE INDEX dimensao_gerencia_uk01 ON dimensao_gerencia (filial_id, nome);
CREATE INDEX dimensao_gerencia_idx01 ON dimensao_gerencia (filial_id);

-- 3. A area de venda passa a pertencer a uma gerencia.
--
-- Entra NULL e vira NOT NULL depois: as areas ja' gravadas nasceram da ingestao
-- antiga, que jogava tudo numa area literal "(nao classificada)". Elas ganham
-- uma gerencia de mesmo nome, tambem "(nao classificada)" -- inventar
-- Construcao ou Nao Construcao para elas seria dado falso, e a proxima carga
-- as reclassifica com a informacao de verdade.
ALTER TABLE dimensao_area_venda ADD COLUMN gerencia_id uuid;

INSERT INTO dimensao_gerencia (id, filial_id, nome)
SELECT gen_random_uuid(), a.filial_id, '(não classificada)'
  FROM (SELECT DISTINCT filial_id FROM dimensao_area_venda) a
 WHERE NOT EXISTS (
   SELECT 1 FROM dimensao_gerencia g
    WHERE g.filial_id = a.filial_id AND g.nome = '(não classificada)'
 );

UPDATE dimensao_area_venda a
   SET gerencia_id = g.id
  FROM dimensao_gerencia g
 WHERE g.filial_id = a.filial_id
   AND g.nome = '(não classificada)'
   AND a.gerencia_id IS NULL;

ALTER TABLE dimensao_area_venda ALTER COLUMN gerencia_id SET NOT NULL;
ALTER TABLE dimensao_area_venda
  ADD CONSTRAINT dimensao_area_venda_dimensao_gerencia_fk
  FOREIGN KEY (gerencia_id) REFERENCES dimensao_gerencia (id)
  ON UPDATE CASCADE ON DELETE RESTRICT;
CREATE INDEX dimensao_area_venda_idx02 ON dimensao_area_venda (gerencia_id);

-- 4. A gerencia no fato, pelo mesmo motivo da area de venda: reclassificar nao
--    pode reescrever o passado. A venda de marco continua na gerencia em que
--    foi feita.
ALTER TABLE fato_venda_linha ADD COLUMN gerencia_id uuid;

UPDATE fato_venda_linha f
   SET gerencia_id = a.gerencia_id
  FROM dimensao_area_venda a
 WHERE a.id = f.area_venda_id
   AND f.gerencia_id IS NULL;

ALTER TABLE fato_venda_linha ALTER COLUMN gerencia_id SET NOT NULL;
ALTER TABLE fato_venda_linha
  ADD CONSTRAINT fato_venda_linha_dimensao_gerencia_fk
  FOREIGN KEY (gerencia_id) REFERENCES dimensao_gerencia (id)
  ON UPDATE CASCADE ON DELETE RESTRICT;
CREATE INDEX fato_venda_linha_idx07 ON fato_venda_linha (gerencia_id);

-- 5. Comentarios.
COMMENT ON TABLE dimensao_gerencia IS 'Gerencia adjunta dentro da filial: Construcao, Nao Construcao, Deposito. Agrupa areas de venda e e o escopo do N4.';
COMMENT ON TABLE dimensao_area_venda IS 'Area de venda dentro da filial. Tem supervisor e agrupa linhas. Ex.: Pisos e Revestimentos.';
COMMENT ON COLUMN dimensao_area_venda.gerencia_id IS 'Gerencia a que a area pertence HOJE. A linha herda daqui. Dominio em dimensao_gerencia.';
COMMENT ON COLUMN dimensao_area_venda.supervisor IS 'Nome do supervisor da area. Texto da origem, nao vinculo com usuario -- o supervisor participa da reuniao do N4 sem ter login.';
COMMENT ON COLUMN fato_venda_linha.area_venda_id IS 'Area de venda no dia da venda. Congelada: reclassificar a linha nao reescreve o passado.';
COMMENT ON COLUMN fato_venda_linha.gerencia_id IS 'Gerencia no dia da venda. Congelada pelo mesmo motivo.';

-- O nivel por MATRICULA, que prevalece sobre o do perfil.
--
-- PLANO 7.17. Decisao do analista em 28/08/2026.
--
-- Perfil e' CARGO, e cargo nem sempre diz o papel no GD: Pedro Souto tem
-- id_perfil 11, associado a N3, e responde como N2. Sem esta tabela a saida
-- seria reclassificar o perfil 11 inteiro -- e junto com ele todo mundo que tem
-- aquele cargo.
--
-- A regra: a linha da PESSOA vence a do PERFIL, sempre. Nao ha' mescla -- se a
-- matricula esta' aqui e ativa, e' esta linha que responde, gerencia inclusa.
--
-- `usuario.matricula` entra junto porque nao existia: o portal guardava so' o
-- `login_erp` (`u10001abc`), e a matricula (`10001`) so' aparecia em transito,
-- vinda da API de login como `employeeId`. Sem grava-la nao ha' como casar a
-- pessoa com a linha desta tabela.

ALTER TABLE usuario ADD COLUMN matricula INTEGER;

COMMENT ON COLUMN usuario.matricula IS
  'numcad do cadastro corporativo. NAO e o login: login_erp e u10001abc, matricula e 10001.';

CREATE TABLE matricula_nivel (
  matricula  INTEGER      NOT NULL,
  nivel      nivel_type   NOT NULL,
  gerencia   VARCHAR,
  descricao  VARCHAR      NOT NULL,
  ativo      BOOLEAN      NOT NULL DEFAULT true,
  criado_em  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT matricula_nivel_pk PRIMARY KEY (matricula)
);

COMMENT ON TABLE matricula_nivel IS
  'Nivel e gerencia de UMA pessoa, por matricula. Prevalece sobre perfil_nivel.';

CREATE INDEX matricula_nivel_idx01 ON matricula_nivel (nivel);

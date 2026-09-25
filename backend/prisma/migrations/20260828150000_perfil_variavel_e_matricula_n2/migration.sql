-- O cadastro de acesso passa a ter tres formas, uma por nivel (PLANO §7.20):
--
--   N4  ->  id_perfil + variaveis de controle
--   N3  ->  id_perfil
--   N2  ->  matricula
--
-- Duas coisas saem, `nomloc` e `gerencia`, e uma volta: `perfil_variavel`.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. `perfil_variavel`: de quais variaveis o perfil responde
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "perfil_variavel" (
    "id_perfil"            INTEGER      NOT NULL,
    "variavel_controle_id" UUID         NOT NULL,
    "criado_em"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perfil_variavel_pk" PRIMARY KEY ("id_perfil", "variavel_controle_id")
);

CREATE INDEX "perfil_variavel_idx01" ON "perfil_variavel"("id_perfil");
CREATE INDEX "perfil_variavel_idx02" ON "perfil_variavel"("variavel_controle_id");

COMMENT ON TABLE "perfil_variavel" IS
  'De quais variaveis de controle o perfil responde -- o que o N4 pode MARCAR. '
  'Cadastrado junto com o nivel, na mesma tela: sao as duas metades de uma '
  'decisao so''. A empresa nao entra -- e'' a filial de quem loga que filtra.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Backfill, ANTES de a gerencia sumir
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Hoje a permissao de marcar e' derivada: a pessoa responde por uma gerencia
-- (`perfil_nivel.gerencia`) e a gerencia responde por variaveis
-- (`gerencia_variavel`). Percorrer esse caminho uma ultima vez e gravar o
-- resultado preserva exatamente quem podia marcar o que.
--
-- DISTINCT porque `dimensao_gerencia` tem uma linha por (filial, nome) e a
-- associacao do perfil e' por NOME: as nove lojas trazem a mesma variavel nove
-- vezes.
INSERT INTO "perfil_variavel" ("id_perfil", "variavel_controle_id")
SELECT DISTINCT pn."id_perfil", gv."variavel_controle_id"
  FROM "perfil_nivel" pn
  JOIN "dimensao_gerencia" dg ON dg."nome" = pn."gerencia"
  JOIN "gerencia_variavel" gv ON gv."gerencia_id" = dg."id"
 WHERE pn."gerencia" IS NOT NULL
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. `perfil_nivel`: a chave volta a ser o `id_perfil` sozinho
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A lotacao entrou na chave por meio dia para distinguir os quatro perfis de
-- GERENTE ADJUNTO -- mas eles ja' sao quatro `id_perfil` diferentes, e a
-- lotacao repetia na chave o que o perfil ja' dizia.
--
-- A checagem e' explicita porque o `ADD PRIMARY KEY` tambem falharia com
-- duplicata, mas com uma mensagem que nao diz qual perfil resolver primeiro.
DO $$
DECLARE
  repetidos TEXT;
BEGIN
  SELECT string_agg(DISTINCT "id_perfil"::TEXT, ', ')
    INTO repetidos
    FROM (SELECT "id_perfil" FROM "perfil_nivel"
           GROUP BY "id_perfil" HAVING COUNT(*) > 1) d;

  IF repetidos IS NOT NULL THEN
    RAISE EXCEPTION
      'Os perfis % tem mais de uma classificacao por lotacao. Apague as linhas '
      'sobrando (mantendo uma por id_perfil) antes de aplicar esta migracao: a '
      'lotacao vai sair da chave, e nao existe criterio para escolher qual das '
      'linhas vale.',
      repetidos;
  END IF;
END $$;

ALTER TABLE "perfil_nivel" DROP CONSTRAINT "perfil_nivel_pk";
DROP INDEX IF EXISTS "perfil_nivel_idx02";
ALTER TABLE "perfil_nivel" DROP COLUMN "nomloc";
ALTER TABLE "perfil_nivel" DROP COLUMN "gerencia";
ALTER TABLE "perfil_nivel" ADD CONSTRAINT "perfil_nivel_pk" PRIMARY KEY ("id_perfil");

ALTER TABLE "perfil_variavel"
  ADD CONSTRAINT "perfil_variavel_perfil_nivel_fk"
  FOREIGN KEY ("id_perfil") REFERENCES "perfil_nivel"("id_perfil")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "perfil_variavel"
  ADD CONSTRAINT "perfil_variavel_variavel_controle_fk"
  FOREIGN KEY ("variavel_controle_id") REFERENCES "variavel_controle"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE "perfil_nivel" IS
  'O cadastro do N3 e do N4: um id_perfil por linha. A empresa nao entra -- a '
  'associacao vale para as nove lojas e quem escolhe a filial e'' a pessoa que '
  'loga. As variaveis do N4 estao em perfil_variavel.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. `matricula_nivel`: o cadastro do N2
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A gerencia sai pelo mesmo motivo do perfil: quem responde por variaveis e' o
-- N4, e o N4 se cadastra por perfil. O N2 e' corporativo.
--
-- A coluna `nivel` FICA, e passa a ter `N2` como padrao: e'' o unico nivel que
-- se cadastra por matricula hoje, e abrir os outros depois vira uma opcao no
-- seletor em vez de uma migracao.
ALTER TABLE "matricula_nivel" DROP COLUMN "gerencia";
ALTER TABLE "matricula_nivel" ALTER COLUMN "nivel" SET DEFAULT 'N2';

COMMENT ON TABLE "matricula_nivel" IS
  'O cadastro do N2: uma matricula por linha, e ela PREVALECE sobre perfil_nivel. '
  'Perfil e'' cargo, e cargo nem sempre diz o papel no GD -- quem tem o perfil de '
  'gerente geral (N3) e responde como N2 e'' cadastrado aqui.';

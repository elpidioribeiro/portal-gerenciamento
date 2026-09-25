-- A carga de usuários: o portal passa a conhecer as pessoas ANTES do primeiro
-- login delas (analista, 31/08/2026, §7.33).
--
-- O problema, medido: `perfil_nivel` tinha `id_perfil 11 -> N3` ativo, com dez
-- gerentes gerais de loja no RH, e o seletor de "escalar para o N3" vinha
-- VAZIO. As duas coisas eram verdade ao mesmo tempo porque `usuario` só ganha
-- linha no PRIMEIRO LOGIN (`auth/provider.ts` faz upsert ao autenticar), e
-- nenhum deles tinha entrado.
--
-- Isso é um ovo-e-galinha de implantação: o N4 precisa escalar para o gerente
-- geral, e o gerente geral só vira destino depois de logar.

-- ─────────────────────────────────────────────────────────────────────────────
-- A MATRÍCULA vira chave de reconciliação
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `login_erp` (`u10001abc`) é a identidade de quem entra, e é por ele que o
-- login faz upsert. Mas a `hr_vw_colaboradores` NÃO TEM coluna de login --
-- medido: as 13 colunas dela são cod_empresa, centro_custo, numcad, nomfun,
-- titred, codcar, nomloc, numcpf, sitafa, numloc, id_perfil, numfis, avaliador.
--
-- Então a carga não consegue produzir `login_erp`, e precisa de outra chave. O
-- `numcad` é a única identidade que as duas pontas compartilham.
--
-- Sem esta unicidade, a segunda execução da carga criaria a pessoa de novo, e o
-- primeiro login criaria uma TERCEIRA -- três linhas para a mesma pessoa, e a
-- ação escalada para a linha errada some do quadro de quem entrou.
--
-- Nulos continuam permitidos e não colidem entre si (é assim que UNIQUE trata
-- NULL no Postgres): usuário de MockAuthProvider não tem matrícula, e são
-- vários.
CREATE UNIQUE INDEX "usuario_uk02" ON "usuario" ("matricula");

COMMENT ON COLUMN public."usuario"."matricula" IS
  'numcad do cadastro corporativo. E'' a chave de RECONCILIACAO entre a carga de '
  'usuarios e o primeiro login: a view do RH nao tem coluna de login, entao a '
  'carga grava um login_erp provisorio e o login adota a linha pela matricula.';

-- ─────────────────────────────────────────────────────────────────────────────
-- De onde a linha veio
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A carga só pode mexer no que ELA criou. Uma pessoa que já entrou no portal
-- tem estado próprio -- `ativo` e `admin` são decisões do portal, e o login já
-- as preserva de propósito --, e a carga não pode desfazer isso.
--
-- Com esta coluna a regra fica legível num `SELECT`, em vez de inferida da
-- forma do `login_erp`.
ALTER TABLE "usuario"
  ADD COLUMN "origem_carga" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public."usuario"."origem_carga" IS
  'Verdadeiro enquanto a linha existe apenas porque a carga a criou -- a pessoa '
  'nunca entrou no portal. Vira falso no primeiro login, e a partir dai a carga '
  'nao mexe mais em ativo nem em admin.';

-- As três pessoas que já existem entraram pelo login, não pela carga.
UPDATE "usuario" SET "origem_carga" = false;

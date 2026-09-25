-- Duas coisas para o login real e para a administracao de acesso.

-- 1. Usuario admin.
--
-- Ve todos os niveis e escolhe qual visualizar. E' DADO, nao codigo: hoje so' a
-- matricula 10001 tem, e um segundo admin e' UPDATE, nao deploy.
--
-- E' tambem a unica porta de entrada enquanto os perfis nao estiverem
-- classificados: perfil sem nivel e' BLOQUEADO no login, e a view do RH tem 462
-- perfis distintos contra os poucos cadastrados em perfil_nivel. Sem o admin,
-- ligar AUTH_PROVIDER=erp trancaria todo mundo do lado de fora.
ALTER TABLE "usuario" ADD COLUMN "admin" BOOLEAN NOT NULL DEFAULT false;

-- 2. Quais variaveis de controle um (id_perfil, nomloc) pode ver.
--
-- O PAR importa: o mesmo cargo em locais diferentes ve variaveis diferentes.
--
-- `nomloc` vem de hr_vw_colaboradores no Oracle e e' guardado SEMPRE com trim.
-- As colunas daquela view sao CHAR e voltam com espaco a direita — medido:
-- titred devolveu 'GERENTE ADJUNTO ' com espaco no fim. Sem normalizar, a
-- associacao nao casa no login e a pessoa nao ve variavel nenhuma, sem erro
-- nenhum aparecer.
--
-- Ausencia de linha significa NENHUMA variavel visivel. Nega por padrao, a mesma
-- regra do login que bloqueia perfil sem nivel.
CREATE TABLE "perfil_variavel" (
    "id_perfil" INTEGER NOT NULL,
    "nomloc" TEXT NOT NULL,
    "variavel_controle_id" UUID NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Chave composta: e' associacao pura, sem identidade propria.
    CONSTRAINT "perfil_variavel_pkey" PRIMARY KEY ("id_perfil", "nomloc", "variavel_controle_id")
);

-- O acesso no login e' sempre por (id_perfil, nomloc); a variavel vem depois.
CREATE INDEX "perfil_variavel_id_perfil_nomloc_idx"
    ON "perfil_variavel" ("id_perfil", "nomloc");

-- CASCADE: se uma variavel de controle for removida do catalogo, a associacao
-- perde sentido e deve ir junto. Deixar orfa faria a tela referenciar variavel
-- inexistente.
ALTER TABLE "perfil_variavel"
    ADD CONSTRAINT "perfil_variavel_variavel_controle_id_fkey"
    FOREIGN KEY ("variavel_controle_id") REFERENCES "variavel_controle"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

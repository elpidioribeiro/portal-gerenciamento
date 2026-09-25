-- A empresa (filial) entra na chave da associacao de variaveis.
--
-- Decisao do analista. O que estava antes: `(id_perfil, nomloc)`, que e' cargo x
-- LOTACAO. Medido na view do RH, `nomloc` e' o setor (VENDAS CONSTRUCAO,
-- ATENDIMENTO E SERVICOS) e nao a loja — a loja e' o `cod_empresa`, e um mesmo
-- `id_perfil` atravessa as filiais. Sem a empresa na chave, nao havia como dar
-- variaveis diferentes ao mesmo cargo em lojas diferentes.
--
-- Custo medido: 602 pares viram 1.575 trios (1.183 dentro das 9 filiais do GD).
-- Mas 416 dos 602 pares (69%) existem em UMA empresa so', e nesses a empresa e'
-- implicada — nao ha' o que escolher. O peso real esta' nos 54 pares que
-- atravessam as 9 filiais, e para esses a API aceita varias empresas por
-- requisicao, senao seria o mesmo clique nove vezes.

-- 1. A empresa na chave de `perfil_variavel`.
--
-- Sem DEFAULT e NOT NULL: se a tabela tivesse linha, este ALTER FALHA — e falhar
-- e' o certo. Nao existe empresa correta para inventar numa associacao que foi
-- gravada sem ela, e um default (0? 1?) daria a linha antiga a uma filial
-- arbitraria, calado. A tabela esta' vazia nos dois ambientes.
ALTER TABLE "perfil_variavel" DROP CONSTRAINT "perfil_variavel_pkey";
ALTER TABLE "perfil_variavel" ADD COLUMN "cod_empresa" INTEGER NOT NULL;
ALTER TABLE "perfil_variavel"
    ADD CONSTRAINT "perfil_variavel_pkey"
    PRIMARY KEY ("id_perfil", "nomloc", "cod_empresa", "variavel_controle_id");

-- O acesso no login e' sempre pelo trio; a variavel vem depois.
DROP INDEX "perfil_variavel_id_perfil_nomloc_idx";
CREATE INDEX "perfil_variavel_escopo_idx"
    ON "perfil_variavel" ("id_perfil", "nomloc", "cod_empresa");

-- 2. O codigo da empresa na tabela de filiais.
--
-- Precisa existir para a tela mostrar "CAM" em vez de "8". O mapeamento
-- cod->sigla ja' vivia em `docs/n8n/fontes.mjs` (FILIAIS_GD), duplicado e longe
-- de quem precisa dele; aqui ele passa a ser atributo da filial.
--
-- NULO permitido de proposito: nem toda empresa do RH e' filial do GD. Ha' o
-- corporativo (99), os CDs (82, 92, 93, 94) e outros codigos (4016, 8090,
-- 9007...) que nao tem linha em `filial` — e a associacao de variaveis pode
-- apontar para eles. A tela mostra o numero quando nao acha a sigla, em vez de
-- esconder o escopo.
ALTER TABLE "filial" ADD COLUMN "codigo" INTEGER;

-- Unico onde presente: dois codigos iguais fariam a traducao cod->filial
-- escolher uma das duas em silencio.
CREATE UNIQUE INDEX "filial_codigo_key" ON "filial" ("codigo");

-- As 9 filiais do GD, na correspondencia usada em toda a ingestao.
UPDATE "filial" SET "codigo" = 1 WHERE "sigla" = 'CEN';
UPDATE "filial" SET "codigo" = 2 WHERE "sigla" = 'NOR';
UPDATE "filial" SET "codigo" = 3 WHERE "sigla" = 'SUL';
UPDATE "filial" SET "codigo" = 4 WHERE "sigla" = 'LES';
UPDATE "filial" SET "codigo" = 5 WHERE "sigla" = 'OES';
UPDATE "filial" SET "codigo" = 6 WHERE "sigla" = 'LIT';
UPDATE "filial" SET "codigo" = 7 WHERE "sigla" = 'SER';
UPDATE "filial" SET "codigo" = 8 WHERE "sigla" = 'CAM';
UPDATE "filial" SET "codigo" = 9 WHERE "sigla" = 'PRA';

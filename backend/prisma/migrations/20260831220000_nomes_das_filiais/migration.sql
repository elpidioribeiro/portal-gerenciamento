-- Os nomes completos das nove lojas (analista, 31/08/2026).
--
-- Seis delas tinham a SIGLA no lugar do nome -- "LES" chamada de LES, "OES" de
-- OES. Nao era descuido: o handoff so' trazia as siglas, e o seed registrava a
-- falta numa nota ("os nomes completos sao uma pendencia de cadastro -- ate' la',
-- sigla serve de nome"). Tres ja' tinham nome: Centro, Norte, Sul.
--
-- `filial.nome` aparece na tela de login e no seletor de loja. "OES" nao diz a
-- ninguem que e' Oeste, e quem entra pela primeira vez escolhe pela sigla que
-- conhece de cor ou nao escolhe.
--
-- Casado pela SIGLA, e nao pelo codigo: a sigla e' o que o analista informou, e
-- o codigo e' a chave da empresa (cod_empresa). Errar o par aqui poria o nome de
-- uma loja em outra -- e ninguem estranharia "Oeste" no lugar de "Praia" sem
-- conhecer as nove.
UPDATE "filial" SET "nome" = 'Leste' WHERE "sigla" = 'LES';
UPDATE "filial" SET "nome" = 'Oeste'     WHERE "sigla" = 'OES';
UPDATE "filial" SET "nome" = 'Litoral' WHERE "sigla" = 'LIT';
UPDATE "filial" SET "nome" = 'Serra' WHERE "sigla" = 'SER';
UPDATE "filial" SET "nome" = 'Campo'     WHERE "sigla" = 'CAM';
UPDATE "filial" SET "nome" = 'Praia'      WHERE "sigla" = 'PRA';

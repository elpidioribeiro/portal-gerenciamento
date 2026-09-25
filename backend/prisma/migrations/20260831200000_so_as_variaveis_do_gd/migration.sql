-- Só as variáveis de controle que o GD acompanha ficam visíveis (§7.43).
--
-- O drill-down do N2 oferecia cinco chips em Vendas -- Ticket medio, Conversao
-- de loja, Itens por cupom ao lado de Performance Vendedor e Performance
-- Vendas. As tres primeiras sao do handoff: nao tem fato, nao tem acao, e
-- ninguem as acompanha. Clicar nelas nao podia levar a lugar nenhum.
--
-- Mesma decisao das causas sinteticas (§7.30), e pela mesma razao: uma lista
-- que mistura o que existe com o que foi exemplo faz alguem escolher o exemplo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O criterio e' o VINCULO COM A GERENCIA, e nao uma lista de nomes
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `gerencia_variavel` e' o cadastro de quem acompanha o que (§7.18). Variavel
-- sem vinculo nenhum e' variavel que nenhuma gerencia acompanha -- e uma
-- variavel de controle que ninguem controla nao esta' no Gerenciamento Diario.
--
-- Medido: as duas reais tem 18 vinculos cada (9 filiais x 2 gerencias de
-- venda); as doze do handoff tem ZERO, e tambem zero acao.
--
-- Uma lista de nomes envelheceria: variavel nova cadastrada amanha nasceria
-- fora dela e sumiria da tela sem ninguem entender. Pelo vinculo, ela aparece
-- assim que alguem a acompanha, que e' exatamente quando ela passa a existir
-- para o GD.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- INATIVAS, nao apagadas
-- ─────────────────────────────────────────────────────────────────────────────
--
-- E' a convencao do schema, escrita no proprio campo: "tira de vista sem
-- apagar". E ha' o que preservar: 2.592 metas de escopo VARIAVEL apontam para
-- elas, e 36 pontos de causa (ja' inativos por §7.30). Apagar a variavel levaria
-- tudo isso junto, ou deixaria FK orfa.
UPDATE "variavel_controle"
   SET "ativo" = false
 WHERE "id" NOT IN (SELECT DISTINCT "variavel_controle_id" FROM "gerencia_variavel");

COMMENT ON COLUMN "variavel_controle"."ativo" IS
  'Tira de vista sem apagar. Falso nas variaveis que nenhuma gerencia acompanha '
  '-- sem vinculo em gerencia_variavel, a variavel nao esta'' no GD e nao deve '
  'aparecer como opcao na tela.';

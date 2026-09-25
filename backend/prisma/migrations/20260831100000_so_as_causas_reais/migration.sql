-- Só os pontos de causa REAIS ficam na tela (analista, 31/08/2026).
--
-- O banco tinha 51 causas ativas, de duas origens que nunca deveriam conviver
-- numa lista só:
--
--   15  REAIS      as que o analista passou, em `prisma/seed/variaveis-gd.ts`.
--                  Penduram em Performance Vendedor (4) e Performance Vendas
--                  (11), que são as duas variáveis do GD de verdade.
--   36  SINTÉTICAS 12 variáveis do handoff x 3, para as telas da v1 terem
--                  Pareto: "Ocupação baixa do veículo", "Cobertura de câmeras
--                  no corredor 7".
--
-- No seletor de "Abrir ação" as duas apareciam juntas, e quem abre uma ação da
-- reunião escolhia a causa dela no meio de 36 que não são de ninguém.
--
-- INATIVAS, e não apagadas. Duas razões:
--
--   1. É a convenção do schema, escrita em `indicador.ativo`: "aposentar não
--      pode significar apagar a linha -- falso remove da tela e preserva tudo.
--      Mesma solução de filial.ativa e ponto_causa.ativo";
--   2. as ocorrências semeadas penduram NELAS. `pareto.ts` gera a marcação
--      sintética a partir dos pesos do handoff, então apagar a causa levaria
--      junto o Pareto das telas da v1 -- que continuam existindo.
--
-- Todas as rotas que listam causa já filtram `ativo = true`
-- (`/contramedidas/opcoes` e a grade de marcação), então isto basta para elas
-- sumirem de toda lista sem tocar em rota nenhuma.

-- ─────────────────────────────────────────────────────────────────────────────
-- As causas das DUAS variáveis reais continuam ativas; as demais saem
-- ─────────────────────────────────────────────────────────────────────────────
--
-- O critério é a VARIÁVEL, e não uma lista de 36 nomes: nome a nome, uma causa
-- real escrita diferente do esperado seria desativada em silêncio, e a pessoa
-- descobriria na reunião que a causa dela sumiu do seletor. Pela variável, o
-- pior caso é sobrar causa demais -- que se vê na hora.
UPDATE "ponto_causa" pc
   SET "ativo" = false
  FROM "variavel_controle" v
 WHERE pc."variavel_controle_id" = v."id"
   AND pc."ativo" = true
   AND v."nome" NOT IN ('Performance Vendedor', 'Performance Vendas');

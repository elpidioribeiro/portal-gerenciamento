-- O agrupamento do N4 passa a ser a GERÊNCIA, não a área de venda.
--
-- O quadro do N4 é o da gerência dele -- Construção, Não Construção,
-- Operacional. A ÁREA DE VENDA é a camada de baixo, e ela é do N5, que ainda
-- não existe (analista, 29/08/2026). Ver §7.28.
--
-- Isto desfaz o cadastro que `scripts/sincronizar-agrupamentos.ts` criou, e
-- corrige de vez o handoff, que trazia dois níveis empilhados numa linha só:
--
--     grupo 'Vendas Construção'  |  nome 'Pisos e Revestimentos'
--     └─ a gerência (N4)            └─ a área (N5, quando existir)
--
-- Era isso que fazia o coordenador escolher entre "Pisos e Revestimentos" e
-- "Eletro" ao abrir uma ação, quando ele só tem um quadro.
--
-- O cadastro é PRÓPRIO DO PORTAL, e não derivado de dimensao_gerencia: aquela
-- tabela nasce da carga de vendas e por isso só conhece CONSTRUÇÃO e NÃO
-- CONSTRUÇÃO. Operacional é um quadro de GD que existe na reunião sem vender
-- nada -- derivar da dimensão o apagaria.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. As três gerências entram
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `ON CONFLICT DO NOTHING` sobre agrupamento_uk01 (nivel, nome): 'Operacional'
-- já existe em N3 e N2, e a chave inclui o nível, então não colidem.
INSERT INTO "agrupamento" ("id", "nivel", "grupo", "nome", "ordem")
VALUES
  (gen_random_uuid(), 'N4', NULL, 'Construção',     1),
  (gen_random_uuid(), 'N4', NULL, 'Não Construção', 2),
  (gen_random_uuid(), 'N4', NULL, 'Operacional',    3)
ON CONFLICT ("nivel", "nome") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O que aponta para um agrupamento antigo é REAPONTADO, não apagado
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A gerência de destino sai do `grupo` do agrupamento antigo, que é justamente
-- a informação que estava empilhada ali. Nenhuma linha é adivinhada: o que não
-- tiver grupo reconhecível fica de fora e barra o DELETE do passo 3, que é o
-- comportamento certo -- ninguém deve descobrir na reunião que a ação mudou de
-- quadro sozinha.
--
-- 'Não Construção' é testado ANTES de 'Construção': ele contém a palavra. E as
-- duas grafias entram, com e sem til: o handoff escreveu "Vendas Não
-- Construção" e a carga de áreas escreveu "NÃO CONSTRUÇÃO", mas houve grafia
-- sem acento no meio do caminho.
CREATE TEMP TABLE mapa_agrupamento_n4 AS
SELECT velho."id" AS velho_id, novo."id" AS novo_id
  FROM "agrupamento" velho
  JOIN "agrupamento" novo
    ON novo."nivel" = 'N4'
   AND novo."grupo" IS NULL
   AND novo."nome" = CASE
         WHEN velho."grupo" ILIKE '%NÃO CONSTRU%' THEN 'Não Construção'
         WHEN velho."grupo" ILIKE '%NAO CONSTRU%' THEN 'Não Construção'
         WHEN velho."grupo" ILIKE '%CONSTRU%'     THEN 'Construção'
         WHEN velho."grupo" ILIKE '%OPERACIONAL%' THEN 'Operacional'
       END
 WHERE velho."nivel" = 'N4'
   AND velho."grupo" IS NOT NULL;

-- As quatro colunas que referenciam agrupamento.
UPDATE "contramedida" c SET "bucket_id" = m.novo_id
  FROM mapa_agrupamento_n4 m WHERE c."bucket_id" = m.velho_id;

UPDATE "ponto_causa" pc SET "bucket_id" = m.novo_id
  FROM mapa_agrupamento_n4 m WHERE pc."bucket_id" = m.velho_id;

UPDATE "usuario" u SET "bucket_id" = m.novo_id
  FROM mapa_agrupamento_n4 m WHERE u."bucket_id" = m.velho_id;

UPDATE "movimentacao" mv SET "bucket_destino_id" = m.novo_id
  FROM mapa_agrupamento_n4 m WHERE mv."bucket_destino_id" = m.velho_id;

DROP TABLE mapa_agrupamento_n4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Os agrupamentos antigos do N4 saem
-- ─────────────────────────────────────────────────────────────────────────────
--
-- No banco de desenvolvimento são 75 -- 73 áreas de venda vindas da carga (com
-- as onze grafias de "Utilidades Domésticas" que o cadastro de cada loja
-- produziu) e 2 do handoff, cujas ações o passo 2 já levou para Construção.
--
-- SEM `CASCADE`, e é o ponto: se sobrou linha apontando para um agrupamento
-- antigo -- porque o `grupo` dele não dizia a gerência --, esta migração FALHA
-- em vez de arrastar a ação junto. Um erro aqui custa uma investigação; uma
-- ação sumindo do quadro custa a reunião.
DELETE FROM "agrupamento"
 WHERE "nivel" = 'N4'
   AND NOT ("grupo" IS NULL AND "nome" IN ('Construção', 'Não Construção', 'Operacional'));

COMMENT ON COLUMN public."agrupamento"."nome" IS
  'Nome do agrupamento -- a coluna do quadro. No N4 e'' a GERENCIA (Construcao, '
  'Nao Construcao, Operacional); nos demais e'' o setor (Vendas, Suprimentos). A '
  'area de venda e'' a camada abaixo da gerencia e pertence ao N5, que ainda nao '
  'existe.';

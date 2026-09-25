-- As três áreas de destaque de cada gerência (analista, 31/08/2026, §7.31).
--
-- Uma gerência tem até 28 áreas, e a reunião de 15 minutos não passa por todas.
-- O analista nomeou três por gerência; o resto fica atrás do "expandir".
--
--   CONSTRUÇÃO       Pisos e Revestimentos · Metais e Acessórios · Tintas e Químicos
--   NÃO CONSTRUÇÃO   Eletro · Móveis · Utilidades Domésticas
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Por que (filial, cd_area) e não o nome, e por que a lista é LONGA
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Instrução do analista: "cheque o nome delas em cada filial e utilize o código
-- da área de venda". É o caminho certo, e a conferência mostrou por quê.
--
-- **O `cd_area` NÃO é o mesmo entre filiais.** Não é chave de rede, é chave
-- dentro da loja (`dimensao_area_venda_uk01` é (filial, cd_area)):
--
--   cd=6   AUTOMOTIVO em 8 lojas, PISOS E REVESTIMENTOS em 1
--   cd=9   PISOS em 6, MÁQUINAS E MOTORES em 1, TINTAS em 2
--   cd=1   NÃO CONSTRUÇÃO em 8 lojas, CONSTRUÇÃO na LES
--
-- Uma lista de três códigos valendo para a rede poria em destaque a área errada
-- em três lojas -- sem erro nenhum, só a linha errada no topo do quadro.
--
-- **E os nomes do analista quase nunca existem literais**, porque o cadastro é
-- de cada loja:
--
--   "Metais e Acessórios"    -> LOUÇAS E METAIS SANITÁRIOS  (em todas)
--   "Tintas e Químicos"      -> TINTAS E ACESSÓRIOS         (em todas)
--   "Móveis"                 -> MÓVEIS / MOVEIS / MÓVEIS E DECORAÇÕES /
--                               MÓVEIS E COZINHAS
--   "Utilidades Domésticas"  -> sete grafias diferentes
--
-- Por isso a resolução foi feita UMA VEZ, por nome, loja a loja, e o resultado
-- está congelado abaixo em código -- que é estável dentro da loja mesmo quando
-- alguém corrige a grafia do nome. Refazer o casamento por nome a cada leitura
-- seria repetir um palpite a cada requisição.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- TRÊS CASOS QUE NÃO FECHARAM, e ficam de fora em vez de virar palpite
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. **CEN e SER não têm Utilidades Domésticas.** Nenhuma área com o nome. Elas
--    ficam com DUAS de destaque em Não Construção, e não com uma terceira
--    escolhida por proximidade -- destacar "Cama, Mesa e Banho" no lugar seria
--    a tela afirmando algo que ninguém pediu.
--
-- 2. **LES: `ELETRO` (cd=1) está sob CONSTRUÇÃO.** Está marcado assim mesmo:
--    o destaque é da ÁREA, e em qual gerência ela aparece é o cadastro que
--    decide. Se for erro de cadastro, corrige-se na origem e o destaque segue
--    junto -- o que não se deve fazer é a tela remendar por fora.
--
-- 3. **OES e LES têm duas candidatas a Utilidades.** Escolhido o `cd=2` nas
--    duas, que é o que traz "UTILIDADES" no nome; a outra da OES é
--    "SEM USO - UTILIDADES PLASTICOS / CAMEBA", que se anuncia sozinha.

ALTER TABLE "dimensao_area_venda"
  ADD COLUMN "destaque" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "dimensao_area_venda"."destaque" IS
  'Area de destaque do quadro do N4: aparece antes, e o resto fica atras do '
  '"expandir". Cadastro do portal, nao da carga -- a ingestao so'' atualiza '
  'nome e gerencia_id, entao este campo sobrevive a ela.';

-- (sigla da filial, cd_area) — resolvido por nome, loja a loja, em 31/08/2026.
UPDATE "dimensao_area_venda" dav
   SET "destaque" = true
  FROM "filial" f
 WHERE f."id" = dav."filial_id"
   AND (f."sigla", dav."cd_area") IN (
     -- CONSTRUÇÃO: Pisos · Metais (Louças e Metais Sanitários) · Tintas
     ('OES','9'), ('OES','8'), ('OES','15'),
     ('PRA','12'), ('PRA','11'), ('PRA','9'),
     ('CAM','9'), ('CAM','8'), ('CAM','15'),
     ('CEN','6'), ('CEN','5'), ('CEN','3'),
     ('NOR','9'), ('NOR','8'), ('NOR','15'),
     ('LIT','9'), ('LIT','8'), ('LIT','15'),
     ('SUL','12'), ('SUL','11'), ('SUL','9'),
     ('SER','9'), ('SER','8'), ('SER','15'),
     ('LES','9'), ('LES','8'), ('LES','15'),
     -- NÃO CONSTRUÇÃO: Eletro · Móveis · Utilidades Domésticas
     ('OES','1'), ('OES','10'), ('OES','2'),
     ('PRA','1'), ('PRA','13'), ('PRA','2'),
     ('CAM','1'), ('CAM','10'), ('CAM','2'),
     ('CEN','20'), ('CEN','23'),           -- sem Utilidades nesta loja
     ('NOR','1'), ('NOR','10'), ('NOR','2'),
     ('LIT','1'), ('LIT','10'), ('LIT','2'),
     ('SUL','1'), ('SUL','13'), ('SUL','2'),
     ('SER','1'), ('SER','10'),            -- sem Utilidades nesta loja
     ('LES','1'), ('LES','10'), ('LES','2')
   );

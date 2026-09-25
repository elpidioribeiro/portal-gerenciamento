-- O patamar de Performance Vendas: 100% (analista, 31/08/2026).
--
-- Fecha o buraco que fazia as duas telas do GD mentirem em direções opostas,
-- sobre o mesmo dado. Ver PLANO §7.37.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Duas metas com o mesmo nome, e só uma estava cadastrada
-- ─────────────────────────────────────────────────────────────────────────────
--
--   escopo AREA_VENDA   `ESQUADRIAS E FECHADURAS -> 1.369.698`
--                       Os R$ que a area tem de vender. 9.603 linhas, vindas da
--                       carga de metas. E' o DENOMINADOR do calculo: "vendeu
--                       quanto / tinha de vender quanto" -> 95%.
--
--   escopo VARIAVEL     `Conversao de loja (%) -> 35`
--                       O PATAMAR do resultado: a partir de quanto o indicador
--                       conta como cumprido. 2.592 linhas, e NENHUMA delas para
--                       Performance Vendas ou Performance Vendedor -- as duas
--                       variaveis que sustentam o GD.
--
-- A tela tinha o numero (95%) e nao tinha contra o que compara-lo. E cada tela
-- resolveu isso por conta:
--
--   N4   `percentual >= (meta ?? 100)`   supunha 100% -> 95% virava VERMELHO
--   N3   `meta === null -> null`         nao comparava -> tudo CINZA
--
-- O comentario do proprio N4, tres linhas abaixo do `?? 100`, dizia por que
-- aquilo estava errado: "supor a meta faria a variavel parecer no alvo (ou fora
-- dele) por uma decisao que ninguem tomou".
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 100%, e por que so' Vendas
-- ─────────────────────────────────────────────────────────────────────────────
--
-- "So' olhe para vendas, 100%" -- o analista. Para Vendas o patamar e' o proprio
-- alvo: bater a meta e' bater a meta, e 100% e' o valor honesto.
--
-- Performance VENDEDOR fica sem patamar DE PROPOSITO, e nao por esquecimento.
-- Ela e' "% dos vendedores que cumpriram cota", e exigir 100% poria em vermelho
-- toda equipe com um vendedor abaixo. Ela continua na tela como informacao --
-- 43% de 53 vendedores diz muito numa reuniao --, mas nao emite veredito.
--
-- Consequencia visivel: o selo da area e da gerencia passa a responder por
-- VENDAS. Uma area com 95% de vendas e 0% de vendedores aparece "fora da meta"
-- pelos 95%, e o 0% fica ao lado, em cinza, para a conversa.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A cobertura segue o padrao das que ja' existem
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 9 filiais x 24 competencias (2025 e 2026) = 216 linhas. Medido: as 2.592 metas
-- de variavel sao 9 filiais x 12 variaveis x 24 meses, exatamente esta forma.
--
-- `tipo = 'FILIAL'` exclui Rede e 99-CORPORATIVO: meta de variavel e' de loja, e
-- as outras duas nao tem reuniao de GD.
INSERT INTO "meta" ("id", "escopo", "alvo_id", "filial_id", "ano", "mes", "valor")
SELECT gen_random_uuid(), 'VARIAVEL', v."id", f."id", a.ano, m.mes, 100
  FROM "variavel_controle" v
  CROSS JOIN "filial" f
  CROSS JOIN (SELECT generate_series(2025, 2026) AS ano) a
  CROSS JOIN (SELECT generate_series(1, 12) AS mes) m
 WHERE v."nome" = 'Performance Vendas'
   AND f."tipo" = 'FILIAL'
ON CONFLICT DO NOTHING;

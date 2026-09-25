-- Paridade de objetos soltos entre dois bancos do Portal GD.
--
-- Emite uma linha canonica por SEQUENCE, FUNCTION e TRIGGER do schema public,
-- ordenada, para `diff` comparar o banco montado pelas migrations do Prisma
-- contra o montado pelas GMUDs. Sao exatamente as classes que o gerador do
-- 8-cria_banco NAO emite (ver memoria: gmud-gerada-omite-objetos-soltos) e que
-- ja causaram 500 em producao (sequence do codigo) e integridade ausente
-- (triggers). Ver docs/gmud/13 e 14.
--
-- POR QUE SO' ESTAS TRES CLASSES: tabelas, colunas e indices o gerador emite, e
-- os NOMES de constraint/indice divergem de proposito entre os dois mundos
-- (`_pkey` do Prisma vs `_PK` que o script 1 renomeia) -- compara-los daria
-- vermelho por diferenca benigna. Sequence, function e trigger tem nome e
-- definicao IGUAIS nos dois lados, entao a comparacao e' limpa.
--
-- Definicao comparada por hash (md5 de pg_get_functiondef/pg_get_triggerdef);
-- o nome vai junto para o diff dizer QUAL objeto divergiu. START da sequence
-- fica de fora de proposito: dev comeca em 143 (nao colidir com o seed) e prod
-- em 1 -- diferenca legitima, nao e' o que o portao vigia.

\pset tuples_only on
\pset format unaligned

SELECT line
  FROM (
    SELECT 'SEQ' || E'\t' || sequencename AS line
      FROM pg_sequences
     WHERE schemaname = 'public'
    UNION ALL
    SELECT 'FN' || E'\t' || p.proname || E'\t' || md5(pg_get_functiondef(p.oid))
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
    UNION ALL
    SELECT 'TRG' || E'\t' || c.relname || '.' || t.tgname || E'\t' || md5(pg_get_triggerdef(t.oid))
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal
  ) s
 ORDER BY line;

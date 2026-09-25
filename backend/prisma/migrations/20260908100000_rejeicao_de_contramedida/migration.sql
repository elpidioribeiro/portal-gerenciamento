-- REJEICAO: devolver a contramedida a quem a passou, com observacao.
--
-- Valor novo, e nao reaproveitamento de REVISAO. REVISAO fazia um movimento
-- parecido -- devolvia a acao ao nivel de baixo -- e saiu de uso em 25/08/2026,
-- mas as linhas que existem com ela sao revisoes de verdade, feitas quando o
-- movimento tinha esse nome. Reusar o valor faria toda leitura do historico ter
-- de escolher entre dois significados sem nada na linha para distinguir.
--
-- ADD VALUE roda dentro de transacao a partir do Postgres 12 (aqui: 16), e a
-- migracao nao usa o valor novo em nenhum INSERT -- usar na mesma transacao que
-- o cria e' que seria recusado.
--
-- Aditivo e reversivel na pratica: nenhuma linha existente muda, e nenhum
-- codigo antigo le o valor novo. O RECUPERA da GMUD nao remove o valor (o
-- Postgres nao tem DROP VALUE); se precisar voltar atras, o caminho e' parar de
-- gravar REJEICAO -- as linhas ja gravadas continuam legiveis.

ALTER TYPE public.tipo_movimentacao_type ADD VALUE 'REJEICAO';

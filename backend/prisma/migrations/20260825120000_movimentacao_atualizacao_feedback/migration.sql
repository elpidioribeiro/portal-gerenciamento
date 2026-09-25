-- Atualizacao e feedback entram no vocabulario de movimentacao; revisao sai.
--
-- PLANO §7.1 (renomeada), §7.3 (concluir x feedback) e §7.5 (revisar saiu).
--
--  ATUALIZACAO  prestacao de contas sem soltar a acao. Era chamada devolutiva.
--  FEEDBACK     de quem abriu, depois de concluida: o indicador respondeu?
--  REVISAO      devolvia a acao ao nivel de baixo. Acao escalada nao volta mais.
--
-- REVISAO nao e removido do tipo. Remover valor de enum no Postgres exige
-- recriar o tipo e reescrever a coluna, e o ganho seria cosmetico: o valor
-- deixa de ser escrito pela aplicacao, e as linhas historicas que o usam
-- continuam validas -- eram revisoes de verdade quando aconteceram. Apagar o
-- valor exigiria reescrever esse historico para algo que nao aconteceu.

ALTER TYPE tipo_movimentacao_type ADD VALUE IF NOT EXISTS 'ATUALIZACAO';
ALTER TYPE tipo_movimentacao_type ADD VALUE IF NOT EXISTS 'FEEDBACK';

COMMENT ON TYPE tipo_movimentacao_type IS
  'Movimentos de uma contramedida. REVISAO esta reservado: saiu de uso em 25/08/2026, mas permanece pelas linhas historicas.';

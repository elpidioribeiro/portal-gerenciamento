-- A marcação volta a ser POR ÁREA DE VENDA, e o Pareto passa a ser um só.
--
-- Terceira forma em dois dias, e a que descreve a reunião de verdade (analista,
-- 29/08/2026):
--
--   o gerente abre a área  →  fala com o SUPERVISOR dela  →  ele aponta a causa
--                          →  o gerente marca ALI
--   o Pareto é UM, a soma de todas as áreas da gerência
--
-- A marcação segue a conversa, que é por área porque o supervisor é por área. A
-- LEITURA é da gerência, porque a reunião prioriza uma coisa só. Ver §7.27.
--
-- Isto desfaz o alvo de `20260829120000_marcacao_por_gerencia`, de algumas horas
-- antes. O escopo `AREA_VENDA` nunca saiu do enum — foi por isso que ele ficou.

-- ─────────────────────────────────────────────────────────────────────────────
-- As marcações de gerência são APAGADAS, não devolvidas a uma área
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Subir de área para gerência somou; descer não tem inverso. Uma linha de
-- gerência não sabe de qual área veio, e escolher uma — a primeira, a maior —
-- poria um número numa área que ninguém apontou. Numa reunião isso é pior do
-- que a célula vazia: o supervisor seria cobrado por uma causa que não é dele.
--
-- Concretamente são DUAS linhas, ambas marcadas durante o teste desta sessão
-- (29/08/2026): "Colaboradores em desenvolvimento" na Construção da LES e
-- "Escala de Folgas" na Construção da NOR. Nenhuma reunião de verdade
-- aconteceu ainda.
--
-- Se houvesse marcação real aqui, esta migração NÃO seria a forma certa: o
-- caminho seria exportar antes, e devolver cada linha à área com quem marcou.
DELETE FROM "ocorrencia_ponto_causa" WHERE "escopo" = 'GERENCIA';

COMMENT ON COLUMN "ocorrencia_ponto_causa"."escopo" IS
  'Contra o que a ocorrencia foi marcada. O N4 marca contra AREA_VENDA -- a '
  'conversa e'' com o supervisor da area --, e o Pareto SOMA as areas da '
  'gerencia: marca-se onde se conversa, le''-se onde se prioriza. GERENCIA '
  'continua valido e atende a gerencia operacional, que nao tem area de venda.';

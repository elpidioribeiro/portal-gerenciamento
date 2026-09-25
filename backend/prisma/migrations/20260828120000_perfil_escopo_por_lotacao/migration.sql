-- O escopo de quem entra passa a ser (id_perfil, LOTACAO) -> (nivel, gerencia).
--
-- PLANO 7.17. Decisao do analista em 28/08/2026.
--
-- O QUE MUDA, e sao duas coisas:
--
-- 1. `perfil_nivel` ganha `nomloc` na chave e `gerencia` como destino. O cargo
--    GERENTE ADJUNTO tem quatro perfis, um por lotacao, e sao eles que
--    distinguem Vendas Construcao de Vendas Nao Construcao -- amarrar so' no
--    perfil daria a mesma resposta para os dois.
--
-- 2. `perfil_variavel` DEIXA DE EXISTIR. De quais variaveis a pessoa responde
--    passa a ser DERIVADO: ela responde pela gerencia, e a gerencia responde
--    pelas variaveis (`gerencia_variavel`) -- a MESMA tabela que decide o que o
--    quadro desenha.
--
--    Eram dois cadastros para a mesma pergunta, e eles divergiam: dava para ver
--    a variavel no quadro do N4 e nao poder marca-la, sem erro nenhum.
--
-- A EMPRESA NAO ENTRA na chave nova. A associacao vale para as nove lojas, e
-- quem escolhe a linha e' a filial da PESSOA. Uma linha por filial seria o mesmo
-- cadastro repetido nove vezes, e nove lugares para esquecer de atualizar um.
--
-- O DADO DE `perfil_variavel` NAO E' MIGRADO, e nao ha' como: ele associa
-- perfil a VARIAVEL, e o destino agora e' GERENCIA. Nao existe funcao de um para
-- o outro -- duas variaveis do mesmo perfil podem pertencer a gerencias
-- diferentes. A associacao e' refeita na tela de administracao, e sao poucas
-- linhas: uma por (perfil, lotacao), nao por (perfil, lotacao, empresa,
-- variavel).

ALTER TABLE perfil_nivel ADD COLUMN nomloc VARCHAR NOT NULL DEFAULT '';
ALTER TABLE perfil_nivel ADD COLUMN gerencia VARCHAR;

COMMENT ON COLUMN perfil_nivel.nomloc IS
  'Lotacao (hr_vw_colaboradores.nomloc), sem acento. Vazio = qualquer lotacao.';
COMMENT ON COLUMN perfil_nivel.gerencia IS
  'Nome da gerencia pela qual a pessoa responde. Nulo para N3 (filial inteira) e N2 (corporativo).';

-- A PK passa a incluir a lotacao. Era chave primaria de coluna unica, entao
-- DROP CONSTRAINT e' o caminho -- diferente de uk01, que era indice.
ALTER TABLE perfil_nivel DROP CONSTRAINT perfil_nivel_pk;
ALTER TABLE perfil_nivel ADD CONSTRAINT perfil_nivel_pk PRIMARY KEY (id_perfil, nomloc);

CREATE INDEX perfil_nivel_idx02 ON perfil_nivel (id_perfil);

DROP TABLE perfil_variavel;

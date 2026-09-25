-- O usuario guarda a LOTACAO (nomloc).
--
-- PLANO 7.11.
--
-- `perfil_variavel` -- a associacao que diz de quais variaveis de controle a
-- pessoa responde -- tem chave (id_perfil, nomloc, cod_empresa). O usuario ja'
-- guardava id_perfil, e cod_empresa sai da filial. Faltava o nomloc.
--
-- Ele JA' E' LIDO no login: SQL_USUARIO traz `TRIM(nomloc) AS LOCAL` e o
-- provider o descartava. Sem grava-lo, a unica saida seria consultar por
-- (id_perfil, cod_empresa) ignorando a lotacao -- e ai' um VENDEDOR, cargo que
-- tem 21 lotacoes, receberia as variaveis de todas elas. A pessoa marcaria
-- ponto de causa de departamento que nao e' o dela, sem erro nenhum aparecer.
--
-- Nulo e' esperado e nao e' defeito: usuario do MockAuthProvider nao vem do
-- cadastro corporativo, e sessao antiga so' ganha o valor no proximo login.
-- Quem consulta trata nulo como "nenhuma variavel associada", que e' a mesma
-- regra de ausencia de associacao -- ver fnc podeMarcarPontoCausa.

ALTER TABLE usuario ADD COLUMN nomloc text;

COMMENT ON COLUMN usuario.nomloc IS
'Lotacao no cadastro corporativo (hr_vw_colaboradores.nomloc), gravada no login. Compoe com id_perfil e o codigo da filial a chave de perfil_variavel. Nulo em usuario que nao vem do sistema corporativo.';

-- Desdobramento de Perdas por tipo de quebra: FILIAL, DATA, TIPO, VALOR.
--
-- VIEW e nao tabela, de proposito. `fato_perdas` ja guarda exatamente esses
-- quatro campos: a chave unica dela e (filial_id, data, tipo_quebra, status), e
-- `status` e sempre APROVADA porque a classificacao QI/QNI so existe depois da
-- aprovacao. Uma tabela alimentada a partir dela seria dois lugares com os
-- mesmos numeros, e toda recarga de Perdas exigiria repopular a copia — esquecer
-- disso deixaria o desdobramento mostrando numero velho embaixo de um indicador
-- atualizado, sem nada avisando.
--
-- Este projeto ja pagou tres vezes por fonte duplicada: a aritmetica de
-- percentual entre seed e producao, a meta do periodo entre painel e grafico, e
-- o mapeamento congelado no JSON do n8n. A view custa zero e nao pode divergir.
--
-- O filtro de status nao muda nada hoje, e fica porque e' a definicao do
-- indicador: so quebra APROVADA entra em Perdas % Mov. Se um dia o fluxo passar
-- a enviar PENDENTE, a view continua correta sem precisar de ajuste.
--
-- QI e QNI sao QUEBRA IDENTIFICADA e QUEBRA NAO IDENTIFICADA.
--
-- `valor` mantem o sinal da origem, e NENHUM sinal esta associado a um tipo:
-- QI e QNI podem vir positivos ou negativos, e nada e' pre-determinado. Ver a
-- secao de Perdas no PLANO.md.
CREATE VIEW vw_tipo_perda AS
SELECT
    filial_id,
    data,
    tipo_quebra AS tipo,
    valor
FROM fato_perdas
WHERE status = 'APROVADA';

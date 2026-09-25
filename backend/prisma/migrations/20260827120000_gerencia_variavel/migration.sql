-- Quais variaveis de controle cada gerencia acompanha.
--
-- PLANO 7.11.
--
-- E' o que decide O QUE A TELA DO N3 MOSTRA: categoria sem variavel atribuida
-- nao e' desenhada. Sem esta tabela, nada diz que Deposito nao acompanha Vendas
-- -- e o deposito aparecia sob a secao Vendas com um "-" em "Vendas na meta",
-- que se le como dado faltando quando a verdade e' que a pergunta nao se aplica.
--
-- O GRAO E' A VARIAVEL, nao a categoria. A categoria (Vendas, Operacional,
-- Perdas e Despesas, Pessoas) e' DERIVADA: sai do indicador da variavel. Guardar
-- a categoria aqui criaria uma segunda verdade sobre a mesma coisa, e as duas
-- discordariam no dia em que uma variavel mudasse de indicador.
--
-- Espelha `perfil_variavel`, que faz o mesmo para PESSOAS. Mesma forma, mesma
-- regra: chave composta, sem identidade propria, e ausencia de linha significa
-- NENHUMA variavel -- nega por padrao.

CREATE TABLE gerencia_variavel (
  gerencia_id          uuid      NOT NULL,
  variavel_controle_id uuid      NOT NULL,
  criado_em            timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT gerencia_variavel_pk PRIMARY KEY (gerencia_id, variavel_controle_id),
  CONSTRAINT gerencia_variavel_dimensao_gerencia_fk FOREIGN KEY (gerencia_id)
    REFERENCES dimensao_gerencia (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT gerencia_variavel_variavel_controle_fk FOREIGN KEY (variavel_controle_id)
    REFERENCES variavel_controle (id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX gerencia_variavel_idx01 ON gerencia_variavel (gerencia_id);
CREATE INDEX gerencia_variavel_idx02 ON gerencia_variavel (variavel_controle_id);

COMMENT ON TABLE gerencia_variavel IS
'Variaveis de controle que cada gerencia acompanha. Decide o que a tela do N3 mostra: categoria sem variavel atribuida nao aparece. Ausencia de linha significa nenhuma variavel.';
COMMENT ON COLUMN gerencia_variavel.variavel_controle_id IS
'A categoria da tela (Vendas, Operacional...) e derivada do indicador desta variavel, nao guardada aqui -- guarda-la seria uma segunda verdade sobre a mesma coisa.';

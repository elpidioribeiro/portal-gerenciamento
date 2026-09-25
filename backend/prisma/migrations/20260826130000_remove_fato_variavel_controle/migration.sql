-- Remove fato_variavel_controle: o valor da variavel de controle e' CALCULADO.
--
-- PLANO 7.8.
--
-- A tabela foi desenhada para receber numerador e denominador por variavel,
-- filial e dia, vindos de uma ingestao propria. Essa ingestao nunca existiu:
-- em todo o codigo, o unico lugar que a mencionava era o deleteMany() do seed.
-- Zero linhas gravadas, em qualquer ambiente, desde que a tabela foi criada.
--
-- A decisao (26/08/2026) e' que o numero da variavel sai de CALCULO sobre as
-- tabelas que ja' existem -- fato_venda_linha, meta e o que mais vier -- e nao
-- de uma fato propria. Manter a tabela vazia seria manter uma promessa de
-- arquitetura que o projeto decidiu nao cumprir: quem chegasse depois leria a
-- estrutura e concluiria que a variavel tem fato, quando ela tem consulta.
--
-- Recusa-se a rodar se houver dado. A tabela deveria estar vazia em todo
-- ambiente; se nao estiver, alguem comecou a usa-la e a decisao precisa ser
-- revista antes de apagar -- nao depois.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fato_variavel_controle LIMIT 1) THEN
    RAISE EXCEPTION
      'fato_variavel_controle tem dado. A migracao a apagaria. Reveja a decisao de PLANO 7.8 antes de prosseguir.';
  END IF;
END $$;

DROP TABLE fato_variavel_controle;

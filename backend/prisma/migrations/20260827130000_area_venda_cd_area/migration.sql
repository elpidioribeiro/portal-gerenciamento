-- A area de venda passa a ser identificada por CODIGO, nao por nome.
--
-- PLANO 7.14.
--
-- A cadeia de Performance Vendedor cruza vendedor -> area -> supervisor por
-- (cod_empresa, cd_area), que e' a chave do cadastro corporativo. O portal
-- identificava a area por (filial, nome), e nome e' rotulo: no dia em que
-- alguem corrigisse a grafia no ERP_AREA_VENDA, a proxima carga criaria uma
-- area NOVA -- meta orfa de um lado, area sem meta do outro, e nenhum erro.
--
-- POR QUE AGORA: `vendas-linha` nunca rodou e a carga de vendedor nao existe,
-- entao nao ha' dado para reconciliar. Depois da primeira carga, esta mesma
-- migracao exigiria um de-para de nome para codigo, feito a mao, por filial.
--
-- `nome` deixa de ser unico DE PROPOSITO. Ele virou rotulo, reafirmado a cada
-- carga; duas areas com a mesma descricao na origem devem entrar as duas --
-- visivelmente iguais na tela, que e' problema do cadastro, em vez de a carga
-- inteira ser recusada por um cadastro que o portal nao controla.
--
-- Recusa-se a rodar se houver dado. `cd_area` e' NOT NULL e nao ha' valor
-- para inventar: a area existente veio de uma carga que nao mandava codigo, e
-- adivinha-lo pelo nome e' exatamente o acoplamento que esta migracao remove.
-- Se parar aqui, a saida e' recarregar `vendas-linha` depois de aplicar.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM dimensao_area_venda LIMIT 1) THEN
    RAISE EXCEPTION
      'dimensao_area_venda tem dado, e cd_area e NOT NULL sem valor para preencher. Apague as areas (e os fatos que dependem delas) e recarregue vendas-linha depois de aplicar. Ver PLANO 7.14.';
  END IF;
END $$;

ALTER TABLE dimensao_area_venda
  ADD COLUMN cd_area VARCHAR NOT NULL;

COMMENT ON COLUMN dimensao_area_venda.cd_area IS
  'Codigo da area no cadastro corporativo (ERP_AREA_VENDA.CD_AREA). E a identidade da area; nome e rotulo.';

COMMENT ON COLUMN dimensao_area_venda.nome IS
  'Rotulo de exibicao, reafirmado a cada carga a partir da origem. Nao e identidade.';

-- uk01 passa a cobrir o codigo. Era um indice unico, nao uma constraint --
-- dai DROP INDEX e nao DROP CONSTRAINT (ja custou uma migracao quebrada).
DROP INDEX dimensao_area_venda_uk01;

CREATE UNIQUE INDEX dimensao_area_venda_uk01
  ON dimensao_area_venda (filial_id, cd_area);

CREATE INDEX dimensao_area_venda_idx03
  ON dimensao_area_venda (filial_id, nome);

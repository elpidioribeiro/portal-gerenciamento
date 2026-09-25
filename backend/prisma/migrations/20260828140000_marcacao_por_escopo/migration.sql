-- A marcacao de ponto de causa passa a ter ESCOPO, como a meta.
--
-- PLANO 7.19.
--
-- POR QUE: a marcacao era amarrada a AREA DE VENDA por chave estrangeira, e
-- area de venda so' existe em gerencia de VENDA. O GD vai ganhar gerencia
-- OPERACIONAL -- o deposito, com recebimento, armazenagem e expedicao --, e ela
-- nao tem area de venda. Marcar ponto de causa nela exigiria uma coluna nova, e
-- coluna nova em tabela com dado e' migracao com backfill.
--
-- Com escopo, uma gerencia nova precisa de um VALOR NOVO no enum. E enquanto a
-- unidade abaixo dela nao estiver definida, marca-se contra a GERENCIA inteira
-- -- sem inventar uma estrutura que talvez nao seja a certa.
--
-- E' o mesmo padrao de `meta.escopo` + `meta.alvo_id`, ja' em uso desde 24/08,
-- com a mesma consequencia: nao ha' chave estrangeira, porque a coluna aponta
-- para tabelas diferentes. Quem valida e' a trigger.
--
-- O PRECO, e e' o mesmo de la': a regra fica invisivel no schema.prisma, que
-- nao modela trigger. Esta registrada em comentario no modelo e aqui.
--
-- O dado existente e' TODO de area de venda -- e' o unico escopo que existia --,
-- entao o backfill e' direto e nao ha' o que decidir.

CREATE TYPE escopo_marcacao_type AS ENUM ('AREA_VENDA', 'GERENCIA');

ALTER TABLE ocorrencia_ponto_causa
  ADD COLUMN escopo escopo_marcacao_type NOT NULL DEFAULT 'AREA_VENDA';

ALTER TABLE ocorrencia_ponto_causa RENAME COLUMN area_venda_id TO alvo_id;

COMMENT ON COLUMN ocorrencia_ponto_causa.escopo IS
  'Contra o que a ocorrencia foi marcada. AREA_VENDA em gerencia de venda; GERENCIA quando nao ha unidade abaixo definida.';
COMMENT ON COLUMN ocorrencia_ponto_causa.alvo_id IS
  'Id do alvo, na tabela que escopo indica. Sem chave estrangeira: aponta para mais de uma tabela. Validado por fnc_valida_alvo_ocorrencia.';

-- A chave estrangeira sai: ela so' aceita area de venda, que e' exatamente a
-- limitacao que esta migracao remove.
ALTER TABLE ocorrencia_ponto_causa
  DROP CONSTRAINT ocorrencia_ponto_causa_dimensao_area_venda_fk;

-- A chave unica ganha o escopo. Dois alvos de tabelas diferentes nunca teriam o
-- mesmo uuid, mas a chave tem de DIZER o que identifica -- quem le a definicao
-- da tabela precisa entender a regra sem descobrir que uuid e' global.
DROP INDEX ocorrencia_ponto_causa_uk01;
CREATE UNIQUE INDEX ocorrencia_ponto_causa_uk01
  ON ocorrencia_ponto_causa (ponto_causa_id, escopo, alvo_id, ano, mes, semana);

-- ── A validacao que substitui a chave estrangeira ────────────────────────────
CREATE OR REPLACE FUNCTION public.fnc_valida_alvo_ocorrencia() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.escopo = 'AREA_VENDA' THEN
    IF NOT EXISTS (SELECT 1 FROM public.dimensao_area_venda WHERE id = NEW.alvo_id) THEN
      RAISE EXCEPTION 'ocorrencia_ponto_causa.alvo_id % nao existe em dimensao_area_venda (escopo AREA_VENDA)', NEW.alvo_id;
    END IF;
  ELSIF NEW.escopo = 'GERENCIA' THEN
    IF NOT EXISTS (SELECT 1 FROM public.dimensao_gerencia WHERE id = NEW.alvo_id) THEN
      RAISE EXCEPTION 'ocorrencia_ponto_causa.alvo_id % nao existe em dimensao_gerencia (escopo GERENCIA)', NEW.alvo_id;
    END IF;
  ELSE
    -- CASE explicito, e nao ELSE generico: com um escopo novo o ELSE passaria a
    -- significar "qualquer coisa que nao seja os dois primeiros", e ele entraria
    -- sem validacao. Mesma decisao da trigger de meta.
    RAISE EXCEPTION 'escopo % de ocorrencia_ponto_causa nao tem validacao. Acrescente-a em fnc_valida_alvo_ocorrencia.', NEW.escopo;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

comment on function public.fnc_valida_alvo_ocorrencia() is
'Valida que ocorrencia_ponto_causa.alvo_id existe na tabela indicada pelo escopo. Substitui a chave estrangeira, impossivel porque a coluna aponta para mais de uma tabela.';

CREATE TRIGGER ocorrencia_ponto_causa_valida_alvo_trg
  BEFORE INSERT OR UPDATE ON public.ocorrencia_ponto_causa
  FOR EACH ROW EXECUTE FUNCTION public.fnc_valida_alvo_ocorrencia();

-- ── O outro lado: alvo que some deixando marcacao orfa ───────────────────────
CREATE OR REPLACE FUNCTION public.fnc_impede_alvo_com_ocorrencia() RETURNS TRIGGER AS $$
DECLARE
  quantas INTEGER;
  escopo_do_alvo escopo_marcacao_type;
BEGIN
  escopo_do_alvo := CASE TG_TABLE_NAME
    WHEN 'dimensao_area_venda' THEN 'AREA_VENDA'::escopo_marcacao_type
    WHEN 'dimensao_gerencia'   THEN 'GERENCIA'::escopo_marcacao_type
  END;

  SELECT COUNT(*) INTO quantas
    FROM public.ocorrencia_ponto_causa
   WHERE escopo = escopo_do_alvo AND alvo_id = OLD.id;

  IF quantas > 0 THEN
    RAISE EXCEPTION
      '% % tem % ocorrencia(s) de ponto de causa. Apaga-las deixaria o Pareto sem historico.',
      TG_TABLE_NAME, OLD.id, quantas;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

comment on function public.fnc_impede_alvo_com_ocorrencia() is
'Impede apagar area de venda ou gerencia que tenha marcacao. Sem a chave estrangeira, nada mais segura o outro lado.';

CREATE TRIGGER dimensao_area_venda_impede_ocorrencia_trg
  BEFORE DELETE ON public.dimensao_area_venda
  FOR EACH ROW EXECUTE FUNCTION public.fnc_impede_alvo_com_ocorrencia();

CREATE TRIGGER dimensao_gerencia_impede_ocorrencia_trg
  BEFORE DELETE ON public.dimensao_gerencia
  FOR EACH ROW EXECUTE FUNCTION public.fnc_impede_alvo_com_ocorrencia();

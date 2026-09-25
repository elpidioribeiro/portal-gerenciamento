-- Meta por area de venda.
--
-- PLANO 7.10.
--
-- Performance Vendas compara a TENDENCIA da area com a META DO MES da area --
-- do mesmo jeito que o indicador de Vendas faz para a filial. A meta existia
-- so' para indicador e variavel; a area de venda nao tinha onde entrar.
--
-- `meta.alvo_id` aponta para tres tabelas agora, e por isso continua sem chave
-- estrangeira: quem valida e' a trigger, que passa a conhecer o escopo novo.
-- Ver o comentario do modelo Meta em schema.prisma.

ALTER TYPE escopo_meta_type ADD VALUE IF NOT EXISTS 'AREA_VENDA';

-- A trigger de gravacao passa a validar o alvo nas tres tabelas.
--
-- CASE explicito em vez de IF/ELSE: com tres escopos, o ELSE deixaria de ser
-- "e' o outro" e viraria "e' qualquer coisa que nao seja o primeiro" -- um
-- escopo novo passaria batido pela validacao da variavel de controle, e a meta
-- entraria apontando para nada.
CREATE OR REPLACE FUNCTION public.fnc_valida_alvo_meta() RETURNS TRIGGER AS $$
DECLARE
  _existe boolean;
BEGIN
  CASE NEW.escopo
    WHEN 'INDICADOR' THEN
      SELECT EXISTS (SELECT 1 FROM public.indicador WHERE id = NEW.alvo_id) INTO _existe;
      IF NOT _existe THEN
        RAISE EXCEPTION 'meta.alvo_id % nao existe em indicador (escopo INDICADOR)', NEW.alvo_id;
      END IF;
    WHEN 'VARIAVEL' THEN
      SELECT EXISTS (SELECT 1 FROM public.variavel_controle WHERE id = NEW.alvo_id) INTO _existe;
      IF NOT _existe THEN
        RAISE EXCEPTION 'meta.alvo_id % nao existe em variavel_controle (escopo VARIAVEL)', NEW.alvo_id;
      END IF;
    WHEN 'AREA_VENDA' THEN
      SELECT EXISTS (SELECT 1 FROM public.dimensao_area_venda WHERE id = NEW.alvo_id) INTO _existe;
      IF NOT _existe THEN
        RAISE EXCEPTION 'meta.alvo_id % nao existe em dimensao_area_venda (escopo AREA_VENDA)', NEW.alvo_id;
      END IF;
    ELSE
      RAISE EXCEPTION 'meta.escopo % nao tem validacao de alvo. Acrescente-a a fnc_valida_alvo_meta.', NEW.escopo;
  END CASE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.fnc_valida_alvo_meta() IS
'Valida que meta.alvo_id existe na tabela indicada por meta.escopo (indicador, variavel_controle ou dimensao_area_venda). Substitui a chave estrangeira, que nao e possivel porque a coluna aponta para tres tabelas.';

-- O outro lado: area de venda com meta nao pode sumir deixando meta orfa.
--
-- Mesma regra de indicador e variavel. A area de venda vem da CARGA e e criada
-- sob demanda, entao apagar e' menos provavel aqui -- mas o estrago seria o
-- mesmo, e a assimetria e' o tipo de coisa que ninguem percebe ate' acontecer.
CREATE OR REPLACE FUNCTION public.fnc_impede_area_venda_com_meta() RETURNS TRIGGER AS $$
DECLARE
  _metas integer;
BEGIN
  SELECT count(*) INTO _metas
    FROM public.meta
   WHERE escopo = 'AREA_VENDA' AND alvo_id = OLD.id;

  IF _metas > 0 THEN
    RAISE EXCEPTION
      'A area de venda % tem % meta(s) e nao pode ser removida. Metas orfas destroem historico em silencio.',
      OLD.nome, _metas;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.fnc_impede_area_venda_com_meta() IS
'Recusa remover area de venda que tenha meta. Espelha fnc_impede_alvo_com_meta, que faz o mesmo para indicador e variavel de controle.';

CREATE TRIGGER area_venda_impede_com_meta_trg
  BEFORE DELETE ON public.dimensao_area_venda
  FOR EACH ROW EXECUTE FUNCTION public.fnc_impede_area_venda_com_meta();

-- Integridade de `meta.alvo_id`, que nao pode ser chave estrangeira.
--
-- `meta` aponta ora para `indicador`, ora para `variavel_controle`, conforme
-- `escopo`. Uma FK aponta para UMA tabela, entao a coluna ficava solta: o banco
-- aceitava meta com alvo inexistente e deixava apagar um alvo que tinha metas.
-- Nos dois casos sem erro nenhum.
--
-- Por que trigger e nao duas colunas nulas com FK de verdade: com duas colunas,
-- a chave unica (indicador, variavel, filial, ano, mes) nao funciona - o
-- Postgres trata NULL como valor distinto, e duas metas iguais passariam. A
-- saida seria indice parcial ou NULLS NOT DISTINCT, e o Prisma 6 nao declara
-- nenhum dos dois: viraria divergencia permanente entre schema e banco.
--
-- Separar em duas tabelas resolveria, ao custo de 40 usos em 8 arquivos. A
-- trigger entrega a mesma garantia pratica sem tocar em codigo.
--
-- O preco: a regra fica invisivel no schema.prisma, que nao modela trigger.
-- Esta registrada em comentario no modelo Meta e no PLANO secao 5.4.1.

CREATE OR REPLACE FUNCTION public.fnc_valida_alvo_meta() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.escopo = 'INDICADOR' THEN
    IF NOT EXISTS (SELECT 1 FROM public.indicador WHERE id = NEW.alvo_id) THEN
      RAISE EXCEPTION 'meta.alvo_id % nao existe em indicador (escopo INDICADOR)', NEW.alvo_id;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.variavel_controle WHERE id = NEW.alvo_id) THEN
      RAISE EXCEPTION 'meta.alvo_id % nao existe em variavel_controle (escopo VARIAVEL)', NEW.alvo_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

comment on function public.fnc_valida_alvo_meta() is
'Valida que meta.alvo_id existe na tabela indicada por meta.escopo. Substitui a chave estrangeira, que nao e possivel porque a coluna aponta para duas tabelas.';

CREATE TRIGGER meta_valida_alvo_trg
  BEFORE INSERT OR UPDATE ON public.meta
  FOR EACH ROW EXECUTE FUNCTION public.fnc_valida_alvo_meta();

-- ── O outro lado: impedir que o alvo suma deixando metas orfas ───────────────
--
-- A trigger acima cuida da gravacao da meta. Esta cuida da remocao do alvo, que
-- e' o caso mais provavel: alguem aposenta um indicador e as metas dele ficam
-- apontando para nada.
--
-- RESTRICT e nao CASCADE, de proposito: apagar metas junto seria destruir
-- historico em silencio. O caminho certo para aposentar um indicador e' a
-- coluna `ativo`, criada em 24/08/2026.

CREATE OR REPLACE FUNCTION public.fnc_impede_alvo_com_meta() RETURNS TRIGGER AS $$
DECLARE
  v_escopo TEXT;
  v_qtd    INTEGER;
BEGIN
  v_escopo := CASE TG_TABLE_NAME WHEN 'indicador' THEN 'INDICADOR' ELSE 'VARIAVEL' END;
  SELECT count(*) INTO v_qtd FROM public.meta
   WHERE alvo_id = OLD.id AND escopo = v_escopo::public.escopo_meta_type;
  IF v_qtd > 0 THEN
    RAISE EXCEPTION
      '% % tem % meta(s) e nao pode ser apagado. Use a coluna ativo para tirar de vista.',
      TG_TABLE_NAME, OLD.id, v_qtd;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

comment on function public.fnc_impede_alvo_com_meta() is
'Impede apagar indicador ou variavel de controle que ainda tem metas. Aposentar deve ser feito pela coluna ativo, que preserva o historico.';

CREATE TRIGGER indicador_impede_remocao_trg
  BEFORE DELETE ON public.indicador
  FOR EACH ROW EXECUTE FUNCTION public.fnc_impede_alvo_com_meta();

CREATE TRIGGER variavel_controle_impede_remocao_trg
  BEFORE DELETE ON public.variavel_controle
  FOR EACH ROW EXECUTE FUNCTION public.fnc_impede_alvo_com_meta();

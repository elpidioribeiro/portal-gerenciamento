-- Hierarquia de indicadores, vinculo explicito nos fatos, e desativacao.
--
-- Tres mudancas que andam juntas:
--
-- 1. `indicador.indicador_pai_id` - o drill-down. Nulo = primeiro nivel.
-- 2. `indicador_id` nas tabelas de fato de indicador. Ate aqui o vinculo estava
--    no NOME da tabela (`fato_venda` significava vendas porque se chamava
--    assim); com filhos isso deixa de funcionar.
-- 3. `ativo` em indicador e variavel_controle - tirar de vista sem apagar.
--
-- `fato_movimentacao` NAO recebe indicador_id: movimentacao nao e' indicador,
-- e' o denominador de Perdas % Mov. `fato_variavel_controle` tambem nao: ele ja
-- aponta para a variavel, que ja aponta para o indicador.
--
-- O preenchimento usa o codigo do indicador. Num banco novo as tabelas estao
-- vazias e o UPDATE nao afeta nada; se houver fato sem indicador
-- correspondente, o SET NOT NULL falha - alto, que e' o certo.

-- ── indicador ────────────────────────────────────────────────────────────────
ALTER TABLE public.indicador ADD COLUMN indicador_pai_id UUID;
ALTER TABLE public.indicador ADD COLUMN ativo BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.indicador ADD CONSTRAINT indicador_indicador_fk
  FOREIGN KEY (indicador_pai_id) REFERENCES public.indicador(id)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX indicador_idx01 ON public.indicador (indicador_pai_id);

comment on column public.indicador.indicador_pai_id is
'Indicador pai, quando este e um desdobramento (drill-down) de outro. Nulo significa indicador de primeiro nivel. Existe so para a arvore da tela: em todo o resto um filho e um indicador comum, com fato e meta proprios.';
comment on column public.indicador.ativo is
'Tira de vista sem apagar. Dominio: true-SIM false-NAO. Falso remove das telas e preserva metas, fatos e contramedidas que apontam para o indicador.';

-- ── variavel_controle ────────────────────────────────────────────────────────
ALTER TABLE public.variavel_controle ADD COLUMN ativo BOOLEAN NOT NULL DEFAULT true;

comment on column public.variavel_controle.ativo is
'Tira de vista sem apagar. Dominio: true-SIM false-NAO. Mesma regra de indicador.ativo.';

-- ── fato_venda ───────────────────────────────────────────────────────────────
ALTER TABLE public.fato_venda ADD COLUMN indicador_id UUID;
UPDATE public.fato_venda SET indicador_id = (SELECT id FROM public.indicador WHERE codigo = 'vendas');
ALTER TABLE public.fato_venda ALTER COLUMN indicador_id SET NOT NULL;
ALTER TABLE public.fato_venda ADD CONSTRAINT fato_venda_indicador_fk
  FOREIGN KEY (indicador_id) REFERENCES public.indicador(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX public.fato_venda_uk01;
CREATE UNIQUE INDEX fato_venda_uk01 ON public.fato_venda (filial_id, data, indicador_id);
CREATE INDEX fato_venda_idx04 ON public.fato_venda (indicador_id);
comment on column public.fato_venda.indicador_id is
'Indicador a que este fato pertence. A ingestao substitui janela: o DELETE do periodo TEM de filtrar por esta coluna, senao carregar um filho apaga o pai.';

-- ── fato_venda_linha ─────────────────────────────────────────────────────────
ALTER TABLE public.fato_venda_linha ADD COLUMN indicador_id UUID;
UPDATE public.fato_venda_linha SET indicador_id = (SELECT id FROM public.indicador WHERE codigo = 'vendas');
ALTER TABLE public.fato_venda_linha ALTER COLUMN indicador_id SET NOT NULL;
ALTER TABLE public.fato_venda_linha ADD CONSTRAINT fato_venda_linha_indicador_fk
  FOREIGN KEY (indicador_id) REFERENCES public.indicador(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX public.fato_venda_linha_uk01;
CREATE UNIQUE INDEX fato_venda_linha_uk01 ON public.fato_venda_linha (filial_id, data, linha_id, indicador_id);
CREATE INDEX fato_venda_linha_idx05 ON public.fato_venda_linha (indicador_id);
comment on column public.fato_venda_linha.indicador_id is
'Indicador a que este fato pertence. Ver a observacao sobre substituicao de janela em fato_venda.indicador_id.';

-- ── fato_nps ─────────────────────────────────────────────────────────────────
ALTER TABLE public.fato_nps ADD COLUMN indicador_id UUID;
UPDATE public.fato_nps SET indicador_id = (SELECT id FROM public.indicador WHERE codigo = 'nps');
ALTER TABLE public.fato_nps ALTER COLUMN indicador_id SET NOT NULL;
ALTER TABLE public.fato_nps ADD CONSTRAINT fato_nps_indicador_fk
  FOREIGN KEY (indicador_id) REFERENCES public.indicador(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX public.fato_nps_uk01;
CREATE UNIQUE INDEX fato_nps_uk01 ON public.fato_nps (filial_id, data, indicador_id);
CREATE INDEX fato_nps_idx04 ON public.fato_nps (indicador_id);
comment on column public.fato_nps.indicador_id is
'Indicador a que este fato pertence. Ver a observacao sobre substituicao de janela em fato_venda.indicador_id.';

-- ── fato_perda ───────────────────────────────────────────────────────────────
ALTER TABLE public.fato_perda ADD COLUMN indicador_id UUID;
UPDATE public.fato_perda SET indicador_id = (SELECT id FROM public.indicador WHERE codigo = 'perdas');
ALTER TABLE public.fato_perda ALTER COLUMN indicador_id SET NOT NULL;
ALTER TABLE public.fato_perda ADD CONSTRAINT fato_perda_indicador_fk
  FOREIGN KEY (indicador_id) REFERENCES public.indicador(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX public.fato_perda_uk01;
CREATE UNIQUE INDEX fato_perda_uk01 ON public.fato_perda (filial_id, data, tipo_quebra, status, indicador_id);
CREATE INDEX fato_perda_idx04 ON public.fato_perda (indicador_id);
comment on column public.fato_perda.indicador_id is
'Indicador a que este fato pertence. Ver a observacao sobre substituicao de janela em fato_venda.indicador_id.';

-- ── fato_custo ───────────────────────────────────────────────────────────────
ALTER TABLE public.fato_custo ADD COLUMN indicador_id UUID;
UPDATE public.fato_custo SET indicador_id = (SELECT id FROM public.indicador WHERE codigo = 'custo');
ALTER TABLE public.fato_custo ALTER COLUMN indicador_id SET NOT NULL;
ALTER TABLE public.fato_custo ADD CONSTRAINT fato_custo_indicador_fk
  FOREIGN KEY (indicador_id) REFERENCES public.indicador(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX public.fato_custo_uk01;
CREATE UNIQUE INDEX fato_custo_uk01 ON public.fato_custo (filial_id, ano, mes, indicador_id);
CREATE INDEX fato_custo_idx03 ON public.fato_custo (indicador_id);
comment on column public.fato_custo.indicador_id is
'Indicador a que este fato pertence. Ver a observacao sobre substituicao de janela em fato_venda.indicador_id.';

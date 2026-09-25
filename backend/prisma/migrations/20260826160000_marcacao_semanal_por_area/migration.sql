-- A marcacao de ponto de causa passa a ser SEMANAL, por AREA DE VENDA, com
-- QUANTIDADE.
--
-- PLANO 7.11.
--
-- Como era: uma linha por ocorrencia, com `registrado_em` (timestamp) e filial.
-- Como e': uma linha por (ponto de causa, area de venda, ano, semana), com a
-- quantidade na propria linha.
--
-- POR QUE MUDA:
--
--  1. A marcacao acontece por SEMANA na reuniao do N4 (S1..S5), nao por
--     instante. Com timestamp, duas marcacoes da mesma semana viravam duas
--     linhas com datas diferentes, e "editar a marcacao da S3" nao tinha como
--     acontecer -- so' inserir mais uma.
--  2. A tela e' um CONTADOR: um toque soma 1 na celula. Com uma linha por
--     ocorrencia, corrigir de 3 para 2 seria apagar linha, sem rastro de quem
--     corrigiu. Com quantidade, e' UPDATE -- e o autor e a data ficam.
--  3. A variavel de controle abre por AREA DE VENDA, entao a causa e' daquela
--     area, nao da filial inteira: "falta de produto" aconteceu em Pisos, nao
--     em toda a loja.
--
-- FILIAL SAI: `dimensao_area_venda` ja' tem filial. Manter as duas abria a
-- possibilidade de divergirem -- ocorrencia na filial CEN apontando area de
-- venda da NOR, sem nada impedir. Quem precisa de filial faz o join.
--
-- OS DADOS EXISTENTES SAO APAGADOS, e isso e' seguro: nenhuma rota jamais
-- escreveu nesta tabela (verificado em todo o `src/`), entao as 9.459 linhas
-- vieram do seed, que as regenera. Elas tambem NAO PODERIAM ser migradas: sao
-- por filial, e a area de venda -- obrigatoria agora -- nao existe nelas.
--
-- A recusa abaixo protege o caso de algum ambiente ter comecado a usar a tabela
-- de verdade. Marcacao de reuniao e' registro do que aconteceu; apagar em
-- silencio seria destruir historico que ninguem consegue reconstruir.
DO $$
DECLARE
  _reais integer;
BEGIN
  -- Ocorrencia gravada por gente, e nao pelo seed, tem observacao ou autor
  -- fora do conjunto do seed. Como nada nunca gravou aqui, o esperado e' zero.
  SELECT count(*) INTO _reais
    FROM public.ocorrencia_ponto_causa
   WHERE observacao IS NOT NULL;

  IF _reais > 0 THEN
    RAISE EXCEPTION
      'ocorrencia_ponto_causa tem % linha(s) com observacao -- sinal de marcacao feita por gente. A migracao as apagaria. Reveja PLANO 7.11 antes de prosseguir.',
      _reais;
  END IF;
END $$;

DROP TABLE public.ocorrencia_ponto_causa;

CREATE TABLE public.ocorrencia_ponto_causa (
  id                uuid      NOT NULL,
  ponto_causa_id    uuid      NOT NULL,
  area_venda_id     uuid      NOT NULL,
  ano               integer   NOT NULL,
  mes               integer   NOT NULL,
  -- Semana DO MES (1..5), nao semana ISO do ano.
  --
  -- E' o que a grade da reuniao mostra (S1..S5) e o que o ciclo do GD usa -- o
  -- ciclo e' o mes. A regra de quais dias caem em cada semana ja' existe em
  -- `lib/semanas.ts`: segunda a domingo, contando as semanas que COMECAM no
  -- mes. Semana ISO obrigaria a traduzir S1..S5 para 31..35 toda vez que a tela
  -- falasse com o banco, e e' nessa traducao que o off-by-one mora.
  semana            integer   NOT NULL,
  quantidade        integer   NOT NULL,
  registrado_por_id uuid      NOT NULL,
  -- timestamp(3): a precisao que o Prisma usa por padrao, igual a criado_em de
  -- contramedida e movimentacao. Sem o (3) o Postgres cria com 6 e o
  -- `migrate diff` acusa drift para sempre.
  registrado_em     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ocorrencia_ponto_causa_pk PRIMARY KEY (id),
  CONSTRAINT ocorrencia_ponto_causa_ponto_causa_fk FOREIGN KEY (ponto_causa_id)
    REFERENCES public.ponto_causa (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT ocorrencia_ponto_causa_dimensao_area_venda_fk FOREIGN KEY (area_venda_id)
    REFERENCES public.dimensao_area_venda (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT ocorrencia_ponto_causa_usuario_fk FOREIGN KEY (registrado_por_id)
    REFERENCES public.usuario (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT ocorrencia_ponto_causa_ck01 CHECK (mes BETWEEN 1 AND 12),
  -- 1 a 5. Sem isto, um erro de calculo gravaria semana 0 ou 9 e o Pareto
  -- simplesmente nao acharia a marcacao -- sem erro nenhum.
  CONSTRAINT ocorrencia_ponto_causa_ck02 CHECK (semana BETWEEN 1 AND 5),
  -- Quantidade zero nao e' marcacao, e' ausencia dela. Uma celula que volta a
  -- zero tem a LINHA removida; guardar zero encheria o Pareto de causas que
  -- ninguem apontou, todas com peso nenhum.
  CONSTRAINT ocorrencia_ponto_causa_ck03 CHECK (quantidade > 0)
);

-- A chave da celula da grade. E' ela que torna a marcacao EDITAVEL: sem
-- unicidade, o segundo toque criaria linha nova em vez de somar.
CREATE UNIQUE INDEX ocorrencia_ponto_causa_uk01
  ON public.ocorrencia_ponto_causa (ponto_causa_id, area_venda_id, ano, mes, semana);

CREATE INDEX ocorrencia_ponto_causa_idx01 ON public.ocorrencia_ponto_causa (ponto_causa_id);
CREATE INDEX ocorrencia_ponto_causa_idx02 ON public.ocorrencia_ponto_causa (area_venda_id);
CREATE INDEX ocorrencia_ponto_causa_idx03 ON public.ocorrencia_ponto_causa (registrado_por_id);
-- O Pareto do ciclo: filtra por area e periodo, agrupa por ponto de causa.
CREATE INDEX ocorrencia_ponto_causa_idx04 ON public.ocorrencia_ponto_causa (area_venda_id, ano, mes);

COMMENT ON TABLE public.ocorrencia_ponto_causa IS
'Marcacao de ponto de causa na reuniao do N4: uma linha por (ponto, area de venda, ano, semana), com a quantidade. Nunca expurgada -- e registro historico de ocorrencia de problema.';
COMMENT ON COLUMN public.ocorrencia_ponto_causa.semana IS 'Semana DO MES (1..5) a que a marcacao SE REFERE, pela regra de lib/semanas.ts. Independente de registrado_em.';
COMMENT ON COLUMN public.ocorrencia_ponto_causa.quantidade IS 'Quantas vezes a causa ocorreu na semana. Sempre maior que zero: celula zerada tem a linha removida.';
COMMENT ON COLUMN public.ocorrencia_ponto_causa.registrado_por_id IS 'Quem marcou por ultimo. Com contador editavel, e o autor da ultima alteracao.';
COMMENT ON COLUMN public.ocorrencia_ponto_causa.registrado_em IS 'Quando a marcacao foi feita. Comparado com ano+mes+semana, revela marcacao retroativa -- que e permitida e fica visivel no dado, em vez de proibida.';

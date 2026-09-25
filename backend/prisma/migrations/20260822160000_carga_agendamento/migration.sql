-- Horario da carga automatica, editavel pela tela.
--
-- Antes disto, `hora` e `minuto` viviam em `docs/n8n/fontes.mjs` e mudar o
-- horario era deploy. Decisao do analista: o horario vai para a tela.
--
-- **A JANELA nao vem para ca', de proposito.** `janelaDias` continua em codigo:
-- ela nao e' preferencia, e' regra de negocio. Perdas usa 730 dias porque uma
-- quebra PENDENTE vira APROVADA meses depois e altera um dia ja' fechado;
-- movimentacao usa 60 porque nota fiscal nao se reclassifica assim. Num campo de
-- tela, alguem baixaria Perdas para 60 sem saber disso, e o efeito seria o
-- passado parar de se corrigir — sem erro nenhum.

-- LINHA = OVERRIDE, ausencia = o valor do codigo.
--
-- Nao ha' seed. Se a tabela estiver vazia, o agendamento usa a hora de
-- `fontes.mjs`, que continua sendo o padrao. Semear copiaria o padrao para ca' e
-- criaria duas fontes de verdade: mudar o codigo depois nao teria efeito, porque
-- a copia no banco ganharia — e ninguem entenderia por que.
CREATE TABLE "carga_agendamento" (
    -- Nome da fonte em `fontes.mjs` ('perdas', 'movimentacao'). Sem FK: a lista
    -- de fontes e' codigo, nao tabela.
    "fonte" TEXT NOT NULL,
    -- Hora e minuto no fuso de TZ_APP, nao em UTC. O servidor pode rodar em UTC
    -- e a regra e' de Recife; guardar UTC faria o valor mudar de significado se
    -- o fuso da aplicacao mudasse.
    "hora" INTEGER NOT NULL,
    "minuto" INTEGER NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Quem mudou. A tela mostra, e sem isto um horario estranho nao tem a quem
    -- perguntar.
    "atualizado_por" UUID,

    CONSTRAINT "carga_agendamento_pkey" PRIMARY KEY ("fonte")
);

-- Faixa valida no BANCO, alem do schema da rota.
--
-- A rota valida, mas ela nao e' o unico caminho: UPDATE na mao existe. E hora 25
-- nao daria erro no agendamento — `msAteProximo` calcularia um instante no dia
-- seguinte e a carga rodaria na hora errada, calada.
ALTER TABLE "carga_agendamento"
    ADD CONSTRAINT "carga_agendamento_hora_valida" CHECK ("hora" BETWEEN 0 AND 23);
ALTER TABLE "carga_agendamento"
    ADD CONSTRAINT "carga_agendamento_minuto_valido" CHECK ("minuto" BETWEEN 0 AND 59);

ALTER TABLE "carga_agendamento"
    ADD CONSTRAINT "carga_agendamento_atualizado_por_fkey"
    FOREIGN KEY ("atualizado_por") REFERENCES "usuario"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

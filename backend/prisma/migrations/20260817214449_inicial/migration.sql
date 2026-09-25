-- CreateEnum
CREATE TYPE "Nivel" AS ENUM ('N1', 'N2', 'N3', 'N4', 'N5', 'CROSS');

-- CreateEnum
CREATE TYPE "TipoFilial" AS ENUM ('FILIAL', 'REDE', 'CORPORATIVO');

-- CreateEnum
CREATE TYPE "Sentido" AS ENUM ('MAIOR_MELHOR', 'MENOR_MELHOR');

-- CreateEnum
CREATE TYPE "EscopoMeta" AS ENUM ('INDICADOR', 'VARIAVEL');

-- CreateEnum
CREATE TYPE "TipoQuebra" AS ENUM ('QI', 'QNI');

-- CreateEnum
CREATE TYPE "StatusQuebra" AS ENUM ('PENDENTE', 'APROVADA');

-- CreateEnum
CREATE TYPE "Prioridade" AS ENUM ('ALTA', 'MEDIA', 'BAIXA');

-- CreateEnum
CREATE TYPE "TipoMovimentacao" AS ENUM ('ESCALACAO', 'REVISAO', 'DIRECIONAMENTO', 'CONCLUSAO');

-- CreateEnum
CREATE TYPE "ResultadoIndicador" AS ENUM ('META_ATINGIDA', 'MELHORA_PARCIAL', 'SEM_EFEITO');

-- CreateEnum
CREATE TYPE "StatusSync" AS ENUM ('EM_ANDAMENTO', 'SUCESSO', 'ERRO');

-- CreateTable
CREATE TABLE "filial" (
    "id" UUID NOT NULL,
    "sigla" VARCHAR(20) NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoFilial" NOT NULL DEFAULT 'FILIAL',
    "ordem" INTEGER NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "filial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bucket" (
    "id" UUID NOT NULL,
    "nivel" "Nivel" NOT NULL,
    "grupo" TEXT,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,

    CONSTRAINT "bucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL,
    "login_erp" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "iniciais" VARCHAR(3) NOT NULL,
    "cargo" TEXT NOT NULL,
    "nivel" "Nivel" NOT NULL,
    "filial_id" UUID,
    "bucket_id" UUID,
    "senha_hash" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dim_area_venda" (
    "id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "supervisor" TEXT,

    CONSTRAINT "dim_area_venda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dim_linha" (
    "id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "area_venda_id" UUID NOT NULL,

    CONSTRAINT "dim_linha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicador" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(30) NOT NULL,
    "nome" TEXT NOT NULL,
    "unidade" TEXT NOT NULL,
    "sentido" "Sentido" NOT NULL,
    "escala_y" JSONB NOT NULL,
    "regra_status" JSONB NOT NULL,
    "ordem" INTEGER NOT NULL,

    CONSTRAINT "indicador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variavel_controle" (
    "id" UUID NOT NULL,
    "indicador_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "unidade" TEXT NOT NULL,
    "sentido" "Sentido" NOT NULL,
    "ordem" INTEGER NOT NULL,

    CONSTRAINT "variavel_controle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ponto_causa" (
    "id" UUID NOT NULL,
    "variavel_controle_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "bucket_id" UUID,
    "ordem" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ponto_causa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta" (
    "id" UUID NOT NULL,
    "escopo" "EscopoMeta" NOT NULL,
    "alvo_id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "valor" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fato_vendas" (
    "id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "sync_id" UUID NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fato_vendas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fato_vendas_linha" (
    "id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "linha_id" UUID NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "sync_id" UUID NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fato_vendas_linha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fato_nps" (
    "id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "qtd_promotores" INTEGER NOT NULL,
    "qtd_neutros" INTEGER NOT NULL,
    "qtd_detratores" INTEGER NOT NULL,
    "sync_id" UUID NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fato_nps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fato_perdas" (
    "id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "tipo_quebra" "TipoQuebra" NOT NULL,
    "status" "StatusQuebra" NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "sync_id" UUID NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fato_perdas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fato_movimentacao" (
    "id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "sync_id" UUID NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fato_movimentacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fato_custo" (
    "id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "lancado_por_id" UUID NOT NULL,
    "lancado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fato_custo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fato_variavel_controle" (
    "id" UUID NOT NULL,
    "variavel_controle_id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "numerador" DECIMAL(18,4) NOT NULL,
    "denominador" DECIMAL(18,4),
    "sync_id" UUID NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fato_variavel_controle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocorrencia_ponto_causa" (
    "id" UUID NOT NULL,
    "ponto_causa_id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "registrado_por_id" UUID NOT NULL,
    "registrado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observacao" TEXT,

    CONSTRAINT "ocorrencia_ponto_causa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contramedida" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "titulo" TEXT NOT NULL,
    "pdc_ref" TEXT,
    "ponto_causa_id" UUID,
    "variavel_controle_id" UUID,
    "indicador_id" UUID,
    "filial_id" UUID NOT NULL,
    "nivel_atual" "Nivel" NOT NULL,
    "bucket_id" UUID NOT NULL,
    "responsavel_atual_id" UUID NOT NULL,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prazo" DATE NOT NULL,
    "prioridade" "Prioridade" NOT NULL,
    "concluida_em" TIMESTAMP(3),
    "comentario_abertura" TEXT NOT NULL,
    "origem" TEXT,

    CONSTRAINT "contramedida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacao" (
    "id" UUID NOT NULL,
    "contramedida_id" UUID NOT NULL,
    "tipo" "TipoMovimentacao" NOT NULL,
    "autor_id" UUID NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nivel_origem" "Nivel" NOT NULL,
    "nivel_destino" "Nivel" NOT NULL,
    "bucket_destino_id" UUID,
    "responsavel_destino_id" UUID NOT NULL,
    "motivo" TEXT,
    "texto" TEXT NOT NULL,
    "novo_prazo" DATE,
    "resultado_indicador" "ResultadoIndicador",

    CONSTRAINT "movimentacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comentario" (
    "id" UUID NOT NULL,
    "contramedida_id" UUID NOT NULL,
    "autor_id" UUID NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "texto" TEXT NOT NULL,

    CONSTRAINT "comentario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_execucao" (
    "id" UUID NOT NULL,
    "fonte" VARCHAR(30) NOT NULL,
    "iniciado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizado_em" TIMESTAMP(3),
    "status" "StatusSync" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "periodo_de" DATE NOT NULL,
    "periodo_ate" DATE NOT NULL,
    "linhas_recebidas" INTEGER NOT NULL DEFAULT 0,
    "linhas_gravadas" INTEGER NOT NULL DEFAULT 0,
    "linhas_removidas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "origem_ip" TEXT,

    CONSTRAINT "sync_execucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "familia_id" UUID NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "revogado_em" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "usuario_id" UUID,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidade_id" TEXT,
    "payload" JSONB,
    "ip" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "filial_sigla_key" ON "filial"("sigla");

-- CreateIndex
CREATE UNIQUE INDEX "bucket_nivel_nome_key" ON "bucket"("nivel", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_login_erp_key" ON "usuario"("login_erp");

-- CreateIndex
CREATE INDEX "usuario_nivel_idx" ON "usuario"("nivel");

-- CreateIndex
CREATE UNIQUE INDEX "dim_area_venda_filial_id_nome_key" ON "dim_area_venda"("filial_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "dim_linha_filial_id_nome_key" ON "dim_linha"("filial_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "indicador_codigo_key" ON "indicador"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "variavel_controle_indicador_id_nome_key" ON "variavel_controle"("indicador_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "ponto_causa_variavel_controle_id_nome_key" ON "ponto_causa"("variavel_controle_id", "nome");

-- CreateIndex
CREATE INDEX "meta_filial_id_ano_mes_idx" ON "meta"("filial_id", "ano", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "meta_escopo_alvo_id_filial_id_ano_mes_key" ON "meta"("escopo", "alvo_id", "filial_id", "ano", "mes");

-- CreateIndex
CREATE INDEX "fato_vendas_data_idx" ON "fato_vendas"("data");

-- CreateIndex
CREATE UNIQUE INDEX "fato_vendas_filial_id_data_key" ON "fato_vendas"("filial_id", "data");

-- CreateIndex
CREATE INDEX "fato_vendas_linha_data_idx" ON "fato_vendas_linha"("data");

-- CreateIndex
CREATE UNIQUE INDEX "fato_vendas_linha_filial_id_data_linha_id_key" ON "fato_vendas_linha"("filial_id", "data", "linha_id");

-- CreateIndex
CREATE INDEX "fato_nps_data_idx" ON "fato_nps"("data");

-- CreateIndex
CREATE UNIQUE INDEX "fato_nps_filial_id_data_key" ON "fato_nps"("filial_id", "data");

-- CreateIndex
CREATE INDEX "fato_perdas_data_idx" ON "fato_perdas"("data");

-- CreateIndex
CREATE UNIQUE INDEX "fato_perdas_filial_id_data_tipo_quebra_status_key" ON "fato_perdas"("filial_id", "data", "tipo_quebra", "status");

-- CreateIndex
CREATE INDEX "fato_movimentacao_data_idx" ON "fato_movimentacao"("data");

-- CreateIndex
CREATE UNIQUE INDEX "fato_movimentacao_filial_id_data_key" ON "fato_movimentacao"("filial_id", "data");

-- CreateIndex
CREATE UNIQUE INDEX "fato_custo_filial_id_ano_mes_key" ON "fato_custo"("filial_id", "ano", "mes");

-- CreateIndex
CREATE INDEX "fato_variavel_controle_data_idx" ON "fato_variavel_controle"("data");

-- CreateIndex
CREATE UNIQUE INDEX "fato_variavel_controle_variavel_controle_id_filial_id_data_key" ON "fato_variavel_controle"("variavel_controle_id", "filial_id", "data");

-- CreateIndex
CREATE INDEX "ocorrencia_ponto_causa_ponto_causa_id_filial_id_registrado__idx" ON "ocorrencia_ponto_causa"("ponto_causa_id", "filial_id", "registrado_em");

-- CreateIndex
CREATE UNIQUE INDEX "contramedida_codigo_key" ON "contramedida"("codigo");

-- CreateIndex
CREATE INDEX "contramedida_nivel_atual_filial_id_idx" ON "contramedida"("nivel_atual", "filial_id");

-- CreateIndex
CREATE INDEX "contramedida_responsavel_atual_id_idx" ON "contramedida"("responsavel_atual_id");

-- CreateIndex
CREATE INDEX "contramedida_criado_em_idx" ON "contramedida"("criado_em");

-- CreateIndex
CREATE INDEX "movimentacao_contramedida_id_criado_em_idx" ON "movimentacao"("contramedida_id", "criado_em");

-- CreateIndex
CREATE INDEX "comentario_contramedida_id_criado_em_idx" ON "comentario"("contramedida_id", "criado_em");

-- CreateIndex
CREATE INDEX "sync_execucao_fonte_status_iniciado_em_idx" ON "sync_execucao"("fonte", "status", "iniciado_em");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_usuario_id_idx" ON "refresh_token"("usuario_id");

-- CreateIndex
CREATE INDEX "refresh_token_familia_id_idx" ON "refresh_token"("familia_id");

-- CreateIndex
CREATE INDEX "audit_log_entidade_entidade_id_idx" ON "audit_log"("entidade", "entidade_id");

-- CreateIndex
CREATE INDEX "audit_log_criado_em_idx" ON "audit_log"("criado_em");

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "bucket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dim_area_venda" ADD CONSTRAINT "dim_area_venda_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dim_linha" ADD CONSTRAINT "dim_linha_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dim_linha" ADD CONSTRAINT "dim_linha_area_venda_id_fkey" FOREIGN KEY ("area_venda_id") REFERENCES "dim_area_venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variavel_controle" ADD CONSTRAINT "variavel_controle_indicador_id_fkey" FOREIGN KEY ("indicador_id") REFERENCES "indicador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_causa" ADD CONSTRAINT "ponto_causa_variavel_controle_id_fkey" FOREIGN KEY ("variavel_controle_id") REFERENCES "variavel_controle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ponto_causa" ADD CONSTRAINT "ponto_causa_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "bucket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta" ADD CONSTRAINT "meta_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_vendas" ADD CONSTRAINT "fato_vendas_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_vendas" ADD CONSTRAINT "fato_vendas_sync_id_fkey" FOREIGN KEY ("sync_id") REFERENCES "sync_execucao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_vendas_linha" ADD CONSTRAINT "fato_vendas_linha_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_vendas_linha" ADD CONSTRAINT "fato_vendas_linha_linha_id_fkey" FOREIGN KEY ("linha_id") REFERENCES "dim_linha"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_vendas_linha" ADD CONSTRAINT "fato_vendas_linha_sync_id_fkey" FOREIGN KEY ("sync_id") REFERENCES "sync_execucao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_nps" ADD CONSTRAINT "fato_nps_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_nps" ADD CONSTRAINT "fato_nps_sync_id_fkey" FOREIGN KEY ("sync_id") REFERENCES "sync_execucao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_perdas" ADD CONSTRAINT "fato_perdas_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_perdas" ADD CONSTRAINT "fato_perdas_sync_id_fkey" FOREIGN KEY ("sync_id") REFERENCES "sync_execucao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_movimentacao" ADD CONSTRAINT "fato_movimentacao_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_movimentacao" ADD CONSTRAINT "fato_movimentacao_sync_id_fkey" FOREIGN KEY ("sync_id") REFERENCES "sync_execucao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_custo" ADD CONSTRAINT "fato_custo_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_custo" ADD CONSTRAINT "fato_custo_lancado_por_id_fkey" FOREIGN KEY ("lancado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_variavel_controle" ADD CONSTRAINT "fato_variavel_controle_variavel_controle_id_fkey" FOREIGN KEY ("variavel_controle_id") REFERENCES "variavel_controle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_variavel_controle" ADD CONSTRAINT "fato_variavel_controle_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fato_variavel_controle" ADD CONSTRAINT "fato_variavel_controle_sync_id_fkey" FOREIGN KEY ("sync_id") REFERENCES "sync_execucao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocorrencia_ponto_causa" ADD CONSTRAINT "ocorrencia_ponto_causa_ponto_causa_id_fkey" FOREIGN KEY ("ponto_causa_id") REFERENCES "ponto_causa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocorrencia_ponto_causa" ADD CONSTRAINT "ocorrencia_ponto_causa_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocorrencia_ponto_causa" ADD CONSTRAINT "ocorrencia_ponto_causa_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contramedida" ADD CONSTRAINT "contramedida_filial_id_fkey" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contramedida" ADD CONSTRAINT "contramedida_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "bucket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contramedida" ADD CONSTRAINT "contramedida_ponto_causa_id_fkey" FOREIGN KEY ("ponto_causa_id") REFERENCES "ponto_causa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contramedida" ADD CONSTRAINT "contramedida_variavel_controle_id_fkey" FOREIGN KEY ("variavel_controle_id") REFERENCES "variavel_controle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contramedida" ADD CONSTRAINT "contramedida_indicador_id_fkey" FOREIGN KEY ("indicador_id") REFERENCES "indicador"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contramedida" ADD CONSTRAINT "contramedida_responsavel_atual_id_fkey" FOREIGN KEY ("responsavel_atual_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contramedida" ADD CONSTRAINT "contramedida_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_contramedida_id_fkey" FOREIGN KEY ("contramedida_id") REFERENCES "contramedida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_responsavel_destino_id_fkey" FOREIGN KEY ("responsavel_destino_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacao" ADD CONSTRAINT "movimentacao_bucket_destino_id_fkey" FOREIGN KEY ("bucket_destino_id") REFERENCES "bucket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comentario" ADD CONSTRAINT "comentario_contramedida_id_fkey" FOREIGN KEY ("contramedida_id") REFERENCES "contramedida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comentario" ADD CONSTRAINT "comentario_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Codigo sequencial da contramedida (AC-0142)
--
-- Gerado por SEQUENCE do Postgres, consumida dentro da transacao de criacao.
-- Um MAX(codigo)+1 na aplicacao quebra sob concorrencia: duas criacoes
-- simultaneas leriam o mesmo maximo e tentariam gravar o mesmo codigo.
-- A sequence e atomica por construcao.
--
-- Comeca em 143 para que a primeira contramedida criada pelo portal nao colida
-- com as do seed, que reproduzem os codigos do handoff (AC-0142 e anteriores).
-- ---------------------------------------------------------------------------
CREATE SEQUENCE contramedida_codigo_seq START WITH 143;

CREATE OR REPLACE FUNCTION proximo_codigo_contramedida() RETURNS text AS $$
  SELECT 'AC-' || lpad(nextval('contramedida_codigo_seq')::text, 4, '0');
$$ LANGUAGE sql VOLATILE;

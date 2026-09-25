-- Performance Vendedor: as tabelas da leva.
--
-- PLANO 7.14 e 7.15.
--
--   dimensao_vendedor    cadastro: quem e' e em que area esta HOJE
--   fato_venda_vendedor  a venda por DIA
--   vendedor_mes         situacao (SITAFA, HOUVE_VENDA) e a COTA do mes
--   dia_util             o calendario por filial, para ratear a cota
--
-- Tres decisoes que a estrutura materializa, e cada uma tem contra-exemplo:
--
-- SEM area congelada. Diferente de fato_venda_linha, que guarda a area do dia
-- da venda. La' o total da gerencia e' historico; aqui a pergunta e' "quantos
-- vendedores DESTA area bateram meta", e a area e' a de agora. O preco: o
-- Pareto de um mes fechado mostra o vendedor na area atual dele.
--
-- SEM indicador_id no fato. Em fato_venda_linha a coluna existe porque
-- indicadores FILHOS gravam na mesma tabela e o DELETE da janela precisa
-- distinguir. Performance Vendedor nao tem filhos.
--
-- A COTA fica em vendedor_mes, nao em `meta` com um EscopoMeta.VENDEDOR. Ela
-- chega na MESMA linha da situacao: separa-las obrigaria duas gravacoes a
-- partir de uma consulta so', e um dia uma passaria sem a outra.
--
-- E uma dependencia operacional que nao esta em constraint nenhuma:
-- vendedor_mes TEM DE SER REESCRITO, nao so' inserido. `houve_venda` e'
-- calculada com SYSDATE na origem -- enquanto o mes corre todo mundo e'
-- MES_EM_VIGOR, e quando fecha a mesma linha vira COM_VENDA ou SEM_VENDA.
-- Carga so'-insercao congela o mes inteiro e o denominador nunca mais muda.

-- cd_area foi criada como VARCHAR na migracao anterior e o modelo pede TEXT.
-- Sem dado (a tabela e' recarregada por vendas-linha), a conversao e' livre.
ALTER TABLE "dimensao_area_venda" ALTER COLUMN "cd_area" SET DATA TYPE TEXT;

-- CreateEnum
CREATE TYPE "houve_venda_type" AS ENUM ('SEM_VENDA', 'SUPERVISOR', 'MES_EM_VIGOR', 'COM_VENDA');
-- AlterTable
-- CreateTable
CREATE TABLE "dimensao_vendedor" (
    "id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "cod_vendedor" TEXT NOT NULL,
    "matricula" TEXT,
    "nome" TEXT NOT NULL,
    "area_venda_id" UUID NOT NULL,
    CONSTRAINT "dimensao_vendedor_pk" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "fato_venda_vendedor" (
    "id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "vendedor_id" UUID NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,
    "sync_id" UUID NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fato_venda_vendedor_pk" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "vendedor_mes" (
    "id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "vendedor_id" UUID NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "meta" DECIMAL(18,2) NOT NULL,
    "sitafa" INTEGER NOT NULL,
    "houve_venda" "houve_venda_type" NOT NULL,
    "sync_id" UUID NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vendedor_mes_pk" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "dia_util" (
    "id" UUID NOT NULL,
    "filial_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "dia_util" BOOLEAN NOT NULL,
    "acumulado_dia" INTEGER NOT NULL,
    "uteis_do_mes" INTEGER NOT NULL,
    "sync_id" UUID NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dia_util_pk" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "dimensao_vendedor_idx01" ON "dimensao_vendedor"("filial_id");
-- CreateIndex
CREATE INDEX "dimensao_vendedor_idx02" ON "dimensao_vendedor"("area_venda_id");
-- CreateIndex
CREATE INDEX "dimensao_vendedor_idx03" ON "dimensao_vendedor"("matricula");
-- CreateIndex
CREATE UNIQUE INDEX "dimensao_vendedor_uk01" ON "dimensao_vendedor"("filial_id", "cod_vendedor");
-- CreateIndex
CREATE INDEX "fato_venda_vendedor_idx01" ON "fato_venda_vendedor"("data");
-- CreateIndex
CREATE INDEX "fato_venda_vendedor_idx02" ON "fato_venda_vendedor"("filial_id");
-- CreateIndex
CREATE INDEX "fato_venda_vendedor_idx03" ON "fato_venda_vendedor"("vendedor_id");
-- CreateIndex
CREATE INDEX "fato_venda_vendedor_idx04" ON "fato_venda_vendedor"("sync_id");
-- CreateIndex
CREATE UNIQUE INDEX "fato_venda_vendedor_uk01" ON "fato_venda_vendedor"("filial_id", "data", "vendedor_id");
-- CreateIndex
CREATE INDEX "vendedor_mes_idx01" ON "vendedor_mes"("filial_id");
-- CreateIndex
CREATE INDEX "vendedor_mes_idx02" ON "vendedor_mes"("vendedor_id");
-- CreateIndex
CREATE INDEX "vendedor_mes_idx03" ON "vendedor_mes"("ano", "mes");
-- CreateIndex
CREATE INDEX "vendedor_mes_idx04" ON "vendedor_mes"("sync_id");
-- CreateIndex
CREATE UNIQUE INDEX "vendedor_mes_uk01" ON "vendedor_mes"("filial_id", "vendedor_id", "ano", "mes");
-- CreateIndex
CREATE INDEX "dia_util_idx01" ON "dia_util"("filial_id");
-- CreateIndex
CREATE INDEX "dia_util_idx02" ON "dia_util"("data");
-- CreateIndex
CREATE INDEX "dia_util_idx03" ON "dia_util"("sync_id");
-- CreateIndex
CREATE UNIQUE INDEX "dia_util_uk01" ON "dia_util"("filial_id", "data");
-- AddForeignKey
ALTER TABLE "dimensao_vendedor" ADD CONSTRAINT "dimensao_vendedor_filial_fk" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "dimensao_vendedor" ADD CONSTRAINT "dimensao_vendedor_dimensao_area_venda_fk" FOREIGN KEY ("area_venda_id") REFERENCES "dimensao_area_venda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "fato_venda_vendedor" ADD CONSTRAINT "fato_venda_vendedor_filial_fk" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "fato_venda_vendedor" ADD CONSTRAINT "fato_venda_vendedor_dimensao_vendedor_fk" FOREIGN KEY ("vendedor_id") REFERENCES "dimensao_vendedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "fato_venda_vendedor" ADD CONSTRAINT "fato_venda_vendedor_execucao_sincronizacao_fk" FOREIGN KEY ("sync_id") REFERENCES "execucao_sincronizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "vendedor_mes" ADD CONSTRAINT "vendedor_mes_filial_fk" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "vendedor_mes" ADD CONSTRAINT "vendedor_mes_dimensao_vendedor_fk" FOREIGN KEY ("vendedor_id") REFERENCES "dimensao_vendedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "vendedor_mes" ADD CONSTRAINT "vendedor_mes_execucao_sincronizacao_fk" FOREIGN KEY ("sync_id") REFERENCES "execucao_sincronizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "dia_util" ADD CONSTRAINT "dia_util_filial_fk" FOREIGN KEY ("filial_id") REFERENCES "filial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "dia_util" ADD CONSTRAINT "dia_util_execucao_sincronizacao_fk" FOREIGN KEY ("sync_id") REFERENCES "execucao_sincronizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

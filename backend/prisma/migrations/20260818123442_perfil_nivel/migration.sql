-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "id_perfil" TEXT;

-- CreateTable
CREATE TABLE "perfil_nivel" (
    "id_perfil" TEXT NOT NULL,
    "nivel" "Nivel" NOT NULL,
    "descricao" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perfil_nivel_pkey" PRIMARY KEY ("id_perfil")
);

-- CreateIndex
CREATE INDEX "perfil_nivel_nivel_idx" ON "perfil_nivel"("nivel");

-- CreateIndex
CREATE INDEX "usuario_id_perfil_idx" ON "usuario"("id_perfil");

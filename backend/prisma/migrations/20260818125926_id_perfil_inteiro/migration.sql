/*
  Warnings:

  - The primary key for the `perfil_nivel` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id_perfil` column on the `usuario` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `id_perfil` on the `perfil_nivel` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "perfil_nivel" DROP CONSTRAINT "perfil_nivel_pkey",
DROP COLUMN "id_perfil",
ADD COLUMN     "id_perfil" INTEGER NOT NULL,
ADD CONSTRAINT "perfil_nivel_pkey" PRIMARY KEY ("id_perfil");

-- AlterTable
ALTER TABLE "usuario" DROP COLUMN "id_perfil",
ADD COLUMN     "id_perfil" INTEGER;

-- CreateIndex
CREATE INDEX "usuario_id_perfil_idx" ON "usuario"("id_perfil");

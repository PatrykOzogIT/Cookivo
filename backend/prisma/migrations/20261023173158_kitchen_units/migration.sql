-- CreateEnum
CREATE TYPE "UnitBasis" AS ENUM ('SOURCE', 'AI', 'ADMIN');

-- CreateEnum
CREATE TYPE "UnitSuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "AiImportKind" ADD VALUE 'UNIT_ESTIMATE';

-- AlterTable
ALTER TABLE "ingredient_units" ADD COLUMN     "basis" "UnitBasis" NOT NULL DEFAULT 'SOURCE';

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "units_estimated_at" TIMESTAMP(3),
ADD COLUMN     "units_not_fit" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "recipe_ingredients" ADD COLUMN     "unit_grams" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "unit_suggestions" (
    "id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "unit_code" VARCHAR(32) NOT NULL,
    "grams" DOUBLE PRECISION NOT NULL,
    "user_id" UUID,
    "status" "UnitSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "unit_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unit_suggestions_status_idx" ON "unit_suggestions"("status");

-- CreateIndex
CREATE INDEX "unit_suggestions_ingredient_id_unit_code_idx" ON "unit_suggestions"("ingredient_id", "unit_code");

-- AddForeignKey
ALTER TABLE "unit_suggestions" ADD CONSTRAINT "unit_suggestions_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_suggestions" ADD CONSTRAINT "unit_suggestions_unit_code_fkey" FOREIGN KEY ("unit_code") REFERENCES "units"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_suggestions" ADD CONSTRAINT "unit_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Jedna oczekująca propozycja od osoby na parę składnik + miara
CREATE UNIQUE INDEX "unit_suggestions_pending_key" ON "unit_suggestions" ("user_id", "ingredient_id", "unit_code") WHERE "status" = 'PENDING';

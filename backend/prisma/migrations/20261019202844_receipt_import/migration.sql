-- Licznik importów przepisów staje się wspólnym licznikiem odczytów przez AI (przepis, paragon)
-- CreateEnum
CREATE TYPE "AiImportKind" AS ENUM ('RECIPE', 'RECEIPT');

-- CreateEnum
CREATE TYPE "PriceSource" AS ENUM ('RECEIPT', 'MANUAL');

-- Zmiana nazwy zamiast DROP + CREATE: zostają liczniki limitów
ALTER TABLE "recipe_imports" RENAME TO "ai_imports";
ALTER TABLE "ai_imports" RENAME CONSTRAINT "recipe_imports_pkey" TO "ai_imports_pkey";
ALTER TABLE "ai_imports" RENAME CONSTRAINT "recipe_imports_user_id_fkey" TO "ai_imports_user_id_fkey";
ALTER INDEX "recipe_imports_user_id_created_at_idx" RENAME TO "ai_imports_user_id_created_at_idx";
ALTER INDEX "recipe_imports_created_at_idx" RENAME TO "ai_imports_created_at_idx";
ALTER TABLE "ai_imports" ADD COLUMN "kind" "AiImportKind" NOT NULL DEFAULT 'RECIPE',
ADD COLUMN "scope_key" VARCHAR(40),
ADD COLUMN "committed_at" TIMESTAMP(3),
ADD COLUMN "result" JSONB;

-- CreateTable
CREATE TABLE "price_observations" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "household_id" UUID,
    "list_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "import_id" UUID,
    "source" "PriceSource" NOT NULL,
    "store_name" VARCHAR(80),
    "purchased_on" DATE,
    "currency" VARCHAR(3) NOT NULL,
    "package_amount" DOUBLE PRECISION NOT NULL,
    "package_unit_code" VARCHAR(32) NOT NULL,
    "package_grams" DOUBLE PRECISION NOT NULL,
    "packages" DOUBLE PRECISION NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_observations_ingredient_id_purchased_on_idx" ON "price_observations"("ingredient_id", "purchased_on");

-- CreateIndex
CREATE INDEX "price_observations_user_id_idx" ON "price_observations"("user_id");

-- CreateIndex
CREATE INDEX "price_observations_household_id_idx" ON "price_observations"("household_id");

-- CreateIndex
CREATE INDEX "price_observations_list_id_idx" ON "price_observations"("list_id");

-- CreateIndex
CREATE INDEX "price_observations_import_id_idx" ON "price_observations"("import_id");

-- AddForeignKey
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "ai_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Właściciel: gospodarstwo albo osoba (jak w cennikach)
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_owner" CHECK (num_nonnulls("user_id", "household_id") = 1);

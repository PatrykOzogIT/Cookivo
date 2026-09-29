-- Wyszukiwanie rozmyte (literówki, fragmenty słów)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "IngredientStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IngredientSource" AS ENUM ('USDA', 'USER');

-- CreateTable
CREATE TABLE "allergens" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name_pl" VARCHAR(80) NOT NULL,
    "name_en" VARCHAR(80) NOT NULL,
    "icon" VARCHAR(40) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "allergens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_categories" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name_pl" VARCHAR(80) NOT NULL,
    "name_en" VARCHAR(80) NOT NULL,
    "icon" VARCHAR(40) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ingredient_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "code" VARCHAR(32) NOT NULL,
    "name_pl" VARCHAR(40) NOT NULL,
    "name_en" VARCHAR(40) NOT NULL,
    "ml" DOUBLE PRECISION,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "units_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "name_pl" VARCHAR(120) NOT NULL,
    "name_en" VARCHAR(120),
    "search_text" TEXT NOT NULL,
    "category_id" INTEGER NOT NULL,
    "status" "IngredientStatus" NOT NULL DEFAULT 'PENDING',
    "source" "IngredientSource" NOT NULL DEFAULT 'USER',
    "source_ref" VARCHAR(40),
    "seed_key" VARCHAR(160),
    "kcal" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "saturated_fat" DOUBLE PRECISION,
    "carbs" DOUBLE PRECISION NOT NULL,
    "sugars" DOUBLE PRECISION,
    "fiber" DOUBLE PRECISION,
    "salt" DOUBLE PRECISION,
    "density" DOUBLE PRECISION,
    "created_by_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_allergens" (
    "ingredient_id" UUID NOT NULL,
    "allergen_id" INTEGER NOT NULL,

    CONSTRAINT "ingredient_allergens_pkey" PRIMARY KEY ("ingredient_id","allergen_id")
);

-- CreateTable
CREATE TABLE "ingredient_units" (
    "ingredient_id" UUID NOT NULL,
    "unit_code" VARCHAR(32) NOT NULL,
    "grams" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ingredient_units_pkey" PRIMARY KEY ("ingredient_id","unit_code")
);

-- CreateIndex
CREATE UNIQUE INDEX "allergens_code_key" ON "allergens"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_categories_code_key" ON "ingredient_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_seed_key_key" ON "ingredients"("seed_key");

-- CreateIndex
CREATE INDEX "ingredients_status_category_id_idx" ON "ingredients"("status", "category_id");

-- CreateIndex
CREATE INDEX "ingredients_created_by_id_idx" ON "ingredients"("created_by_id");

-- CreateIndex
CREATE INDEX "ingredient_allergens_allergen_id_idx" ON "ingredient_allergens"("allergen_id");

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ingredient_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_allergens" ADD CONSTRAINT "ingredient_allergens_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_allergens" ADD CONSTRAINT "ingredient_allergens_allergen_id_fkey" FOREIGN KEY ("allergen_id") REFERENCES "allergens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_units" ADD CONSTRAINT "ingredient_units_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_units" ADD CONSTRAINT "ingredient_units_unit_code_fkey" FOREIGN KEY ("unit_code") REFERENCES "units"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indeks trigramowy do szybkiego wyszukiwania po nazwie
CREATE INDEX "ingredients_search_text_trgm_idx" ON "ingredients" USING GIN ("search_text" gin_trgm_ops);

-- Zatwierdzone składniki muszą mieć unikalną polską nazwę (bez względu na wielkość liter)
CREATE UNIQUE INDEX "ingredients_approved_name_pl_key" ON "ingredients" (lower("name_pl")) WHERE "status" = 'APPROVED';

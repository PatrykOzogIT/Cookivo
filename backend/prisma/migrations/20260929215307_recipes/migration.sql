-- CreateEnum
CREATE TYPE "RecipeVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- DropIndex
DROP INDEX "ingredients_search_text_trgm_idx";

-- CreateTable
CREATE TABLE "meal_types" (
    "code" VARCHAR(32) NOT NULL,
    "name_pl" VARCHAR(60) NOT NULL,
    "name_en" VARCHAR(60) NOT NULL,
    "icon" VARCHAR(40) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "meal_types_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "author_id" UUID,
    "title" VARCHAR(150) NOT NULL,
    "description" VARCHAR(2000),
    "search_text" TEXT NOT NULL,
    "servings" INTEGER NOT NULL,
    "prep_minutes" INTEGER,
    "cook_minutes" INTEGER,
    "difficulty" "Difficulty",
    "visibility" "RecipeVisibility" NOT NULL DEFAULT 'PRIVATE',
    "can_be_ingredient" BOOLEAN NOT NULL DEFAULT false,
    "hidden_at" TIMESTAMP(3),
    "hidden_by_id" UUID,
    "hidden_reason" VARCHAR(500),
    "cooked_grams" DOUBLE PRECISION,
    "total_grams" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "kcal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "protein" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "saturated_fat" DOUBLE PRECISION,
    "carbs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sugars" DOUBLE PRECISION,
    "fiber" DOUBLE PRECISION,
    "salt" DOUBLE PRECISION,
    "kcal_per_serving" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_meal_types" (
    "recipe_id" UUID NOT NULL,
    "meal_type_code" VARCHAR(32) NOT NULL,

    CONSTRAINT "recipe_meal_types_pkey" PRIMARY KEY ("recipe_id","meal_type_code")
);

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "group_name" VARCHAR(80),
    "ingredient_id" UUID,
    "sub_recipe_id" UUID,
    "amount" DOUBLE PRECISION NOT NULL,
    "unit_code" VARCHAR(32) NOT NULL,
    "grams" DOUBLE PRECISION NOT NULL,
    "note" VARCHAR(120),

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_steps" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "text" VARCHAR(2000) NOT NULL,
    "timer_minutes" INTEGER,
    "photo_id" UUID,

    CONSTRAINT "recipe_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_allergens" (
    "recipe_id" UUID NOT NULL,
    "allergen_id" INTEGER NOT NULL,

    CONSTRAINT "recipe_allergens_pkey" PRIMARY KEY ("recipe_id","allergen_id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "recipe_id" UUID,
    "position" INTEGER,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recipes_visibility_hidden_at_idx" ON "recipes"("visibility", "hidden_at");

-- CreateIndex
CREATE INDEX "recipes_author_id_idx" ON "recipes"("author_id");

-- CreateIndex
CREATE INDEX "recipe_meal_types_meal_type_code_idx" ON "recipe_meal_types"("meal_type_code");

-- CreateIndex
CREATE INDEX "recipe_ingredients_recipe_id_idx" ON "recipe_ingredients"("recipe_id");

-- CreateIndex
CREATE INDEX "recipe_ingredients_ingredient_id_idx" ON "recipe_ingredients"("ingredient_id");

-- CreateIndex
CREATE INDEX "recipe_ingredients_sub_recipe_id_idx" ON "recipe_ingredients"("sub_recipe_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_steps_photo_id_key" ON "recipe_steps"("photo_id");

-- CreateIndex
CREATE INDEX "recipe_steps_recipe_id_idx" ON "recipe_steps"("recipe_id");

-- CreateIndex
CREATE INDEX "recipe_allergens_allergen_id_idx" ON "recipe_allergens"("allergen_id");

-- CreateIndex
CREATE INDEX "photos_recipe_id_idx" ON "photos"("recipe_id");

-- CreateIndex
CREATE INDEX "photos_owner_id_recipe_id_idx" ON "photos"("owner_id", "recipe_id");

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_hidden_by_id_fkey" FOREIGN KEY ("hidden_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_meal_types" ADD CONSTRAINT "recipe_meal_types_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_meal_types" ADD CONSTRAINT "recipe_meal_types_meal_type_code_fkey" FOREIGN KEY ("meal_type_code") REFERENCES "meal_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_sub_recipe_id_fkey" FOREIGN KEY ("sub_recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_allergens" ADD CONSTRAINT "recipe_allergens_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_allergens" ADD CONSTRAINT "recipe_allergens_allergen_id_fkey" FOREIGN KEY ("allergen_id") REFERENCES "allergens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Wyszukiwanie przepisów po tytule (literówki, bez polskich znaków)
CREATE INDEX "recipes_search_text_trgm_idx" ON "recipes" USING GIN ("search_text" gin_trgm_ops);

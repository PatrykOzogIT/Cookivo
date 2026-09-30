-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('FEMALE', 'MALE');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('SEDENTARY', 'LIGHT', 'MODERATE', 'ACTIVE', 'VERY_ACTIVE');

-- CreateEnum
CREATE TYPE "NutritionGoal" AS ENUM ('CUT', 'CUT_MILD', 'MAINTAIN', 'BULK');

-- CreateEnum
CREATE TYPE "AllergySeverity" AS ENUM ('ALLERGY', 'INTOLERANCE');

-- CreateEnum
CREATE TYPE "PreferenceLevel" AS ENUM ('NEVER', 'SOMETIMES', 'LIKE', 'LOVE');

-- AlterEnum
ALTER TYPE "EmailTokenType" ADD VALUE 'CHANGE_EMAIL';

-- DropForeignKey
ALTER TABLE "photos" DROP CONSTRAINT "photos_owner_id_fkey";

-- DropIndex
DROP INDEX "recipes_search_text_trgm_idx";

-- AlterTable
ALTER TABLE "email_tokens" ADD COLUMN     "payload" VARCHAR(254);

-- AlterTable
ALTER TABLE "photos" ALTER COLUMN "owner_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "nutrition_profiles" (
    "user_id" UUID NOT NULL,
    "sex" "Sex" NOT NULL,
    "birth_date" DATE NOT NULL,
    "height_cm" DOUBLE PRECISION NOT NULL,
    "weight_kg" DOUBLE PRECISION NOT NULL,
    "activity" "ActivityLevel" NOT NULL,
    "goal" "NutritionGoal" NOT NULL,
    "custom_kcal" INTEGER,
    "custom_protein" DOUBLE PRECISION,
    "custom_fat" DOUBLE PRECISION,
    "custom_carbs" DOUBLE PRECISION,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nutrition_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_allergens" (
    "user_id" UUID NOT NULL,
    "allergen_id" INTEGER NOT NULL,
    "severity" "AllergySeverity" NOT NULL DEFAULT 'ALLERGY',

    CONSTRAINT "user_allergens_pkey" PRIMARY KEY ("user_id","allergen_id")
);

-- CreateTable
CREATE TABLE "ingredient_preferences" (
    "user_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "level" "PreferenceLevel" NOT NULL,

    CONSTRAINT "ingredient_preferences_pkey" PRIMARY KEY ("user_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "category_preferences" (
    "user_id" UUID NOT NULL,
    "category_id" INTEGER NOT NULL,
    "level" "PreferenceLevel" NOT NULL,

    CONSTRAINT "category_preferences_pkey" PRIMARY KEY ("user_id","category_id")
);

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_profiles" ADD CONSTRAINT "nutrition_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_allergens" ADD CONSTRAINT "user_allergens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_allergens" ADD CONSTRAINT "user_allergens_allergen_id_fkey" FOREIGN KEY ("allergen_id") REFERENCES "allergens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_preferences" ADD CONSTRAINT "ingredient_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_preferences" ADD CONSTRAINT "ingredient_preferences_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_preferences" ADD CONSTRAINT "category_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_preferences" ADD CONSTRAINT "category_preferences_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ingredient_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

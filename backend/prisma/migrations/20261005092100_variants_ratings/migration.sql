-- AlterTable
ALTER TABLE "recipes" ADD COLUMN     "rating_avg" DOUBLE PRECISION,
ADD COLUMN     "rating_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "variant_note" VARCHAR(200),
ADD COLUMN     "variant_of_id" UUID;

-- CreateTable
CREATE TABLE "recipe_ratings" (
    "recipe_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_ratings_pkey" PRIMARY KEY ("recipe_id","user_id")
);

-- CreateIndex
CREATE INDEX "recipe_ratings_user_id_idx" ON "recipe_ratings"("user_id");

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_variant_of_id_fkey" FOREIGN KEY ("variant_of_id") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ratings" ADD CONSTRAINT "recipe_ratings_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ratings" ADD CONSTRAINT "recipe_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recipe_ratings" ADD CONSTRAINT "recipe_ratings_stars" CHECK ("stars" BETWEEN 1 AND 5);
-- Wariant nie może wskazywać na siebie
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_variant_not_self" CHECK ("variant_of_id" IS NULL OR "variant_of_id" <> "id");
CREATE INDEX "recipes_variant_of_id_idx" ON "recipes"("variant_of_id");

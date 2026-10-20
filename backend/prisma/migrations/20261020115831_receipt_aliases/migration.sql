-- CreateEnum
CREATE TYPE "IngredientRequestStatus" AS ENUM ('OPEN', 'DONE', 'REJECTED');

-- AlterTable
ALTER TABLE "ai_imports" ADD COLUMN     "lines" JSONB;

-- CreateTable
CREATE TABLE "receipt_alias_votes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "store_key" VARCHAR(40) NOT NULL,
    "text_key" VARCHAR(120) NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_alias_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "receipt_text" VARCHAR(120),
    "store_name" VARCHAR(80),
    "store_key" VARCHAR(40) NOT NULL DEFAULT '',
    "text_key" VARCHAR(120),
    "status" "IngredientRequestStatus" NOT NULL DEFAULT 'OPEN',
    "ingredient_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "ingredient_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receipt_alias_votes_text_key_store_key_idx" ON "receipt_alias_votes"("text_key", "store_key");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_alias_votes_user_id_store_key_text_key_key" ON "receipt_alias_votes"("user_id", "store_key", "text_key");

-- CreateIndex
CREATE INDEX "ingredient_requests_status_created_at_idx" ON "ingredient_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "ingredient_requests_user_id_idx" ON "ingredient_requests"("user_id");

-- AddForeignKey
ALTER TABLE "receipt_alias_votes" ADD CONSTRAINT "receipt_alias_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_alias_votes" ADD CONSTRAINT "receipt_alias_votes_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_requests" ADD CONSTRAINT "ingredient_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_requests" ADD CONSTRAINT "ingredient_requests_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

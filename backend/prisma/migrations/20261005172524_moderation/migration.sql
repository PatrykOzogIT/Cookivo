-- CreateEnum
CREATE TYPE "ReportTarget" AS ENUM ('RECIPE', 'RATING', 'USER');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('OFFENSIVE', 'SPAM', 'DANGEROUS', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED');

-- DropIndex
DROP INDEX "recipes_variant_of_id_idx";

-- AlterTable
ALTER TABLE "recipe_ratings" ADD COLUMN     "hidden_at" TIMESTAMP(3),
ADD COLUMN     "hidden_reason" VARCHAR(500);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "block_reason" VARCHAR(500),
ADD COLUMN     "blocked_at" TIMESTAMP(3),
ADD COLUMN     "blocked_until" TIMESTAMP(3),
ADD COLUMN     "name_hidden_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "target_type" "ReportTarget" NOT NULL,
    "recipe_id" UUID,
    "target_user_id" UUID,
    "reporter_id" UUID NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "details" VARCHAR(500),
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,
    "resolution_note" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_status_target_type_idx" ON "reports"("status", "target_type");

-- CreateIndex
CREATE INDEX "reports_recipe_id_idx" ON "reports"("recipe_id");

-- CreateIndex
CREATE INDEX "reports_target_user_id_idx" ON "reports"("target_user_id");

-- CreateIndex
CREATE INDEX "reports_reporter_id_idx" ON "reports"("reporter_id");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cel zgłoszenia zgodny z typem
ALTER TABLE "reports" ADD CONSTRAINT "reports_target" CHECK (
  ("target_type" = 'RECIPE' AND "recipe_id" IS NOT NULL AND "target_user_id" IS NULL) OR
  ("target_type" = 'RATING' AND "recipe_id" IS NOT NULL AND "target_user_id" IS NOT NULL) OR
  ("target_type" = 'USER' AND "recipe_id" IS NULL AND "target_user_id" IS NOT NULL)
);
-- Jedna otwarta skarga tej samej osoby na ten sam cel
CREATE UNIQUE INDEX "reports_one_open_per_reporter" ON "reports"
  ("reporter_id", "target_type", COALESCE("recipe_id", '00000000-0000-0000-0000-000000000000'::uuid),
   COALESCE("target_user_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "status" = 'OPEN';

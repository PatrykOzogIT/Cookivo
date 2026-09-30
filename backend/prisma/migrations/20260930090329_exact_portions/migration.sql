-- AlterEnum
ALTER TYPE "ConsentType" ADD VALUE 'HOUSEHOLD_TARGETS';

-- AlterTable
ALTER TABLE "household_members" ADD COLUMN     "share_targets" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "plan_cooks" ADD COLUMN     "cooked_grams" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "plan_meals" ADD COLUMN     "absent_dependent_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "absent_user_ids" UUID[] DEFAULT ARRAY[]::UUID[];

-- CreateTable
CREATE TABLE "household_dependents" (
    "id" UUID NOT NULL,
    "household_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "birth_year" INTEGER NOT NULL,
    "sex" "Sex" NOT NULL,
    "custom_kcal" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_dependents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "household_dependents_household_id_idx" ON "household_dependents"("household_id");

-- AddForeignKey
ALTER TABLE "household_dependents" ADD CONSTRAINT "household_dependents_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "household_dependents" ADD CONSTRAINT "household_dependents_birth_year" CHECK ("birth_year" BETWEEN 1900 AND 2100);
ALTER TABLE "plan_cooks" ADD CONSTRAINT "plan_cooks_cooked_grams" CHECK ("cooked_grams" IS NULL OR "cooked_grams" > 0);

-- CreateTable
CREATE TABLE "pantry_items" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "household_id" UUID,
    "ingredient_id" UUID NOT NULL,
    "amount" DOUBLE PRECISION,
    "unit_code" VARCHAR(32),
    "grams" DOUBLE PRECISION,
    "expires_on" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pantry_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_items" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "household_id" UUID,
    "ingredient_id" UUID,
    "name" VARCHAR(80),
    "grams" DOUBLE PRECISION,
    "note" VARCHAR(80),
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "checked_by_id" UUID,
    "checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopping_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pantry_items_user_id_idx" ON "pantry_items"("user_id");

-- CreateIndex
CREATE INDEX "pantry_items_household_id_idx" ON "pantry_items"("household_id");

-- CreateIndex
CREATE INDEX "shopping_items_user_id_idx" ON "shopping_items"("user_id");

-- CreateIndex
CREATE INDEX "shopping_items_household_id_idx" ON "shopping_items"("household_id");

-- AddForeignKey
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_checked_by_id_fkey" FOREIGN KEY ("checked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_owner" CHECK (num_nonnulls("user_id", "household_id") = 1);
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_owner" CHECK (num_nonnulls("user_id", "household_id") = 1);
-- Pozycja to składnik z bazy albo własna nazwa
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_what" CHECK (num_nonnulls("ingredient_id", "name") = 1);
-- Jeden wpis na składnik w lodówce danego właściciela
CREATE UNIQUE INDEX "pantry_items_user_ingredient" ON "pantry_items"("user_id", "ingredient_id") WHERE "user_id" IS NOT NULL;
CREATE UNIQUE INDEX "pantry_items_household_ingredient" ON "pantry_items"("household_id", "ingredient_id") WHERE "household_id" IS NOT NULL;

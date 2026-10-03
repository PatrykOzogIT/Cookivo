-- CreateTable
CREATE TABLE "price_lists" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "household_id" UUID,
    "name" VARCHAR(60) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'PLN',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_entries" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "package_amount" DOUBLE PRECISION NOT NULL,
    "package_unit_code" VARCHAR(32) NOT NULL,
    "package_grams" DOUBLE PRECISION NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_lists_user_id_idx" ON "price_lists"("user_id");

-- CreateIndex
CREATE INDEX "price_lists_household_id_idx" ON "price_lists"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_entries_list_id_ingredient_id_key" ON "price_entries"("list_id", "ingredient_id");

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_entries" ADD CONSTRAINT "price_entries_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_entries" ADD CONSTRAINT "price_entries_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_owner" CHECK (num_nonnulls("user_id", "household_id") = 1);
ALTER TABLE "price_entries" ADD CONSTRAINT "price_entries_positive" CHECK ("price_cents" >= 0 AND "package_grams" > 0 AND "package_amount" > 0);
-- Najwyżej jeden domyślny cennik na właściciela
CREATE UNIQUE INDEX "price_lists_user_default" ON "price_lists"("user_id") WHERE "is_default" AND "user_id" IS NOT NULL;
CREATE UNIQUE INDEX "price_lists_household_default" ON "price_lists"("household_id") WHERE "is_default" AND "household_id" IS NOT NULL;

-- CreateTable
CREATE TABLE "planner_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "household_id" UUID,
    "hidden_slots" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exact_portions" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planner_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_meal_slots" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "household_id" UUID,
    "name" VARCHAR(40) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_meal_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_cooks" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "household_id" UUID,
    "recipe_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "servings" DOUBLE PRECISION NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_cooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_meals" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "household_id" UUID,
    "date" DATE NOT NULL,
    "slot_code" VARCHAR(32),
    "custom_slot_id" UUID,
    "cook_id" UUID NOT NULL,
    "servings" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_meals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "planner_settings_user_id_key" ON "planner_settings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "planner_settings_household_id_key" ON "planner_settings"("household_id");

-- CreateIndex
CREATE INDEX "custom_meal_slots_user_id_idx" ON "custom_meal_slots"("user_id");

-- CreateIndex
CREATE INDEX "custom_meal_slots_household_id_idx" ON "custom_meal_slots"("household_id");

-- CreateIndex
CREATE INDEX "plan_cooks_user_id_date_idx" ON "plan_cooks"("user_id", "date");

-- CreateIndex
CREATE INDEX "plan_cooks_household_id_date_idx" ON "plan_cooks"("household_id", "date");

-- CreateIndex
CREATE INDEX "plan_meals_user_id_date_idx" ON "plan_meals"("user_id", "date");

-- CreateIndex
CREATE INDEX "plan_meals_household_id_date_idx" ON "plan_meals"("household_id", "date");

-- CreateIndex
CREATE INDEX "plan_meals_cook_id_idx" ON "plan_meals"("cook_id");

-- AddForeignKey
ALTER TABLE "planner_settings" ADD CONSTRAINT "planner_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planner_settings" ADD CONSTRAINT "planner_settings_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_meal_slots" ADD CONSTRAINT "custom_meal_slots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_meal_slots" ADD CONSTRAINT "custom_meal_slots_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_cooks" ADD CONSTRAINT "plan_cooks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_cooks" ADD CONSTRAINT "plan_cooks_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_cooks" ADD CONSTRAINT "plan_cooks_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_cooks" ADD CONSTRAINT "plan_cooks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_meals" ADD CONSTRAINT "plan_meals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_meals" ADD CONSTRAINT "plan_meals_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_meals" ADD CONSTRAINT "plan_meals_custom_slot_id_fkey" FOREIGN KEY ("custom_slot_id") REFERENCES "custom_meal_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_meals" ADD CONSTRAINT "plan_meals_cook_id_fkey" FOREIGN KEY ("cook_id") REFERENCES "plan_cooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Wiersz planera należy albo do użytkownika, albo do gospodarstwa
ALTER TABLE "planner_settings" ADD CONSTRAINT "planner_settings_owner" CHECK (num_nonnulls("user_id", "household_id") = 1);
ALTER TABLE "custom_meal_slots" ADD CONSTRAINT "custom_meal_slots_owner" CHECK (num_nonnulls("user_id", "household_id") = 1);
ALTER TABLE "plan_cooks" ADD CONSTRAINT "plan_cooks_owner" CHECK (num_nonnulls("user_id", "household_id") = 1);
ALTER TABLE "plan_meals" ADD CONSTRAINT "plan_meals_owner" CHECK (num_nonnulls("user_id", "household_id") = 1);
-- Posiłek: stały (kod) albo własny - dokładnie jedno
ALTER TABLE "plan_meals" ADD CONSTRAINT "plan_meals_slot" CHECK (num_nonnulls("slot_code", "custom_slot_id") = 1);
ALTER TABLE "plan_cooks" ADD CONSTRAINT "plan_cooks_servings" CHECK ("servings" > 0);
ALTER TABLE "plan_meals" ADD CONSTRAINT "plan_meals_servings" CHECK ("servings" > 0);

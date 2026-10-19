-- CreateTable
CREATE TABLE "recipe_imports" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "photos" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recipe_imports_user_id_created_at_idx" ON "recipe_imports"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "recipe_imports_created_at_idx" ON "recipe_imports"("created_at");

-- AddForeignKey
ALTER TABLE "recipe_imports" ADD CONSTRAINT "recipe_imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

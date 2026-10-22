-- AlterTable
ALTER TABLE "photos" ADD COLUMN     "credit_author" VARCHAR(300),
ADD COLUMN     "credit_license" VARCHAR(60),
ADD COLUMN     "credit_license_url" VARCHAR(300),
ADD COLUMN     "credit_source_url" VARCHAR(500);

-- CreateTable
CREATE TABLE "recipe_translations" (
    "recipe_id" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" VARCHAR(2000),
    "steps" JSONB NOT NULL,
    "lines" JSONB NOT NULL,

    CONSTRAINT "recipe_translations_pkey" PRIMARY KEY ("recipe_id","locale")
);

-- CreateTable
CREATE TABLE "recipe_sources" (
    "recipe_id" UUID NOT NULL,
    "external_id" VARCHAR(100) NOT NULL,
    "revision_id" VARCHAR(40),
    "source_name" VARCHAR(100) NOT NULL,
    "source_locale" "Locale" NOT NULL,
    "source_title" VARCHAR(300) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "history_url" VARCHAR(500),
    "authors" VARCHAR(300),
    "license" VARCHAR(60) NOT NULL,
    "license_url" VARCHAR(300) NOT NULL,
    "changes" TEXT[],
    "dataset_version" VARCHAR(40) NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_sources_pkey" PRIMARY KEY ("recipe_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recipe_sources_external_id_key" ON "recipe_sources"("external_id");

-- AddForeignKey
ALTER TABLE "recipe_translations" ADD CONSTRAINT "recipe_translations_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_sources" ADD CONSTRAINT "recipe_sources_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

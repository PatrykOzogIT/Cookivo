-- CreateEnum
CREATE TYPE "FriendGroupRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "FriendGroupMemberStatus" AS ENUM ('PENDING', 'ACTIVE');

-- AlterEnum
ALTER TYPE "RecipeVisibility" ADD VALUE 'GROUPS';

-- CreateTable
CREATE TABLE "friend_groups" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "description" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friend_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friend_group_members" (
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "FriendGroupRole" NOT NULL DEFAULT 'MEMBER',
    "status" "FriendGroupMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "invited_by_id" UUID,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "friend_group_members_pkey" PRIMARY KEY ("group_id","user_id")
);

-- CreateTable
CREATE TABLE "friend_group_invites" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" VARCHAR(254),
    "created_by_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friend_group_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_friend_groups" (
    "recipe_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,

    CONSTRAINT "recipe_friend_groups_pkey" PRIMARY KEY ("recipe_id","group_id")
);

-- CreateIndex
CREATE INDEX "friend_group_members_user_id_idx" ON "friend_group_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "friend_group_invites_token_hash_key" ON "friend_group_invites"("token_hash");

-- CreateIndex
CREATE INDEX "friend_group_invites_group_id_idx" ON "friend_group_invites"("group_id");

-- CreateIndex
CREATE INDEX "recipe_friend_groups_group_id_idx" ON "recipe_friend_groups"("group_id");

-- AddForeignKey
ALTER TABLE "friend_group_members" ADD CONSTRAINT "friend_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "friend_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_group_members" ADD CONSTRAINT "friend_group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_group_members" ADD CONSTRAINT "friend_group_members_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_group_invites" ADD CONSTRAINT "friend_group_invites_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "friend_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friend_group_invites" ADD CONSTRAINT "friend_group_invites_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_friend_groups" ADD CONSTRAINT "recipe_friend_groups_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_friend_groups" ADD CONSTRAINT "recipe_friend_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "friend_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Jeden właściciel na grupę (jak w gospodarstwach)
CREATE UNIQUE INDEX "friend_group_members_one_owner" ON "friend_group_members"("group_id") WHERE "role" = 'OWNER';

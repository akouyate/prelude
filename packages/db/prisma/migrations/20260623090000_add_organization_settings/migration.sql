-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "generatorModel" TEXT,
ADD COLUMN     "generatorProvider" TEXT,
ADD COLUMN     "schemaVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "InterviewDraft" ADD COLUMN     "generatorModel" TEXT,
ADD COLUMN     "generatorProvider" TEXT,
ADD COLUMN     "schemaVersion" INTEGER NOT NULL DEFAULT 1;

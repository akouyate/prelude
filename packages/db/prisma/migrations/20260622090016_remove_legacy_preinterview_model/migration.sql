/*
  Warnings:

  - You are about to drop the `Answer` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PreInterview` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Question` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Submission` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Answer" DROP CONSTRAINT "Answer_questionId_fkey";

-- DropForeignKey
ALTER TABLE "Answer" DROP CONSTRAINT "Answer_submissionId_fkey";

-- DropForeignKey
ALTER TABLE "PreInterview" DROP CONSTRAINT "PreInterview_jobId_fkey";

-- DropForeignKey
ALTER TABLE "Question" DROP CONSTRAINT "Question_preInterviewId_fkey";

-- DropForeignKey
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_candidateId_fkey";

-- DropForeignKey
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_preInterviewId_fkey";

-- DropTable
DROP TABLE "Answer";

-- DropTable
DROP TABLE "PreInterview";

-- DropTable
DROP TABLE "Question";

-- DropTable
DROP TABLE "Submission";

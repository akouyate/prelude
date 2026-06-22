/*
  Warnings:

  - Added the required column `justification` to the `ComplianceOverrideEvent` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ComplianceOverrideEvent" ADD COLUMN     "justification" TEXT NOT NULL;

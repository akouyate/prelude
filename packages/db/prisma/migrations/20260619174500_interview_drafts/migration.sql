-- CreateTable
CREATE TABLE "InterviewDraft" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "roleTitle" TEXT NOT NULL,
    "roleBrief" TEXT NOT NULL DEFAULT '',
    "seniority" TEXT,
    "focus" JSONB NOT NULL DEFAULT '[]',
    "responseModes" JSONB NOT NULL DEFAULT '[]',
    "questions" JSONB NOT NULL DEFAULT '[]',
    "criteria" JSONB NOT NULL DEFAULT '[]',
    "guardrails" JSONB NOT NULL DEFAULT '[]',
    "estimatedMinutes" INTEGER,
    "rationale" TEXT,
    "sourceAttachmentName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "draftId" TEXT,
    "publicToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'published',
    "roleTitle" TEXT NOT NULL,
    "roleBrief" TEXT NOT NULL DEFAULT '',
    "seniority" TEXT,
    "focus" JSONB NOT NULL DEFAULT '[]',
    "responseModes" JSONB NOT NULL DEFAULT '[]',
    "questions" JSONB NOT NULL DEFAULT '[]',
    "criteria" JSONB NOT NULL DEFAULT '[]',
    "guardrails" JSONB NOT NULL DEFAULT '[]',
    "estimatedMinutes" INTEGER,
    "rationale" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "realtimeSessionId" TEXT,
    "candidateName" TEXT,
    "candidateEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewDraft_organizationId_status_updatedAt_idx" ON "InterviewDraft"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "InterviewDraft_jobId_status_idx" ON "InterviewDraft"("jobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Interview_draftId_key" ON "Interview"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "Interview_publicToken_key" ON "Interview"("publicToken");

-- CreateIndex
CREATE INDEX "Interview_organizationId_status_updatedAt_idx" ON "Interview"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Interview_jobId_status_idx" ON "Interview"("jobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateSession_realtimeSessionId_key" ON "CandidateSession"("realtimeSessionId");

-- CreateIndex
CREATE INDEX "CandidateSession_organizationId_status_updatedAt_idx" ON "CandidateSession"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "CandidateSession_interviewId_status_idx" ON "CandidateSession"("interviewId", "status");

-- AddForeignKey
ALTER TABLE "InterviewDraft" ADD CONSTRAINT "InterviewDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewDraft" ADD CONSTRAINT "InterviewDraft_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "InterviewDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSession" ADD CONSTRAINT "CandidateSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSession" ADD CONSTRAINT "CandidateSession_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSession" ADD CONSTRAINT "CandidateSession_realtimeSessionId_fkey" FOREIGN KEY ("realtimeSessionId") REFERENCES "live_interview_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

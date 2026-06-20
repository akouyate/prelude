-- Persist resumable organization onboarding progress before final completion.
ALTER TABLE "Organization"
  ADD COLUMN "onboardingState" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "onboardingStep" TEXT NOT NULL DEFAULT 'welcome';

import type { CriteriaDistribution } from "../dashboard/criteria-signal";

export type CandidateReviewStatus = "archived" | "to_call" | "to_review";

export type CandidateScreenListItem = {
  analysisStatus: string;
  candidateLabel: string;
  completedAt: string | null;
  criteriaDistribution: CriteriaDistribution;
  hasCompletedBrief: boolean;
  href: string;
  id: string;
  jobTitle: string;
  pointsToClarifyCount: number | null;
  questionCompletionRate: number | null;
  reviewStatus: CandidateReviewStatus;
  roleTitle: string;
  startedAt: string | null;
  status: string;
};

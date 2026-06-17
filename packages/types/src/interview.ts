export type ReviewStatus = "draft" | "published" | "closed";

export type EvaluationCriterion = {
  id: string;
  label: string;
  description: string;
};

export type PreInterviewQuestion = {
  id: string;
  prompt: string;
  expectedSignal: string;
  maxDurationSeconds: number;
};

export type PreInterview = {
  id: string;
  jobId: string;
  status: ReviewStatus;
  questions: PreInterviewQuestion[];
  criteria: EvaluationCriterion[];
  publicToken: string;
};

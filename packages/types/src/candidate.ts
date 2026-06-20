import type {
  CandidateBriefStatus,
  RecruiterReviewStatus,
} from "./domain-spine";

export type CandidateStatus = "to_call" | "to_review" | "archived";

export type Candidate = {
  id: string;
  fullName: string;
  email: string;
  status: CandidateStatus;
  createdAt: Date;
};

export type CandidateAnswerMode = "audio" | "video" | "text";

export type CandidateAnswer = {
  questionId: string;
  mode: CandidateAnswerMode;
  transcript?: string;
  text?: string;
  mediaUrl?: string;
};

export type CandidateSubmission = {
  id: string;
  candidateId: string;
  preInterviewId: string;
  answers: CandidateAnswer[];
  submittedAt: Date;
};

export type CandidateBrief = {
  candidateSessionId: string;
  status: CandidateBriefStatus;
  summary?: string;
  strengths: string[];
  risks: string[];
  limitations: string[];
  suggestedNextStep?: RecruiterReviewStatus;
};

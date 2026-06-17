import { describe, expect, it } from "vitest";

import {
  liveInterviewEventSchema,
  liveInterviewPlanSchema,
  liveInterviewSessionSchema
} from "./live-interview";

describe("liveInterviewPlanSchema", () => {
  it("accepts a short structured live interview plan", () => {
    const result = liveInterviewPlanSchema.safeParse({
      planId: "plan_01",
      jobId: "job_01",
      roleTitle: "Customer Success Manager",
      locale: "fr-FR",
      candidateModes: ["audio", "video"],
      questions: [
        {
          id: "q_01",
          prompt: "Pouvez-vous presenter votre experience client la plus proche ?",
          category: "experience",
          expectedSignal: "Experience concrete en relation client",
          maxFollowups: 1
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  it("rejects plans with more than one follow-up per question", () => {
    const result = liveInterviewPlanSchema.safeParse({
      planId: "plan_01",
      jobId: "job_01",
      roleTitle: "Account Executive",
      candidateModes: ["audio"],
      questions: [
        {
          id: "q_01",
          prompt: "Pourquoi ce poste vous interesse aujourd'hui ?",
          maxFollowups: 2
        }
      ]
    });

    expect(result.success).toBe(false);
  });
});

describe("liveInterviewEventSchema", () => {
  it("accepts a normalized question_asked event", () => {
    const result = liveInterviewEventSchema.safeParse({
      eventId: "evt_01",
      sessionId: "session_01",
      type: "question_asked",
      sequence: 3,
      idempotencyKey: "session_01:question_asked:q_01:1",
      occurredAt: "2026-06-17T10:30:00.000Z",
      payload: {
        questionId: "q_01",
        questionIndex: 0,
        prompt: "Pouvez-vous presenter votre parcours en quelques phrases ?"
      }
    });

    expect(result.success).toBe(true);
  });

  it("rejects mismatched discriminated event payloads", () => {
    const result = liveInterviewEventSchema.safeParse({
      eventId: "evt_01",
      sessionId: "session_01",
      type: "session_failed",
      sequence: 7,
      idempotencyKey: "session_01:failed:provider_timeout",
      occurredAt: "2026-06-17T10:30:00.000Z",
      payload: {
        questionId: "q_01",
        questionIndex: 0,
        prompt: "This payload belongs to question_asked."
      }
    });

    expect(result.success).toBe(false);
  });
});

describe("liveInterviewSessionSchema", () => {
  it("accepts an agent_joining session state", () => {
    const result = liveInterviewSessionSchema.safeParse({
      sessionId: "session_01",
      candidateId: "candidate_01",
      planId: "plan_01",
      status: "agent_joining",
      livekitRoomName: "prelude-session-01",
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: "2026-06-17T10:01:00.000Z"
    });

    expect(result.success).toBe(true);
  });
});

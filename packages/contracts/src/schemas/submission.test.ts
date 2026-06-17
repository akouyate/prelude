import { describe, expect, it } from "vitest";

import { candidateSubmissionSchema } from "./submission";

describe("candidateSubmissionSchema", () => {
  it("accepts a valid text submission", () => {
    const result = candidateSubmissionSchema.safeParse({
      token: "demo-token",
      candidate: {
        fullName: "Camille Martin",
        email: "camille@example.com"
      },
      answers: [
        {
          questionId: "q1",
          mode: "text",
          text: "I handled a similar support escalation last quarter."
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid candidate email", () => {
    const result = candidateSubmissionSchema.safeParse({
      token: "demo-token",
      candidate: {
        fullName: "Camille Martin",
        email: "not-an-email"
      },
      answers: [
        {
          questionId: "q1",
          mode: "text",
          text: "Answer"
        }
      ]
    });

    expect(result.success).toBe(false);
  });
});

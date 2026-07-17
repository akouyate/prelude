import { describe, expect, it } from "vitest";

import {
  defaultWorkspaceNotificationPreferences,
  readWorkspaceNotificationPreferences,
} from "./preferences";

describe("workspace notification preferences", () => {
  it("keeps the legacy interview-completed preference during the rename", () => {
    expect(
      readWorkspaceNotificationPreferences({
        notifications: { interviewCompleted: false },
      }),
    ).toMatchObject({ candidateCompletionConfirmation: false });
  });

  it("uses explicit V1 preferences while safely defaulting unrelated values", () => {
    expect(
      readWorkspaceNotificationPreferences({
        notifications: {
          candidateCompletionConfirmation: false,
          screensReadyForReview: false,
        },
      }),
    ).toEqual({
      ...defaultWorkspaceNotificationPreferences,
      candidateCompletionConfirmation: false,
      screensReadyForReview: false,
    });
  });
});

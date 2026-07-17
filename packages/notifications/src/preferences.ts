export type WorkspaceNotificationPreferences = {
  candidateCompletionConfirmation: boolean;
  mentionsAndComments: boolean;
  productUpdates: boolean;
  screensReadyForReview: boolean;
  weeklyDigest: boolean;
};

export const defaultWorkspaceNotificationPreferences: WorkspaceNotificationPreferences =
  {
    candidateCompletionConfirmation: true,
    mentionsAndComments: true,
    productUpdates: false,
    screensReadyForReview: true,
    weeklyDigest: false,
  };

export function readWorkspaceNotificationPreferences(
  input: unknown,
): WorkspaceNotificationPreferences {
  const root = isRecord(input) ? input : {};
  const notifications = isRecord(root.notifications) ? root.notifications : {};

  return {
    candidateCompletionConfirmation: readBoolean(
      notifications.candidateCompletionConfirmation,
      // Keep existing workspace data functional after the setting was renamed.
      readBoolean(
        notifications.interviewCompleted,
        defaultWorkspaceNotificationPreferences.candidateCompletionConfirmation,
      ),
    ),
    mentionsAndComments: readBoolean(
      notifications.mentionsAndComments,
      defaultWorkspaceNotificationPreferences.mentionsAndComments,
    ),
    productUpdates: readBoolean(
      notifications.productUpdates,
      defaultWorkspaceNotificationPreferences.productUpdates,
    ),
    screensReadyForReview: readBoolean(
      notifications.screensReadyForReview,
      defaultWorkspaceNotificationPreferences.screensReadyForReview,
    ),
    weeklyDigest: readBoolean(
      notifications.weeklyDigest,
      defaultWorkspaceNotificationPreferences.weeklyDigest,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export {
  createNotificationEmailProviderFromEnv,
  getNotificationProviderConfig,
  NotificationProviderError,
  type NotificationEmailMessage,
  type NotificationEmailProvider,
  type NotificationEmailSendResult,
} from "./email-provider";
export {
  createNotificationDispatcher,
  notificationEventTypes,
  type NotificationDispatchOutcome,
  type NotificationEventType,
} from "./notification-service";
export {
  CandidateInterviewCompletedEmail,
  RecruiterBriefNeedsAttentionEmail,
  RecruiterBriefReadyEmail,
} from "./templates";

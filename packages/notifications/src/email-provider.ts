import type { ReactNode } from "react";
import { Resend } from "resend";

export type NotificationEmailMessage = {
  idempotencyKey: string;
  react: ReactNode;
  subject: string;
  tags: Array<{ name: string; value: string }>;
  text: string;
  to: string;
};

export type NotificationEmailProvider = {
  name: "disabled" | "resend";
  send: (
    message: NotificationEmailMessage,
  ) => Promise<NotificationEmailSendResult>;
};

export type NotificationEmailSendResult =
  | {
      providerMessageId: string;
      status: "sent";
    }
  | {
      reason: "notifications_disabled" | "provider_misconfigured";
      status: "skipped";
    };

export class NotificationProviderError extends Error {
  constructor(
    readonly code: string,
    message = "The email provider rejected the notification.",
  ) {
    super(message);
    this.name = "NotificationProviderError";
  }
}

type NotificationProviderConfig =
  | {
      apiKey: string;
      fromEmail: string;
      status: "ready";
    }
  | {
      reason: "notifications_disabled" | "provider_misconfigured";
      status: "disabled";
    };

export function createNotificationEmailProviderFromEnv(
  source: Record<string, string | undefined> = process.env,
): NotificationEmailProvider {
  const config = getNotificationProviderConfig(source);

  if (config.status === "disabled") {
    return {
      name: "disabled",
      send: async () => ({ reason: config.reason, status: "skipped" }),
    };
  }

  const resend = new Resend(config.apiKey);

  return {
    name: "resend",
    send: async (message) => {
      const { data, error } = await resend.emails.send(
        {
          from: config.fromEmail,
          react: message.react,
          subject: message.subject,
          tags: message.tags,
          text: message.text,
          to: message.to,
        },
        { idempotencyKey: message.idempotencyKey },
      );

      if (error) {
        throw new NotificationProviderError(
          error.name || "resend_error",
          "The email provider rejected the notification.",
        );
      }

      if (!data?.id) {
        throw new NotificationProviderError("missing_message_id");
      }

      return { providerMessageId: data.id, status: "sent" };
    },
  };
}

export function getNotificationProviderConfig(
  source: Record<string, string | undefined> = process.env,
): NotificationProviderConfig {
  if (source.NOTIFICATIONS_ENABLED?.trim() !== "1") {
    return { reason: "notifications_disabled", status: "disabled" };
  }

  const apiKey = source.RESEND_API_KEY?.trim();
  const fromEmail = source.RESEND_FROM_EMAIL?.trim();

  if (!apiKey || !fromEmail) {
    return { reason: "provider_misconfigured", status: "disabled" };
  }

  return { apiKey, fromEmail, status: "ready" };
}

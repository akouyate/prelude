import { describe, expect, it } from "vitest";

import { getNotificationProviderConfig } from "./email-provider";

describe("notification provider configuration", () => {
  it("is explicitly disabled unless notification delivery is enabled", () => {
    expect(getNotificationProviderConfig({})).toEqual({
      reason: "notifications_disabled",
      status: "disabled",
    });
  });

  it("requires both Resend secrets when enabled", () => {
    expect(
      getNotificationProviderConfig({ NOTIFICATIONS_ENABLED: "1" }),
    ).toEqual({ reason: "provider_misconfigured", status: "disabled" });
  });

  it("returns the server-only Resend configuration when complete", () => {
    expect(
      getNotificationProviderConfig({
        NOTIFICATIONS_ENABLED: "1",
        RESEND_API_KEY: "re_test",
        RESEND_FROM_EMAIL: "Prelude <notifications@prelude.ai>",
      }),
    ).toEqual({
      apiKey: "re_test",
      fromEmail: "Prelude <notifications@prelude.ai>",
      status: "ready",
    });
  });
});

import type { WorkspaceSettingsData } from "./settings-types";

export type BillingState = WorkspaceSettingsData["billing"]["state"];

export function usagePercentage(usage: number, limit: number | null) {
  if (limit === null) {
    return null;
  }

  if (limit <= 0) {
    return usage > 0 ? 100 : 0;
  }

  return Math.min(Math.max((usage / limit) * 100, 0), 100);
}

export function billingStateTranslationKey(state: BillingState) {
  return `settings.billing.states.${state}` as const;
}

export function billingStateDescriptionKey(state: BillingState) {
  if (state === "canceled") {
    return "settings.billing.canceledDescription" as const;
  }
  if (state === "past_due") {
    return "settings.billing.pastDueDescription" as const;
  }
  if (state === "unavailable") {
    return "settings.billing.unavailableDescription" as const;
  }

  return "settings.billing.description" as const;
}

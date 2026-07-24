export type WorkspacePlanEntitlements = {
  activeRoleLimit: number;
  candidateInterviewLimit: number;
  recording: boolean;
};

export const workspacePlanCatalog = {
  free: {
    activeRoleLimit: 1,
    candidateInterviewLimit: 5,
    recording: false,
  },
  unknown: {
    activeRoleLimit: 0,
    candidateInterviewLimit: 0,
    recording: false,
  },
  v1_workspace: {
    activeRoleLimit: 25,
    candidateInterviewLimit: 250,
    recording: true,
  },
} as const satisfies Record<string, WorkspacePlanEntitlements>;

export type WorkspacePlanKey = keyof typeof workspacePlanCatalog;
export type WorkspaceBillingState =
  | "active"
  | "canceled"
  | "free"
  | "past_due"
  | "trialing"
  | "unavailable"
  | "unconfigured";
export type WorkspaceBillingFeature =
  | "candidate_interviews"
  | "published_roles"
  | "recording";
export type BillingSubscriptionStatus =
  | "abandoned"
  | "active"
  | "canceled"
  | "ended"
  | "expired"
  | "incomplete"
  | "past_due"
  | "upcoming";

export type BillingSubscriptionSnapshot = {
  id: string;
  items: BillingSubscriptionItemSnapshot[];
  status: BillingSubscriptionStatus;
  updatedAt: Date;
};

export type BillingSubscriptionItemSnapshot = {
  id: string;
  isDefault: boolean;
  isFreeTrial: boolean;
  periodEnd: Date | null;
  periodStart: Date | null;
  planId: string | null;
  planName: string | null;
  planSlug: string | null;
  status: BillingSubscriptionStatus;
  updatedAt: Date;
};

export type WorkspaceBilling = {
  accessAllowed: boolean;
  entitlements: WorkspacePlanEntitlements;
  isFreeTrial: boolean;
  periodEnd: Date | null;
  periodStart: Date | null;
  planId: string | null;
  planKey: WorkspacePlanKey;
  planName: string;
  planSlug: string | null;
  sourceUpdatedAt: Date;
  state: WorkspaceBillingState;
  subscriptionId: string | null;
  subscriptionItemId: string | null;
  subscriptionItemStatus: string | null;
  subscriptionStatus: string | null;
};

export type WorkspaceEntitlementDecision =
  | {
      allowed: true;
      limit: number | null;
      usage: number;
    }
  | {
      allowed: false;
      code:
        | "billing_unavailable"
        | "feature_not_in_plan"
        | "usage_limit_reached";
      limit: number | null;
      usage: number;
    };

export type BillingUsagePeriod = {
  end: Date;
  start: Date;
};

export function normalizeBillingSubscription(
  subscription: BillingSubscriptionSnapshot | null,
  {
    now,
    paidPlanSlug,
  }: {
    now: Date;
    paidPlanSlug: string;
  },
): WorkspaceBilling {
  if (!subscription) {
    return unavailableBilling(now);
  }

  const paidCandidate = newestItem(
    subscription.items.filter((item) => item.planSlug === paidPlanSlug),
  );
  const paidItem =
    paidCandidate && itemCanRemainEffective(paidCandidate, now)
      ? paidCandidate
      : undefined;
  const defaultItem = newestItem(
    subscription.items.filter((item) => item.isDefault),
  );
  const selected = paidItem ?? defaultItem;

  if (!selected) {
    return unavailableBilling(subscription.updatedAt, {
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
    });
  }

  const planKey: WorkspacePlanKey = paidItem
    ? "v1_workspace"
    : selected.isDefault
      ? "free"
      : "unknown";
  const canceledStillEffective =
    selected.status === "canceled" &&
    Boolean(selected.periodEnd && selected.periodEnd > now);
  const active =
    selected.status === "active" ||
    canceledStillEffective ||
    (selected.status === "upcoming" &&
      Boolean(selected.periodStart && selected.periodStart <= now));
  const state: WorkspaceBillingState =
    selected.status === "past_due" || subscription.status === "past_due"
      ? "past_due"
      : canceledStillEffective
        ? "canceled"
        : active && selected.isFreeTrial
          ? "trialing"
          : active && planKey === "free"
            ? "free"
            : active && planKey === "v1_workspace"
              ? "active"
              : "unavailable";
  const accessAllowed =
    planKey !== "unknown" &&
    (state === "active" ||
      state === "canceled" ||
      state === "free" ||
      state === "trialing");

  return {
    accessAllowed,
    entitlements: accessAllowed
      ? workspacePlanCatalog[planKey]
      : workspacePlanCatalog.unknown,
    isFreeTrial: selected.isFreeTrial,
    periodEnd: selected.periodEnd,
    periodStart: selected.periodStart,
    planId: selected.planId,
    planKey,
    planName:
      selected.planName ?? (planKey === "free" ? "Free" : "V1 Workspace"),
    planSlug: selected.planSlug,
    sourceUpdatedAt:
      selected.updatedAt > subscription.updatedAt
        ? selected.updatedAt
        : subscription.updatedAt,
    state,
    subscriptionId: subscription.id,
    subscriptionItemId: selected.id,
    subscriptionItemStatus: selected.status,
    subscriptionStatus: subscription.status,
  };
}

export function unconfiguredBilling(now: Date): WorkspaceBilling {
  return {
    accessAllowed: true,
    entitlements: {
      activeRoleLimit: Number.MAX_SAFE_INTEGER,
      candidateInterviewLimit: Number.MAX_SAFE_INTEGER,
      recording: true,
    },
    isFreeTrial: false,
    periodEnd: null,
    periodStart: null,
    planId: null,
    planKey: "unknown",
    planName: "Billing not configured",
    planSlug: null,
    sourceUpdatedAt: now,
    state: "unconfigured",
    subscriptionId: null,
    subscriptionItemId: null,
    subscriptionItemStatus: null,
    subscriptionStatus: null,
  };
}

export function unavailableBilling(
  now: Date,
  overrides: Partial<WorkspaceBilling> = {},
): WorkspaceBilling {
  return {
    accessAllowed: false,
    entitlements: workspacePlanCatalog.unknown,
    isFreeTrial: false,
    periodEnd: null,
    periodStart: null,
    planId: null,
    planKey: "unknown",
    planName: "Billing unavailable",
    planSlug: null,
    sourceUpdatedAt: now,
    state: "unavailable",
    subscriptionId: null,
    subscriptionItemId: null,
    subscriptionItemStatus: null,
    subscriptionStatus: null,
    ...overrides,
  };
}

export function resolveBillingRuntime({
  appEnv,
  billingEnabled,
}: {
  appEnv?: string;
  billingEnabled: boolean;
}): "configured" | "unavailable" | "unconfigured" {
  if (billingEnabled) {
    return "configured";
  }

  return appEnv === "production" ? "unavailable" : "unconfigured";
}

export function evaluateWorkspaceEntitlement({
  billing,
  feature,
  usage,
}: {
  billing: WorkspaceBilling;
  feature: WorkspaceBillingFeature;
  usage: number;
}): WorkspaceEntitlementDecision {
  if (billing.state === "unconfigured") {
    return { allowed: true, limit: null, usage };
  }

  if (!billing.accessAllowed) {
    return {
      allowed: false,
      code: "billing_unavailable",
      limit: limitFor(billing, feature),
      usage,
    };
  }

  if (feature === "recording") {
    return billing.entitlements.recording
      ? { allowed: true, limit: null, usage }
      : {
          allowed: false,
          code: "feature_not_in_plan",
          limit: null,
          usage,
        };
  }

  const limit = limitFor(billing, feature);
  if (limit !== null && usage >= limit) {
    return {
      allowed: false,
      code: "usage_limit_reached",
      limit,
      usage,
    };
  }

  return { allowed: true, limit, usage };
}

export function resolveBillingUsagePeriod(
  billing: Pick<WorkspaceBilling, "periodEnd" | "periodStart">,
  now: Date,
): BillingUsagePeriod {
  if (billing.periodStart && billing.periodEnd) {
    return { end: billing.periodEnd, start: billing.periodStart };
  }

  return {
    end: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    ),
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };
}

function limitFor(billing: WorkspaceBilling, feature: WorkspaceBillingFeature) {
  if (billing.state === "unconfigured" || feature === "recording") {
    return null;
  }

  return feature === "published_roles"
    ? billing.entitlements.activeRoleLimit
    : billing.entitlements.candidateInterviewLimit;
}

function newestItem(items: BillingSubscriptionItemSnapshot[]) {
  return [...items].sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  )[0];
}

function itemCanRemainEffective(
  item: BillingSubscriptionItemSnapshot,
  now: Date,
) {
  if (
    item.status === "active" ||
    item.status === "past_due"
  ) {
    return true;
  }

  if (item.status === "upcoming") {
    return Boolean(item.periodStart && item.periodStart <= now);
  }

  return (
    item.status === "canceled" &&
    Boolean(item.periodEnd && item.periodEnd > now)
  );
}

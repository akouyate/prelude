import type {
  BillingSubscriptionSnapshot,
  BillingSubscriptionStatus,
} from "./billing-policy";

type ClerkBillingPlan = {
  id: string;
  isDefault: boolean;
  name: string;
  slug: string;
};

export type ClerkBillingSubscription = {
  id: string;
  status: BillingSubscriptionStatus;
  subscriptionItems: Array<{
    id: string;
    isFreeTrial?: boolean;
    periodEnd: number | null;
    periodStart: number;
    plan: ClerkBillingPlan | null;
    planId: string | null;
    status: BillingSubscriptionStatus;
    updatedAt: number;
  }>;
  updatedAt: number;
};

/**
 * Adapts Clerk's beta Billing resource to the provider-neutral subscription
 * shape used by the policy and projection. Payment fields intentionally never
 * cross this boundary.
 */
export function mapClerkBillingSubscription(
  subscription: ClerkBillingSubscription,
): BillingSubscriptionSnapshot {
  return {
    id: subscription.id,
    items: subscription.subscriptionItems.map((item) => ({
      id: item.id,
      isDefault: item.plan?.isDefault ?? false,
      isFreeTrial: item.isFreeTrial ?? false,
      periodEnd: item.periodEnd === null ? null : new Date(item.periodEnd),
      periodStart: new Date(item.periodStart),
      planId: item.planId ?? item.plan?.id ?? null,
      planName: item.plan?.name ?? null,
      planSlug: item.plan?.slug ?? null,
      status: item.status,
      updatedAt: new Date(item.updatedAt),
    })),
    status: subscription.status,
    updatedAt: new Date(subscription.updatedAt),
  };
}

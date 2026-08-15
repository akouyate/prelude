export {
  evaluateWorkspaceEntitlement,
  normalizeBillingSubscription,
  resolveBillingUsagePeriod,
  resolveBillingRuntime,
  unavailableBilling,
  unconfiguredBilling,
  workspacePlanCatalog,
  type BillingSubscriptionItemSnapshot,
  type BillingSubscriptionSnapshot,
  type BillingSubscriptionStatus,
  type BillingUsagePeriod,
  type WorkspaceBilling,
  type WorkspaceBillingFeature,
  type WorkspaceBillingState,
  type WorkspaceEntitlementDecision,
  type WorkspacePlanKey,
  type WorkspacePlanEntitlements,
} from "./billing-policy";
export { isCreditBillingEnabled } from "./credit-billing-flag";
export {
  constructStripeEvent,
  getStripeClient,
  isStripePurchaseConfigured,
  MissingStripeConfigError,
  MissingStripeWebhookSecretError,
} from "./stripe-client";
export {
  captureReservationForSession,
  ensureWallet,
  expireDueLots,
  // The three money-EXIT transitions are NOT re-exported (`freezeLotForDispute`,
  // `resolveDisputeOnLot`, `revokeUnconsumedLot`), for the same reason
  // `grantPurchasedCreditLot` is not: the webhook handlers are the named boundary
  // for turning a Stripe fact into a ledger move, and nothing outside this package
  // may revoke credits without passing the identification and status guards they
  // apply. They stay exported from `./credit-ledger` for intra-package use.
  // `grantPurchasedCreditLot` is deliberately NOT re-exported: `fulfillPaidPaymentIntent`
  // is the named boundary for turning money into credits, and no package outside
  // this one may reach the ledger without passing the fulfilment cross-checks.
  // It stays exported from `./credit-ledger` for intra-package use and its db tests.
  reconcileWallet,
  releaseExpiredReservations,
  releaseReservationForSession,
  reserveCreditForSession,
  FIRST_FIVE_CREDITS,
  FIRST_FIVE_EXPIRY_DAYS,
  PAID_CREDIT_EXPIRY_DAYS,
  RESERVATION_TTL_HOURS,
  CreditReservationOrganizationMismatchError,
  InvalidCreditPurchaseAmountError,
  MissingCreditWalletError,
  UnknownCreditLotKindError,
  type CaptureReservationResult,
  type CreditLotAdjustmentResult,
  type GrantPurchasedCreditLotInput,
  type GrantPurchasedCreditLotResult,
  type ReleaseReservationResult,
  type ReserveCreditResult,
  type WalletReconciliation,
} from "./credit-ledger";
export {
  handleDisputeEvent,
  handleRefundEvent,
  type DisputeFreezeNotifier,
  type StripeDisputeHandlerDeps,
  type StripeRefundClient,
  type StripeRefundHandlerDeps,
} from "./stripe-refunds";
export {
  fulfillCreditCheckout,
  fulfillPaidPaymentIntent,
  type CreditCheckoutFulfilment,
  type StripeFulfilmentClient,
} from "./stripe-fulfilment";
export {
  handleStripeWebhookEvent,
  refundAndDisputeEventTypes,
  reprocessIgnoredStripeEvents,
  type StripeEventReprocessReport,
  type StripeWebhookDeps,
  type StripeWebhookStatus,
} from "./stripe-webhook";
export {
  createCreditCheckoutSession,
  ensureStripeCustomer,
  MissingCheckoutSessionUrlError,
  SUPPORTED_CREDIT_CURRENCIES,
  UnsupportedCreditCurrencyError,
  type CreditCheckoutResult,
  type StripePurchaseClient,
} from "./stripe-purchase";

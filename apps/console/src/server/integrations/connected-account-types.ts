import type { Prisma } from "@prelude/db";

export const connectedAccountProviderGoogle = "google" as const;
export const connectedAccountCapabilityCalendar = "calendar" as const;

export const connectedAccountStatusValues = [
  "not_connected",
  "connecting",
  "connected",
  "expired",
  "needs_reconnect",
  "revoked",
  "error",
] as const;

export type ConnectedAccountProviderId = typeof connectedAccountProviderGoogle;
export type ConnectedAccountCapability =
  typeof connectedAccountCapabilityCalendar;
export type ConnectedAccountStatus =
  (typeof connectedAccountStatusValues)[number];

export type ConnectedAccountSummary = {
  capabilities: ConnectedAccountCapability[];
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  externalAccountEmail: string | null;
  externalAccountId: string | null;
  id: string;
  provider: ConnectedAccountProviderId;
  scopes: string[];
  status: ConnectedAccountStatus;
};

type ConnectedAccountLike = {
  accessTokenCiphertext?: string | null;
  accessTokenExpiresAt?: Date | null;
  capabilities: Prisma.JsonValue;
  connectedAt?: Date | null;
  disconnectedAt?: Date | null;
  externalAccountEmail?: string | null;
  externalAccountId?: string | null;
  id: string;
  provider: string;
  refreshTokenCiphertext?: string | null;
  scopes: Prisma.JsonValue;
  status: string;
};

export function toConnectedAccountSummary(
  account: ConnectedAccountLike,
  now = new Date(),
): ConnectedAccountSummary {
  return {
    capabilities: readCapabilities(account.capabilities),
    connectedAt: account.connectedAt ?? null,
    disconnectedAt: account.disconnectedAt ?? null,
    externalAccountEmail: account.externalAccountEmail ?? null,
    externalAccountId: account.externalAccountId ?? null,
    id: account.id,
    provider: readProvider(account.provider),
    scopes: readStringArray(account.scopes),
    status: resolveConnectedAccountStatus(account, now),
  };
}

export function resolveConnectedAccountStatus(
  account: Pick<
    ConnectedAccountLike,
    "accessTokenExpiresAt" | "refreshTokenCiphertext" | "status"
  > | null,
  now = new Date(),
): ConnectedAccountStatus {
  if (!account) {
    return "not_connected";
  }

  const persistedStatus = normalizeConnectedAccountStatus(account.status);
  if (
    persistedStatus === "error" ||
    persistedStatus === "needs_reconnect" ||
    persistedStatus === "revoked"
  ) {
    return persistedStatus;
  }

  if (
    account.accessTokenExpiresAt &&
    account.accessTokenExpiresAt.getTime() <= now.getTime() &&
    !account.refreshTokenCiphertext
  ) {
    return "expired";
  }

  return persistedStatus;
}

export function getCapabilityStatus(
  account: ConnectedAccountLike | null,
  capability: ConnectedAccountCapability,
  now = new Date(),
): ConnectedAccountStatus {
  if (!account) {
    return "not_connected";
  }

  const status = resolveConnectedAccountStatus(account, now);
  if (status !== "connected") {
    return status;
  }

  return readCapabilities(account.capabilities).includes(capability)
    ? "connected"
    : "not_connected";
}

export function readStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function readCapabilities(
  value: Prisma.JsonValue,
): ConnectedAccountCapability[] {
  return readStringArray(value).filter(
    (item): item is ConnectedAccountCapability =>
      item === connectedAccountCapabilityCalendar,
  );
}

function readProvider(value: string): ConnectedAccountProviderId {
  return value === connectedAccountProviderGoogle
    ? connectedAccountProviderGoogle
    : connectedAccountProviderGoogle;
}

function normalizeConnectedAccountStatus(
  status: string,
): ConnectedAccountStatus {
  return connectedAccountStatusValues.includes(status as ConnectedAccountStatus)
    ? (status as ConnectedAccountStatus)
    : "error";
}

export function mergeUniqueStrings(...sets: string[][]) {
  return Array.from(new Set(sets.flat().filter(Boolean)));
}

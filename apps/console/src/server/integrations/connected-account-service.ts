import "server-only";

import { prisma } from "@prelude/db";

import {
  decryptConnectedAccountSecret,
  encryptConnectedAccountSecret,
  safeOAuthErrorMessage,
} from "./connected-account-crypto";
import {
  ConnectedAccountProviderError,
  type ConnectedAccountProvider,
} from "./connected-account-provider";
import {
  createConnectedAccountOAuthState,
  verifyConnectedAccountOAuthState,
} from "./connected-account-oauth-state";
import {
  connectedAccountCapabilityCalendar,
  connectedAccountProviderGoogle,
  getCapabilityStatus,
  mergeUniqueStrings,
  readStringArray,
  toConnectedAccountSummary,
  type ConnectedAccountCapability,
  type ConnectedAccountProviderId,
  type ConnectedAccountStatus,
  type ConnectedAccountSummary,
} from "./connected-account-types";
import {
  createGoogleConnectedAccountProvider,
  googleScopesForCapability,
} from "./google-connected-account-provider";
import {
  getGoogleOAuthConfig,
  type GoogleOAuthConfig,
} from "./google-oauth-config";
import { getConsoleAuthIdentity } from "../auth/console-auth-provider";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

type OAuthStartResult =
  | { ok: true; url: string }
  | { ok: false; reason: "missing_config" | "unauthorized" };

type OAuthCallbackResult =
  | { ok: true; returnTo: string }
  | {
      ok: false;
      reason:
        | "access_denied"
        | "missing_config"
        | "provider_error"
        | "state_mismatch"
        | "unauthorized";
      returnTo: string;
    };

type DisconnectResult = { ok: true; status: "disconnected" };

export type GoogleCalendarConnection =
  | {
      accessToken: string;
      accountId: string;
      accountLabel: string | null;
      ok: true;
    }
  | { ok: false; status: ConnectedAccountStatus };

export async function createGoogleCalendarAuthorizationUrl(input?: {
  returnTo?: string;
}): Promise<OAuthStartResult> {
  const [identity, scope] = await Promise.all([
    getConsoleAuthIdentity(),
    getCompletedOrganizationScope(),
  ]);

  if (!identity.ok) {
    return { ok: false, reason: "unauthorized" };
  }

  const config = getGoogleOAuthConfig();
  if (!config.ok) {
    return { ok: false, reason: config.error };
  }

  const provider = createProvider(config);
  const state = createConnectedAccountOAuthState({
    capability: connectedAccountCapabilityCalendar,
    organizationId: scope.organizationId,
    provider: connectedAccountProviderGoogle,
    returnTo: safeCalendarReturnTo(input?.returnTo),
    userId: scope.userId,
  });

  return {
    ok: true,
    url: await provider.getAuthorizationUrl({
      capability: connectedAccountCapabilityCalendar,
      loginHint: identity.value.userEmail,
      state,
    }),
  };
}

export async function completeGoogleOAuthCallback(input: {
  code: string | null;
  error: string | null;
  state: string | null;
}): Promise<OAuthCallbackResult> {
  if (input.error) {
    return {
      ok: false,
      reason: "access_denied",
      returnTo: "/settings?view=integrations",
    };
  }

  if (!input.code || !input.state) {
    return {
      ok: false,
      reason: "provider_error",
      returnTo: "/settings?view=integrations",
    };
  }

  let state;
  try {
    state = verifyConnectedAccountOAuthState(input.state);
  } catch {
    return {
      ok: false,
      reason: "state_mismatch",
      returnTo: "/settings?view=integrations",
    };
  }

  const scope = await getCompletedOrganizationScope();
  if (
    scope.organizationId !== state.organizationId ||
    scope.userId !== state.userId
  ) {
    return { ok: false, reason: "state_mismatch", returnTo: state.returnTo };
  }

  const config = getGoogleOAuthConfig();
  if (!config.ok) {
    return { ok: false, reason: config.error, returnTo: state.returnTo };
  }

  try {
    await connectGoogleAccount({
      capability: state.capability,
      code: input.code,
      config,
      organizationId: state.organizationId,
      userId: state.userId,
    });
  } catch {
    return { ok: false, reason: "provider_error", returnTo: state.returnTo };
  }

  return { ok: true, returnTo: state.returnTo };
}

export async function disconnectGoogleCalendarAccount(): Promise<DisconnectResult> {
  const scope = await getCompletedOrganizationScope();
  const config = getGoogleOAuthConfig();
  const account = await prisma.connectedAccount.findUnique({
    where: {
      organizationId_userId_provider: {
        organizationId: scope.organizationId,
        provider: connectedAccountProviderGoogle,
        userId: scope.userId,
      },
    },
  });

  if (!account) {
    return { ok: true, status: "disconnected" };
  }

  let revokeError: string | null = null;
  if (config.ok) {
    const provider = createProvider(config);
    const token =
      account.refreshTokenCiphertext ?? account.accessTokenCiphertext;
    if (token) {
      try {
        await provider.revokeConnection({
          token: decryptConnectedAccountSecret(token),
        });
      } catch (error) {
        revokeError = safeOAuthErrorMessage(error);
      }
    }
  } else {
    revokeError = config.error;
  }

  await prisma.connectedAccount.update({
    data: {
      accessTokenCiphertext: null,
      accessTokenExpiresAt: null,
      capabilities: [],
      disconnectedAt: new Date(),
      lastRefreshError: revokeError,
      refreshTokenCiphertext: null,
      scopes: [],
      status: "revoked",
    },
    where: { id: account.id },
  });

  return { ok: true, status: "disconnected" };
}

export async function refreshConnectedAccountAccessToken(connectionId: string) {
  const account = await prisma.connectedAccount.findUnique({
    where: { id: connectionId },
  });

  if (!account?.refreshTokenCiphertext) {
    if (account) {
      await markConnectionNeedsReconnect(account.id, "Missing refresh token.");
    }
    return { ok: false, status: "needs_reconnect" as ConnectedAccountStatus };
  }

  const config = getGoogleOAuthConfig();
  if (!config.ok) {
    await markConnectionNeedsReconnect(connectionId, config.error);
    return { ok: false, status: "needs_reconnect" as ConnectedAccountStatus };
  }

  const provider = createProvider(config);
  const scopes = readStringArray(account.scopes);

  try {
    const tokenSet = await provider.refreshAccessToken({
      refreshToken: decryptConnectedAccountSecret(
        account.refreshTokenCiphertext,
      ),
      scopes,
    });

    await prisma.connectedAccount.update({
      data: {
        accessTokenCiphertext: encryptConnectedAccountSecret(
          tokenSet.accessToken,
        ),
        accessTokenExpiresAt: tokenSet.expiresAt,
        lastRefreshAttemptAt: new Date(),
        lastRefreshError: null,
        refreshTokenCiphertext: tokenSet.refreshToken
          ? encryptConnectedAccountSecret(tokenSet.refreshToken)
          : account.refreshTokenCiphertext,
        scopes: mergeUniqueStrings(scopes, tokenSet.scopes),
        status: "connected",
      },
      where: { id: account.id },
    });

    return { ok: true, status: "connected" as ConnectedAccountStatus };
  } catch (error) {
    const reconnectRequired =
      error instanceof ConnectedAccountProviderError &&
      error.isReconnectRequired;
    const status: ConnectedAccountStatus = reconnectRequired
      ? "needs_reconnect"
      : "error";
    await prisma.connectedAccount.update({
      data: {
        lastRefreshAttemptAt: new Date(),
        lastRefreshError: safeOAuthErrorMessage(error),
        status,
      },
      where: { id: account.id },
    });
    return { ok: false, status };
  }
}

export async function listConnectedAccountSummaries(input: {
  organizationId: string;
  userId: string;
}): Promise<ConnectedAccountSummary[]> {
  const accounts = await prisma.connectedAccount.findMany({
    orderBy: { updatedAt: "desc" },
    where: {
      organizationId: input.organizationId,
      userId: input.userId,
    },
  });

  return accounts.map((account) => toConnectedAccountSummary(account));
}

export async function getConnectedAccountCapabilityStatus(input: {
  capability: ConnectedAccountCapability;
  organizationId: string;
  provider: ConnectedAccountProviderId;
  userId: string;
}) {
  const account = await prisma.connectedAccount.findUnique({
    where: {
      organizationId_userId_provider: {
        organizationId: input.organizationId,
        provider: input.provider,
        userId: input.userId,
      },
    },
  });

  return getCapabilityStatus(account, input.capability);
}

export async function getGoogleCalendarConnection(input: {
  forceRefresh?: boolean;
  organizationId: string;
  userId: string;
}): Promise<GoogleCalendarConnection> {
  let account = await prisma.connectedAccount.findUnique({
    where: {
      organizationId_userId_provider: {
        organizationId: input.organizationId,
        provider: connectedAccountProviderGoogle,
        userId: input.userId,
      },
    },
  });
  const status = getCapabilityStatus(
    account,
    connectedAccountCapabilityCalendar,
  );

  if (!account || status !== "connected") {
    return { ok: false, status };
  }

  const refreshSkewMs = 60_000;
  const shouldRefresh =
    input.forceRefresh ||
    !account.accessTokenCiphertext ||
    !account.accessTokenExpiresAt ||
    account.accessTokenExpiresAt.getTime() <= Date.now() + refreshSkewMs;

  if (shouldRefresh) {
    const refreshed = await refreshConnectedAccountAccessToken(account.id);
    if (!refreshed.ok) {
      return { ok: false, status: refreshed.status };
    }

    account = await prisma.connectedAccount.findUnique({
      where: { id: account.id },
    });
  }

  if (!account?.accessTokenCiphertext) {
    return { ok: false, status: "needs_reconnect" };
  }

  return {
    accessToken: decryptConnectedAccountSecret(account.accessTokenCiphertext),
    accountId: account.id,
    accountLabel: account.externalAccountEmail,
    ok: true,
  };
}

export async function markGoogleCalendarConnectionNeedsReconnect(
  connectionId: string,
) {
  await markConnectionNeedsReconnect(
    connectionId,
    "Google Calendar access token was rejected after refresh.",
  );
}

export function googleOAuthAvailable() {
  return getGoogleOAuthConfig().ok;
}

async function connectGoogleAccount(input: {
  capability: ConnectedAccountCapability;
  code: string;
  config: Extract<GoogleOAuthConfig, { ok: true }>;
  organizationId: string;
  userId: string;
}) {
  const provider = createProvider(input.config);
  const existing = await prisma.connectedAccount.findUnique({
    where: {
      organizationId_userId_provider: {
        organizationId: input.organizationId,
        provider: connectedAccountProviderGoogle,
        userId: input.userId,
      },
    },
  });
  const tokenSet = await provider.exchangeCode({
    capability: input.capability,
    code: input.code,
  });
  const userInfo = await provider.getUserInfo(tokenSet.accessToken);
  const previousCapabilities = existing
    ? readStringArray(existing.capabilities)
    : [];
  const previousScopes = existing ? readStringArray(existing.scopes) : [];
  const refreshTokenCiphertext = tokenSet.refreshToken
    ? encryptConnectedAccountSecret(tokenSet.refreshToken)
    : (existing?.refreshTokenCiphertext ?? null);
  const missingRefreshToken = !refreshTokenCiphertext;

  await prisma.connectedAccount.upsert({
    create: {
      accessTokenCiphertext: encryptConnectedAccountSecret(
        tokenSet.accessToken,
      ),
      accessTokenExpiresAt: tokenSet.expiresAt,
      capabilities: [input.capability],
      connectedAt: new Date(),
      externalAccountEmail: userInfo.email,
      externalAccountId: userInfo.externalAccountId,
      lastRefreshError: missingRefreshToken
        ? "Google did not return a refresh token."
        : null,
      organizationId: input.organizationId,
      provider: connectedAccountProviderGoogle,
      refreshTokenCiphertext,
      scopes: mergeUniqueStrings(
        googleScopesForCapability(input.capability),
        tokenSet.scopes,
      ),
      status: missingRefreshToken ? "needs_reconnect" : "connected",
      userId: input.userId,
    },
    update: {
      accessTokenCiphertext: encryptConnectedAccountSecret(
        tokenSet.accessToken,
      ),
      accessTokenExpiresAt: tokenSet.expiresAt,
      capabilities: mergeUniqueStrings(previousCapabilities, [
        input.capability,
      ]),
      connectedAt: new Date(),
      disconnectedAt: null,
      externalAccountEmail: userInfo.email,
      externalAccountId: userInfo.externalAccountId,
      lastRefreshError: missingRefreshToken
        ? "Google did not return a refresh token."
        : null,
      refreshTokenCiphertext,
      scopes: mergeUniqueStrings(
        previousScopes,
        googleScopesForCapability(input.capability),
        tokenSet.scopes,
      ),
      status: missingRefreshToken ? "needs_reconnect" : "connected",
    },
    where: {
      organizationId_userId_provider: {
        organizationId: input.organizationId,
        provider: connectedAccountProviderGoogle,
        userId: input.userId,
      },
    },
  });
}

async function markConnectionNeedsReconnect(id: string, message: string) {
  await prisma.connectedAccount.update({
    data: {
      lastRefreshAttemptAt: new Date(),
      lastRefreshError: message,
      status: "needs_reconnect",
    },
    where: { id },
  });
}

function createProvider(
  config: Extract<GoogleOAuthConfig, { ok: true }>,
): ConnectedAccountProvider {
  return createGoogleConnectedAccountProvider(config.value);
}

function safeCalendarReturnTo(value: string | undefined) {
  if (
    value &&
    (value.startsWith("/settings") || value.startsWith("/interviews/")) &&
    !value.startsWith("//")
  ) {
    return value;
  }

  return "/settings?view=integrations";
}

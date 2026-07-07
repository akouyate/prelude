import "server-only";

import { redactOAuthPayload } from "./connected-account-crypto";
import {
  ConnectedAccountProviderError,
  type ConnectedAccountProvider,
  type ConnectedAccountTokenSet,
  type ConnectedAccountUserInfo,
  type RevokeConnectionInput,
} from "./connected-account-provider";
import {
  connectedAccountCapabilityCalendar,
  connectedAccountProviderGoogle,
  type ConnectedAccountCapability,
} from "./connected-account-types";
import type { GoogleOAuthConfig } from "./google-oauth-config";

const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const revokeEndpoint = "https://oauth2.googleapis.com/revoke";
const userInfoEndpoint = "https://openidconnect.googleapis.com/v1/userinfo";

export const googleCalendarEventsScope =
  "https://www.googleapis.com/auth/calendar.events";

const googleIdentityScopes = ["openid", "email", "profile"];

type FetchLike = typeof fetch;

export function googleScopesForCapability(
  capability: ConnectedAccountCapability,
) {
  if (capability !== connectedAccountCapabilityCalendar) {
    return googleIdentityScopes;
  }

  return [...googleIdentityScopes, googleCalendarEventsScope];
}

export function createGoogleConnectedAccountProvider(
  config: Extract<GoogleOAuthConfig, { ok: true }>["value"],
  fetchImpl: FetchLike = fetch,
): ConnectedAccountProvider {
  return {
    provider: connectedAccountProviderGoogle,

    async getAuthorizationUrl(input) {
      const url = new URL(authorizationEndpoint);
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("include_granted_scopes", "true");
      if (input.loginHint) {
        url.searchParams.set("login_hint", input.loginHint);
      }
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("redirect_uri", config.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set(
        "scope",
        googleScopesForCapability(input.capability).join(" "),
      );
      url.searchParams.set("state", input.state);

      return url.toString();
    },

    async exchangeCode(input) {
      const payload = await postGoogleToken(
        fetchImpl,
        new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code: input.code,
          grant_type: "authorization_code",
          redirect_uri: config.redirectUri,
        }),
      );

      return readTokenSet(payload, googleScopesForCapability(input.capability));
    },

    async getUserInfo(accessToken) {
      const response = await fetchImpl(userInfoEndpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = await readJsonResponse(response);

      if (!response.ok) {
        throw providerError("Google userinfo request failed.", payload);
      }

      return readUserInfo(payload);
    },

    async refreshAccessToken(input) {
      const payload = await postGoogleToken(
        fetchImpl,
        new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
          refresh_token: input.refreshToken,
        }),
      );

      return readTokenSet(payload, input.scopes);
    },

    async revokeConnection(input: RevokeConnectionInput) {
      const response = await fetchImpl(revokeEndpoint, {
        body: new URLSearchParams({ token: input.token }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      });

      if (!response.ok) {
        const payload = await readJsonResponse(response);
        throw providerError("Google token revocation failed.", payload);
      }
    },
  };
}

async function postGoogleToken(fetchImpl: FetchLike, body: URLSearchParams) {
  const response = await fetchImpl(tokenEndpoint, {
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw providerError("Google token request failed.", payload);
  }

  return payload;
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { response: "non_json" };
  }
}

function readTokenSet(
  payload: Record<string, unknown>,
  fallbackScopes: string[],
): ConnectedAccountTokenSet {
  if (typeof payload.access_token !== "string") {
    throw new ConnectedAccountProviderError(
      "Google token response did not include an access token.",
      { code: "invalid_token_response", isReconnectRequired: true },
    );
  }

  return {
    accessToken: payload.access_token,
    expiresAt:
      typeof payload.expires_in === "number"
        ? new Date(Date.now() + payload.expires_in * 1000)
        : null,
    refreshToken:
      typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    scopes:
      typeof payload.scope === "string"
        ? payload.scope.split(/\s+/u).filter(Boolean)
        : fallbackScopes,
  };
}

function readUserInfo(
  payload: Record<string, unknown>,
): ConnectedAccountUserInfo {
  if (typeof payload.sub !== "string") {
    throw new ConnectedAccountProviderError(
      "Google userinfo response did not include an account id.",
      { code: "invalid_userinfo_response", isReconnectRequired: true },
    );
  }

  return {
    email: typeof payload.email === "string" ? payload.email : null,
    externalAccountId: payload.sub,
  };
}

function providerError(message: string, payload: Record<string, unknown>) {
  const redacted = JSON.stringify(redactOAuthPayload(payload));
  const code =
    typeof payload.error === "string" ? payload.error : "provider_error";

  return new ConnectedAccountProviderError(`${message} ${redacted}`, {
    code,
    isReconnectRequired: code === "invalid_grant",
  });
}

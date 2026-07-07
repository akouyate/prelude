import "server-only";

import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

import type {
  ConnectedAccountCapability,
  ConnectedAccountProviderId,
} from "./connected-account-types";

export type ConnectedAccountOAuthState = {
  capability: ConnectedAccountCapability;
  expiresAt: number;
  nonce: string;
  organizationId: string;
  provider: ConnectedAccountProviderId;
  returnTo: string;
  userId: string;
  v: 1;
};

const stateTtlMs = 10 * 60 * 1000;

export function createConnectedAccountOAuthState(input: {
  capability: ConnectedAccountCapability;
  organizationId: string;
  provider: ConnectedAccountProviderId;
  returnTo?: string;
  source?: Record<string, string | undefined>;
  userId: string;
}) {
  return signConnectedAccountOAuthState(
    {
      capability: input.capability,
      expiresAt: Date.now() + stateTtlMs,
      nonce: randomUUID(),
      organizationId: input.organizationId,
      provider: input.provider,
      returnTo: input.returnTo ?? "/settings?view=integrations",
      userId: input.userId,
      v: 1,
    },
    input.source,
  );
}

export function signConnectedAccountOAuthState(
  state: ConnectedAccountOAuthState,
  source: Record<string, string | undefined> = process.env,
) {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString(
    "base64url",
  );
  return `${payload}.${sign(payload, source)}`;
}

export function verifyConnectedAccountOAuthState(
  value: string,
  source: Record<string, string | undefined> = process.env,
) {
  const [payload, signature] = value.split(".");

  if (
    !payload ||
    !signature ||
    !constantTimeEqual(signature, sign(payload, source))
  ) {
    throw new Error("Invalid OAuth state.");
  }

  const parsed = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as Partial<ConnectedAccountOAuthState>;

  if (
    parsed.v !== 1 ||
    parsed.provider !== "google" ||
    parsed.capability !== "calendar" ||
    typeof parsed.organizationId !== "string" ||
    typeof parsed.userId !== "string" ||
    typeof parsed.returnTo !== "string" ||
    typeof parsed.expiresAt !== "number" ||
    typeof parsed.nonce !== "string"
  ) {
    throw new Error("Invalid OAuth state payload.");
  }

  if (parsed.expiresAt <= Date.now()) {
    throw new Error("OAuth state expired.");
  }

  return parsed as ConnectedAccountOAuthState;
}

function sign(
  payload: string,
  source: Record<string, string | undefined> = process.env,
) {
  return createHmac("sha256", resolveStateSecret(source))
    .update(payload)
    .digest("base64url");
}

function resolveStateSecret(source: Record<string, string | undefined>) {
  const configured =
    source.CONNECTED_ACCOUNT_STATE_SECRET ||
    source.CLERK_SECRET_KEY ||
    source.CONNECTED_ACCOUNT_ENCRYPTION_KEY;

  if (configured) {
    return configured;
  }

  if (source.NODE_ENV === "production") {
    throw new Error(
      "CONNECTED_ACCOUNT_STATE_SECRET or CLERK_SECRET_KEY is required in production.",
    );
  }

  return "prelude-local-connected-account-oauth-state-secret";
}

function constantTimeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

import {
  marketingDemoHandoffExchangeSchema,
  marketingDemoHandoffExchangeResponseSchema,
  marketingDemoRolesResponseSchema,
  marketingDemoServiceAdmissionSchema,
} from "@prelude/contracts";

function candidateOrigin() {
  const url = new URL(
    process.env.NEXT_PUBLIC_CANDIDATE_URL ?? "http://localhost:3001",
  );
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new MarketingDemoCandidateApiError(503);
  }
  if (
    (process.env.APP_ENV === "production" ||
      process.env.NODE_ENV === "production") &&
    url.protocol !== "https:"
  ) {
    // Never send the website-to-candidate bearer over plaintext in production.
    throw new MarketingDemoCandidateApiError(503);
  }
  return url.origin;
}

export async function fetchMarketingDemoRoles() {
  const response = await candidateFetch("/api/internal/marketing-demo-roles", {
    method: "GET",
  });
  if (!response.ok) {
    throw new MarketingDemoCandidateApiError(response.status);
  }
  return marketingDemoRolesResponseSchema.parse(await response.json());
}

export async function createMarketingDemoSession(input: {
  launchNonce: string;
  returnTarget: string;
  roleSlug: string;
}) {
  const body = marketingDemoServiceAdmissionSchema.parse({
    ...input,
    botProofVerified: true,
  });
  const response = await candidateFetch(
    "/api/internal/marketing-demo-sessions",
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new MarketingDemoCandidateApiError(response.status);
  }
  const payload = (await response.json()) as {
    expiresAt?: unknown;
    previewUrl?: unknown;
  };
  if (
    typeof payload.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(payload.expiresAt)) ||
    typeof payload.previewUrl !== "string"
  ) {
    throw new MarketingDemoCandidateApiError(503);
  }
  try {
    new URL(payload.previewUrl);
  } catch {
    throw new MarketingDemoCandidateApiError(503);
  }
  return { expiresAt: payload.expiresAt, previewUrl: payload.previewUrl };
}

export async function exchangeMarketingDemoHandoff(input: {
  code: string;
  returnTarget: string;
}) {
  const body = marketingDemoHandoffExchangeSchema.parse(input);
  const response = await candidateFetch(
    "/api/internal/marketing-demo-handoffs/exchange",
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new MarketingDemoCandidateApiError(response.status);
  }
  return marketingDemoHandoffExchangeResponseSchema.parse(
    await response.json(),
  );
}

async function candidateFetch(path: string, init: RequestInit) {
  const secret = process.env.MARKETING_DEMO_SERVICE_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new MarketingDemoCandidateApiError(503);
  }
  return fetch(new URL(path, candidateOrigin()), {
    ...init,
    cache: "no-store",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${secret}`,
      ...init.headers,
    },
  }).catch(() => {
    throw new MarketingDemoCandidateApiError(503);
  });
}

export class MarketingDemoCandidateApiError extends Error {
  constructor(public readonly status: number) {
    super("marketing_demo_candidate_api_failed");
    this.name = "MarketingDemoCandidateApiError";
  }
}

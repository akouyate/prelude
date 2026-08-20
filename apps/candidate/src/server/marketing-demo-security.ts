import { createHash, timingSafeEqual } from "node:crypto";

export const marketingDemoPolicy = {
  accessTtlMs: 10 * 60 * 1000,
  handoffTtlMs: 5 * 60 * 1000,
  launchNonceTtlMs: 10 * 60 * 1000,
  maxRequestBytes: 8 * 1024,
  runtimeTtlMs: 12 * 60 * 1000,
} as const;

export function digestOpaqueSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function marketingDemoHandoffEncryptionKey() {
  const configured = process.env.MARKETING_DEMO_HANDOFF_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new MarketingDemoRequestError("demo_handoff_unavailable", 503);
  }
  const key = Buffer.from(configured, "base64");
  if (key.length !== 32) {
    throw new MarketingDemoRequestError("demo_handoff_unavailable", 503);
  }
  return key;
}

export function isMarketingDemoServiceRequestAuthorized(request: Request) {
  const expected = process.env.MARKETING_DEMO_SERVICE_SECRET?.trim();
  if (!expected || Buffer.byteLength(expected, "utf8") < 32) {
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) {
    return false;
  }

  const provided = header.slice(prefix.length).trim();
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

export async function readSizeLimitedJson(
  request: Request,
  maxBytes = marketingDemoPolicy.maxRequestBytes,
): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new MarketingDemoRequestError("request_too_large", 413);
  }

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > maxBytes) {
    throw new MarketingDemoRequestError("request_too_large", 413);
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new MarketingDemoRequestError("invalid_json", 400);
  }
}

export function isAllowedMarketingDemoReturnTarget(value: string) {
  let normalized: string;
  try {
    normalized = new URL(value).toString();
  } catch {
    return false;
  }

  return allowedMarketingDemoReturnTargets().has(normalized);
}

export function allowedMarketingDemoReturnTargets() {
  const configured = (process.env.MARKETING_DEMO_RETURN_TARGETS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length === 0 && !isMarketingDemoProduction()) {
    const consoleOrigin =
      process.env.NEXT_PUBLIC_CONSOLE_URL ?? "http://localhost:3000";
    configured.push(new URL("/demo/result", consoleOrigin).toString());
  }

  return new Set(
    configured.flatMap((value) => {
      try {
        const target = new URL(value);
        if (!new Set(["http:", "https:"]).has(target.protocol)) {
          return [];
        }
        if (isMarketingDemoProduction() && target.protocol !== "https:") {
          return [];
        }
        target.hash = "";
        return [target.toString()];
      } catch {
        return [];
      }
    }),
  );
}

export function isMarketingDemoProduction() {
  return (
    process.env.APP_ENV === "production" ||
    process.env.NODE_ENV === "production"
  );
}

export class MarketingDemoRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "MarketingDemoRequestError";
  }
}

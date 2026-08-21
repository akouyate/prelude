import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import {
  MarketingDemoLeadError,
  processMarketingDemoLeadOperations,
} from "../../../../../src/server/marketing-demos/marketing-demo-leads";

const defaultLimit = 50;
const maxLimit = 200;

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return authFailure();
  }
  const limit = readLimit(request.nextUrl.searchParams);
  if (limit === null) {
    return Response.json({ error: "invalid_limit" }, { status: 400 });
  }

  try {
    return Response.json(await processMarketingDemoLeadOperations({ limit }));
  } catch (error) {
    const code =
      error instanceof MarketingDemoLeadError
        ? error.code
        : "lead_operations_failed";
    return Response.json({ error: code }, { status: 503 });
  }
}

function isAuthorized(request: NextRequest) {
  const expected = operationsSecret();
  if (!expected) {
    return false;
  }
  const header = request.headers.get("authorization")?.trim() ?? "";
  const [scheme, ...rest] = header.split(/\s+/u);
  if (scheme?.toLowerCase() !== "bearer") {
    return false;
  }
  const presented = Buffer.from(rest.join(" "), "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    presented.length === expectedBytes.length &&
    timingSafeEqual(presented, expectedBytes)
  );
}

function authFailure() {
  const configured = operationsSecret() !== null;
  return Response.json(
    {
      error: configured ? "unauthorized" : "lead_operations_not_configured",
    },
    {
      status: configured ? 401 : 503,
    },
  );
}

function operationsSecret() {
  const secret = process.env.MARKETING_DEMO_LEAD_OPERATIONS_SECRET?.trim();
  return secret && Buffer.byteLength(secret, "utf8") >= 32 ? secret : null;
}

function readLimit(params: URLSearchParams) {
  const raw = params.get("limit");
  if (raw === null) {
    return defaultLimit;
  }
  if (!/^\d+$/u.test(raw.trim())) {
    return null;
  }
  const limit = Number(raw);
  return limit >= 1 && limit <= maxLimit ? limit : null;
}

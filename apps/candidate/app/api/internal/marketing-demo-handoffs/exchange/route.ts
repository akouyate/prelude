import { marketingDemoHandoffExchangeSchema } from "@prelude/contracts";
import { NextResponse } from "next/server";

import { exchangeMarketingDemoHandoff } from "../../../../../src/server/marketing-demo-handoffs";
import {
  MarketingDemoRequestError,
  isMarketingDemoServiceRequestAuthorized,
  readSizeLimitedJson,
} from "../../../../../src/server/marketing-demo-security";

export async function POST(request: Request) {
  if (!isMarketingDemoServiceRequestAuthorized(request)) {
    return response({ error: { code: "unauthorized" } }, 401);
  }
  let body: unknown;
  try {
    body = await readSizeLimitedJson(request);
  } catch (error) {
    if (error instanceof MarketingDemoRequestError) {
      return response({ error: { code: error.code } }, error.status);
    }
    return response({ error: { code: "invalid_json" } }, 400);
  }
  const parsed = marketingDemoHandoffExchangeSchema.safeParse(body);
  if (!parsed.success) {
    return response({ error: { code: "invalid_handoff_request" } }, 400);
  }

  try {
    return response(await exchangeMarketingDemoHandoff(parsed.data), 200);
  } catch (error) {
    if (error instanceof MarketingDemoRequestError) {
      return response({ error: { code: error.code } }, error.status);
    }
    return response({ error: { code: "handoff_unavailable" } }, 503);
  }
}

function response(body: unknown, status: number) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
    },
    status,
  });
}

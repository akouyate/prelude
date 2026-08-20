import { marketingDemoServiceAdmissionSchema } from "@prelude/contracts";
import { NextResponse } from "next/server";

import { createMarketingDemoPreview } from "../../../../src/server/marketing-demo-admission";
import {
  MarketingDemoRequestError,
  isMarketingDemoServiceRequestAuthorized,
  readSizeLimitedJson,
} from "../../../../src/server/marketing-demo-security";

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

  const parsed = marketingDemoServiceAdmissionSchema.safeParse(body);
  if (!parsed.success) {
    return response({ error: { code: "invalid_demo_request" } }, 400);
  }

  try {
    const preview = await createMarketingDemoPreview(parsed.data);
    return response(preview, 201);
  } catch (error) {
    if (error instanceof MarketingDemoRequestError) {
      return response({ error: { code: error.code } }, error.status);
    }
    return response({ error: { code: "demo_controls_unavailable" } }, 503);
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

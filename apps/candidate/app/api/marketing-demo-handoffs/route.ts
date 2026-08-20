import { marketingDemoHandoffSubmissionSchema } from "@prelude/contracts";
import { NextResponse } from "next/server";

import { createMarketingDemoHandoff } from "../../../src/server/marketing-demo-handoffs";
import {
  MarketingDemoRequestError,
  readSizeLimitedJson,
} from "../../../src/server/marketing-demo-security";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await readSizeLimitedJson(request);
  } catch (error) {
    if (error instanceof MarketingDemoRequestError) {
      return response({ error: { code: error.code } }, error.status);
    }
    return response({ error: { code: "invalid_json" } }, 400);
  }
  const parsed = marketingDemoHandoffSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return response({ error: { code: "invalid_demo_handoff" } }, 400);
  }

  try {
    return response(await createMarketingDemoHandoff(parsed.data), 201);
  } catch (error) {
    if (error instanceof MarketingDemoRequestError) {
      return response({ error: { code: error.code } }, error.status);
    }
    return response({ error: { code: "demo_handoff_unavailable" } }, 503);
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

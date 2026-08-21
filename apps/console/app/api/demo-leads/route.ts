import { NextResponse } from "next/server";

import {
  captureMarketingDemoLead,
  MarketingDemoLeadError,
} from "../../../src/server/marketing-demos/marketing-demo-leads";

const maxRequestBytes = 4 * 1024;

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    return response({ error: { code: "request_too_large" } }, 413);
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxRequestBytes) {
    return response({ error: { code: "request_too_large" } }, 413);
  }
  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch {
    return response({ error: { code: "invalid_json" } }, 400);
  }

  try {
    return response(await captureMarketingDemoLead(input), 201);
  } catch (error) {
    if (error instanceof MarketingDemoLeadError) {
      return response({ error: { code: error.code } }, error.status);
    }
    return response({ error: { code: "lead_capture_unavailable" } }, 503);
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

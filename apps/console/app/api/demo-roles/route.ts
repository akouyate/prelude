import { NextResponse } from "next/server";

import { fetchMarketingDemoRoles } from "../../../src/server/marketing-demos/marketing-demo-candidate-api";

export async function GET() {
  try {
    return response(await fetchMarketingDemoRoles(), 200);
  } catch {
    return response({ error: { code: "demo_unavailable" } }, 503);
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

import { NextResponse } from "next/server";

import { listMarketingDemoRoles } from "../../../../src/server/marketing-demo-admission";
import {
  MarketingDemoRequestError,
  isMarketingDemoServiceRequestAuthorized,
} from "../../../../src/server/marketing-demo-security";

export async function GET(request: Request) {
  if (!isMarketingDemoServiceRequestAuthorized(request)) {
    return response({ error: { code: "unauthorized" } }, 401);
  }

  try {
    return response(await listMarketingDemoRoles(), 200);
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

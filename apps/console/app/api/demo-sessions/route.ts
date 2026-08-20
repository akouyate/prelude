import { marketingDemoSessionAdmissionSchema } from "@prelude/contracts";
import { NextResponse } from "next/server";

import { verifyMarketingDemoBotProof } from "../../../src/server/marketing-demos/marketing-demo-bot-proof";
import { createMarketingDemoSession } from "../../../src/server/marketing-demos/marketing-demo-candidate-api";

const maxRequestBytes = 8 * 1024;

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    return response({ error: { code: "request_too_large" } }, 413);
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxRequestBytes) {
    return response({ error: { code: "request_too_large" } }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return response({ error: { code: "invalid_json" } }, 400);
  }
  const parsed = marketingDemoSessionAdmissionSchema.safeParse(body);
  if (!parsed.success) {
    return response({ error: { code: "invalid_demo_request" } }, 400);
  }

  const botVerified = await verifyMarketingDemoBotProof({
    proof: parsed.data.botProof,
    remoteIp: request.headers.get("cf-connecting-ip"),
  });
  if (!botVerified) {
    return response({ error: { code: "bot_verification_failed" } }, 403);
  }

  try {
    const session = await createMarketingDemoSession({
      launchNonce: parsed.data.launchNonce,
      returnTarget: parsed.data.returnTarget,
      roleSlug: parsed.data.roleSlug,
    });
    return response(session, 201);
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

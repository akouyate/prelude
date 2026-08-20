import { NextResponse } from "next/server";
import { prisma } from "@prelude/db";

const maxRequestBytes = 4 * 1024;
const consentVersion = "marketing-demo-email-v1";

export async function POST(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxRequestBytes) {
    return response({ error: { code: "request_too_large" } }, 413);
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return response({ error: { code: "invalid_json" } }, 400);
  }
  const input = parseLead(value);
  if (!input) {
    return response({ error: { code: "invalid_lead" } }, 400);
  }

  const role = await prisma.marketingDemoRole.findUnique({
    select: { enabled: true },
    where: { slug: input.roleSlug },
  });
  if (!role?.enabled) {
    return response({ error: { code: "invalid_role" } }, 400);
  }
  await prisma.marketingDemoLead.create({
    data: {
      consentVersion,
      consentedAt: new Date(),
      email: input.email.toLowerCase(),
      roleSlug: input.roleSlug,
    },
  });
  return response({ accepted: true }, 201);
}

function parseLead(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) =>
        key !== "email" && key !== "marketingConsent" && key !== "roleSlug",
    ) ||
    input.marketingConsent !== true ||
    typeof input.email !== "string" ||
    typeof input.roleSlug !== "string"
  ) {
    return null;
  }
  const email = input.email.trim();
  const roleSlug = input.roleSlug.trim();
  if (
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
    roleSlug.length < 1 ||
    roleSlug.length > 80
  ) {
    return null;
  }
  return { email, roleSlug };
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

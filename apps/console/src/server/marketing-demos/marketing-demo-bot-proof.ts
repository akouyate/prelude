import { timingSafeEqual } from "node:crypto";

type TurnstileResponse = { success?: unknown };

export async function verifyMarketingDemoBotProof(input: {
  proof: string;
  remoteIp: string | null;
}) {
  const secret = process.env.MARKETING_DEMO_TURNSTILE_SECRET?.trim();
  if (!secret) {
    return verifyExplicitDevelopmentProof(input.proof);
  }

  const form = new URLSearchParams({
    response: input.proof,
    secret,
  });
  if (input.remoteIp) {
    form.set("remoteip", input.remoteIp);
  }

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      body: form,
      cache: "no-store",
      method: "POST",
    },
  ).catch(() => null);
  if (!response?.ok) {
    return false;
  }
  const payload = (await response
    .json()
    .catch(() => null)) as TurnstileResponse | null;
  return payload?.success === true;
}

function verifyExplicitDevelopmentProof(proof: string) {
  if (
    process.env.APP_ENV === "production" ||
    process.env.NODE_ENV === "production"
  ) {
    return false;
  }
  const expected = process.env.MARKETING_DEMO_TEST_BOT_PROOF?.trim();
  if (!expected) {
    return false;
  }
  const expectedBytes = Buffer.from(expected);
  const proofBytes = Buffer.from(proof);
  return (
    expectedBytes.length === proofBytes.length &&
    timingSafeEqual(expectedBytes, proofBytes)
  );
}

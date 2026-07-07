import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const algorithm = "aes-256-gcm";
const keyByteLength = 32;

type SecretEnvelope = {
  alg: "A256GCM";
  ciphertext: string;
  iv: string;
  tag: string;
  v: 1;
};

export function encryptConnectedAccountSecret(
  value: string,
  source: Record<string, string | undefined> = process.env,
) {
  const key = resolveConnectedAccountEncryptionKey(source);
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  const envelope: SecretEnvelope = {
    alg: "A256GCM",
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    v: 1,
  };

  return JSON.stringify(envelope);
}

export function decryptConnectedAccountSecret(
  encryptedValue: string,
  source: Record<string, string | undefined> = process.env,
) {
  const envelope = parseEnvelope(encryptedValue);
  const decipher = createDecipheriv(
    algorithm,
    resolveConnectedAccountEncryptionKey(source),
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function resolveConnectedAccountEncryptionKey(
  source: Record<string, string | undefined> = process.env,
) {
  const raw = source.CONNECTED_ACCOUNT_ENCRYPTION_KEY?.trim();

  if (!raw) {
    assertDevelopmentOnlyFallback(source);
    return createHash("sha256")
      .update("prelude-local-connected-account-encryption-key")
      .digest();
  }

  const parsed = parseKey(raw);
  if (parsed) {
    return parsed;
  }

  if (source.NODE_ENV === "production") {
    throw new Error(
      "CONNECTED_ACCOUNT_ENCRYPTION_KEY must decode to a 32-byte key in production.",
    );
  }

  return createHash("sha256").update(raw).digest();
}

export function redactOAuthPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactOAuthPayload(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? "[redacted]" : redactOAuthPayload(item),
    ]),
  );
}

export function safeOAuthErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return redactTokenLikeText(error.message);
  }

  return "OAuth request failed.";
}

function assertDevelopmentOnlyFallback(
  source: Record<string, string | undefined>,
) {
  if (source.NODE_ENV === "production") {
    throw new Error(
      "CONNECTED_ACCOUNT_ENCRYPTION_KEY is required in production.",
    );
  }
}

function parseEnvelope(value: string): SecretEnvelope {
  const parsed = JSON.parse(value) as Partial<SecretEnvelope>;

  if (
    parsed.v !== 1 ||
    parsed.alg !== "A256GCM" ||
    typeof parsed.iv !== "string" ||
    typeof parsed.tag !== "string" ||
    typeof parsed.ciphertext !== "string"
  ) {
    throw new Error("Invalid connected-account secret envelope.");
  }

  return parsed as SecretEnvelope;
}

function parseKey(value: string) {
  const hex = value.match(/^[a-f0-9]{64}$/iu)
    ? Buffer.from(value, "hex")
    : null;
  if (hex?.byteLength === keyByteLength) {
    return hex;
  }

  for (const encoding of ["base64url", "base64"] as const) {
    try {
      const decoded = Buffer.from(value, encoding);
      if (decoded.byteLength === keyByteLength) {
        return decoded;
      }
    } catch {
      // Continue to the next supported encoding.
    }
  }

  return null;
}

function isSensitiveKey(key: string) {
  return /^(access_token|refresh_token|id_token|token)$/iu.test(key);
}

function redactTokenLikeText(value: string) {
  return value.replace(
    /\b(access_token|refresh_token|id_token|token)=([^&\s]+)/giu,
    "$1=[redacted]",
  );
}

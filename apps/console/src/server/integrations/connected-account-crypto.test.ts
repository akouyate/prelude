import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  decryptConnectedAccountSecret,
  encryptConnectedAccountSecret,
  redactOAuthPayload,
  resolveConnectedAccountEncryptionKey,
} from "./connected-account-crypto";

const testKey =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("connected account crypto", () => {
  it("encrypts and decrypts token material without storing plaintext", () => {
    const encrypted = encryptConnectedAccountSecret("refresh-token-123", {
      CONNECTED_ACCOUNT_ENCRYPTION_KEY: testKey,
      NODE_ENV: "test",
    });

    expect(encrypted).not.toContain("refresh-token-123");
    expect(
      decryptConnectedAccountSecret(encrypted, {
        CONNECTED_ACCOUNT_ENCRYPTION_KEY: testKey,
        NODE_ENV: "test",
      }),
    ).toBe("refresh-token-123");
  });

  it("requires an encryption key in production", () => {
    expect(() =>
      resolveConnectedAccountEncryptionKey({ NODE_ENV: "production" }),
    ).toThrow(/CONNECTED_ACCOUNT_ENCRYPTION_KEY/u);
  });

  it("redacts OAuth token fields recursively", () => {
    expect(
      redactOAuthPayload({
        access_token: "access",
        nested: { refresh_token: "refresh" },
        safe: "value",
      }),
    ).toEqual({
      access_token: "[redacted]",
      nested: { refresh_token: "[redacted]" },
      safe: "value",
    });
  });
});

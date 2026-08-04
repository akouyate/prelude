import { describe, expect, it } from "vitest";

import {
  candidatePreviewAccessExpiresAt,
  candidatePreviewRuntimeExpiresAt,
  isCandidatePreviewActive,
} from "./candidate-preview";

describe("candidate preview policy", () => {
  const now = new Date("2026-08-03T10:00:00.000Z");

  it("keeps page access shorter than a running live test", () => {
    expect(candidatePreviewAccessExpiresAt(now).toISOString()).toBe(
      "2026-08-03T10:30:00.000Z",
    );
    expect(candidatePreviewRuntimeExpiresAt(now).toISOString()).toBe(
      "2026-08-03T10:45:00.000Z",
    );
  });

  it("fails closed for expired or revoked previews", () => {
    expect(
      isCandidatePreviewActive(
        { expiresAt: new Date("2026-08-03T10:01:00.000Z"), revokedAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      isCandidatePreviewActive({ expiresAt: now, revokedAt: null }, now),
    ).toBe(false);
    expect(
      isCandidatePreviewActive(
        { expiresAt: new Date("2026-08-03T10:01:00.000Z"), revokedAt: now },
        now,
      ),
    ).toBe(false);
  });
});

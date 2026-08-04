export const candidatePreviewPolicy = {
  accessTtlMs: 30 * 60 * 1000,
  cleanupGraceMs: 24 * 60 * 60 * 1000,
  liveTestLimit: 3,
  runtimeTtlMs: 45 * 60 * 1000,
} as const;

export function candidatePreviewAccessExpiresAt(now = new Date()) {
  return new Date(now.getTime() + candidatePreviewPolicy.accessTtlMs);
}

export function candidatePreviewRuntimeExpiresAt(now = new Date()) {
  return new Date(now.getTime() + candidatePreviewPolicy.runtimeTtlMs);
}

export function isCandidatePreviewActive(
  preview: { expiresAt: Date; revokedAt: Date | null },
  now = new Date(),
) {
  return preview.revokedAt === null && preview.expiresAt > now;
}

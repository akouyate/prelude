import {
  importedRoleDraftSchema,
  roleIntakeStatusSchema,
  type ImportedRoleDraft,
  type RoleIntakeStatus,
  type RoleIntakeWarning,
} from "@prelude/contracts";

export const ROLE_INTAKE_MAX_BYTES = 10 * 1024 * 1024;
export const ROLE_INTAKE_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const ROLE_INTAKE_UPLOAD_URL_TTL_SECONDS = 10 * 60;
export const ROLE_INTAKE_MAX_ATTEMPTS = 3;
// A scan has a 20-second network timeout, but extraction can legitimately take
// longer for a 100-page PDF. Keep the durable lease comfortably above that
// bound so another worker never races a healthy processor.
export const ROLE_INTAKE_PROCESSING_LEASE_MS = 5 * 60 * 1000;

const manageableRoles = new Set(["owner", "admin", "recruiter"]);
const supportedMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const transitions: Record<RoleIntakeStatus, readonly RoleIntakeStatus[]> = {
  consumed: [],
  deleted: [],
  expired: ["deleted"],
  failed: ["queued", "deleted", "expired"],
  processing: ["ready_for_review", "failed", "queued", "expired"],
  quarantined: ["queued", "failed", "expired", "deleted"],
  queued: ["processing", "failed", "expired", "deleted"],
  ready_for_review: ["consumed", "expired", "deleted"],
  uploading: ["quarantined", "failed", "expired", "deleted"],
};

export type RoleIntakeFileInput = {
  byteSize: number;
  contentType: string;
  fileName: string;
};

export function canManageRoleIntake(role: string): boolean {
  return manageableRoles.has(role);
}

export function canTransitionRoleIntake(
  from: RoleIntakeStatus,
  to: RoleIntakeStatus,
): boolean {
  return transitions[from].includes(to);
}

export function validateRoleIntakeFile(
  input: RoleIntakeFileInput,
): { ok: true; value: RoleIntakeFileInput } | { ok: false; error: string } {
  const fileName = input.fileName.trim();
  const contentType = input.contentType.trim().toLowerCase();

  if (!fileName || fileName.length > 255) {
    return { ok: false, error: "Choose a PDF or DOCX file with a valid name." };
  }

  if (!Number.isInteger(input.byteSize) || input.byteSize <= 0) {
    return { ok: false, error: "The selected file is empty." };
  }

  if (input.byteSize > ROLE_INTAKE_MAX_BYTES) {
    return {
      ok: false,
      error: "Choose a file smaller than 10 MB, or start from a manual brief.",
    };
  }

  if (!supportedMimeTypes.has(contentType)) {
    return { ok: false, error: "Prelude accepts PDF and DOCX job briefs only." };
  }

  return {
    ok: true,
    value: { byteSize: input.byteSize, contentType, fileName },
  };
}

export function emptyImportedRoleDraft(): ImportedRoleDraft {
  return importedRoleDraftSchema.parse({});
}

export function normalizeImportedRoleDraft(input: unknown): ImportedRoleDraft {
  return importedRoleDraftSchema.parse(input);
}

export function normalizeRoleIntakeWarnings(
  input: unknown,
): RoleIntakeWarning[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((warning) => {
    if (!warning || typeof warning !== "object") {
      return [];
    }
    const candidate = warning as { code?: unknown; message?: unknown };
    if (typeof candidate.code !== "string" || typeof candidate.message !== "string") {
      return [];
    }
    if (!candidate.code.trim() || !candidate.message.trim()) {
      return [];
    }
    return [
      {
        code: candidate.code.trim().slice(0, 80),
        message: candidate.message.trim().slice(0, 240),
      },
    ];
  });
}

export function isRoleIntakeFeatureEnabled(): boolean {
  return process.env.ROLE_INTAKE_ENABLED === "1";
}

export function roleIntakeExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + ROLE_INTAKE_EXPIRY_MS);
}

export function retryRoleIntakeAt(attemptCount: number, now = new Date()): Date {
  const delayMs = Math.min(60_000 * 2 ** Math.max(0, attemptCount - 1), 15 * 60_000);
  return new Date(now.getTime() + delayMs);
}

export function parseRoleIntakeStatus(value: string): RoleIntakeStatus {
  return roleIntakeStatusSchema.parse(value);
}

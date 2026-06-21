export function formatReviewUserLabel(
  user: { email: string; name: string | null } | null | undefined,
) {
  if (!user) {
    return null;
  }

  return user.name ?? user.email;
}

export function getReviewNotePreview(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 120) {
    return normalized;
  }

  return `${normalized.slice(0, 117)}...`;
}

// Shared by every candidate-link copy affordance (roles list, interview
// detail, the builder's share step): `navigator.clipboard.writeText` can
// reject (permission denied, insecure context) or simply not exist (older
// browser, non-HTTPS origin). Either way the caller must never read that as
// a successful copy — the boolean return, not a thrown/unhandled rejection,
// is what a call site branches its success/failure toast on.
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!navigator.clipboard) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

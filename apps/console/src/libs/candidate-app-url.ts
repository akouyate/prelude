// The candidate experience is a separate app on its own origin
// (NEXT_PUBLIC_CANDIDATE_URL, http://localhost:3001 in dev). Recruiter-facing
// candidate links are stored as bare paths ("/interview/<token>"), so every
// place that turns one into a URL a human will open — a preview link, a copied
// invitation — has to prepend that origin. Resolving against the console origin
// instead lands on a 404.
const fallbackCandidateOrigin = "http://localhost:3001";

export function candidateAppOrigin() {
  // NEXT_PUBLIC_* is inlined at build time, so this works in client components.
  const configured = process.env.NEXT_PUBLIC_CANDIDATE_URL?.trim();
  if (!configured) {
    return fallbackCandidateOrigin;
  }

  try {
    const url = new URL(configured);
    return new Set(["http:", "https:"]).has(url.protocol)
      ? url.origin
      : fallbackCandidateOrigin;
  } catch {
    return fallbackCandidateOrigin;
  }
}

export function candidateAppUrl(candidatePath: string) {
  return `${candidateAppOrigin()}${candidatePath}`;
}

// The label a recruiter reads next to a candidate link: the origin without its
// scheme, so "candidate.hirecall.ai/interview/ci_abc".
export function candidateLinkLabel(candidatePath: string) {
  return `${candidateAppOrigin().replace(/^https?:\/\//u, "")}${candidatePath}`;
}

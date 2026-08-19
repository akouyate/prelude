import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CandidateShell } from "@prelude/ui";

import { candidateExperienceCopy } from "../../../../src/features/live-interview/candidate-experience-copy";
import { CandidatePrivacyNotice } from "../../../../src/features/live-interview/candidate-privacy-notice";
import { candidatePrivacyNotice } from "../../../../src/features/live-interview/privacy-notice-copy";
import { getPublicInterviewContext } from "../../../../src/server/public-interviews";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { follow: false, index: false },
  title: "Privacy notice · HireCall",
};

/**
 * Layer 2 of the candidate information (GDPR art. 13), a sibling of the
 * interview it documents: `/interview/<token>/privacy`.
 *
 * Reached from the same link the candidate was sent and resolved through the
 * SAME public loader as the interview page — unauthenticated by design, because
 * information a candidate has to log in to read is information they were not
 * given. The token is what scopes it: it resolves the controller (the hiring
 * organization's name) and the language, and nothing else about the candidate.
 */
export default async function CandidatePrivacyNoticePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const context = await getPublicInterviewContext(token);

  if (context.kind === "not_found") {
    notFound();
  }

  const notice = candidatePrivacyNotice({
    companyName: context.interview.companyName,
    // Already resolved by `resolveCandidateRenderingLanguage` on the loader, so
    // the notice, the disclosure and the consent are one language — never a
    // French consent next to an English notice.
    language: context.interview.language,
    // Resolved server-side on the SAME loader as the language, and read here
    // rather than re-read from the environment: one value decides what this
    // notice describes, which v3 consent variant the pre-join screens render,
    // and which version id gets stamped on the session. Three surfaces, one
    // resolution — the invariant `consentLanguage` already holds to.
    recordingActive: context.interview.recordingActive,
  });

  return (
    <CandidateShell>
      <CandidatePrivacyNotice
        backHref={`/interview/${encodeURIComponent(token)}`}
        backLabel={candidateExperienceCopy(context.interview.language).back}
        notice={notice}
      />
    </CandidateShell>
  );
}

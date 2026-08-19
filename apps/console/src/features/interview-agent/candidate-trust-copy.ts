import type { WorkspaceLanguage } from "@prelude/contracts";
import {
  candidateConsentCopyFor,
  candidateDisclosureCopyFor,
  type CandidateCopySelection,
} from "@prelude/core";

/**
 * The statutory pair the pre-publish trust panel shows the recruiter: the AI
 * disclosure and the consent text, each with the version id that will be
 * stamped on the candidate's session.
 *
 * The panel's promise is "exactly what every candidate is told and agrees to",
 * so this resolves it the same way the candidate app does — through the same
 * two `@prelude/core` selectors, on the same two axes — instead of printing
 * constants. It used to print the frozen v2 English pair, which was wrong twice
 * over: wrong language for a French screen, and wrong processing reality for a
 * deployment with recording off.
 *
 * Both axes are caller-resolved on purpose, mirroring the core selectors'
 * refusal to default them:
 *
 * - `interviewLanguage` is the draft's own resolved language (the language the
 *   candidate's screen renders in), NOT the recruiter's console language. The
 *   panel's chrome is translated for the recruiter; the statutory texts are
 *   quoted as the candidate will meet them.
 * - `recordingActive` comes from the server (`RECORDING_ENABLED`, resolved in
 *   `src/server/interviews/recording-state.ts`), never guessed client-side.
 *
 * Extracted from the panel so the mapping is testable without rendering: this
 * is the whole decision the panel makes.
 */
export type CandidateTrustCopy = {
  consent: CandidateCopySelection;
  disclosure: CandidateCopySelection;
};

export function candidateTrustCopyFor(
  interviewLanguage: WorkspaceLanguage,
  recordingActive: boolean,
): CandidateTrustCopy {
  return {
    consent: candidateConsentCopyFor(interviewLanguage, recordingActive),
    disclosure: candidateDisclosureCopyFor(interviewLanguage, recordingActive),
  };
}

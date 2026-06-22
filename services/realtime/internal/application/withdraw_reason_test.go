package application

import "testing"

// A candidate-initiated withdrawal closes the session with completed_reason
// "candidate_requested_stop". The realtime API must accept it like any other
// terminal reason, otherwise the duty-of-care close event is rejected at ingest.
func TestKnownSessionCompletionReasonAcceptsCandidateRequestedStop(t *testing.T) {
	known := []string{
		"all_questions_completed",
		"candidate_ended",
		"timeboxed",
		"candidate_requested_stop",
	}
	for _, reason := range known {
		if !knownSessionCompletionReason(reason) {
			t.Errorf("expected %q to be a known session completion reason", reason)
		}
	}

	if knownSessionCompletionReason("definitely_not_a_reason") {
		t.Error("did not expect an unknown reason to be accepted")
	}
}

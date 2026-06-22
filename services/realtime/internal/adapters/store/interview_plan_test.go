package store

import "testing"

// The Python live worker binds InterviewQuestion.category to a strict StrEnum
// {motivation, experience, logistics, role_fit}; any other value crashes its
// AgentConfig validation and the agent never joins the room. decodeInterviewQuestions
// must therefore honor the recruiter-stored category and CLAMP it onto that set.
func TestDecodeInterviewQuestionsClampsCategoryToWorkerSet(t *testing.T) {
	allowed := map[string]bool{
		"motivation": true,
		"experience": true,
		"logistics":  true,
		"role_fit":   true,
	}

	cases := []struct {
		stored string
		want   string
	}{
		{"motivation", "motivation"},
		{"experience", "experience"},
		{"logistics", "logistics"},
		{"skills", "role_fit"},
		{"availability", "role_fit"},
		{"compensation", "role_fit"},
		{"custom", "role_fit"},
		{"", "role_fit"},
		{"communication", "role_fit"}, // legacy heuristic value must not leak
		{"judgment", "role_fit"},
	}

	for _, tc := range cases {
		raw := []byte(`[{"id":"q1","prompt":"Tell me about a project you are proud of.","category":"` + tc.stored + `","expectedSignal":"x","source":"agent"}]`)
		questions := decodeInterviewQuestions(raw)
		if len(questions) != 1 {
			t.Fatalf("stored %q: expected 1 question, got %d", tc.stored, len(questions))
		}
		if got := questions[0].Category; got != tc.want {
			t.Errorf("stored category %q: want %q, got %q", tc.stored, tc.want, got)
		}
		if !allowed[questions[0].Category] {
			t.Errorf("stored category %q produced %q which is NOT in the worker set", tc.stored, questions[0].Category)
		}
	}
}

// The recruiter-approved stored category must win — never the old keyword
// heuristic that sniffed the prompt/signal/source text.
func TestDecodeInterviewQuestionsHonorsStoredCategory(t *testing.T) {
	raw := []byte(`[{"id":"q1","prompt":"What motivates communication and judgment for you?","category":"experience","source":"agent"}]`)
	questions := decodeInterviewQuestions(raw)
	if len(questions) != 1 || questions[0].Category != "experience" {
		t.Fatalf("expected stored category experience, got %+v", questions)
	}
}

// The recruiter's per-question expectedSignal must reach the agent so the live
// interviewer/evaluator is not blind to the intended evaluation signal.
func TestDecodeInterviewQuestionsThreadsExpectedSignalToTheAgent(t *testing.T) {
	raw := []byte(`[{"id":"q1","prompt":"Describe a hard tradeoff you owned.","category":"experience","expectedSignal":"ownership and decision-making under constraints","source":"agent"}]`)
	questions := decodeInterviewQuestions(raw)
	if len(questions) != 1 {
		t.Fatalf("expected 1 question, got %d", len(questions))
	}
	if questions[0].ExpectedSignal != "ownership and decision-making under constraints" {
		t.Fatalf("expected the recruiter expected signal to reach the agent, got %q", questions[0].ExpectedSignal)
	}
}

// The recruiter-authored, reviewed, compliance-scanned follow-up must reach the
// agent verbatim — replacing the generic category-synthesized fallback. The agent
// then speaks it exactly when it needs one bounded probe.
func TestDecodeInterviewQuestionsHonorsAuthoredFollowUp(t *testing.T) {
	raw := []byte(`[{"id":"q1","prompt":"Describe a hard tradeoff you owned.","category":"experience","followUpPrompt":"What did you personally decide, and what changed afterward?","source":"agent"}]`)
	questions := decodeInterviewQuestions(raw)
	if len(questions) != 1 {
		t.Fatalf("expected 1 question, got %d", len(questions))
	}
	if questions[0].FollowUpPrompt != "What did you personally decide, and what changed afterward?" {
		t.Fatalf("expected the recruiter-authored follow-up to reach the agent, got %q", questions[0].FollowUpPrompt)
	}
}

// A legacy/absent follow-up still falls back to the category default so the agent
// always has a bounded probe available.
func TestDecodeInterviewQuestionsFallsBackToCategoryFollowUpWhenAbsent(t *testing.T) {
	raw := []byte(`[{"id":"q1","prompt":"What makes you want this role?","category":"motivation","source":"agent"}]`)
	questions := decodeInterviewQuestions(raw)
	if len(questions) != 1 {
		t.Fatalf("expected 1 question, got %d", len(questions))
	}
	if questions[0].FollowUpPrompt != followUpPrompt("motivation") {
		t.Fatalf("expected the category fallback follow-up, got %q", questions[0].FollowUpPrompt)
	}
}

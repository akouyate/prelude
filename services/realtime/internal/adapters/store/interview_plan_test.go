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

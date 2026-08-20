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
		questions := decodeInterviewQuestions(raw, "fr")
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

func TestDecodeCandidatePreviewPlanUsesTheCanonicalSnapshot(t *testing.T) {
	raw := []byte(`{
		"companyName":"Acme",
		"jobId":"job_1",
		"jobTitle":"Backend Engineer",
		"schemaVersion":1,
		"plan":{
			"roleTitle":"Backend Engineer",
			"roleBrief":"Own backend services and incident response.",
			"seniority":"mid",
			"responseModes":["audio"],
			"questions":[{
				"id":"q1",
				"prompt":"Describe a production incident you investigated end to end.",
				"category":"experience",
				"expectedSignal":"structured problem solving"
			}],
			"guardrails":["Keep every question job related."]
		}
	}`)

	plan, err := decodeCandidatePreviewPlan("pv_123", raw)
	if err != nil {
		t.Fatalf("expected preview plan to decode: %v", err)
	}
	if plan.ID != "pv_123" || plan.RoleTitle != "Backend Engineer" {
		t.Fatalf("unexpected preview plan identity: %+v", plan)
	}
	if len(plan.Questions) != 1 || plan.Questions[0].ExpectedSignal != "structured problem solving" {
		t.Fatalf("expected the canonical preview question, got %+v", plan.Questions)
	}
	if plan.InterviewStyle.Seniority != "mid" {
		t.Fatalf("expected seniority to reach the agent, got %q", plan.InterviewStyle.Seniority)
	}
	if plan.PreviewVariant != "recruiter_preview" {
		t.Fatalf("legacy preview must retain recruiter behavior, got %q", plan.PreviewVariant)
	}
}

func TestDecodeCandidatePreviewPlanThreadsMarketingVariant(t *testing.T) {
	raw := []byte(`{
		"schemaVersion":2,
		"variant":"marketing_demo",
		"plan":{
			"roleTitle":"Account Executive",
			"roleBrief":"Own discovery.",
			"language":"en",
			"responseModes":["audio"],
			"questions":[{"id":"q1","prompt":"Tell me about a discovery call.","category":"experience"}],
			"guardrails":[]
		}
	}`)

	plan, err := decodeCandidatePreviewPlan("pv_marketing", raw)
	if err != nil {
		t.Fatalf("expected marketing preview plan to decode: %v", err)
	}
	if plan.PreviewVariant != "marketing_demo" {
		t.Fatalf("want marketing_demo preview marker, got %q", plan.PreviewVariant)
	}
}

// The recruiter-approved stored category must win — never the old keyword
// heuristic that sniffed the prompt/signal/source text.
func TestDecodeInterviewQuestionsHonorsStoredCategory(t *testing.T) {
	raw := []byte(`[{"id":"q1","prompt":"What motivates communication and judgment for you?","category":"experience","source":"agent"}]`)
	questions := decodeInterviewQuestions(raw, "fr")
	if len(questions) != 1 || questions[0].Category != "experience" {
		t.Fatalf("expected stored category experience, got %+v", questions)
	}
}

// The recruiter's per-question expectedSignal must reach the agent so the live
// interviewer/evaluator is not blind to the intended evaluation signal.
func TestDecodeInterviewQuestionsThreadsExpectedSignalToTheAgent(t *testing.T) {
	raw := []byte(`[{"id":"q1","prompt":"Describe a hard tradeoff you owned.","category":"experience","expectedSignal":"ownership and decision-making under constraints","source":"agent"}]`)
	questions := decodeInterviewQuestions(raw, "fr")
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
	questions := decodeInterviewQuestions(raw, "fr")
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
	questions := decodeInterviewQuestions(raw, "fr")
	if len(questions) != 1 {
		t.Fatalf("expected 1 question, got %d", len(questions))
	}
	if questions[0].FollowUpPrompt != followUpPrompt("motivation", "fr") {
		t.Fatalf("expected the category fallback follow-up, got %q", questions[0].FollowUpPrompt)
	}
}

// The category fallback must be authored in the interview language. An English
// fallback on a French interview was both spoken to the candidate and injected
// into the agent instructions ("Follow-up allowed: ..."), which pulled the live
// voice toward English (the FR/EN mixing seen in the live session).
func TestFollowUpPromptIsLocalized(t *testing.T) {
	if got := followUpPrompt("experience", "fr"); got != "Pouvez-vous décrire le contexte, votre action, et le résultat obtenu ?" {
		t.Fatalf("expected the French experience fallback, got %q", got)
	}
	if got := followUpPrompt("motivation", "fr"); got != "Qu'est-ce qui rend cette opportunité particulièrement pertinente pour la suite de votre parcours ?" {
		t.Fatalf("expected the French motivation fallback, got %q", got)
	}
	if got := followUpPrompt("experience", "en"); got != "Can you share the context, your action, and the result?" {
		t.Fatalf("expected the English fallback to remain available, got %q", got)
	}
}

// GL-T4.3 — the interview language is no longer pinned. It rides in on the
// stored snapshot (Interview.language for a real session, plan.language for a
// preview) and must reach BOTH application.InterviewPlan.Language, which drives
// the whole Python delivery layer, and the category follow-up fallback, which is
// spoken to the candidate. A legacy snapshot with no language keeps the historic
// "fr" so already-published interviews do not change behavior.
func TestBuildStoredInterviewPlanThreadsTheSnapshotLanguage(t *testing.T) {
	cases := []struct {
		name             string
		stored           string
		wantLanguage     string
		wantFollowUpFrom string
	}{
		{name: "french snapshot", stored: "fr", wantLanguage: "fr", wantFollowUpFrom: "fr"},
		{name: "english snapshot", stored: "en", wantLanguage: "en", wantFollowUpFrom: "en"},
		{name: "legacy absent language", stored: "", wantLanguage: "fr", wantFollowUpFrom: "fr"},
		{name: "blank language", stored: "   ", wantLanguage: "fr", wantFollowUpFrom: "fr"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			plan, err := buildStoredInterviewPlan(storedInterviewPlan{
				ID:            "interview_1",
				RoleTitle:     "Backend Engineer",
				Language:      tc.stored,
				ResponseModes: []byte(`["audio"]`),
				// No authored followUpPrompt: the category fallback must be
				// authored in the same language the plan announces.
				Questions:  []byte(`[{"id":"q1","prompt":"What makes you want this role?","category":"motivation","source":"agent"}]`),
				Guardrails: []byte(`[]`),
				RoleBrief:  "Own backend services.",
			})
			if err != nil {
				t.Fatalf("expected the plan to build: %v", err)
			}
			if plan.Language != tc.wantLanguage {
				t.Fatalf("stored language %q: want plan language %q, got %q", tc.stored, tc.wantLanguage, plan.Language)
			}
			want := followUpPrompt("motivation", tc.wantFollowUpFrom)
			if len(plan.Questions) != 1 || plan.Questions[0].FollowUpPrompt != want {
				t.Fatalf("stored language %q: want follow-up %q, got %+v", tc.stored, want, plan.Questions)
			}
		})
	}
}

// A recruiter-authored follow-up still wins over the localized fallback, in any
// interview language — resolveFollowUpPrompt must not "translate" it away.
func TestResolveFollowUpPromptKeepsTheAuthoredProbeInEveryLanguage(t *testing.T) {
	for _, language := range []string{"fr", "en", ""} {
		if got := resolveFollowUpPrompt("  What changed afterward?  ", "motivation", language); got != "What changed afterward?" {
			t.Fatalf("language %q: expected the authored follow-up, got %q", language, got)
		}
		if got := resolveFollowUpPrompt("   ", "motivation", language); got != followUpPrompt("motivation", language) {
			t.Fatalf("language %q: expected the category fallback, got %q", language, got)
		}
	}
}

func TestDecodeCandidatePreviewPlanThreadsTheSnapshotLanguage(t *testing.T) {
	cases := []struct {
		name         string
		languageJSON string
		want         string
	}{
		{name: "english preview", languageJSON: `"language":"en",`, want: "en"},
		{name: "french preview", languageJSON: `"language":"fr",`, want: "fr"},
		{name: "null preview language", languageJSON: `"language":null,`, want: "fr"},
		{name: "legacy preview snapshot", languageJSON: ``, want: "fr"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw := []byte(`{
				"companyName":"Acme",
				"jobId":"job_1",
				"jobTitle":"Backend Engineer",
				"schemaVersion":1,
				"plan":{
					"roleTitle":"Backend Engineer",
					"roleBrief":"Own backend services and incident response.",
					"seniority":"mid",
					` + tc.languageJSON + `
					"responseModes":["audio"],
					"questions":[{
						"id":"q1",
						"prompt":"What makes you want this role?",
						"category":"motivation"
					}],
					"guardrails":[]
				}
			}`)

			plan, err := decodeCandidatePreviewPlan("pv_123", raw)
			if err != nil {
				t.Fatalf("expected preview plan to decode: %v", err)
			}
			if plan.Language != tc.want {
				t.Fatalf("want preview plan language %q, got %q", tc.want, plan.Language)
			}
			if want := followUpPrompt("motivation", tc.want); plan.Questions[0].FollowUpPrompt != want {
				t.Fatalf("want preview follow-up %q, got %q", want, plan.Questions[0].FollowUpPrompt)
			}
		})
	}
}

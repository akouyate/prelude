"use client";

import {
  generateMockInterviewDraft,
  type InterviewAgentDraft,
  type InterviewFocus,
  type InterviewQuestionDraft,
  type InterviewSeniority
} from "@prelude/core";
import { Badge, Button, Textarea } from "@prelude/ui";
import {
  ArrowLeft,
  ArrowRight,
  Attachment as Paperclip,
  Brain,
  Check,
  EditPencil as Pencil,
  Eye,
  Heart,
  Link as Link2,
  Message,
  Page as FileText,
  Pause,
  Play,
  Plus,
  Refresh as RotateCcw,
  ShieldCheck,
  Sparks as Sparkles,
  Suitcase as Briefcase,
  Trash as Trash2,
  Xmark as X,
} from "iconoir-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import {
  publishInterviewDraft,
  saveInterviewDraft,
  type InterviewResponseMode,
  type PublishInterviewDraftResult,
  type SaveInterviewDraftResult,
} from "../../server/interviews/interview-drafts";

type StepId = "brief" | "calibrate" | "questions" | "evaluation" | "share";
type QuestionAction = "warmer" | "sharper" | "replace" | "logistics";
type ResponseMode = InterviewResponseMode;

const steps: Array<{ id: StepId; label: string; title: string }> = [
  { id: "brief", label: "Brief", title: "Start with the role" },
  { id: "calibrate", label: "Calibrate", title: "Calibrate the interview" },
  { id: "questions", label: "Questions", title: "Shape the questions" },
  { id: "evaluation", label: "Evaluation", title: "Set the evaluation standard" },
  { id: "share", label: "Share", title: "Publish when ready" }
];

const focusOptions: Array<{
  value: InterviewFocus;
  label: string;
  description: string;
}> = [
  {
    value: "role_skills",
    label: "Role skills",
    description: "Evidence tied to the job responsibilities"
  },
  {
    value: "situational_judgment",
    label: "Judgment",
    description: "How the candidate handles realistic ambiguity"
  },
  {
    value: "motivation",
    label: "Motivation",
    description: "Why this role makes sense as a next step"
  },
  {
    value: "communication",
    label: "Communication",
    description: "Clarity, structure, and audience awareness"
  }
];

const seniorityOptions: Array<{ value: InterviewSeniority; label: string }> = [
  { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid-level" },
  { value: "senior", label: "Senior" }
];

const responseModes: Array<{ value: ResponseMode; label: string }> = [
  { value: "text", label: "Form" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" }
];

const defaultJobDescription =
  "We are hiring a Customer Success Manager to onboard SMB customers, reduce churn risk, coordinate with product teams, and turn customer feedback into practical improvements. The role needs clear communication, prioritization, and comfort handling ambiguous customer situations.";

type InterviewAgentBuilderProps = {
  companyName?: string;
  initialDraft?: PersistedInterviewDraft;
  initialJobDescription?: string;
  initialJobId?: string;
  initialJobTitle?: string;
};

type PersistedInterviewDraft = {
  id: string;
  jobId: string;
  roleTitle: string;
  roleBrief: string;
  seniority: InterviewSeniority;
  focus: InterviewFocus[];
  responseModes: ResponseMode[];
  sourceAttachmentName?: string;
  draft: InterviewAgentDraft;
};

function updateQuestionPrompt(
  question: InterviewQuestionDraft,
  action: QuestionAction
): InterviewQuestionDraft {
  if (action === "warmer") {
    return {
      ...question,
      prompt: question.prompt.replace("Tell us about", "Could you share")
    };
  }

  if (action === "sharper") {
    return {
      ...question,
      prompt: `${question.prompt} Please include the context, your action, and the result.`
    };
  }

  if (action === "logistics") {
    return {
      ...question,
      prompt:
        "Before we go further, what should we know about your availability, work setup expectations, or location constraints for this role?",
      signal: "Basic alignment on practical hiring constraints",
      source: "agent"
    };
  }

  return {
    ...question,
    prompt:
      "Describe one real work situation that best shows how you would succeed in this role."
  };
}

function createAIQuestion(topic: string, index: number): InterviewQuestionDraft {
  const normalizedTopic = topic.trim().toLowerCase();

  if (normalizedTopic.includes("salary") || normalizedTopic.includes("compensation")) {
    return {
      id: `ai-salary-${index}`,
      prompt:
        "The expected range for this role is shared in the job process. Does that range fit your expectations for a next step?",
      signal: "Compensation alignment before recruiter time is spent",
      source: "agent",
      durationSeconds: 60
    };
  }

  if (normalizedTopic.includes("mobility") || normalizedTopic.includes("location")) {
    return {
      id: `ai-location-${index}`,
      prompt:
        "This role may include location or travel expectations. What constraints should we know before moving forward?",
      signal: "Location, travel, or mobility alignment where job-related",
      source: "agent",
      durationSeconds: 60
    };
  }

  if (normalizedTopic.includes("communication")) {
    return {
      id: `ai-communication-${index}`,
      prompt:
        "Share one example of how you explained a complex customer or internal issue clearly to another person.",
      signal: "Communication clarity in a realistic work situation",
      source: "agent",
      durationSeconds: 75
    };
  }

  return {
    id: `ai-question-${index}`,
    prompt:
      "What is one thing you would want the recruiter to understand about your fit for this role?",
    signal: "Additional recruiter-directed context",
    source: "agent",
    durationSeconds: 60
  };
}

function getResponseModeSummary(modes: ResponseMode[]) {
  const labels = modes.map((mode) => {
    if (mode === "text") {
      return "Form";
    }

    return mode[0]!.toUpperCase() + mode.slice(1);
  });

  return labels.length > 0 ? labels.join(" + ") : "Form";
}

export function InterviewAgentBuilder({
  companyName = "Acme",
  initialDraft,
  initialJobDescription = defaultJobDescription,
  initialJobId,
  initialJobTitle = "Customer Success Manager"
}: InterviewAgentBuilderProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = React.useState<StepId>(
    initialDraft ? "questions" : "brief"
  );
  const [jobId, setJobId] = React.useState(initialDraft?.jobId ?? initialJobId);
  const [persistedDraftId, setPersistedDraftId] = React.useState(
    initialDraft?.id
  );
  const [jobTitle, setJobTitle] = React.useState(
    initialDraft?.roleTitle ?? initialJobTitle
  );
  const [jobDescription, setJobDescription] = React.useState(
    initialDraft?.roleBrief ?? initialJobDescription
  );
  const [seniority, setSeniority] = React.useState<InterviewSeniority>(
    initialDraft?.seniority ?? "mid"
  );
  const [focus, setFocus] = React.useState<InterviewFocus[]>([
    ...(initialDraft?.focus.length
      ? initialDraft.focus
      : ([
          "role_skills",
          "situational_judgment",
          "motivation"
        ] satisfies InterviewFocus[]))
  ]);
  const [modes, setModes] = React.useState<ResponseMode[]>(
    initialDraft?.responseModes.length ? initialDraft.responseModes : ["text", "audio"]
  );
  const [attachmentName, setAttachmentName] = React.useState<string | undefined>(
    initialDraft?.sourceAttachmentName
  );
  const [draft, setDraft] = React.useState<InterviewAgentDraft | undefined>(
    initialDraft?.draft
  );
  const [selectedQuestionId, setSelectedQuestionId] = React.useState<string>();
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);
  const [isSavingDraft, setIsSavingDraft] = React.useState(false);
  const [isPublishingDraft, setIsPublishingDraft] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState<string>();
  const [saveError, setSaveError] = React.useState<string>();
  const [publishedInterview, setPublishedInterview] =
    React.useState<Extract<PublishInterviewDraftResult, { ok: true }>>();

  const currentStepIndex = steps.findIndex((step) => step.id === currentStep);
  const currentStepConfig = steps[currentStepIndex] ?? steps[0]!;
  const activeQuestion = draft?.questions.find(
    (question) => question.id === selectedQuestionId
  ) ?? draft?.questions[0];

  const createDraft = React.useCallback(() => {
    const nextDraft = generateMockInterviewDraft({
      jobTitle,
      companyName,
      jobDescription,
      seniority,
      focus,
      attachmentName
    });

    setDraft(nextDraft);
    setSelectedQuestionId(undefined);
    setPublishedInterview(undefined);
    setSaveMessage(undefined);
    setSaveError(undefined);
    return nextDraft;
  }, [attachmentName, companyName, focus, jobDescription, jobTitle, seniority]);

  const goToStep = React.useCallback((step: StepId) => {
    setCurrentStep(step);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const saveCurrentDraft = React.useCallback(
    async (
      draftToSave = draft
    ): Promise<Extract<SaveInterviewDraftResult, { ok: true }> | null> => {
      if (!draftToSave) {
        setSaveError("Generate questions before saving the draft.");
        return null;
      }

      setIsSavingDraft(true);
      setSaveError(undefined);

      let result: SaveInterviewDraftResult;

      try {
        result = await saveInterviewDraft({
          criteria: draftToSave.criteria,
          draftId: persistedDraftId,
          estimatedMinutes: draftToSave.estimatedMinutes,
          focus,
          guardrails: draftToSave.guardrails,
          jobId,
          questions: draftToSave.questions,
          rationale: draftToSave.rationale,
          responseModes: modes,
          roleBrief: jobDescription,
          roleTitle: jobTitle,
          seniority,
          sourceAttachmentName: attachmentName,
        });
      } catch {
        setIsSavingDraft(false);
        setSaveError("The draft could not be saved. Please try again.");
        return null;
      }

      setIsSavingDraft(false);

      if (!result.ok) {
        setSaveError(result.error);
        return null;
      }

      setJobId(result.jobId);
      setPersistedDraftId(result.draftId);
      setSaveMessage("Draft saved");
      router.replace(`/interviews/new?draftId=${result.draftId}`, {
        scroll: false
      });
      router.refresh();

      return result;
    },
    [
      attachmentName,
      draft,
      focus,
      jobDescription,
      jobId,
      jobTitle,
      modes,
      persistedDraftId,
      router,
      seniority
    ]
  );

  const saveAndShare = React.useCallback(async () => {
    const saved = await saveCurrentDraft();

    if (saved) {
      goToStep("share");
    }
  }, [goToStep, saveCurrentDraft]);

  const publishCurrentDraft = React.useCallback(async () => {
    const saved = await saveCurrentDraft();

    if (!saved) {
      return;
    }

    setIsPublishingDraft(true);
    setSaveError(undefined);

    let result: PublishInterviewDraftResult;

    try {
      result = await publishInterviewDraft(saved.draftId);
    } catch {
      setIsPublishingDraft(false);
      setSaveError("The interview could not be published. Please try again.");
      return;
    }

    setIsPublishingDraft(false);

    if (!result.ok) {
      setSaveError(result.error);
      return;
    }

    setPublishedInterview(result);
    setSaveMessage("Interview published");
    router.refresh();
  }, [router, saveCurrentDraft]);

  const toggleFocus = React.useCallback((value: InterviewFocus) => {
    setFocus((current) => {
      if (current.includes(value)) {
        return current.filter((item) => item !== value);
      }

      return [...current, value];
    });
  }, []);

  const toggleMode = React.useCallback((value: ResponseMode) => {
    setModes((current) => {
      if (current.includes(value)) {
        return current.filter((item) => item !== value);
      }

      return [...current, value];
    });
  }, []);

  const refineQuestion = React.useCallback(
    (questionId: string, action: QuestionAction) => {
      setDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          questions: current.questions.map((question) =>
            question.id === questionId
              ? updateQuestionPrompt(question, action)
              : question
          )
        };
      });
    },
    []
  );

  const updateQuestion = React.useCallback((questionId: string, prompt: string) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        questions: current.questions.map((question) =>
          question.id === questionId ? { ...question, prompt } : question
        )
      };
    });
  }, []);

  const addQuestion = React.useCallback((topic: string) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const nextQuestion = createAIQuestion(topic, current.questions.length + 1);
      setSelectedQuestionId(nextQuestion.id);

      return {
        ...current,
        questions: [...current.questions, nextQuestion],
        rationale: `IA prepared ${current.questions.length + 1} focused questions for this first-screening interview.`
      };
    });
  }, []);

  const removeQuestion = React.useCallback((questionId: string) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const questions = current.questions.filter((question) => question.id !== questionId);
      setSelectedQuestionId((selectedId) =>
        selectedId === questionId ? questions[0]?.id : selectedId
      );

      return {
        ...current,
        questions,
        rationale: `IA prepared ${questions.length} focused questions for this first-screening interview.`
      };
    });
  }, []);

  const next = React.useCallback(() => {
    if (currentStep === "brief") {
      goToStep("calibrate");
      return;
    }

    if (currentStep === "calibrate") {
      createDraft();
      goToStep("questions");
      return;
    }

    if (currentStep === "questions") {
      goToStep("evaluation");
      return;
    }

    if (currentStep === "evaluation") {
      void saveAndShare();
    }
  }, [createDraft, currentStep, goToStep, saveAndShare]);

  const back = React.useCallback(() => {
    const previousStep = steps[currentStepIndex - 1]?.id;

    if (previousStep) {
      goToStep(previousStep);
    }
  }, [currentStepIndex, goToStep]);

  return (
    <>
      <main className="relative z-10 mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl min-w-0 items-center gap-10 px-5 pb-12 pt-6 sm:px-8 lg:grid-cols-[14rem_minmax(0,35rem)] lg:justify-center lg:pb-20">
        <SetupProgress currentStep={currentStep} />

        <section className="min-w-0 w-full">
          <MobileProgress currentStep={currentStep} />

          <div className="mb-7">
            <AgentMessage step={currentStep} draft={draft} />
          </div>

          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink-500">
                Step {currentStepIndex + 1} of {steps.length}
              </p>
              <h1 className="mt-2 text-2xl font-semibold leading-tight text-ink-900 sm:text-3xl">
                {currentStepConfig.title}
              </h1>
            </div>
            {draft ? (
              <div className="flex flex-wrap gap-2">
                <Badge>{draft.questions.length} questions</Badge>
                <Badge>{attachmentName ? "Attachment-aware" : "Job brief only"}</Badge>
              </div>
            ) : null}
          </div>

          {currentStep === "brief" ? (
            <BriefStep
              attachmentName={attachmentName}
              jobDescription={jobDescription}
              jobTitle={jobTitle}
              onAttachmentChange={setAttachmentName}
              onJobDescriptionChange={setJobDescription}
              onJobTitleChange={setJobTitle}
            />
          ) : null}

          {currentStep === "calibrate" ? (
            <CalibrateStep
              focus={focus}
              modes={modes}
              seniority={seniority}
              toggleFocus={toggleFocus}
              toggleMode={toggleMode}
              onSeniorityChange={setSeniority}
            />
          ) : null}

          {currentStep === "questions" && draft ? (
            <QuestionsStep
              draft={draft}
              selectedQuestionId={selectedQuestionId}
              onAddQuestion={addQuestion}
              onRegenerate={createDraft}
              onRefineQuestion={refineQuestion}
              onRemoveQuestion={removeQuestion}
              onSelectQuestion={setSelectedQuestionId}
              onUpdateQuestion={updateQuestion}
            />
          ) : null}

          {currentStep === "evaluation" && draft ? (
            <EvaluationStep draft={draft} />
          ) : null}

          {currentStep === "share" && draft ? (
            <ShareStep
              companyName={companyName}
              draft={draft}
              isPublishing={isPublishingDraft}
              isSaving={isSavingDraft}
              modes={modes}
              publishedInterview={publishedInterview}
              saveError={saveError}
              saveMessage={saveMessage}
              onEditDraft={() => goToStep("questions")}
              onPreview={() => setIsPreviewOpen(true)}
              onPublish={publishCurrentDraft}
              onSave={() => void saveCurrentDraft()}
            />
          ) : null}

          {saveError && currentStep !== "share" ? (
            <p className="mt-5 rounded-xl border border-coral-200 bg-coral-50 px-4 py-3 text-sm font-medium text-coral-800">
              {saveError}
            </p>
          ) : null}

          {saveMessage && currentStep !== "share" ? (
            <p className="mt-5 rounded-xl border border-meadow-200 bg-meadow-50 px-4 py-3 text-sm font-medium text-meadow-800">
              {saveMessage}
            </p>
          ) : null}

          <WizardFooter
            canGoBack={currentStepIndex > 0}
            currentStep={currentStep}
            isWorking={isSavingDraft}
            onBack={back}
            onNext={next}
          />
        </section>
      </main>

      {isPreviewOpen && activeQuestion ? (
        <CandidatePreviewDialog
          companyName={companyName}
          question={activeQuestion}
          onClose={() => setIsPreviewOpen(false)}
        />
      ) : null}
    </>
  );
}

function SetupProgress({ currentStep }: { currentStep: StepId }) {
  const currentIndex = steps.findIndex((step) => step.id === currentStep);

  return (
    <nav
      aria-label="Interview draft progress"
      className="hidden self-center lg:block"
    >
      <p className="mb-5 text-sm font-medium text-ink-600">Interview setup</p>
      <ol className="space-y-5">
        {steps.map((step, index) => {
          const isCurrent = step.id === currentStep;
          const isComplete = index < currentIndex;

          return (
            <li key={step.id} className="flex items-center gap-3">
              <span
                className={`grid h-7 w-7 place-items-center rounded-full border text-xs font-semibold ${
                  isComplete
                    ? "border-ink-900 bg-ink-900 text-white"
                    : isCurrent
                      ? "border-olive-800 bg-[#f0f1e6] text-olive-900 shadow-[0_0_0_4px_rgb(69_66_60/0.08)]"
                      : "border-ink-200 bg-white/70 text-ink-500"
                }`}
              >
                {isComplete ? <Check aria-hidden="true" className="h-4 w-4" /> : index + 1}
              </span>
              <span
                className={`text-sm font-medium ${
                  isCurrent ? "text-ink-900" : "text-ink-700"
                }`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function MobileProgress({ currentStep }: { currentStep: StepId }) {
  const currentIndex = steps.findIndex((step) => step.id === currentStep);

  return (
    <nav aria-label="Interview draft progress" className="mb-8 lg:hidden">
      <div className="flex items-center justify-between text-xs font-medium text-ink-500">
        <span>{steps[currentIndex]?.label}</span>
        <span>
          {currentIndex + 1}/{steps.length}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full rounded-full bg-olive-800 transition-all"
          style={{ width: `${((currentIndex + 1) / steps.length) * 100}%` }}
        />
      </div>
    </nav>
  );
}

function AgentMessage({
  step,
  draft
}: {
  step: StepId;
  draft?: InterviewAgentDraft;
}) {
  const messages: Record<StepId, string> = {
    brief:
      "Paste the job description and I’ll identify the skills, judgment calls, and motivation signals worth screening for.",
    calibrate:
      "I found the strongest hiring signals for this role. Adjust anything before I draft the interview.",
    questions:
      draft?.rationale ??
      "I drafted questions that ask for real examples, not generic self-assessments.",
    evaluation:
      "These criteria help reviewers compare candidates consistently after the interview.",
    share:
      "The draft is ready. Preview the candidate experience only if you want a final check before publishing."
  };

  return (
    <div className="flex min-w-0 gap-3 rounded-2xl border border-ink-100 bg-white/72 px-4 py-3 shadow-soft backdrop-blur">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-900 text-white">
        <Brain aria-hidden="true" className="h-4 w-4" />
      </div>
      <p className="min-w-0 max-w-3xl text-sm leading-6 text-ink-700">
        {messages[step]}
      </p>
    </div>
  );
}

function BriefStep({
  attachmentName,
  jobDescription,
  jobTitle,
  onAttachmentChange,
  onJobDescriptionChange,
  onJobTitleChange
}: {
  attachmentName?: string;
  jobDescription: string;
  jobTitle: string;
  onAttachmentChange: (value: string | undefined) => void;
  onJobDescriptionChange: (value: string) => void;
  onJobTitleChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <Field label="Role">
        <input
          className="h-12 w-full min-w-0 rounded-xl border border-ink-200 bg-white/80 px-3 text-sm font-normal text-ink-900 outline-none transition focus:border-olive-800 focus:ring-2 focus:ring-[#e5e8d6]"
          value={jobTitle}
          onChange={(event) => onJobTitleChange(event.target.value)}
        />
      </Field>

      <Field label="Job description">
        <Textarea
          className="min-h-64 w-full min-w-0 max-w-full bg-white/80 text-sm font-normal leading-6 focus:border-olive-800 focus:ring-[#e5e8d6]"
          value={jobDescription}
          onChange={(event) => onJobDescriptionChange(event.target.value)}
        />
      </Field>

      <label className="flex min-w-0 cursor-pointer flex-col items-stretch justify-between gap-3 rounded-2xl border border-dashed border-ink-300 bg-white/62 p-4 text-sm text-ink-700 transition hover:border-olive-800 hover:bg-white sm:flex-row sm:items-center sm:p-5">
        <span className="flex min-w-0 items-center gap-3">
          <Paperclip aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 leading-5">
            {attachmentName ?? "Add role context, scorecard, or briefing PDF"}
          </span>
        </span>
        <span className="shrink-0 font-medium text-ink-900 sm:text-right">
          Choose file
        </span>
        <input
          className="sr-only"
          type="file"
          accept=".pdf,.doc,.docx,.txt,.md"
          onChange={(event) => onAttachmentChange(event.target.files?.[0]?.name)}
        />
      </label>
    </div>
  );
}

function CalibrateStep({
  focus,
  modes,
  seniority,
  onSeniorityChange,
  toggleFocus,
  toggleMode
}: {
  focus: InterviewFocus[];
  modes: ResponseMode[];
  seniority: InterviewSeniority;
  onSeniorityChange: (value: InterviewSeniority) => void;
  toggleFocus: (value: InterviewFocus) => void;
  toggleMode: (value: ResponseMode) => void;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
      <div>
        <p className="text-sm font-medium text-ink-700">Seniority</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
          {seniorityOptions.map((option) => (
              <button
                key={option.value}
                className={`h-12 cursor-pointer rounded-full border bg-white/80 px-4 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-[#e5e8d6] ${
                  seniority === option.value
                  ? "border-olive-800 bg-[#f0f1e6] text-olive-900 shadow-[0_0_0_3px_rgb(69_66_60/0.08)]"
                  : "border-ink-200 text-ink-700 hover:border-ink-300 hover:bg-white"
              }`}
              type="button"
              onClick={() => onSeniorityChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className="mt-6 text-sm font-medium text-ink-700">Candidate formats</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {responseModes.map((mode) => {
            const checked = modes.includes(mode.value);

            return (
              <button
                key={mode.value}
                aria-label={`${checked ? "Remove" : "Add"} ${mode.label} response mode`}
                className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-[#e5e8d6] ${
                  checked
                    ? "border-olive-800 bg-[#f0f1e6] text-olive-900 shadow-[0_0_0_3px_rgb(69_66_60/0.08)]"
                    : "border-ink-200 bg-white/80 text-ink-700 hover:border-ink-300 hover:bg-white"
                }`}
                type="button"
                onClick={() => toggleMode(mode.value)}
              >
                {checked ? <Check aria-hidden="true" className="h-4 w-4" /> : null}
                {mode.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-ink-700">Hiring signals</p>
        <div className="mt-2 grid gap-3">
          {focusOptions.map((option) => {
            const checked = focus.includes(option.value);

            return (
              <button
                key={option.value}
                aria-label={`${checked ? "Remove" : "Add"} ${option.label} signal`}
                className={`cursor-pointer rounded-2xl border bg-white/80 p-4 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#e5e8d6] ${
                  checked
                    ? "border-olive-800 bg-[#f0f1e6] shadow-[0_0_0_3px_rgb(69_66_60/0.08)]"
                    : "border-ink-200 bg-white/80 hover:border-ink-300 hover:bg-white"
                }`}
                type="button"
                onClick={() => toggleFocus(option.value)}
              >
                <span className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border ${
                      checked
                        ? "border-olive-800 bg-olive-800 text-white"
                        : "border-ink-300"
                    }`}
                  >
                    {checked ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-ink-900">
                      {option.label}
                    </span>
                    <span className="mt-1 block text-sm leading-5 text-ink-600">
                      {option.description}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function getQuestionMeta(question: InterviewQuestionDraft): {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
} {
  const signal = question.signal.toLowerCase();

  if (question.source === "attachment") {
    return {
      icon: <Paperclip aria-hidden="true" className="h-4 w-4" />,
      iconClass: "bg-[#f0f1e6] text-olive-800",
      label: "Context"
    };
  }

  if (signal.includes("motivation")) {
    return {
      icon: <Heart aria-hidden="true" className="h-4 w-4" />,
      iconClass: "bg-coral-50 text-coral-800",
      label: "Motivation"
    };
  }

  if (signal.includes("judgment") || signal.includes("ambiguity")) {
    return {
      icon: <Brain aria-hidden="true" className="h-4 w-4" />,
      iconClass: "bg-gold-100 text-gold-800",
      label: "Judgment"
    };
  }

  if (signal.includes("communication") || signal.includes("clarity")) {
    return {
      icon: <Message aria-hidden="true" className="h-4 w-4" />,
      iconClass: "bg-meadow-50 text-meadow-800",
      label: "Communication"
    };
  }

  if (
    signal.includes("constraint") ||
    signal.includes("alignment") ||
    signal.includes("location")
  ) {
    return {
      icon: <Briefcase aria-hidden="true" className="h-4 w-4" />,
      iconClass: "bg-ink-100 text-ink-800",
      label: "Logistics"
    };
  }

  return {
    icon: <Briefcase aria-hidden="true" className="h-4 w-4" />,
    iconClass: "bg-[#f0f1e6] text-olive-800",
    label: "Experience"
  };
}

function QuestionsStep({
  draft,
  selectedQuestionId,
  onAddQuestion,
  onRegenerate,
  onRefineQuestion,
  onRemoveQuestion,
  onSelectQuestion,
  onUpdateQuestion
}: {
  draft: InterviewAgentDraft;
  selectedQuestionId?: string;
  onAddQuestion: (topic: string) => void;
  onRegenerate: () => InterviewAgentDraft;
  onRefineQuestion: (questionId: string, action: QuestionAction) => void;
  onRemoveQuestion: (questionId: string) => void;
  onSelectQuestion: (questionId: string) => void;
  onUpdateQuestion: (questionId: string, prompt: string) => void;
}) {
  const [editingQuestionId, setEditingQuestionId] = React.useState<string>();
  const [playingQuestionId, setPlayingQuestionId] = React.useState<string>();
  const [isAddingQuestion, setIsAddingQuestion] = React.useState(false);
  const [addTopic, setAddTopic] = React.useState("");

  const addWithAI = React.useCallback(
    (topic: string) => {
      onAddQuestion(topic);
      setAddTopic("");
      setIsAddingQuestion(false);
    },
    [onAddQuestion]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 pb-4">
        <p className="max-w-xl text-sm leading-6 text-ink-600">
          IA prepared these screening questions. Listen, edit, or add one if a signal is missing.
        </p>
        <Button variant="secondary" onClick={onRegenerate}>
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Regenerate draft
        </Button>
      </div>

      <div className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-200 bg-white/76 shadow-soft">
        {draft.questions.map((question, index) => {
          const selected = question.id === selectedQuestionId;
          const editing = question.id === editingQuestionId;
          const playing = question.id === playingQuestionId;
          const meta = getQuestionMeta(question);

          return (
            <article
              key={question.id}
              className={`p-4 transition ${selected ? "bg-[#f7f7ef]" : "bg-white/70"}`}
            >
              <div className="flex items-start gap-3">
                <button
                  aria-label={`${playing ? "Pause" : "Play"} question ${index + 1}`}
                  className={`mt-0.5 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border outline-none transition focus-visible:ring-2 focus-visible:ring-[#e5e8d6] ${
                    playing
                      ? "border-ink-900 bg-ink-900 text-white"
                      : "border-ink-200 bg-white/80 text-ink-900 hover:border-ink-900 hover:bg-white"
                  }`}
                  type="button"
                  onClick={() =>
                    setPlayingQuestionId(playing ? undefined : question.id)
                  }
                >
                  {playing ? (
                    <Pause aria-hidden="true" className="h-4 w-4" />
                  ) : (
                    <Play aria-hidden="true" className="ml-0.5 h-4 w-4" />
                  )}
                </button>

                <span
                  className={`mt-0.5 hidden h-9 w-9 shrink-0 items-center justify-center rounded-full sm:flex ${meta.iconClass}`}
                >
                  {meta.icon}
                </span>

                <div className="min-w-0 flex-1">
                  <button
                    className="block w-full cursor-pointer rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-[#e5e8d6]"
                    type="button"
                    onClick={() => onSelectQuestion(question.id)}
                  >
                    <span className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="rounded-full bg-[#f0f1e6] px-2 py-0.5 text-xs font-medium text-olive-800">
                        {meta.label}
                      </span>
                    </span>
                    <span className="block text-base font-semibold leading-6 text-ink-900">
                      {question.prompt}
                    </span>
                  </button>

                  {editing ? (
                    <div className="mt-3 space-y-3">
                      <Textarea
                        aria-label={`Question ${index + 1} prompt`}
                        className="min-h-24 bg-white/88 text-sm leading-6 focus:border-olive-800 focus:ring-[#e5e8d6]"
                        value={question.prompt}
                        onChange={(event) =>
                          onUpdateQuestion(question.id, event.target.value)
                        }
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() => setEditingQuestionId(undefined)}
                        >
                          Save
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => onRefineQuestion(question.id, "sharper")}
                        >
                          <Sparkles aria-hidden="true" className="h-4 w-4" />
                          Improve with IA
                        </Button>
                      </div>
                    </div>
                  ) : selected ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => setEditingQuestionId(question.id)}
                      >
                        <Pencil aria-hidden="true" className="h-4 w-4" />
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => onRefineQuestion(question.id, "sharper")}
                      >
                        <Sparkles aria-hidden="true" className="h-4 w-4" />
                        Improve with IA
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => onRefineQuestion(question.id, "replace")}
                      >
                        Replace
                      </Button>
                      <Button
                        disabled={draft.questions.length <= 1}
                        variant="ghost"
                        onClick={() => onRemoveQuestion(question.id)}
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="rounded-2xl border border-dashed border-ink-300 bg-white/60 p-4 transition hover:border-olive-800">
        {isAddingQuestion ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-ink-900">Add a question</p>
              <p className="mt-1 text-sm leading-5 text-ink-600">
                Tell IA what signal is missing, or write the question directly later.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                aria-label="Ask IA to add a question about"
                className="h-10 min-w-0 rounded-xl border border-ink-200 bg-white/88 px-3 text-sm outline-none focus:border-olive-800 focus:ring-2 focus:ring-[#e5e8d6]"
                value={addTopic}
                placeholder="salary alignment, mobility, language..."
                onChange={(event) => setAddTopic(event.target.value)}
              />
              <Button onClick={() => addWithAI(addTopic || "screening fit")}>
                <Sparkles aria-hidden="true" className="h-4 w-4" />
                Add with IA
              </Button>
            </div>
          </div>
        ) : (
          <button
            className="flex w-full cursor-pointer items-center gap-3 rounded-full text-left outline-none focus-visible:ring-2 focus-visible:ring-[#e5e8d6]"
            type="button"
            onClick={() => setIsAddingQuestion(true)}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-900 text-white">
              <Plus aria-hidden="true" className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink-900">
                Add question
              </span>
              <span className="mt-1 block text-sm text-ink-600">
                Ask IA for one missing screening signal.
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

function EvaluationStep({ draft }: { draft: InterviewAgentDraft }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
          <FileText aria-hidden="true" className="h-4 w-4 text-ink-700" />
          Review criteria
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {draft.criteria.map((criterion) => (
            <div
              key={criterion.id}
              className="rounded-2xl border border-ink-200 bg-white/76 p-4"
            >
              <p className="text-sm font-semibold text-ink-900">{criterion.label}</p>
              <p className="mt-1 text-sm leading-5 text-ink-600">
                {criterion.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
          <ShieldCheck aria-hidden="true" className="h-4 w-4 text-ink-700" />
          Guardrails
        </div>
        <div className="mt-3 space-y-3 rounded-2xl border border-ink-100 bg-white/72 p-4 shadow-soft">
          {draft.guardrails.map((guardrail) => (
            <div key={guardrail} className="flex gap-3 text-sm leading-6 text-ink-700">
              <Check aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-olive-800" />
              {guardrail}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ShareStep({
  companyName,
  draft,
  isPublishing,
  isSaving,
  modes,
  publishedInterview,
  saveError,
  saveMessage,
  onEditDraft,
  onPreview,
  onPublish,
  onSave
}: {
  companyName: string;
  draft: InterviewAgentDraft;
  isPublishing: boolean;
  isSaving: boolean;
  modes: ResponseMode[];
  publishedInterview?: Extract<PublishInterviewDraftResult, { ok: true }>;
  saveError?: string;
  saveMessage?: string;
  onEditDraft: () => void;
  onPreview: () => void;
  onPublish: () => void;
  onSave: () => void;
}) {
  const candidateLink = publishedInterview
    ? `prelude.ai${publishedInterview.candidatePath}`
    : "Publish to create the candidate link";

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryMetric label="Questions" value={String(draft.questions.length)} />
        <SummaryMetric label="Experience" value={getResponseModeSummary(modes)} />
        <SummaryMetric label="Organization" value={companyName} />
      </div>

      <div className="rounded-2xl border border-ink-200 bg-white/72 p-5 shadow-soft">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
          <Link2 aria-hidden="true" className="h-4 w-4 text-ink-700" />
          Candidate link
        </div>
        <p
          className={`mt-3 break-all text-lg font-semibold ${
            publishedInterview ? "text-ink-900" : "text-ink-500"
          }`}
        >
          {candidateLink}
        </p>
        <p className="mt-2 text-sm leading-6 text-ink-600">
          Drafts stay private. Publishing snapshots the current questions,
          criteria, and candidate formats into a shareable interview.
        </p>
      </div>

      {saveError ? (
        <div className="rounded-xl border border-coral-200 bg-coral-50 p-4 text-sm font-medium text-coral-800">
          {saveError}
        </div>
      ) : null}

      {saveMessage ? (
        <div className="rounded-xl border border-meadow-200 bg-meadow-50 p-4 text-sm font-medium text-meadow-700">
          {saveMessage}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onPreview}>
          <Eye aria-hidden="true" className="h-4 w-4" />
          Preview candidate experience
        </Button>
        <Button variant="secondary" onClick={onEditDraft}>
          Edit draft
        </Button>
        <Button disabled={isSaving || isPublishing} variant="secondary" onClick={onSave}>
          {isSaving ? "Saving..." : "Save draft"}
        </Button>
        <Button disabled={isSaving || isPublishing} onClick={onPublish}>
          {isPublishing ? "Publishing..." : "Publish interview"}
        </Button>
        {publishedInterview ? (
          <a
            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-full border border-ink-200 bg-white/80 px-4 text-sm font-medium text-ink-900 transition hover:border-ink-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
            href={publishedInterview.detailPath}
          >
            Open detail
          </a>
        ) : null}
      </div>
    </div>
  );
}

function WizardFooter({
  canGoBack,
  currentStep,
  isWorking,
  onBack,
  onNext
}: {
  canGoBack: boolean;
  currentStep: StepId;
  isWorking: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const nextLabels: Partial<Record<StepId, string>> = {
    brief: "Continue",
    calibrate: "Create questions",
    questions: "Review evaluation",
    evaluation: "Save and share"
  };

  return (
    <div className="mt-8 grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
      <Button
        className="w-full sm:w-auto"
        disabled={!canGoBack || isWorking}
        variant="secondary"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back
      </Button>

      {currentStep === "share" ? (
        null
      ) : (
        <Button className="w-full sm:w-auto" disabled={isWorking} onClick={onNext}>
          {isWorking ? "Saving..." : nextLabels[currentStep]}
          {currentStep === "calibrate" ? (
            <Sparkles aria-hidden="true" className="h-4 w-4" />
          ) : (
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  );
}

function CandidatePreviewDialog({
  companyName,
  question,
  onClose
}: {
  companyName: string;
  question: InterviewQuestionDraft;
  onClose: () => void;
}) {
  return (
    <div
      aria-label="Candidate preview"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4"
      role="dialog"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold text-ink-900">Candidate preview</p>
          <button
            aria-label="Close candidate preview"
            className="cursor-pointer rounded-full p-2 text-ink-600 outline-none hover:bg-ink-100 focus-visible:ring-2 focus-visible:ring-[#e5e8d6]"
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <div className="rounded-[2rem] bg-ink-900 p-4 text-white">
          <p className="text-xs font-medium text-white/60">{companyName}</p>
          <h3 className="mt-4 text-xl font-semibold leading-snug">{question.prompt}</h3>
          <p className="mt-5 text-sm leading-6 text-white/68">
            Answer by audio, video, or text. You can preview before sending.
          </p>
          <div className="mt-8 grid gap-2">
            <button
              className="h-11 cursor-pointer rounded-full bg-white px-4 text-sm font-semibold text-ink-900 outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              type="button"
            >
              Record audio
            </button>
            <button
              className="h-11 cursor-pointer rounded-full border border-white/18 px-4 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              type="button"
            >
              Write answer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  children,
  label
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="block space-y-1 text-sm font-medium text-ink-700">
      {label}
      {children}
    </label>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink-200 p-4">
      <p className="text-sm text-ink-500">{label}</p>
      <p className="mt-1 text-xl font-semibold leading-tight text-ink-900">{value}</p>
    </div>
  );
}

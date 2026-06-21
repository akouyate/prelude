"use client";

import {
  type InterviewAgentDraft,
  type InterviewFocus,
  type InterviewQuestionDraft,
  type InterviewSeniority
} from "@prelude/core";
import { Badge, Button, Textarea, cn } from "@prelude/ui";
import {
  Attachment as Paperclip,
  Brain,
  Check,
  EditPencil as Pencil,
  Eye,
  Heart,
  Link as Link2,
  Message,
  Microphone,
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
  getInterviewPlanPublicationIssues,
  interviewPlanPolicy,
} from "../../domain/interview-plan-policy";
import {
  addInterviewQuestionAction,
  generateInterviewDraftAction,
  refineInterviewQuestionAction,
  type InterviewDraftGenerationActionResult,
} from "../../server/interviews/interview-draft-generation-actions";
import {
  publishInterviewDraft,
  saveInterviewDraft,
  type InterviewResponseMode,
  type PublishInterviewDraftResult,
  type SaveInterviewDraftResult,
} from "../../server/interviews/interview-drafts";
import {
  InterviewBuilderAgentCard,
  InterviewBuilderBreadcrumb,
  InterviewBuilderFooter,
  InterviewBuilderMobileProgress,
  InterviewBuilderStepHeader,
  InterviewBuilderStepRail,
} from "./interview-builder-layout";

type StepId = "brief" | "calibrate" | "questions" | "evaluation" | "share";
type QuestionAction = "sharper" | "replace";
type ResponseMode = InterviewResponseMode;

const steps: Array<{ id: StepId; label: string; title: string }> = [
  { id: "brief", label: "Brief", title: "Start with the role" },
  { id: "calibrate", label: "Calibrate", title: "Calibrate the role screen" },
  { id: "questions", label: "Questions", title: "Shape the questions" },
  { id: "evaluation", label: "Evaluation", title: "Set the evaluation standard" },
  { id: "share", label: "Publish", title: "Publish the role screen" }
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
  { value: "audio", label: "Audio" }
];
const builderResponseModes = new Set<ResponseMode>(
  responseModes.map((mode) => mode.value),
);

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

function getResponseModeSummary(modes: ResponseMode[]) {
  const labels = modes.map((mode) => {
    if (mode === "text") {
      return "Form";
    }

    return mode[0]!.toUpperCase() + mode.slice(1);
  });

  return labels.length > 0 ? labels.join(" + ") : "Form";
}

function normalizeBuilderResponseModes(modes: ResponseMode[] | undefined) {
  const normalized = modes?.filter((mode) => builderResponseModes.has(mode)) ?? [];

  return normalized.length > 0 ? normalized : (["text", "audio"] satisfies ResponseMode[]);
}

export function InterviewAgentBuilder({
  companyName = "Acme",
  initialDraft,
  initialJobDescription = "",
  initialJobId,
  initialJobTitle = ""
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
    normalizeBuilderResponseModes(initialDraft?.responseModes)
  );
  const [attachmentName] = React.useState<string | undefined>(
    initialDraft?.sourceAttachmentName
  );
  const [draft, setDraft] = React.useState<InterviewAgentDraft | undefined>(
    initialDraft?.draft
  );
  const [selectedQuestionId, setSelectedQuestionId] = React.useState<string>();
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);
  const [isGeneratingDraft, setIsGeneratingDraft] = React.useState(false);
  const [generationPhase, setGenerationPhase] = React.useState(0);
  const [workingQuestionId, setWorkingQuestionId] = React.useState<string>();
  const [isSavingDraft, setIsSavingDraft] = React.useState(false);
  const [isPublishingDraft, setIsPublishingDraft] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState<string>();
  const [saveError, setSaveError] = React.useState<string>();
  const [publishedInterview, setPublishedInterview] =
    React.useState<Extract<PublishInterviewDraftResult, { ok: true }>>();
  const generationTimers = React.useRef<Array<ReturnType<typeof setTimeout>>>(
    [],
  );

  const currentStepIndex = steps.findIndex((step) => step.id === currentStep);
  const currentStepConfig = steps[currentStepIndex] ?? steps[0]!;
  const activeQuestion = draft?.questions.find(
    (question) => question.id === selectedQuestionId
  ) ?? draft?.questions[0];
  const trimmedJobTitle = jobTitle.trim();
  const trimmedJobDescription = jobDescription.trim();

  const createDraft = React.useCallback(async () => {
    let result: InterviewDraftGenerationActionResult;

    try {
      result = await generateInterviewDraftAction({
        companyName,
        focus,
        responseModes: modes,
        roleBrief: jobDescription,
        roleTitle: jobTitle,
        seniority,
        sourceAttachmentName: attachmentName,
      });
    } catch {
      setSaveError("Prelude could not generate the role screen right now. Please retry.");
      return null;
    }

    if (!result.ok) {
      setSaveError(result.error);
      return null;
    }

    setDraft(result.draft);
    setSelectedQuestionId(undefined);
    setPublishedInterview(undefined);
    setSaveMessage(undefined);
    setSaveError(undefined);
    return result.draft;
  }, [
    attachmentName,
    companyName,
    focus,
    jobDescription,
    jobTitle,
    modes,
    seniority
  ]);

  React.useEffect(() => {
    return () => {
      generationTimers.current.forEach((timer) => clearTimeout(timer));
      generationTimers.current = [];
    };
  }, []);

  const goToStep = React.useCallback((step: StepId) => {
    setCurrentStep(step);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const startDraftGeneration = React.useCallback(() => {
    generationTimers.current.forEach((timer) => clearTimeout(timer));
    generationTimers.current = [];
    goToStep("questions");
    setIsGeneratingDraft(true);
    setGenerationPhase(0);
    setSaveError(undefined);
    setDraft(undefined);

    generationTimers.current = [
      setTimeout(() => setGenerationPhase(1), 520),
      setTimeout(() => setGenerationPhase(2), 1040),
    ];

    void (async () => {
      const generated = await createDraft();
      setGenerationPhase(3);
      setIsGeneratingDraft(false);

      if (!generated) {
        generationTimers.current.forEach((timer) => clearTimeout(timer));
        generationTimers.current = [];
      }
    })();
  }, [createDraft, goToStep]);


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
      router.replace(`/roles/new?draftId=${result.draftId}`, {
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
      setSaveError("The role screen could not be published. Please try again.");
      return;
    }

    setIsPublishingDraft(false);

    if (!result.ok) {
      setSaveError(result.error);
      return;
    }

    setPublishedInterview(result);
    setSaveMessage("Role screen published");
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
    async (questionId: string, action: QuestionAction) => {
      if (!draft) {
        return;
      }

      setWorkingQuestionId(questionId);
      setSaveError(undefined);

      try {
        const result = await refineInterviewQuestionAction({
          action,
          companyName,
          draft,
          focus,
          questionId,
          responseModes: modes,
          roleBrief: jobDescription,
          roleTitle: jobTitle,
          seniority,
          sourceAttachmentName: attachmentName,
        });

        if (!result.ok) {
          setSaveError(result.error);
          return;
        }

        setDraft(result.draft);
        setSelectedQuestionId(result.questionId);
        setPublishedInterview(undefined);
        setSaveMessage(undefined);
      } catch {
        setSaveError("Prelude could not refine that question. Please retry.");
      } finally {
        setWorkingQuestionId(undefined);
      }
    },
    [
      attachmentName,
      companyName,
      draft,
      focus,
      jobDescription,
      jobTitle,
      modes,
      seniority
    ]
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
    setPublishedInterview(undefined);
    setSaveMessage(undefined);
  }, []);

  const addQuestion = React.useCallback(
    async (topic: string) => {
      if (!draft || draft.questions.length >= interviewPlanPolicy.maxQuestions) {
        return false;
      }

      setWorkingQuestionId("new");
      setSaveError(undefined);

      try {
        const result = await addInterviewQuestionAction({
          companyName,
          draft,
          focus,
          responseModes: modes,
          roleBrief: jobDescription,
          roleTitle: jobTitle,
          seniority,
          sourceAttachmentName: attachmentName,
          topic,
        });

        if (!result.ok) {
          setSaveError(result.error);
          return false;
        }

        setDraft(result.draft);
        setSelectedQuestionId(result.questionId);
        setPublishedInterview(undefined);
        setSaveMessage(undefined);
        return true;
      } catch {
        setSaveError("Prelude could not add that question. Please retry.");
        return false;
      } finally {
        setWorkingQuestionId(undefined);
      }
    },
    [
      attachmentName,
      companyName,
      draft,
      focus,
      jobDescription,
      jobTitle,
      modes,
      seniority
    ]
  );

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
        rationale: `Prelude prepared ${questions.length} focused questions for this first-screening role screen.`
      };
    });
    setPublishedInterview(undefined);
    setSaveMessage(undefined);
  }, []);

  const next = React.useCallback(() => {
    if (currentStep === "brief") {
      if (trimmedJobTitle.length < 2) {
        setSaveError("Add a role title before calibrating the role screen.");
        return;
      }

      if (trimmedJobDescription.length < 40) {
        setSaveError("Add enough job context before calibrating the role screen.");
        return;
      }

      setSaveError(undefined);
      goToStep("calibrate");
      return;
    }

    if (currentStep === "calibrate") {
      startDraftGeneration();
      return;
    }

    if (currentStep === "questions") {
      if (!draft) {
        startDraftGeneration();
        return;
      }

      goToStep("evaluation");
      return;
    }

    if (currentStep === "evaluation") {
      void saveAndShare();
    }
  }, [
    currentStep,
    draft,
    goToStep,
    saveAndShare,
    startDraftGeneration,
    trimmedJobDescription,
    trimmedJobTitle,
  ]);

  const back = React.useCallback(() => {
    const previousStep = steps[currentStepIndex - 1]?.id;

    if (previousStep) {
      goToStep(previousStep);
    }
  }, [currentStepIndex, goToStep]);

  return (
    <>
      <main className="relative z-10 mx-auto grid w-full max-w-[1060px] min-w-0 gap-[clamp(24px,4vw,56px)] px-4 pb-20 pt-[clamp(22px,3.5vw,36px)] sm:px-7 lg:grid-cols-[212px_minmax(0,1fr)]">
        <InterviewBuilderBreadcrumb
          isSaved={Boolean(saveMessage || persistedDraftId)}
          roleTitle={trimmedJobTitle || "New role"}
        />
        <InterviewBuilderStepRail
          currentStep={currentStep}
          onStepChange={goToStep}
          steps={steps}
        />

        <section className="min-w-0 w-full">
          <InterviewBuilderMobileProgress
            currentStep={currentStep}
            steps={steps}
          />

          <InterviewBuilderAgentCard
            isThinking={isGeneratingDraft}
            message={getAgentMessage(currentStep, draft, isGeneratingDraft)}
          />

          <div className="mb-6">
            <InterviewBuilderStepHeader
              badges={
                draft ? (
                  <>
                    <Badge>{draft.questions.length} questions</Badge>
                    <Badge>
                      {attachmentName ? "Attachment-aware" : "Job brief only"}
                    </Badge>
                  </>
                ) : null
              }
              stepIndex={currentStepIndex}
              stepTitle={currentStepConfig.title}
              totalSteps={steps.length}
            />
          </div>

          {currentStep === "brief" ? (
            <BriefStep
              jobDescription={jobDescription}
              jobTitle={jobTitle}
              onJobDescriptionChange={(value) => {
                setJobDescription(value);
                setSaveError(undefined);
              }}
              onJobTitleChange={(value) => {
                setJobTitle(value);
                setSaveError(undefined);
              }}
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

          {currentStep === "questions" && isGeneratingDraft ? (
            <GeneratingQuestionsStep
              focusCount={focus.length}
              generationPhase={generationPhase}
              modes={modes}
              seniority={seniority}
            />
          ) : null}

          {currentStep === "questions" && draft && !isGeneratingDraft ? (
            <QuestionsStep
              draft={draft}
              selectedQuestionId={selectedQuestionId}
              workingQuestionId={workingQuestionId}
              onAddQuestion={addQuestion}
              onRegenerate={startDraftGeneration}
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
              roleBrief={jobDescription}
              roleTitle={jobTitle}
              saveError={saveError}
              saveMessage={saveMessage}
              onEditDraft={() => goToStep("questions")}
              onPreview={() => setIsPreviewOpen(true)}
              onPublish={publishCurrentDraft}
              onSave={() => void saveCurrentDraft()}
            />
          ) : null}

          {saveError && currentStep !== "share" ? (
            <p className="mt-5 rounded-2xl border border-coral-200 bg-coral-50 px-4 py-3 text-sm font-medium text-coral-800">
              {saveError}
            </p>
          ) : null}

          {saveMessage && currentStep !== "share" ? (
            <p className="mt-5 rounded-2xl border border-meadow-200 bg-meadow-50 px-4 py-3 text-sm font-medium text-meadow-800">
              {saveMessage}
            </p>
          ) : null}

          <InterviewBuilderFooter
            canGoBack={currentStepIndex > 0}
            currentStep={currentStep}
            isWorking={isSavingDraft || isGeneratingDraft}
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

function getAgentMessage(
  step: StepId,
  draft?: InterviewAgentDraft,
  isGenerating = false,
) {
  if (isGenerating) {
    return "Working through the role now — drafting questions tuned to your signals. This takes a few seconds.";
  }

  const messages: Record<StepId, string> = {
    brief:
      "Write the role title and context. I’ll pull the skills, judgment calls, and motivation signals worth screening for.",
    calibrate:
      "I found the strongest hiring signals for this role. Adjust anything before I draft the screen.",
    questions:
      draft?.rationale ??
      "I drafted questions that ask for real examples, not generic self-assessments.",
    evaluation:
      "These criteria help reviewers compare candidates consistently after the screen.",
    share:
      "The draft is ready. Preview the candidate experience only if you want a final check before publishing."
  };

  return messages[step];
}

function GeneratingQuestionsStep({
  focusCount,
  generationPhase,
  modes,
  seniority,
}: {
  focusCount: number;
  generationPhase: number;
  modes: ResponseMode[];
  seniority: InterviewSeniority;
}) {
  const generationSteps = [
    "Reading the role and job description",
    "Mapping your selected hiring signals",
    "Writing questions that ask for real examples",
  ];
  const skeletonWidths = ["74%", "88%", "64%", "81%"];

  return (
    <div className="mt-6 rounded-[18px] border border-[#e7e2d8] bg-white px-[22px] py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2.5 text-[13.5px] font-semibold text-ink-950">
          <span className="h-[15px] w-[15px] animate-spin rounded-full border-2 border-[#e2ddd2] border-t-olive-700" />
          Drafting questions
        </span>
        <span className="text-[12.5px] text-ink-400">
          Tuned to {formatSeniorityLabel(seniority)} · {focusCount} signals ·{" "}
          {getResponseModeSummary(modes)}
        </span>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {generationSteps.map((label, index) => {
          const done = index < generationPhase;
          const active = index === generationPhase;

          return (
            <div className="flex items-center gap-3" key={label}>
              <span
                className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border ${
                  done
                    ? "border-ink-900 bg-ink-900 text-white"
                    : active
                      ? "border-[#cdd6b4] bg-white text-olive-700"
                      : "border-[#e2ddd2] bg-white text-ink-300"
                }`}
              >
                {done ? (
                  <Check aria-hidden={true} className="h-3 w-3" />
                ) : active ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#e2ddd2] border-t-olive-700" />
                ) : null}
              </span>
              <span
                className={`text-[13.5px] ${
                  active || done
                    ? "font-semibold text-ink-950"
                    : "font-medium text-ink-400"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-[22px] flex flex-col gap-3.5 border-t border-[#f0ece1] pt-[18px]">
        {skeletonWidths.map((width, index) => (
          <div className="flex items-center gap-3" key={width}>
            <span className="h-[38px] w-[38px] shrink-0 rounded-full bg-[#f1ede2]" />
            <span className="h-9 w-9 shrink-0 rounded-[10px] bg-[#f1ede2]" />
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="h-2.5 w-[30%] rounded-full bg-[#f0ece1]" />
              <span
                className="h-[13px] rounded-full bg-[#efeadf]"
                style={{ width: index <= generationPhase + 1 ? width : "46%" }}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatSeniorityLabel(value: InterviewSeniority) {
  if (value === "junior") {
    return "Junior";
  }

  if (value === "senior") {
    return "Senior";
  }

  return "Mid-level";
}

function BriefStep({
  jobDescription,
  jobTitle,
  onJobDescriptionChange,
  onJobTitleChange
}: {
  jobDescription: string;
  jobTitle: string;
  onJobDescriptionChange: (value: string) => void;
  onJobTitleChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <div className="rounded-[24px] border border-[#e7e2d8] bg-white/58 p-4 sm:p-5">
        <div className="mb-[18px] flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f3f1ea] text-ink-800">
            <FileText aria-hidden={true} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-950">Manual brief</p>
            <p className="mt-1 max-w-[620px] text-sm leading-6 text-ink-500">
              Add the role title and the job context. Prelude will use this brief
              to draft focused first-screening questions.
            </p>
          </div>
        </div>

        <div className="grid gap-5">
          <Field label="Role">
            <input
              className="mt-2 h-12 w-full min-w-0 rounded-[13px] border border-[#ddd8cc] bg-white px-[15px] text-[15px] font-medium text-ink-950 outline-none transition focus:border-olive-700 focus:ring-2 focus:ring-[#e5e8d6]"
              placeholder="Senior Product Designer"
              value={jobTitle}
              onChange={(event) => onJobTitleChange(event.target.value)}
            />
          </Field>

          <Field label="Job description">
            <Textarea
              className="mt-2 min-h-[184px] w-full min-w-0 max-w-full rounded-[13px] border-[#ddd8cc] bg-white px-[15px] py-3.5 text-sm font-normal leading-[1.6] text-ink-700 focus:border-olive-700 focus:ring-[#e5e8d6]"
              placeholder="Paste the job description, responsibilities, context, hiring criteria, location constraints, or anything the interviewer should understand before drafting the first screen."
              value={jobDescription}
              onChange={(event) => onJobDescriptionChange(event.target.value)}
            />
          </Field>
        </div>
      </div>
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
          {seniorityOptions.map((option) => {
            const selected = seniority === option.value;

            return (
              <button
                key={option.value}
                className={cn(
                  selectionSurfaceClass(selected),
                  "h-12 rounded-[18px] px-4 text-sm font-semibold",
                )}
                type="button"
                onClick={() => onSeniorityChange(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <p className="mt-6 text-sm font-medium text-ink-700">Candidate formats</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {responseModes.map((mode) => {
            const checked = modes.includes(mode.value);

            return (
              <button
                key={mode.value}
                aria-label={`${checked ? "Remove" : "Add"} ${mode.label} response mode`}
                className={cn(
                  selectionSurfaceClass(checked),
                  "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold",
                )}
                type="button"
                onClick={() => toggleMode(mode.value)}
              >
                {mode.value === "audio" ? (
                  <Microphone aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Message aria-hidden="true" className="h-4 w-4" />
                )}
                {checked ? (
                  <Check aria-hidden="true" className="h-4 w-4 text-olive-900" />
                ) : null}
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
                className={cn(
                  selectionSurfaceClass(checked),
                  "rounded-[20px] p-4 text-left",
                )}
                type="button"
                onClick={() => toggleFocus(option.value)}
              >
                <span className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] border transition",
                      checked
                        ? "border-olive-900 bg-olive-900 text-white"
                        : "border-[#cfc8bb] bg-white/72 text-transparent",
                    )}
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

function selectionSurfaceClass(selected: boolean, disabled = false) {
  if (disabled) {
    return "cursor-not-allowed border border-[#e7e2d8] bg-white/46 text-ink-400 opacity-75";
  }

  return cn(
    "cursor-pointer border outline-none transition focus-visible:ring-2 focus-visible:ring-[#e5e8d6]",
    selected
      ? "border-[#d8deca] bg-[#f3f4ea] text-olive-950"
      : "border-[#e7e2d8] bg-white/72 text-ink-700 hover:border-[#d1cbbf] hover:bg-white",
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
      iconClass: "bg-[#eef0e3] text-olive-800",
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
    iconClass: "bg-[#eef0e3] text-olive-800",
    label: "Experience"
  };
}

function QuestionsStep({
  draft,
  selectedQuestionId,
  workingQuestionId,
  onAddQuestion,
  onRegenerate,
  onRefineQuestion,
  onRemoveQuestion,
  onSelectQuestion,
  onUpdateQuestion
}: {
  draft: InterviewAgentDraft;
  selectedQuestionId?: string;
  workingQuestionId?: string;
  onAddQuestion: (topic: string) => Promise<boolean>;
  onRegenerate: () => void;
  onRefineQuestion: (questionId: string, action: QuestionAction) => Promise<void>;
  onRemoveQuestion: (questionId: string) => void;
  onSelectQuestion: (questionId: string) => void;
  onUpdateQuestion: (questionId: string, prompt: string) => void;
}) {
  const [editingQuestionId, setEditingQuestionId] = React.useState<string>();
  const [playingQuestionId, setPlayingQuestionId] = React.useState<string>();
  const [isAddingQuestion, setIsAddingQuestion] = React.useState(false);
  const [addTopic, setAddTopic] = React.useState("");
  const hasReachedQuestionLimit =
    draft.questions.length >= interviewPlanPolicy.maxQuestions;

  const addWithAI = React.useCallback(
    async (topic: string) => {
      const added = await onAddQuestion(topic);

      if (added) {
        setAddTopic("");
        setIsAddingQuestion(false);
      }
    },
    [onAddQuestion]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 pb-4">
        <p className="max-w-xl text-sm leading-6 text-ink-600">
          Prelude prepared these screening questions. Listen, edit, or add one if a signal is missing.
        </p>
        <Button variant="secondary" onClick={onRegenerate}>
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Regenerate draft
        </Button>
      </div>

      <div className="divide-y divide-ink-100 overflow-hidden rounded-3xl border border-ink-100 bg-white/76">
        {draft.questions.map((question, index) => {
          const selected = question.id === selectedQuestionId;
          const editing = question.id === editingQuestionId;
          const playing = question.id === playingQuestionId;
          const isWorkingOnQuestion = workingQuestionId === question.id;
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
                    className="block w-full cursor-pointer rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-[#e5e8d6]"
                    type="button"
                    onClick={() => onSelectQuestion(question.id)}
                  >
                    <span className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="rounded-full bg-[#eef0e3] px-2 py-0.5 text-xs font-medium text-olive-800">
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
                          disabled={isWorkingOnQuestion}
                          onClick={() => void onRefineQuestion(question.id, "sharper")}
                        >
                          <Sparkles aria-hidden="true" className="h-4 w-4" />
                          {isWorkingOnQuestion ? "Improving..." : "Improve"}
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
                        disabled={isWorkingOnQuestion}
                        onClick={() => void onRefineQuestion(question.id, "sharper")}
                      >
                        <Sparkles aria-hidden="true" className="h-4 w-4" />
                        {isWorkingOnQuestion ? "Improving..." : "Improve"}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={isWorkingOnQuestion}
                        onClick={() => void onRefineQuestion(question.id, "replace")}
                      >
                        {isWorkingOnQuestion ? "Replacing..." : "Replace"}
                      </Button>
                      <Button
                        disabled={
                          draft.questions.length <=
                          interviewPlanPolicy.minQuestionsToPublish
                        }
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

      <div className="rounded-3xl border border-dashed border-ink-200 bg-white/60 p-4 transition hover:border-olive-800">
        {hasReachedQuestionLimit ? (
          <div className="flex items-start gap-3 text-sm leading-6 text-ink-600">
            <Check aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-olive-800" />
            This role screen already has 5 questions, which is the V1 limit for
            a focused first screen.
          </div>
        ) : isAddingQuestion ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-ink-900">Add a question</p>
              <p className="mt-1 text-sm leading-5 text-ink-600">
                Tell Prelude what signal is missing, or write the question directly later.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                aria-label="Ask Prelude to add a question about"
                className="h-10 min-w-0 rounded-2xl border border-ink-200 bg-white/88 px-3 text-sm outline-none focus:border-olive-800 focus:ring-2 focus:ring-[#e5e8d6]"
                value={addTopic}
                placeholder="salary alignment, mobility, language..."
                onChange={(event) => setAddTopic(event.target.value)}
              />
              <Button
                disabled={hasReachedQuestionLimit || workingQuestionId === "new"}
                onClick={() => void addWithAI(addTopic || "screening fit")}
              >
                <Sparkles aria-hidden="true" className="h-4 w-4" />
                {workingQuestionId === "new" ? "Adding..." : "Add with Prelude"}
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
                Ask Prelude for one missing screening signal.
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
              className="rounded-3xl border border-ink-100 bg-white/76 p-4"
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
        <div className="mt-3 space-y-3 rounded-3xl border border-ink-100 bg-white/72 p-4">
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
  roleBrief,
  roleTitle,
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
  roleBrief: string;
  roleTitle: string;
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
  const publicationIssues = getInterviewPlanPublicationIssues({
    criteria: draft.criteria,
    guardrails: draft.guardrails,
    questions: draft.questions,
    responseModes: modes,
    roleBrief,
    roleTitle,
  });
  const canPublish = publicationIssues.length === 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryMetric label="Questions" value={String(draft.questions.length)} />
        <SummaryMetric label="Experience" value={getResponseModeSummary(modes)} />
        <SummaryMetric label="Organization" value={companyName} />
      </div>

      <div className="rounded-3xl border border-ink-100 bg-white/72 p-5">
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
          criteria, and candidate formats into a shareable role screen.
        </p>
      </div>

      <div className="rounded-3xl border border-ink-100 bg-white/72 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
          <ShieldCheck aria-hidden="true" className="h-4 w-4 text-ink-700" />
          Publication checks
        </div>
        {canPublish ? (
          <p className="mt-3 text-sm leading-6 text-ink-600">
            The plan has enough questions, evaluation criteria, response modes,
            and compliance guardrails to publish.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-600">
            {publicationIssues.map((issue) => (
              <li key={issue} className="flex gap-2">
                <span aria-hidden="true" className="text-coral-700">
                  -
                </span>
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {saveError ? (
        <div className="rounded-2xl border border-coral-200 bg-coral-50 p-4 text-sm font-medium text-coral-800">
          {saveError}
        </div>
      ) : null}

      {saveMessage ? (
        <div className="rounded-2xl border border-meadow-200 bg-meadow-50 p-4 text-sm font-medium text-meadow-700">
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
        <Button disabled={!canPublish || isSaving || isPublishing} onClick={onPublish}>
          {isPublishing ? "Publishing..." : "Publish role screen"}
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
      <div className="w-full max-w-sm rounded-2xl bg-white p-4">
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
            Answer by audio or form. You can preview before sending.
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
    <div className="rounded-2xl border border-ink-200 p-4">
      <p className="text-sm text-ink-500">{label}</p>
      <p className="mt-1 text-xl font-semibold leading-tight text-ink-900">{value}</p>
    </div>
  );
}

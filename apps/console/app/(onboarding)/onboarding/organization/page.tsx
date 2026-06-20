"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building,
  Check,
  Community,
  DeliveryTruck,
  EditPencil,
  MoreHoriz,
  Industry,
  Microphone,
  Shop,
  Suitcase,
  TaskList,
  VideoCamera,
} from "iconoir-react";
import type { OrganizationOnboardingJobSource } from "@prelude/contracts";
import { Button, ChoiceTile, Input, StepProgress, StepShell, cn } from "@prelude/ui";

import {
  completeOrganizationOnboarding,
  getOrganizationOnboardingProgress,
  saveOrganizationOnboardingProgress,
} from "../../../../src/server/onboarding/organization-onboarding";

type StepId =
  | "welcome"
  | "company"
  | "size"
  | "role"
  | "focus"
  | "source"
  | "jobs"
  | "mode"
  | "ready";

type JobSource = OrganizationOnboardingJobSource;

type OnboardingState = {
  companyName: string;
  companySize: string;
  role: string;
  hiringFocus: string;
  jobSource: JobSource | "";
  manualJobTitle: string;
  selectedJobId: string;
  interviewMode: string;
};

const steps: StepId[] = [
  "welcome",
  "company",
  "size",
  "role",
  "focus",
  "source",
  "jobs",
  "mode",
  "ready"
];

const indeedLogo = {
  color: "#003A9B",
  path: "M11.566 21.5633v-8.762c.2553.0231.5009.0346.758.0346 1.2225 0 2.3739-.3206 3.3506-.8928v9.6182c0 .8219-.1957 1.4287-.5757 1.8338-.378.4033-.8808.6049-1.491.6049-.6007 0-1.0766-.2016-1.468-.6183-.3781-.4032-.5739-1.01-.5739-1.8184zM11.589.5659c2.5447-.8929 5.4424-.8449 7.6186.987.405.3687.8673.8334 1.0515 1.3806.2207.6913-.7695-.073-.9057-.167-.71-.4532-1.4182-.8334-2.2127-1.0946C12.8614.3873 8.8122 2.709 6.2945 6.315c-1.0516 1.5939-1.7367 3.2721-2.299 5.1174-.0614.2017-.1094.4647-.2207.6413-.1113.2036-.048-.5453-.048-.5702.0845-.7623.2438-1.4997.4414-2.237C5.3292 5.3375 7.897 2.0655 11.5891.5658zm4.9281 7.0587c0 1.6686-1.353 3.0224-3.0205 3.0224-1.6677 0-3.0186-1.3538-3.0186-3.0224 0-1.6687 1.351-3.0224 3.0186-3.0224 1.6676 0 3.0205 1.3518 3.0205 3.0224Z"
};

const linkedinLogo = {
  viewBox: "0 0 455.731 455.731",
  background:
    "M0 0h455.731v455.731H0z",
  paths: [
    "M107.255 69.215c20.873.017 38.088 17.257 38.043 38.234-.05 21.965-18.278 38.52-38.3 38.043-20.308.411-38.155-16.551-38.151-38.188 0-20.985 17.282-38.105 38.408-38.089z",
    "M129.431 386.471H84.71c-5.804 0-10.509-4.705-10.509-10.509V185.18c0-5.804 4.705-10.509 10.509-10.509h44.721c5.804 0 10.509 4.705 10.509 10.509v190.783c-.001 5.803-4.705 10.508-10.509 10.508z",
    "M386.884 241.682c0-39.996-32.423-72.42-72.42-72.42h-11.47c-21.882 0-41.214 10.918-52.842 27.606-1.268 1.819-2.442 3.708-3.52 5.658-.373-.056-.594-.085-.599-.075v-23.418c0-2.409-1.953-4.363-4.363-4.363h-55.795c-2.409 0-4.363 1.953-4.363 4.363V382.11c0 2.409 1.952 4.362 4.361 4.363l57.011.014c2.41.001 4.364-1.953 4.364-4.363V264.801c0-20.28 16.175-37.119 36.454-37.348 10.352-.117 19.737 4.031 26.501 10.799 6.675 6.671 10.802 15.895 10.802 26.079v117.808c0 2.409 1.953 4.362 4.361 4.363l57.152.014c2.41.001 4.364-1.953 4.364-4.363V241.682z"
  ]
};

const companySizes = [
  { label: "1-10", value: "1-10" },
  { label: "11-50", value: "11-50" },
  { label: "51-200", value: "51-200" },
  { label: "201-1000", value: "201-1000" },
  { label: "1000+", value: "1000+" }
];

const roles = [
  {
    description: "I screen, qualify, and coordinate candidates.",
    icon: Community,
    label: "Recruiter",
    value: "Recruiter"
  },
  {
    description: "I own the role and need better first filters.",
    icon: Suitcase,
    label: "Hiring manager",
    value: "Hiring manager"
  },
  {
    description: "I need a lean hiring setup for a growing team.",
    icon: Building,
    label: "Founder / operator",
    value: "Founder / operator"
  },
  {
    description: "We manage hiring processes across the company.",
    icon: TaskList,
    label: "HR team",
    value: "HR team"
  }
];

const hiringFocuses = [
  {
    description: "Restaurants, hotels, tourism, and guest-facing roles.",
    icon: Shop,
    label: "Hospitality",
    value: "Hospitality"
  },
  {
    description: "Warehouse, transport, field operations, and shifts.",
    icon: DeliveryTruck,
    label: "Logistics",
    value: "Logistics"
  },
  {
    description: "Retail, customer support, sales, and service teams.",
    icon: Shop,
    label: "Customer-facing",
    value: "Customer-facing"
  },
  {
    description: "Product, engineering, data, and specialist roles.",
    icon: Industry,
    label: "Specialist roles",
    value: "Specialist roles"
  },
  {
    description: "Use this when your hiring needs do not fit a preset category.",
    icon: MoreHoriz,
    label: "Other roles",
    value: "Other roles"
  }
];

const jobSources = [
  {
    description: "Mock connection to active LinkedIn job posts.",
    label: "LinkedIn",
    value: "linkedin"
  },
  {
    description: "Mock connection to active Indeed job posts.",
    label: "Indeed",
    value: "indeed"
  },
  {
    description: "Start from a role title and add details later.",
    label: "Add manually",
    value: "manual"
  }
] satisfies Array<{
  description: string;
  label: string;
  value: JobSource;
}>;

const importedJobs = [
  {
    id: "restaurant-manager",
    location: "Paris",
    source: "LinkedIn",
    title: "Restaurant Manager"
  },
  {
    id: "warehouse-supervisor",
    location: "Lyon",
    source: "Indeed",
    title: "Warehouse Supervisor"
  },
  {
    id: "customer-support-agent",
    location: "Remote",
    source: "LinkedIn",
    title: "Customer Support Agent"
  },
  {
    id: "sales-development-rep",
    location: "Paris",
    source: "Indeed",
    title: "Sales Development Representative"
  }
];

const interviewModes = [
  {
    description: "Prelude speaks with the candidate and adapts live.",
    icon: Microphone,
    label: "Voice first",
    value: "Voice first"
  },
  {
    description: "Candidates can answer on camera when it makes sense.",
    icon: VideoCamera,
    label: "Video optional",
    value: "Video optional"
  },
  {
    description: "Keep a quiet Typeform-like fallback for candidates.",
    icon: EditPencil,
    label: "Form fallback",
    value: "Form fallback"
  }
];

const initialState: OnboardingState = {
  companyName: "",
  companySize: "",
  hiringFocus: "",
  interviewMode: "Voice first",
  jobSource: "",
  manualJobTitle: "",
  role: "",
  selectedJobId: ""
};

export default function OrganizationOnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoadingProgress, setIsLoadingProgress] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, startTransition] = useTransition();
  const [isSaving, startSavingTransition] = useTransition();
  const [state, setState] = useState<OnboardingState>(initialState);
  const saveRevision = useRef(0);

  const step = steps[currentStep] ?? "welcome";
  const availableJobs = useMemo(
    () =>
      state.jobSource === "manual"
        ? []
        : importedJobs.filter(
            (job) => job.source.toLowerCase() === state.jobSource
          ),
    [state.jobSource]
  );
  const selectedJob = useMemo(
    () => availableJobs.find((job) => job.id === state.selectedJobId),
    [availableJobs, state.selectedJobId]
  );
  const firstJobTitle =
    state.jobSource === "manual"
      ? state.manualJobTitle.trim()
      : selectedJob?.title;
  const canContinue = getCanContinue(step, state);

  function update<Key extends keyof OnboardingState>(
    key: Key,
    value: OnboardingState[Key]
  ) {
    setState((current) => ({ ...current, [key]: value }));
  }

  const persistProgress = useCallback(
    (stepId: StepId, nextState: OnboardingState) => {
      const clientRevision = saveRevision.current + 1;
      saveRevision.current = clientRevision;
      setSaveError(null);
      startSavingTransition(async () => {
        const result = await saveOrganizationOnboardingProgress({
          clientRevision,
          currentStep: stepId,
          state: toPersistedState(nextState),
        });

        if (!result.ok) {
          setSaveError(result.error);
        }
      });
    },
    [startSavingTransition],
  );

  useEffect(() => {
    let isMounted = true;

    getOrganizationOnboardingProgress().then((result) => {
      if (!isMounted) {
        return;
      }

      if (!result.ok) {
        setSaveError(result.error);
        setIsLoadingProgress(false);
        return;
      }

      if (result.completed) {
        router.replace("/");
        return;
      }

      setState(toLocalState(result.state));
      setCurrentStep(stepIndex(result.currentStep));
      setIsLoadingProgress(false);
    });

    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (isLoadingProgress) {
      return;
    }

    const timeout = window.setTimeout(() => {
      persistProgress(step, state);
    }, 600);

    return () => window.clearTimeout(timeout);
  }, [isLoadingProgress, persistProgress, state, step]);

  function goNext() {
    if (!canContinue) {
      return;
    }
    const nextStep = Math.min(currentStep + 1, steps.length - 1);
    persistProgress(steps[nextStep] ?? "ready", state);
    setCurrentStep(nextStep);
  }

  function goBack() {
    const previousStep = Math.max(currentStep - 1, 0);
    persistProgress(steps[previousStep] ?? "welcome", state);
    setCurrentStep(previousStep);
  }

  function completeOnboarding() {
    setSubmitError(null);
    startTransition(async () => {
      const result = await completeOrganizationOnboarding({
        companyName: state.companyName,
        companySize: state.companySize,
        hiringFocus: state.hiringFocus,
        interviewMode: state.interviewMode,
        jobSource: state.jobSource as JobSource,
        manualJobTitle: state.manualJobTitle,
        onboardingRole: state.role,
        selectedJob: selectedJob
          ? {
              id: selectedJob.id,
              location: selectedJob.location,
              source: selectedJob.source,
              title: selectedJob.title,
            }
          : undefined,
      });

      if (!result.ok) {
        setSubmitError(result.error);
        return;
      }

      router.push(result.redirectTo);
    });
  }

  if (isLoadingProgress) {
    return (
      <StepShell
        eyebrow="Prelude onboarding"
        title={
          <>
            Preparing your{" "}
            <span className="font-display italic text-olive-700">workspace</span>.
          </>
        }
        description="We are loading your saved setup progress."
      >
        <div className="rounded-3xl border border-ink-100 bg-white/65 p-5 text-sm text-ink-600">
          Loading workspace setup...
        </div>
      </StepShell>
    );
  }

  return (
    <StepShell
      eyebrow={step === "welcome" ? "Prelude onboarding" : "Workspace setup"}
      footer={
        <WizardFooter
          canContinue={canContinue}
          isFirst={currentStep === 0}
          isLast={step === "ready"}
          isSaving={isSaving}
          onBack={goBack}
          onNext={goNext}
        />
      }
      title={<StepTitle state={state} step={step} />}
      description={getStepDescription(step, state)}
    >
      <div className="mb-10">
        <StepProgress current={currentStep + 1} total={steps.length} />
      </div>

      {step === "welcome" ? <WelcomeStep /> : null}

      {step === "company" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            goNext();
          }}
        >
          <Input
            autoFocus
            className="h-14 rounded-2xl border-ink-200 bg-white px-4 text-lg"
            onChange={(event) => update("companyName", event.target.value)}
            placeholder="Acme Talent"
            value={state.companyName}
          />
        </form>
      ) : null}

      {step === "size" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {companySizes.map((size) => (
            <ChoiceTile
              key={size.value}
              className="min-h-24"
              onClick={() => update("companySize", size.value)}
              selected={state.companySize === size.value}
              title={size.label}
            />
          ))}
        </div>
      ) : null}

      {step === "role" ? (
        <ChoiceGrid
          options={roles}
          selected={state.role}
          onSelect={(value) => update("role", value)}
        />
      ) : null}

      {step === "focus" ? (
        <ChoiceGrid
          options={hiringFocuses}
          selected={state.hiringFocus}
          onSelect={(value) => update("hiringFocus", value)}
        />
      ) : null}

      {step === "source" ? (
        <JobSourceGrid
          options={jobSources}
          selected={state.jobSource}
          onSelect={(value) => {
            update("jobSource", value as JobSource);
            update("manualJobTitle", "");
            update("selectedJobId", "");
          }}
        />
      ) : null}

      {step === "jobs" && state.jobSource === "manual" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            goNext();
          }}
        >
          <Input
            autoFocus
            className="h-14 rounded-2xl border-ink-200 bg-white px-4 text-lg"
            onChange={(event) => update("manualJobTitle", event.target.value)}
            placeholder="Restaurant Manager"
            value={state.manualJobTitle}
          />
        </form>
      ) : null}

      {step === "jobs" && state.jobSource !== "manual" ? (
        <div className="space-y-3">
          {availableJobs.map((job) => (
            <button
              key={job.id}
              className={cn(
                "flex w-full cursor-pointer items-center justify-between rounded-3xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
                state.selectedJobId === job.id
                  ? "border-olive-700 bg-[#eef0e3]"
                  : "border-ink-100 bg-white/60 hover:border-ink-300 hover:bg-white"
              )}
              onClick={() => update("selectedJobId", job.id)}
              type="button"
            >
              <span>
                <span className="block text-base font-semibold text-ink-900">
                  {job.title}
                </span>
                <span className="mt-1 block text-sm text-ink-600">
                  {job.location} · {job.source}
                </span>
              </span>
              {state.selectedJobId === job.id ? (
                <span className="grid h-8 w-8 place-items-center rounded-full bg-olive-800 text-white">
                  <Check aria-hidden="true" className="h-4 w-4" />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {step === "mode" ? (
        <ChoiceGrid
          options={interviewModes}
          selected={state.interviewMode}
          onSelect={(value) => update("interviewMode", value)}
        />
      ) : null}

      {step === "ready" ? (
        <div className="rounded-3xl border border-ink-100 bg-white/65 p-5">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <SummaryItem label="Workspace" value={state.companyName} />
            <SummaryItem label="Company size" value={state.companySize} />
            <SummaryItem label="Your role" value={state.role} />
            <SummaryItem label="Hiring focus" value={state.hiringFocus} />
            <SummaryItem
              label="Job source"
              value={formatJobSource(state.jobSource)}
            />
            <SummaryItem label="First job" value={firstJobTitle ?? "Not selected"} />
            <SummaryItem label="Candidate mode" value={state.interviewMode} />
          </dl>
          {submitError ? (
            <p className="mt-5 rounded-2xl border border-[#f4c7b7] bg-[#fff4f0] px-4 py-3 text-sm text-[#8f2f1a]">
              {submitError}
            </p>
          ) : null}
          {saveError ? (
            <p className="mt-5 rounded-2xl border border-[#f4c7b7] bg-[#fff4f0] px-4 py-3 text-sm text-[#8f2f1a]">
              {saveError}
            </p>
          ) : null}
          <div className="mt-6">
            <Button
              className="w-full sm:w-auto"
              disabled={isSubmitting}
              onClick={completeOnboarding}
            >
              {isSubmitting ? "Creating..." : "Finish workspace setup"}
            </Button>
          </div>
        </div>
      ) : null}
    </StepShell>
  );
}

function JobSourceGrid({
  onSelect,
  options,
  selected
}: {
  onSelect: (value: JobSource) => void;
  options: Array<{
    description: string;
    label: string;
    value: JobSource;
  }>;
  selected: JobSource | "";
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {options.map((option) => {
        const isManual = option.value === "manual";
        const isSelected = selected === option.value;

        return (
          <button
            key={option.value}
            aria-pressed={isSelected}
            className={cn(
              "group flex min-h-40 w-full cursor-pointer flex-col rounded-3xl border p-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5e8d6]",
              isManual ? "sm:col-span-2" : undefined,
              isSelected
                ? "border-olive-700 bg-[#eef0e3]"
                : "border-ink-100 bg-white/55 hover:border-ink-300 hover:bg-white"
            )}
            onClick={() => onSelect(option.value)}
            type="button"
          >
            <span className="flex items-start justify-between gap-4">
              <span className="flex items-center gap-3">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl border border-ink-100 bg-white">
                  <SourceLogo source={option.value} />
                </span>
                <span>
                  <span className="block text-base font-semibold text-ink-900">
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                    {isManual ? "No connector" : "Mock connector"}
                  </span>
                </span>
              </span>
              {isSelected ? (
                <span className="grid h-7 w-7 place-items-center rounded-full bg-olive-800 text-white">
                  <Check aria-hidden="true" className="h-4 w-4" />
                </span>
              ) : null}
            </span>
            <span className="mt-6 max-w-sm text-sm leading-6 text-ink-600">
              {option.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SourceLogo({ source }: { source: JobSource }) {
  if (source === "linkedin") {
    return (
      <svg
        aria-hidden="true"
        className="h-7 w-7"
        role="img"
        viewBox={linkedinLogo.viewBox}
      >
        <path d={linkedinLogo.background} fill="#0084B1" />
        {linkedinLogo.paths.map((path) => (
          <path key={path} d={path} fill="#FFFFFF" />
        ))}
      </svg>
    );
  }

  if (source === "indeed") {
    return (
      <svg
        aria-hidden="true"
        className="h-7 w-7"
        fill={indeedLogo.color}
        role="img"
        viewBox="0 0 24 24"
      >
        <path d={indeedLogo.path} />
      </svg>
    );
  }

  return <EditPencil aria-hidden="true" className="h-6 w-6 text-ink-800" />;
}

function ChoiceGrid({
  onSelect,
  options,
  selected
}: {
  onSelect: (value: string) => void;
  options: Array<{
    description: string;
    icon: typeof Suitcase;
    label: string;
    value: string;
  }>;
  selected: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {options.map((option) => {
        const Icon = option.icon;

        return (
          <ChoiceTile
            key={option.value}
            description={option.description}
            icon={<Icon className="h-6 w-6" />}
            onClick={() => onSelect(option.value)}
            selected={selected === option.value}
            title={option.label}
          />
        );
      })}
    </div>
  );
}

function StepTitle({ state, step }: { state: OnboardingState; step: StepId }) {
  if (step === "welcome") {
    return (
      <>
        Let’s create your{" "}
        <span className="font-display italic text-olive-700">hiring</span>{" "}
        workspace.
      </>
    );
  }

  if (step === "company") {
    return "What’s your company or team name?";
  }

  if (step === "size") {
    return "How many people work there?";
  }

  if (step === "role") {
    return "What best describes your role?";
  }

  if (step === "focus") {
    return "What roles do you usually screen?";
  }

  if (step === "source") {
    return (
      <>
        Import your{" "}
        <span className="font-display italic text-olive-700">active roles</span>.
      </>
    );
  }

  if (step === "jobs") {
    return state.jobSource === "manual"
      ? "What role are you hiring for?"
      : "Which job post should we draft first?";
  }

  if (step === "mode") {
    return "How should candidates answer?";
  }

  return `${state.companyName || "Your workspace"} is ready.`;
}

function getStepDescription(step: StepId, state: OnboardingState) {
  if (step === "welcome") {
    return "A few focused questions help Prelude tailor the first interview draft without turning setup into an admin form.";
  }

  if (step === "size") {
    return "This helps us tune the experience for your hiring volume and organization shape.";
  }

  if (step === "source") {
    return "LinkedIn and Indeed are mocked for now, but the flow is designed for real connectors later.";
  }

  if (step === "jobs") {
    return state.jobSource === "manual"
      ? "Enter the first job title. You can add the description and criteria before generating questions."
      : "Pick one active post. Prelude will use it to generate your first interview draft.";
  }

  if (step === "mode") {
    return "This becomes the default for new pre-screen interviews. Recruiters can override it per role later.";
  }

  if (step === "ready") {
    return "We have enough context to create the workspace and prepare the first role on your dashboard.";
  }

  return undefined;
}

function getCanContinue(step: StepId, state: OnboardingState) {
  if (step === "company") {
    return state.companyName.trim().length >= 2;
  }

  if (step === "size") {
    return Boolean(state.companySize);
  }

  if (step === "role") {
    return Boolean(state.role);
  }

  if (step === "focus") {
    return Boolean(state.hiringFocus);
  }

  if (step === "source") {
    return Boolean(state.jobSource);
  }

  if (step === "jobs") {
    return state.jobSource === "manual"
      ? state.manualJobTitle.trim().length >= 2
      : Boolean(state.selectedJobId);
  }

  if (step === "mode") {
    return Boolean(state.interviewMode);
  }

  return true;
}

function WizardFooter({
  canContinue,
  isFirst,
  isLast,
  isSaving,
  onBack,
  onNext
}: {
  canContinue: boolean;
  isFirst: boolean;
  isLast: boolean;
  isSaving: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  if (isLast) {
    return null;
  }

  return (
    <div className="flex items-center justify-between">
      <Button
        className={cn(isFirst ? "invisible" : undefined)}
        onClick={onBack}
        variant="ghost"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back
      </Button>
      <span className="flex items-center gap-3">
        {isSaving ? (
          <span className="text-xs font-medium text-ink-400">Saving...</span>
        ) : null}
        <Button disabled={!canContinue} onClick={onNext}>
          Continue
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Button>
      </span>
    </div>
  );
}

function stepIndex(step: StepId) {
  return Math.max(0, steps.indexOf(step));
}

function toLocalState(state: ReturnType<typeof toPersistedState>): OnboardingState {
  return {
    companyName: state.companyName,
    companySize: state.companySize,
    hiringFocus: state.hiringFocus,
    interviewMode: state.interviewMode,
    jobSource: state.jobSource,
    manualJobTitle: state.manualJobTitle,
    role: state.onboardingRole,
    selectedJobId: state.selectedJobId,
  };
}

function toPersistedState(state: OnboardingState) {
  return {
    companyName: state.companyName,
    companySize: state.companySize,
    hiringFocus: state.hiringFocus,
    interviewMode: state.interviewMode,
    jobSource: state.jobSource,
    manualJobTitle: state.manualJobTitle,
    onboardingRole: state.role,
    selectedJobId: state.selectedJobId,
  };
}

function WelcomeStep() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-3xl border border-ink-100 bg-white/55 p-4">
        <p className="text-sm font-semibold text-ink-900">One question at a time</p>
        <p className="mt-2 text-sm leading-6 text-ink-600">
          The setup stays focused, closer to Typeform and Tally than a settings form.
        </p>
      </div>
      <div className="rounded-3xl border border-ink-100 bg-white/55 p-4">
        <p className="text-sm font-semibold text-ink-900">Mock job imports</p>
        <p className="mt-2 text-sm leading-6 text-ink-600">
          Validate LinkedIn and Indeed onboarding before real partner APIs.
        </p>
      </div>
      <div className="rounded-3xl border border-ink-100 bg-white/55 p-4">
        <p className="text-sm font-semibold text-ink-900">Ready to draft</p>
        <p className="mt-2 text-sm leading-6 text-ink-600">
          The flow lands directly on the first interview draft action.
        </p>
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
        {label}
      </dt>
      <dd className="mt-1 text-base font-medium text-ink-900">{value}</dd>
    </div>
  );
}

function formatJobSource(source: JobSource | "") {
  if (source === "linkedin") {
    return "LinkedIn mock";
  }

  if (source === "indeed") {
    return "Indeed mock";
  }

  return "Manual";
}

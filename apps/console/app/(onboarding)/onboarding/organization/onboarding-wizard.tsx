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
} from "iconoir-react";
import type { OrganizationOnboardingJobSource } from "@prelude/contracts";
import {
  Button,
  ChoiceTile,
  Input,
  RadioCardGroup,
  StepProgress,
  StepShell,
  cn,
} from "@prelude/ui";

import {
  completeOrganizationOnboarding,
  getOrganizationOnboardingProgress,
  saveOrganizationOnboardingProgress,
} from "../../../../src/server/onboarding/organization-onboarding";
import { IntegrationLogo } from "../../../../src/features/integrations/integration-logo";

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
  "ready",
];

const companySizes = [
  { label: "1-10", value: "1-10" },
  { label: "11-50", value: "11-50" },
  { label: "51-200", value: "51-200" },
  { label: "201-1000", value: "201-1000" },
  { label: "1000+", value: "1000+" },
];

const roles = [
  {
    description: "I screen, qualify, and coordinate candidates.",
    icon: Community,
    label: "Recruiter",
    value: "Recruiter",
  },
  {
    description: "I own the role and need better first filters.",
    icon: Suitcase,
    label: "Hiring manager",
    value: "Hiring manager",
  },
  {
    description: "I need a lean hiring setup for a growing team.",
    icon: Building,
    label: "Founder / operator",
    value: "Founder / operator",
  },
  {
    description: "We manage hiring processes across the company.",
    icon: TaskList,
    label: "HR team",
    value: "HR team",
  },
];

const hiringFocuses = [
  {
    description: "Restaurants, hotels, tourism, and guest-facing roles.",
    icon: Shop,
    label: "Hospitality",
    value: "Hospitality",
  },
  {
    description: "Warehouse, transport, field operations, and shifts.",
    icon: DeliveryTruck,
    label: "Logistics",
    value: "Logistics",
  },
  {
    description: "Retail, customer support, sales, and service teams.",
    icon: Shop,
    label: "Customer-facing",
    value: "Customer-facing",
  },
  {
    description: "Product, engineering, data, and specialist roles.",
    icon: Industry,
    label: "Specialist roles",
    value: "Specialist roles",
  },
  {
    description:
      "Use this when your hiring needs do not fit a preset category.",
    icon: MoreHoriz,
    label: "Other roles",
    value: "Other roles",
  },
];

const jobSources = [
  {
    description: "Mock connection to active LinkedIn job posts.",
    label: "LinkedIn",
    value: "linkedin",
  },
  {
    description: "Mock connection to active Indeed job posts.",
    label: "Indeed",
    value: "indeed",
  },
  {
    description: "Start from a role title and add details later.",
    label: "Add manually",
    value: "manual",
  },
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
    title: "Restaurant Manager",
  },
  {
    id: "warehouse-supervisor",
    location: "Lyon",
    source: "Indeed",
    title: "Warehouse Supervisor",
  },
  {
    id: "customer-support-agent",
    location: "Remote",
    source: "LinkedIn",
    title: "Customer Support Agent",
  },
  {
    id: "sales-development-rep",
    location: "Paris",
    source: "Indeed",
    title: "Sales Development Representative",
  },
];

const interviewModes = [
  {
    description: "HireCall speaks with the candidate and adapts live.",
    icon: Microphone,
    label: "Voice first",
    value: "Voice first",
  },
  {
    description: "Keep a quiet Typeform-like fallback for candidates.",
    icon: EditPencil,
    label: "Form fallback",
    value: "Form fallback",
  },
];

const defaultInterviewMode = "Voice first";
const supportedInterviewModes = new Set(
  interviewModes.map((mode) => mode.value),
);

const initialState: OnboardingState = {
  companyName: "",
  companySize: "",
  hiringFocus: "",
  interviewMode: defaultInterviewMode,
  jobSource: "",
  manualJobTitle: "",
  role: "",
  selectedJobId: "",
};

export function OnboardingWizard() {
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
            (job) => job.source.toLowerCase() === state.jobSource,
          ),
    [state.jobSource],
  );
  const selectedJob = useMemo(
    () => availableJobs.find((job) => job.id === state.selectedJobId),
    [availableJobs, state.selectedJobId],
  );
  const firstJobTitle =
    state.jobSource === "manual"
      ? state.manualJobTitle.trim()
      : selectedJob?.title;
  const canContinue = getCanContinue(step, state);

  function update<Key extends keyof OnboardingState>(
    key: Key,
    value: OnboardingState[Key],
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
        eyebrow="HireCall onboarding"
        title={
          <>
            Preparing your{" "}
            <span className="font-display italic text-olive-700">
              workspace
            </span>
            .
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
      eyebrow={step === "welcome" ? "HireCall onboarding" : "Workspace setup"}
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
        <RadioCardGroup
          ariaLabel="Select first job"
          className="space-y-3"
          indicatorShape="circle"
          onValueChange={(value) => update("selectedJobId", value)}
          options={availableJobs.map((job) => ({
            description: `${job.location} · ${job.source}`,
            label: job.title,
            value: job.id,
          }))}
          value={state.selectedJobId}
        />
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
            <SummaryItem
              label="First job"
              value={firstJobTitle ?? "Not selected"}
            />
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
  selected,
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
                : "border-ink-100 bg-white/55 hover:border-ink-300 hover:bg-white",
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
    return <IntegrationLogo brand="linkedin" className="h-11 w-11" />;
  }

  if (source === "indeed") {
    return <IntegrationLogo brand="indeed" className="h-11 w-11" />;
  }

  return <EditPencil aria-hidden="true" className="h-6 w-6 text-ink-800" />;
}

function ChoiceGrid({
  onSelect,
  options,
  selected,
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
        <span className="font-display italic text-olive-700">active roles</span>
        .
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
    return "A few focused questions help HireCall tailor the first interview draft without turning setup into an admin form.";
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
      : "Pick one active post. HireCall will use it to generate your first interview draft.";
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
  onNext,
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

function toLocalState(
  state: ReturnType<typeof toPersistedState>,
): OnboardingState {
  return {
    companyName: state.companyName,
    companySize: state.companySize,
    hiringFocus: state.hiringFocus,
    interviewMode: normalizeInterviewMode(state.interviewMode),
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
    interviewMode: normalizeInterviewMode(state.interviewMode),
    jobSource: state.jobSource,
    manualJobTitle: state.manualJobTitle,
    onboardingRole: state.role,
    selectedJobId: state.selectedJobId,
  };
}

function normalizeInterviewMode(value: string) {
  return supportedInterviewModes.has(value) ? value : defaultInterviewMode;
}

function WelcomeStep() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-3xl border border-ink-100 bg-white/55 p-4">
        <p className="text-sm font-semibold text-ink-900">
          One question at a time
        </p>
        <p className="mt-2 text-sm leading-6 text-ink-600">
          The setup stays focused, closer to Typeform and Tally than a settings
          form.
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

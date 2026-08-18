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
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
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

/*
 * `value` is persisted (Organization.onboardingRole, hiringFocus,
 * interviewMode) and is NOT a display string: translating it would write
 * French into rows an English workspace also reads, and would orphan every
 * value already stored. Only the label and description are translated, which
 * is why they are keys and the value stays a literal.
 */
const roles = [
  {
    descriptionKey: "onboarding.roleRecruiterDescription",
    icon: Community,
    labelKey: "onboarding.roleRecruiterLabel",
    value: "Recruiter",
  },
  {
    descriptionKey: "onboarding.roleHiringManagerDescription",
    icon: Suitcase,
    labelKey: "onboarding.roleHiringManagerLabel",
    value: "Hiring manager",
  },
  {
    descriptionKey: "onboarding.roleFounderDescription",
    icon: Building,
    labelKey: "onboarding.roleFounderLabel",
    value: "Founder / operator",
  },
  {
    descriptionKey: "onboarding.roleHrTeamDescription",
    icon: TaskList,
    labelKey: "onboarding.roleHrTeamLabel",
    value: "HR team",
  },
];

const hiringFocuses = [
  {
    descriptionKey: "onboarding.focusHospitalityDescription",
    icon: Shop,
    labelKey: "onboarding.focusHospitalityLabel",
    value: "Hospitality",
  },
  {
    descriptionKey: "onboarding.focusLogisticsDescription",
    icon: DeliveryTruck,
    labelKey: "onboarding.focusLogisticsLabel",
    value: "Logistics",
  },
  {
    descriptionKey: "onboarding.focusCustomerFacingDescription",
    icon: Shop,
    labelKey: "onboarding.focusCustomerFacingLabel",
    value: "Customer-facing",
  },
  {
    descriptionKey: "onboarding.focusSpecialistDescription",
    icon: Industry,
    labelKey: "onboarding.focusSpecialistLabel",
    value: "Specialist roles",
  },
  {
    descriptionKey: "onboarding.focusOtherDescription",
    icon: MoreHoriz,
    labelKey: "onboarding.focusOtherLabel",
    value: "Other roles",
  },
];

// LinkedIn and Indeed are product names and stay untranslated; only the
// "add manually" option has a label to speak.
const jobSources = [
  {
    descriptionKey: "onboarding.sourceLinkedinDescription",
    label: "LinkedIn",
    value: "linkedin",
  },
  {
    descriptionKey: "onboarding.sourceIndeedDescription",
    label: "Indeed",
    value: "indeed",
  },
  {
    descriptionKey: "onboarding.sourceManualDescription",
    labelKey: "onboarding.sourceManualLabel",
    value: "manual",
  },
] satisfies Array<{
  descriptionKey: string;
  label?: string;
  labelKey?: string;
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
    descriptionKey: "onboarding.modeVoiceDescription",
    icon: Microphone,
    labelKey: "onboarding.modeVoiceLabel",
    value: "Voice first",
  },
  {
    descriptionKey: "onboarding.modeFormDescription",
    icon: EditPencil,
    labelKey: "onboarding.modeFormLabel",
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

/*
 * The emphasised word inside a title is not the same word in every language —
 * "Let's create your *hiring* workspace" versus "Créons votre espace de
 * *recrutement*" — and it does not sit in the same place either. `<Trans>`
 * keeps each title as one translatable sentence with the emphasis marked
 * inside it, rather than three fragments a translator has to reassemble.
 */
function EmphasisedTitle({ i18nKey, values }: { i18nKey: string; values?: Record<string, string> }) {
  return (
    <Trans
      components={{
        em: <span className="font-display italic text-olive-700" />,
      }}
      i18nKey={i18nKey}
      values={values}
    />
  );
}

export function OnboardingWizard() {
  const { t } = useTranslation();
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
        eyebrow={t("onboarding.eyebrowWelcome")}
        title={<EmphasisedTitle i18nKey="onboarding.loadingTitle" />}
        description={t("onboarding.loadingDescription")}
      >
        <div className="rounded-3xl border border-ink-100 bg-white/65 p-5 text-sm text-ink-600">
          {t("onboarding.loadingBody")}
        </div>
      </StepShell>
    );
  }

  return (
    <StepShell
      eyebrow={
        step === "welcome"
          ? t("onboarding.eyebrowWelcome")
          : t("onboarding.eyebrowSetup")
      }
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
      description={getStepDescription(step, state, t)}
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
            placeholder={t("onboarding.companyPlaceholder")}
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
            placeholder={t("onboarding.manualJobPlaceholder")}
            value={state.manualJobTitle}
          />
        </form>
      ) : null}

      {step === "jobs" && state.jobSource !== "manual" ? (
        <RadioCardGroup
          ariaLabel={t("onboarding.selectFirstJobAria")}
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
            {/*
              The recap reads back the persisted values, which are English
              literals by design (see the note on `roles`). Each one is mapped
              back to its translated label so the summary speaks the reader's
              language instead of echoing the stored key.
            */}
            <SummaryItem
              label={t("onboarding.summaryWorkspace")}
              value={state.companyName}
            />
            <SummaryItem
              label={t("onboarding.summaryCompanySize")}
              value={state.companySize}
            />
            <SummaryItem
              label={t("onboarding.summaryRole")}
              value={translatedLabelFor(roles, state.role, t)}
            />
            <SummaryItem
              label={t("onboarding.summaryHiringFocus")}
              value={translatedLabelFor(hiringFocuses, state.hiringFocus, t)}
            />
            <SummaryItem
              label={t("onboarding.summaryJobSource")}
              value={formatJobSource(state.jobSource, t)}
            />
            <SummaryItem
              label={t("onboarding.summaryFirstJob")}
              value={firstJobTitle ?? t("onboarding.summaryNotSelected")}
            />
            <SummaryItem
              label={t("onboarding.summaryCandidateMode")}
              value={translatedLabelFor(
                interviewModes,
                state.interviewMode,
                t,
              )}
            />
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
              {isSubmitting
                ? t("onboarding.creating")
                : t("onboarding.finish")}
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
    descriptionKey: string;
    label?: string;
    labelKey?: string;
    value: JobSource;
  }>;
  selected: JobSource | "";
}) {
  const { t } = useTranslation();

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
                    {option.labelKey ? t(option.labelKey) : option.label}
                  </span>
                  <span className="mt-1 block text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                    {isManual
                      ? t("onboarding.sourceConnectorNone")
                      : t("onboarding.sourceConnectorMock")}
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
              {t(option.descriptionKey)}
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

type LabelledChoice = {
  descriptionKey: string;
  icon: typeof Suitcase;
  labelKey: string;
  value: string;
};

function ChoiceGrid({
  onSelect,
  options,
  selected,
}: {
  onSelect: (value: string) => void;
  options: LabelledChoice[];
  selected: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {options.map((option) => {
        const Icon = option.icon;

        return (
          <ChoiceTile
            key={option.value}
            description={t(option.descriptionKey)}
            icon={<Icon className="h-6 w-6" />}
            onClick={() => onSelect(option.value)}
            selected={selected === option.value}
            title={t(option.labelKey)}
          />
        );
      })}
    </div>
  );
}

// The stored value is an English literal; this maps it back to whatever the
// reader's language calls it. Falls back to the raw value so a legacy or
// hand-edited row still shows something rather than an empty cell.
function translatedLabelFor(
  options: Array<{ labelKey: string; value: string }>,
  value: string,
  t: TFunction,
) {
  const match = options.find((option) => option.value === value);
  return match ? t(match.labelKey) : value;
}

function StepTitle({ state, step }: { state: OnboardingState; step: StepId }) {
  const { t } = useTranslation();

  if (step === "welcome") {
    return <EmphasisedTitle i18nKey="onboarding.titleWelcome" />;
  }

  if (step === "company") {
    return t("onboarding.titleCompany");
  }

  if (step === "size") {
    return t("onboarding.titleSize");
  }

  if (step === "role") {
    return t("onboarding.titleRole");
  }

  if (step === "focus") {
    return t("onboarding.titleFocus");
  }

  if (step === "source") {
    return <EmphasisedTitle i18nKey="onboarding.titleSource" />;
  }

  if (step === "jobs") {
    return state.jobSource === "manual"
      ? t("onboarding.titleJobsManual")
      : t("onboarding.titleJobsImported");
  }

  if (step === "mode") {
    return t("onboarding.titleMode");
  }

  return t("onboarding.titleReady", {
    workspace: state.companyName || t("onboarding.titleReadyFallback"),
  });
}

function getStepDescription(
  step: StepId,
  state: OnboardingState,
  t: TFunction,
) {
  if (step === "welcome") {
    return t("onboarding.descriptionWelcome");
  }

  if (step === "size") {
    return t("onboarding.descriptionSize");
  }

  if (step === "source") {
    return t("onboarding.descriptionSource");
  }

  if (step === "jobs") {
    return state.jobSource === "manual"
      ? t("onboarding.descriptionJobsManual")
      : t("onboarding.descriptionJobsImported");
  }

  if (step === "mode") {
    return t("onboarding.descriptionMode");
  }

  if (step === "ready") {
    return t("onboarding.descriptionReady");
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
  const { t } = useTranslation();

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
        {t("onboarding.back")}
      </Button>
      <span className="flex items-center gap-3">
        {isSaving ? (
          <span className="text-xs font-medium text-ink-400">
            {t("onboarding.saving")}
          </span>
        ) : null}
        <Button disabled={!canContinue} onClick={onNext}>
          {t("onboarding.continue")}
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
  const { t } = useTranslation();
  const cards = [
    {
      body: t("onboarding.welcomeCardFocusBody"),
      key: "focus",
      title: t("onboarding.welcomeCardFocusTitle"),
    },
    {
      body: t("onboarding.welcomeCardImportsBody"),
      key: "imports",
      title: t("onboarding.welcomeCardImportsTitle"),
    },
    {
      body: t("onboarding.welcomeCardDraftBody"),
      key: "draft",
      title: t("onboarding.welcomeCardDraftTitle"),
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((card) => (
        <div
          className="rounded-3xl border border-ink-100 bg-white/55 p-4"
          key={card.key}
        >
          <p className="text-sm font-semibold text-ink-900">{card.title}</p>
          <p className="mt-2 text-sm leading-6 text-ink-600">{card.body}</p>
        </div>
      ))}
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

function formatJobSource(source: JobSource | "", t: TFunction) {
  if (source === "linkedin") {
    return t("onboarding.jobSourceLinkedinMock");
  }

  if (source === "indeed") {
    return t("onboarding.jobSourceIndeedMock");
  }

  return t("onboarding.jobSourceManual");
}

import type { LiveInterviewRecruiterSummary } from "@prelude/contracts";
import { Button, StatusBadge } from "@prelude/ui";
import {
  ArrowRight,
  Calendar,
  CheckCircle,
  ClipboardCheck,
  HelpCircle,
  MessageText,
  NavArrowDown as ChevronDown,
  Page as FileText,
  ShieldCheck,
  Sparks as Sparkles,
  Strategy as Target,
  Suitcase as BriefcaseBusiness,
  UserBadgeCheck as UserRoundCheck,
  WarningTriangle as AlertTriangle,
} from "iconoir-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

type RecruiterSummaryPanelProps = {
  summary: LiveInterviewRecruiterSummary;
};

type Tone = "green" | "amber" | "red" | "neutral";

const statusTone: Record<string, Tone> = {
  satisfied: "green",
  unclear: "amber",
  missing: "red",
  not_assessed: "neutral",
};

const toneClasses: Record<Tone, string> = {
  green: "bg-meadow-50 text-meadow-800",
  amber: "bg-gold-100 text-gold-800",
  red: "bg-coral-50 text-coral-800",
  neutral: "bg-ink-100 text-ink-700",
};

const categoryConfig: Record<
  string,
  { labelKey: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; classes: string }
> = {
  role_fit: {
    labelKey: "candidateReview.categoryRoleFit",
    icon: Target,
    classes: "bg-[#eef7ff] text-[#245b89]",
  },
  experience: {
    labelKey: "candidateReview.categoryExperience",
    icon: BriefcaseBusiness,
    classes: "bg-[#f6f1ff] text-[#68439c]",
  },
  communication: {
    labelKey: "candidateReview.categoryCommunication",
    icon: MessageText,
    classes: "bg-meadow-100 text-meadow-700",
  },
  availability: {
    labelKey: "candidateReview.categoryLogistics",
    icon: Calendar,
    classes: "bg-gold-100 text-gold-800",
  },
};

export function RecruiterSummaryPanel({ summary }: RecruiterSummaryPanelProps) {
  const { t } = useTranslation();
  const satisfiedCriteria = summary.criteria.filter(
    (criterion) => criterion.status === "satisfied",
  ).length;
  const needsAttention = summary.criteria.length - satisfiedCriteria;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <section className="rounded-3xl border border-ink-100 bg-white/76 px-5 py-5 backdrop-blur md:px-6 md:py-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="dark">{t("candidateReview.interviewRecap")}</StatusBadge>
              <StatusBadge tone={summary.status === "complete" ? "success" : "warning"}>
                {summary.status === "complete"
                  ? t("candidateReview.recapComplete")
                  : t("candidateReview.recapIncomplete")}
              </StatusBadge>
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-normal text-ink-900 md:text-4xl">
              {summary.roleTitle}
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-ink-600">
              {summary.overview}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button>
                Continue review
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Button>
              <Button variant="secondary">
                <Sparkles aria-hidden="true" className="h-4 w-4" />
                Ask AI
              </Button>
            </div>
          </div>

          <div className="w-full rounded-3xl border border-ink-100 bg-[#f7f7ef] p-4 lg:max-w-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-600">
              <ClipboardCheck aria-hidden="true" className="h-4 w-4" />
              Recruiter decision
            </div>
            <h2 className="mt-3 text-xl font-semibold text-ink-900">
              {summary.recommendation.label}
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-600">
              {summary.recommendation.rationale}
            </p>
          </div>
        </div>

        <dl className="mt-6 grid gap-3 border-t border-ink-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label={t("candidateReview.metricSignalsCaptured")}
            value={`${satisfiedCriteria}/${summary.criteria.length}`}
          />
          <Metric
            label={t("candidateReview.metricNeedsAttention")}
            value={String(needsAttention)}
          />
          <Metric
            label={t("candidateReview.metricAnalysisMode")}
            value={formatGenerator(summary.generator, t)}
          />
          <Metric
            label={t("candidateReview.metricEvidence")}
            value={t("candidateReview.metricEvidenceValue", {
              count: summary.audit.sourceEventIds.length,
            })}
          />
        </dl>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-5">
          <DecisionBrief summary={summary} />
          <QuestionReview questions={summary.questionNotes} />
        </div>

        <aside className="flex flex-col gap-5">
          <ReviewChecklist
            missingInformation={summary.missingInformation}
            followUpQuestions={summary.followUpQuestions}
            logisticsNotes={summary.logisticsNotes}
          />
          <GuardrailPanel summary={summary} />
        </aside>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-ink-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-ink-900">{value}</dd>
    </div>
  );
}

function DecisionBrief({
  summary,
}: {
  summary: LiveInterviewRecruiterSummary;
}) {
  const { t } = useTranslation();

  return (
    <section className="rounded-3xl border border-ink-100 bg-white/76 p-5 backdrop-blur">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <UserRoundCheck aria-hidden="true" className="h-4 w-4" />
            Decision brief
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {t("candidateReview.summaryShortRead")}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <SignalColumn
          empty={t("candidateReview.whatWorksEmpty")}
          icon={<CheckCircle aria-hidden="true" className="h-4 w-4" />}
          signals={summary.strengths}
          title={t("candidateReview.whatWorks")}
        />
        <SignalColumn
          empty={t("candidateReview.whatToValidateEmpty")}
          icon={<AlertTriangle aria-hidden="true" className="h-4 w-4" />}
          signals={summary.risks}
          title={t("candidateReview.whatToValidate")}
        />
      </div>
    </section>
  );
}

function SignalColumn({
  empty,
  icon,
  signals,
  title,
}: {
  empty: string;
  icon: ReactNode;
  signals: LiveInterviewRecruiterSummary["strengths"];
  title: string;
}) {
  return (
    <div className="rounded-3xl border border-ink-100 bg-white/62 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        {icon}
        {title}
      </div>
      {signals.length === 0 ? (
        <p className="mt-4 text-sm leading-6 text-ink-600">{empty}</p>
      ) : (
        <div className="mt-4 space-y-4">
          {signals.map((signal) => (
            <article key={`${signal.title}-${signal.explanation}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium text-ink-900">
                  {signal.title}
                </h3>
                <StatusBadge tone="neutral">
                  {signal.confidence} confidence
                </StatusBadge>
              </div>
              <p className="mt-2 text-sm leading-6 text-ink-600">
                {signal.explanation}
              </p>
              <EvidenceList evidence={signal.evidence} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionReview({
  questions,
}: {
  questions: LiveInterviewRecruiterSummary["questionNotes"];
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-ink-100 bg-white/76 backdrop-blur">
      <div className="flex flex-col gap-2 border-b border-ink-100 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <FileText aria-hidden="true" className="h-4 w-4" />
            Question review
          </div>
          <p className="mt-1 text-sm text-ink-500">
            One line of judgment per question, with evidence underneath.
          </p>
        </div>
        <Button className="h-9 px-3" variant="secondary">
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          Refine recap
        </Button>
      </div>

      <div className="divide-y divide-ink-100">
        {questions.map((note, index) => (
          <article key={note.questionId} className="p-5">
            <div className="flex gap-4">
              <CategoryIcon category={note.category} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge className={statusClass(note.answerStatus)}>
                    {formatStatus(note.answerStatus)}
                  </StatusBadge>
                  <span className="text-sm text-ink-500">
                    Question {index + 1}
                  </span>
                </div>
                <h3 className="mt-2 text-base font-semibold leading-6 text-ink-900">
                  {note.prompt}
                </h3>
                <p className="mt-2 text-sm leading-6 text-ink-600">
                  {note.answerSummary}
                </p>
                <EvidenceList evidence={note.evidence} />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CategoryIcon({ category }: { category: string }) {
  const { t } = useTranslation();
  const known = categoryConfig[category];
  // An unknown category has no catalogue entry, so it falls back to its own
  // readable form rather than rendering a missing key.
  const label = known ? t(known.labelKey) : formatStatus(category);
  const Icon = known?.icon ?? HelpCircle;
  const classes = known?.classes ?? "bg-ink-100 text-ink-700";

  return (
    <div
      aria-label={label}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${classes}`}
      title={label}
    >
      <Icon aria-hidden="true" className="h-5 w-5" />
    </div>
  );
}

function ReviewChecklist({
  missingInformation,
  followUpQuestions,
  logisticsNotes,
}: {
  missingInformation: string[];
  followUpQuestions: string[];
  logisticsNotes: string[];
}) {
  const { t } = useTranslation();

  return (
    <section className="rounded-3xl border border-ink-100 bg-white/76 p-5 backdrop-blur">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        <Target aria-hidden="true" className="h-4 w-4" />
        {t("candidateReview.recruiterNextStep")}
      </div>
      <p className="mt-2 text-sm leading-6 text-ink-600">
        {t("candidateReview.recruiterNextStepIntro")}
      </p>

      <CompactList
        title={t("candidateReview.clarifyFirst")}
        values={missingInformation}
      />
      <CompactList
        title={t("candidateReview.suggestedQuestions")}
        values={followUpQuestions}
      />
      <CompactList
        title={t("candidateReview.categoryLogistics")}
        values={logisticsNotes}
      />
    </section>
  );
}

function CompactList({ title, values }: { title: string; values: string[] }) {
  if (values.length === 0) {
    return null;
  }

  return (
    <div className="mt-5">
      <h3 className="text-xs font-semibold uppercase text-ink-500">{title}</h3>
      <ul className="mt-3 space-y-3">
        {values.map((value) => (
          <li key={value} className="flex gap-2 text-sm leading-6 text-ink-700">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-400" />
            <span>{value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GuardrailPanel({
  summary,
}: {
  summary: LiveInterviewRecruiterSummary;
}) {
  return (
    <details className="group rounded-3xl border border-ink-100 bg-white/76 p-5 backdrop-blur">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink-900">
          <ShieldCheck aria-hidden="true" className="h-4 w-4" />
          Audit and guardrails
        </span>
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 text-ink-500 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="mt-4 space-y-3 text-sm leading-6 text-ink-600">
        <p>{summary.disclaimer}</p>
        <p>
          Generated from {summary.audit.sourceEventIds.length} events and{" "}
          {summary.audit.transcriptTurnIds.length} transcript turns.
        </p>
        {summary.excludedSensitiveSignals.length > 0 ? (
          <p>
            Excluded: {summary.excludedSensitiveSignals.join(", ")}.
          </p>
        ) : null}
      </div>
    </details>
  );
}

function EvidenceList({
  evidence,
}: {
  evidence: LiveInterviewRecruiterSummary["criteria"][number]["evidence"];
}) {
  if (evidence.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2">
      {evidence.map((item) => (
        <blockquote
          key={`${item.eventId}-${item.turnId ?? item.quote}`}
          className="border-l-2 border-ink-200 pl-3 text-sm leading-6 text-ink-700"
        >
          {item.quote}
        </blockquote>
      ))}
    </div>
  );
}

function statusClass(status: string) {
  return toneClasses[statusTone[status] ?? "neutral"];
}

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

function formatGenerator(
  generator: LiveInterviewRecruiterSummary["generator"],
  t: TFunction,
) {
  return generator === "llm_assisted"
    ? t("candidateReview.generatorAiAssisted")
    : t("candidateReview.generatorDeterministic");
}

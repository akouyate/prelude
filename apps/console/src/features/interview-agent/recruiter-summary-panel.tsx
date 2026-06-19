import type { LiveInterviewRecruiterSummary } from "@prelude/contracts";
import { Badge, Button } from "@prelude/ui";
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
  green: "bg-meadow-100 text-meadow-700",
  amber: "bg-gold-100 text-gold-800",
  red: "bg-[#fff1ed] text-[#9f351f]",
  neutral: "bg-ink-100 text-ink-700",
};

const categoryConfig: Record<
  string,
  { label: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; classes: string }
> = {
  role_fit: {
    label: "Role fit",
    icon: Target,
    classes: "bg-[#eef7ff] text-[#245b89]",
  },
  experience: {
    label: "Experience",
    icon: BriefcaseBusiness,
    classes: "bg-[#f6f1ff] text-[#68439c]",
  },
  communication: {
    label: "Communication",
    icon: MessageText,
    classes: "bg-meadow-100 text-meadow-700",
  },
  availability: {
    label: "Logistics",
    icon: Calendar,
    classes: "bg-gold-100 text-gold-800",
  },
};

export function RecruiterSummaryPanel({ summary }: RecruiterSummaryPanelProps) {
  const satisfiedCriteria = summary.criteria.filter(
    (criterion) => criterion.status === "satisfied",
  ).length;
  const needsAttention = summary.criteria.length - satisfiedCriteria;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <section className="rounded-2xl border border-ink-200 bg-white px-5 py-5 shadow-soft md:px-6 md:py-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-ink-900 text-white">Interview recap</Badge>
              <Badge className={summary.status === "complete" ? toneClasses.green : toneClasses.amber}>
                {summary.status === "complete" ? "Complete" : "Incomplete"}
              </Badge>
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

          <div className="w-full rounded-2xl border border-ink-200 bg-ink-50 p-4 lg:max-w-sm">
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

        <dl className="mt-6 grid gap-3 border-t border-ink-200 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Signals captured"
            value={`${satisfiedCriteria}/${summary.criteria.length}`}
          />
          <Metric label="Needs attention" value={String(needsAttention)} />
          <Metric label="Analysis mode" value={formatGenerator(summary.generator)} />
          <Metric
            label="Evidence"
            value={`${summary.audit.sourceEventIds.length} events`}
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
  return (
    <section className="rounded-2xl border border-ink-200 bg-white p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <UserRoundCheck aria-hidden="true" className="h-4 w-4" />
            Decision brief
          </div>
          <p className="mt-1 text-sm text-ink-500">
            A short read before opening the candidate profile.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <SignalColumn
          empty="No clear strength was extracted from this interview."
          icon={<CheckCircle aria-hidden="true" className="h-4 w-4" />}
          signals={summary.strengths}
          title="What works"
        />
        <SignalColumn
          empty="No blocking concern was detected from the available transcript."
          icon={<AlertTriangle aria-hidden="true" className="h-4 w-4" />}
          signals={summary.risks}
          title="What to validate"
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
    <div className="rounded-2xl border border-ink-200 bg-ink-50 p-4">
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
                <Badge className="bg-white text-ink-700">
                  {signal.confidence} confidence
                </Badge>
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
    <section className="rounded-2xl border border-ink-200 bg-white">
      <div className="flex flex-col gap-2 border-b border-ink-200 p-5 sm:flex-row sm:items-center sm:justify-between">
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

      <div className="divide-y divide-ink-200">
        {questions.map((note, index) => (
          <article key={note.questionId} className="p-5">
            <div className="flex gap-4">
              <CategoryIcon category={note.category} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={statusClass(note.answerStatus)}>
                    {formatStatus(note.answerStatus)}
                  </Badge>
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
  const config = categoryConfig[category] ?? {
    label: formatStatus(category),
    icon: HelpCircle,
    classes: "bg-ink-100 text-ink-700",
  };
  const Icon = config.icon;

  return (
    <div
      aria-label={config.label}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${config.classes}`}
      title={config.label}
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
  return (
    <section className="rounded-2xl border border-ink-200 bg-white p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        <Target aria-hidden="true" className="h-4 w-4" />
        Recruiter next step
      </div>
      <p className="mt-2 text-sm leading-6 text-ink-600">
        Use this checklist to keep the follow-up short and focused.
      </p>

      <CompactList title="Clarify first" values={missingInformation} />
      <CompactList title="Suggested questions" values={followUpQuestions} />
      <CompactList title="Logistics" values={logisticsNotes} />
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
    <details className="group rounded-2xl border border-ink-200 bg-white p-5">
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

function formatGenerator(generator: LiveInterviewRecruiterSummary["generator"]) {
  return generator === "llm_assisted" ? "AI assisted" : "Deterministic";
}

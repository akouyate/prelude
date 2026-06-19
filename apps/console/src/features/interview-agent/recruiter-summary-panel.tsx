import type { LiveInterviewRecruiterSummary } from "@prelude/contracts";
import { Badge, Card } from "@prelude/ui";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  HelpCircle,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

type RecruiterSummaryPanelProps = {
  summary: LiveInterviewRecruiterSummary;
};

const statusStyles: Record<string, string> = {
  satisfied: "bg-meadow-100 text-meadow-700",
  unclear: "bg-gold-100 text-gold-800",
  missing: "bg-ink-100 text-ink-700",
  not_assessed: "bg-ink-100 text-ink-700",
};

export function RecruiterSummaryPanel({ summary }: RecruiterSummaryPanelProps) {
  const answered = summary.criteria.filter(
    (criterion) => criterion.status === "satisfied",
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <section className="border-b border-ink-200 pb-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="max-w-3xl">
            <Badge className="bg-ink-900 text-white">Recruiter summary</Badge>
            <h1 className="mt-4 text-3xl font-semibold tracking-normal text-ink-900">
              {summary.roleTitle}
            </h1>
            <p className="mt-3 text-base leading-7 text-ink-600">
              {summary.overview}
            </p>
          </div>
          <div className="min-w-56 rounded-lg border border-ink-200 bg-white p-4">
            <div className="text-sm font-medium text-ink-500">Captured</div>
            <div className="mt-2 text-3xl font-semibold text-ink-900">
              {answered}/{summary.criteria.length}
            </div>
            <div className="mt-1 text-sm text-ink-600">planned signals</div>
          </div>
        </div>
      </section>

      <Card className="p-5 shadow-none">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-ink-500">
              <ClipboardCheck aria-hidden="true" className="h-4 w-4" />
              Recruiter action
            </div>
            <h2 className="mt-2 text-xl font-semibold text-ink-900">
              {summary.recommendation.label}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-600">
              {summary.recommendation.rationale}
            </p>
          </div>
          <Badge className="bg-ink-100 text-ink-800">
            {summary.status === "complete" ? "Complete" : "Incomplete"}
          </Badge>
        </div>
      </Card>

      <section className="grid gap-3 md:grid-cols-3">
        {summary.criteria.map((criterion) => (
          <div
            key={criterion.criterionId}
            className="rounded-lg border border-ink-200 bg-white p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-ink-900">
                {criterion.label}
              </div>
              <span
                className={`rounded-sm px-2 py-1 text-xs font-medium ${
                  statusStyles[criterion.status] ?? statusStyles.not_assessed
                }`}
              >
                {formatStatus(criterion.status)}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-ink-600">
              {criterion.note}
            </p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <SignalList
          icon={<CheckCircle2 aria-hidden="true" className="h-4 w-4" />}
          title="Strengths"
          signals={summary.strengths}
        />
        <SignalList
          icon={<AlertTriangle aria-hidden="true" className="h-4 w-4" />}
          title="Gaps to validate"
          signals={summary.risks}
          empty="No major gap was detected from the available transcript."
        />
      </section>

      <section className="rounded-lg border border-ink-200 bg-white">
        <div className="flex items-center gap-2 border-b border-ink-200 px-5 py-4">
          <FileText aria-hidden="true" className="h-4 w-4 text-ink-500" />
          <h2 className="text-sm font-semibold text-ink-900">
            Question notes
          </h2>
        </div>
        <div className="divide-y divide-ink-200">
          {summary.questionNotes.map((note, index) => (
            <details
              key={note.questionId}
              className="group px-5 py-4"
              open={index === 0}
            >
              <summary className="cursor-pointer list-none text-sm font-medium text-ink-900">
                {note.prompt}
              </summary>
              <p className="mt-3 text-sm leading-6 text-ink-600">
                {note.answerSummary}
              </p>
              <EvidenceList evidence={note.evidence} />
            </details>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <CompactList
          icon={<HelpCircle aria-hidden="true" className="h-4 w-4" />}
          title="Suggested follow-ups"
          values={summary.followUpQuestions}
        />
        <CompactList
          icon={<ShieldCheck aria-hidden="true" className="h-4 w-4" />}
          title="Audit and guardrails"
          values={[
            summary.disclaimer,
            `${summary.audit.sourceEventIds.length} source events, ${summary.audit.transcriptTurnIds.length} transcript turns`,
            ...summary.excludedSensitiveSignals.map(
              (signal) => `Excluded sensitive signal: ${signal}`,
            ),
          ]}
        />
      </section>
    </div>
  );
}

function SignalList({
  icon,
  title,
  signals,
  empty,
}: {
  icon: ReactNode;
  title: string;
  signals: LiveInterviewRecruiterSummary["strengths"];
  empty?: string;
}) {
  return (
    <section className="rounded-lg border border-ink-200 bg-white p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        {icon}
        {title}
      </div>
      {signals.length === 0 ? (
        <p className="mt-4 text-sm text-ink-600">{empty}</p>
      ) : (
        <div className="mt-4 space-y-4">
          {signals.map((signal) => (
            <article key={`${signal.title}-${signal.explanation}`}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-ink-900">
                  {signal.title}
                </h3>
                <Badge className="bg-ink-100 text-ink-700">
                  {signal.confidence}
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
    </section>
  );
}

function CompactList({
  icon,
  title,
  values,
}: {
  icon: ReactNode;
  title: string;
  values: string[];
}) {
  return (
    <section className="rounded-lg border border-ink-200 bg-white p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        {icon}
        {title}
      </div>
      <ul className="mt-4 space-y-3 text-sm leading-6 text-ink-600">
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </section>
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

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

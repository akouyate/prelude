"use client";

import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

export type CriteriaDistribution = {
  "Not assessable": number;
  Medium: number;
  Strong: number;
  Weak: number;
};

export type CriteriaSignalState =
  | "available"
  | "empty"
  | "failed"
  | "not_ready"
  | "pending";

export function CriteriaSignal({
  analysisStatus,
  distribution,
  hasCompletedBrief,
}: {
  analysisStatus: string;
  distribution: CriteriaDistribution;
  hasCompletedBrief: boolean;
}) {
  const { t } = useTranslation();
  const state = getCriteriaSignalState({
    analysisStatus,
    distribution,
    hasCompletedBrief,
  });
  const label = getCriteriaSignalLabel(
    {
      analysisStatus,
      distribution,
      hasCompletedBrief,
      state,
    },
    t,
  );

  return (
    <>
      <span
        aria-label={t("dashboard.criteriaSignalAria", { label })}
        className="flex h-2 overflow-hidden rounded-full bg-ink-100"
        role="img"
      >
        <CriteriaSignalBar distribution={distribution} state={state} />
      </span>
      <span className="mt-2 block truncate text-xs text-ink-500">{label}</span>
    </>
  );
}

export function getCriteriaSignalState({
  analysisStatus,
  distribution,
  hasCompletedBrief,
}: {
  analysisStatus: string;
  distribution: CriteriaDistribution;
  hasCompletedBrief: boolean;
}): CriteriaSignalState {
  if (analysisStatus === "failed") {
    return "failed";
  }

  if (analysisStatus === "pending") {
    return "pending";
  }

  if (!hasCompletedBrief) {
    return "not_ready";
  }

  if (getDistributionTotal(distribution) === 0) {
    return "empty";
  }

  return "available";
}

function CriteriaSignalBar({
  distribution,
  state,
}: {
  distribution: CriteriaDistribution;
  state: CriteriaSignalState;
}) {
  if (state === "available") {
    const segments = buildSignalSegments(distribution);

    return (
      <>
        {segments.map((segment) => (
          <span
            className={segment.className}
            key={segment.label}
            style={{ width: segment.width }}
          />
        ))}
      </>
    );
  }

  if (state === "pending") {
    return (
      <span className="block h-full w-2/5 rounded-full bg-olive-500/45 motion-safe:animate-pulse" />
    );
  }

  if (state === "failed") {
    return <span className="block h-full w-1/4 rounded-full bg-coral-300/70" />;
  }

  if (state === "not_ready") {
    return <span className="block h-full w-1/5 rounded-full bg-ink-200" />;
  }

  return null;
}

function buildSignalSegments(distribution: CriteriaDistribution) {
  const values = [
    {
      className: "block h-full bg-olive-700",
      label: "Strong",
      value: distribution.Strong,
    },
    {
      className: "block h-full bg-gold-300",
      label: "Medium",
      value: distribution.Medium,
    },
    {
      className: "block h-full bg-coral-300",
      label: "Weak",
      value: distribution.Weak,
    },
    {
      className: "block h-full bg-ink-200",
      label: "Not assessable",
      value: distribution["Not assessable"],
    },
  ].filter((segment) => segment.value > 0);
  const total = values.reduce((sum, segment) => sum + segment.value, 0);

  return values.map((segment) => ({
    className: segment.className,
    label: segment.label,
    width: `${Math.max((segment.value / total) * 100, 8)}%`,
  }));
}

function getCriteriaSignalLabel(
  {
    analysisStatus,
    distribution,
    hasCompletedBrief,
    state,
  }: {
    analysisStatus: string;
    distribution: CriteriaDistribution;
    hasCompletedBrief: boolean;
    state: CriteriaSignalState;
  },
  t: TFunction,
) {
  if (state === "available") {
    return formatCriteriaDistribution(distribution, t);
  }

  if (state === "empty") {
    return t("dashboard.criteriaNoSignal");
  }

  if (state === "failed") {
    return t("dashboard.criteriaAnalysisFailed");
  }

  if (state === "pending") {
    return t("dashboard.criteriaAnalysisPending");
  }

  if (!hasCompletedBrief) {
    return t("dashboard.criteriaBriefPending");
  }

  return formatAnalysisStatus(analysisStatus, t);
}

function formatAnalysisStatus(status: string, t: TFunction) {
  if (status === "available") {
    return t("dashboard.criteriaAnalysisReady");
  }

  return t("dashboard.criteriaNotReady");
}

function formatCriteriaDistribution(
  distribution: CriteriaDistribution,
  t: TFunction,
) {
  const labels = [
    distribution.Strong > 0
      ? t("dashboard.criteriaStrong", { count: distribution.Strong })
      : null,
    distribution.Medium > 0
      ? t("dashboard.criteriaMedium", { count: distribution.Medium })
      : null,
    distribution.Weak > 0
      ? t("dashboard.criteriaWeak", { count: distribution.Weak })
      : null,
    distribution["Not assessable"] > 0
      ? t("dashboard.criteriaNotAssessable", {
          count: distribution["Not assessable"],
        })
      : null,
  ].filter((value): value is string => Boolean(value));

  return labels.length > 0
    ? labels.join(" · ")
    : t("dashboard.criteriaNoSignal");
}

function getDistributionTotal(distribution: CriteriaDistribution) {
  return (
    distribution.Strong +
    distribution.Medium +
    distribution.Weak +
    distribution["Not assessable"]
  );
}

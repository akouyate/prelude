"use client";

import * as React from "react";
import { Check, NavArrowDown } from "iconoir-react";

import {
  reviewCriterionTone,
  type ReviewCriterion,
} from "./candidate-review-model";
import { formatReplayTime } from "./interview-replay";
import { ReplaySeekButton } from "./interview-replay-controller";

const sectionLabelClassName =
  "font-title text-[10px] font-semibold uppercase tracking-[0.1em] text-[#b3ac9d]";

const seekButtonClassName =
  "mt-3 inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-full border border-[#e7e2d8] bg-white px-[11px] font-title text-xs font-semibold text-ink-600 transition hover:border-ink-900 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300";

export function CandidateVerdictSection({
  criteria,
  summary,
}: {
  criteria: ReviewCriterion[];
  summary: string | null;
}) {
  const confirmed = criteria.filter(
    (criterion) => criterion.status === "strong",
  ).length;
  const openCount = criteria.length - confirmed;

  return (
    <section className="mt-7 border-t border-[#ebe9e1] pt-[26px]">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-title text-[21px] font-semibold tracking-[-0.02em] text-ink-950">
          {criteria.length > 0
            ? `${confirmed} of ${criteria.length} criteria confirmed`
            : "No criteria evaluated yet"}
        </h2>
        {openCount > 0 ? (
          <span className="text-[13px] text-ink-400">
            {openCount === 1
              ? "1 needs a second look"
              : `${openCount} need a second look`}
          </span>
        ) : null}
      </div>

      {criteria.length > 0 ? (
        <div className="mt-3.5 flex gap-[5px]">
          {criteria.map((criterion) => (
            <span
              className={`h-1.5 flex-1 rounded-full ${reviewCriterionTone(criterion.status).segmentClassName}`}
              key={criterion.id}
              title={criterion.label}
            />
          ))}
        </div>
      ) : null}

      {summary ? (
        <p className="mt-[18px] max-w-[64ch] text-[15px] leading-[1.65] text-[#3c392f]">
          {summary}
        </p>
      ) : null}
    </section>
  );
}

export function CandidateGapsSection({ criteria }: { criteria: ReviewCriterion[] }) {
  if (criteria.length === 0) {
    return null;
  }

  return (
    <section className="mt-[34px]">
      <p className={`mb-1 ${sectionLabelClassName}`}>Needs a second look</p>
      <p className="mb-3.5 text-[13.5px] text-[#8a8178]">
        The criteria the conversation did not settle, and what to ask instead.
      </p>
      <div className="flex flex-col gap-3">
        {criteria.map((criterion) => {
          const tone = reviewCriterionTone(criterion.status);

          return (
            <article
              className="rounded-2xl border border-[#e7e2d8] bg-white px-5 py-[18px]"
              key={criterion.id}
            >
              <div className="flex items-center gap-2.5">
                <h3 className="flex-1 font-title text-[15.5px] font-semibold tracking-[-0.01em] text-ink-950">
                  {criterion.label}
                </h3>
                <span
                  className={`inline-flex h-[22px] shrink-0 items-center rounded-lg px-2.5 font-title text-[10.5px] font-semibold uppercase tracking-[0.04em] ${tone.badgeClassName}`}
                >
                  {criterion.status === "partial" ? "Partial" : "No evidence"}
                </span>
              </div>
              <p className="mt-2.5 max-w-[62ch] text-sm leading-[1.6] text-ink-700">
                {criterion.note}
              </p>

              {criterion.quote ? (
                <>
                  <blockquote
                    className={`mt-[13px] border-l-2 pl-3.5 text-[13.5px] leading-[1.6] text-[#6f6a5f] ${tone.quoteBorderClassName}`}
                  >
                    {criterion.quote}
                  </blockquote>
                  {criterion.startMs === null ? null : (
                    <ReplaySeekButton
                      className={seekButtonClassName}
                      label={formatReplayTime(criterion.startMs)}
                      startMs={criterion.startMs}
                    />
                  )}
                </>
              ) : null}

              {criterion.askOnNextCall.length > 0 ? (
                <div className="mt-4 border-t border-[#f0ece1] pt-3.5">
                  <p className="mb-2 font-title text-[11px] font-semibold uppercase tracking-[0.06em] text-olive-800">
                    Ask on the next call
                  </p>
                  <div className="flex flex-col gap-[7px]">
                    {criterion.askOnNextCall.map((ask) => (
                      <p
                        className="relative pl-[15px] text-[13.5px] leading-[1.55] text-ink-700"
                        key={ask}
                      >
                        <span className="absolute left-0 top-2 h-[5px] w-[5px] rounded-full bg-[#cbc4b6]" />
                        {ask}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function CandidateConfirmedSection({
  criteria,
}: {
  criteria: ReviewCriterion[];
}) {
  const [openId, setOpenId] = React.useState<string | null>(null);

  if (criteria.length === 0) {
    return null;
  }

  return (
    <section className="mt-[30px]">
      <p className={`mb-3 ${sectionLabelClassName}`}>
        Confirmed by the interview
      </p>
      <div className="overflow-hidden rounded-2xl border border-[#e7e2d8] bg-white">
        {criteria.map((criterion, index) => {
          const tone = reviewCriterionTone(criterion.status);
          const open = openId === criterion.id;

          return (
            <div
              className={index === 0 ? undefined : "border-t border-[#f0ece1]"}
              key={criterion.id}
            >
              <button
                aria-expanded={open}
                className="flex w-full cursor-pointer items-center gap-3 px-[18px] py-[15px] text-left transition hover:bg-[#f1efe8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
                onClick={() => setOpenId(open ? null : criterion.id)}
                type="button"
              >
                <span
                  className={`h-[7px] w-[7px] shrink-0 rounded-full ${tone.dotClassName}`}
                />
                <span className="min-w-0 flex-1 font-title text-[14.5px] font-semibold text-ink-950">
                  {criterion.label}
                </span>
                {!open && criterion.quote ? (
                  <span className="max-w-[38%] shrink-0 truncate text-[13px] text-[#8a8178]">
                    {teaserFor(criterion.quote)}
                  </span>
                ) : null}
                <NavArrowDown
                  aria-hidden={true}
                  className={`h-4 w-4 shrink-0 text-[#bdb6a8] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                />
              </button>
              {open ? (
                <div className="pb-[18px] pl-[37px] pr-[18px]">
                  <p className="max-w-[60ch] text-sm leading-[1.6] text-ink-700">
                    {criterion.note}
                  </p>
                  {criterion.quote ? (
                    <blockquote
                      className={`mt-3 border-l-2 pl-3.5 text-[13.5px] leading-[1.6] text-[#6f6a5f] ${tone.quoteBorderClassName}`}
                    >
                      {criterion.quote}
                    </blockquote>
                  ) : null}
                  {criterion.startMs === null ? null : (
                    <ReplaySeekButton
                      className={seekButtonClassName}
                      label={formatReplayTime(criterion.startMs)}
                      startMs={criterion.startMs}
                    />
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function CandidateCoveredCallout({ facts }: { facts: string[] }) {
  if (facts.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 flex items-start gap-2.5 rounded-xl bg-[#f1efe8] px-4 py-3.5">
      <Check
        aria-hidden={true}
        className="mt-0.5 h-[15px] w-[15px] shrink-0 text-olive-600"
      />
      <p className="text-[13px] leading-[1.55] text-ink-700">
        <span className="font-title font-semibold text-ink-950">
          Already covered.
        </span>{" "}
        {facts.join(" ")}
      </p>
    </div>
  );
}

function teaserFor(quote: string) {
  const trimmed = quote.replace(/^\W+/u, "");

  return trimmed.length > 58 ? `${trimmed.slice(0, 58)}…` : trimmed;
}

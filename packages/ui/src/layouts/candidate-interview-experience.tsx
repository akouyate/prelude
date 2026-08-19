"use client";

import * as React from "react";

import { Button } from "../components/button";
import {
  CheckIcon,
  ClockIcon,
  MailIcon,
  MicIcon,
  ShieldCheckIcon,
  TranscriptIcon,
  type CandidateIconProps,
} from "../components/candidate-icons";
import { CandidateMonoPill } from "./candidate-shell";

type CandidateExperienceMode = string;

/**
 * Every user-visible string on the two candidate pre-join screens — the welcome
 * (disclosure) screen and the setup (consent) screen.
 *
 * Same contract as `EnterpriseShellLabels`: finished copy, never catalogue keys,
 * and required rather than defaulted. These screens carry the AI disclosure and
 * the consent the candidate ticks, so a missing label must be a type error, not
 * a silent fallback to English next to a French consent text.
 *
 * Interpolation happens on the caller's side (`durationPill`, `invitation`,
 * `preflightSubtitle`, `formatValue`, …), for the same reason the shell receives
 * `nextExpiryLabel` pre-formatted: composing a sentence is a translation
 * concern, and only the app has the copy table.
 */
export type CandidateInterviewExperienceLabels = {
  answersBody: string;
  answersTitle: string;
  audioOnlyNotice: string;
  durationPill: string;
  emailLabel: string;
  emailOptional: string;
  emailPlaceholder: string;
  evidenceBody: string;
  evidenceTitle: string;
  fairnessHeading: string;
  fairnessKicker: string;
  formatLabel: string;
  formatValue: string;
  humanReviewedPill: string;
  introDescription: string;
  introHeading: string;
  introPill: string;
  invitation: string;
  lengthLabel: string;
  lengthValue: string;
  // Legal ruling R5.1: this fragment closes the statutory disclosure paragraph,
  // so it travels with it. It is kept out of `@prelude/core` so the reviewed
  // disclosure text there stays byte-exact.
  listeningNoteEmphasis: string;
  listeningNoteLead: string;
  modesPill: string;
  nameLabel: string;
  namePlaceholder: string;
  paceBody: string;
  paceTitle: string;
  preflightHeading: string;
  preflightSubtitle: string;
  privacyPill: string;
  roleLabel: string;
  startButton: string;
  startFootnote: string;
};

/** The two response-mode words `formatCandidateModes` joins. */
export type CandidateExperienceModeLabels = {
  audio: string;
  formFallback: string;
};

export type CandidateWelcomeExperienceProps = {
  disclosureCopy: string;
  labels: CandidateInterviewExperienceLabels;
  onStart: () => void;
  roleTitle: string;
};

export function CandidateWelcomeExperience({
  disclosureCopy,
  labels,
  onStart,
  roleTitle,
}: CandidateWelcomeExperienceProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-[clamp(1.125rem,6vw,2.75rem)] pb-[5.75rem] pt-2">
      <div className="flex w-full max-w-[580px] flex-col motion-safe:animate-[cc-in_.55s_cubic-bezier(.2,.7,.2,1)_both]">
        <CandidateMonoPill className="self-start" tone="tint">
          <ShieldCheckIcon className="h-[13px] w-[13px]" strokeWidth={1.9} />
          {labels.privacyPill}
        </CandidateMonoPill>

        <p className="mt-6 text-[14.5px] text-ink-700">{labels.invitation}</p>
        <h1 className="mt-3.5 text-balance font-display text-[clamp(40px,8.4vw,68px)] font-normal leading-[1] tracking-[-0.022em] text-ink-950">
          {roleTitle}
        </h1>
        <p className="mt-5 max-w-[34rem] text-pretty text-[17px] leading-[1.62] text-ink-700">
          {disclosureCopy} {labels.listeningNoteLead}{" "}
          <span className="font-display text-[21px] italic text-ink-950">
            {labels.listeningNoteEmphasis}
          </span>
          .
        </p>

        <div className="mt-[26px] flex flex-wrap gap-2">
          <CandidateSoftPill icon={MicIcon} label={labels.modesPill} />
          <CandidateSoftPill icon={ClockIcon} label={labels.durationPill} />
          <CandidateSoftPill
            icon={ShieldCheckIcon}
            label={labels.humanReviewedPill}
          />
        </div>

        <div className="mt-[30px] rounded-[28px] border border-ink-200 bg-white px-[clamp(1.25rem,4vw,2rem)] py-[30px] motion-safe:animate-[cc-in_.6s_cubic-bezier(.2,.7,.2,1)_.1s_both]">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-600">
            {labels.fairnessKicker}
          </p>
          <h2 className="mt-3 font-display text-[27px] font-normal leading-[1.2] tracking-[-0.014em] text-ink-950">
            {labels.fairnessHeading}
          </h2>
          <div className="mt-[22px] flex flex-col">
            <CandidateFairnessRow
              body={labels.answersBody}
              icon={ShieldCheckIcon}
              title={labels.answersTitle}
            />
            <CandidateFairnessRow
              body={labels.paceBody}
              icon={ClockIcon}
              title={labels.paceTitle}
            />
            <CandidateFairnessRow
              body={labels.evidenceBody}
              icon={TranscriptIcon}
              isLast
              title={labels.evidenceTitle}
            />
          </div>
        </div>

        <Button
          className="mt-7 h-[54px] w-full gap-2.5 px-[26px] font-title text-[15.5px] font-medium hover:bg-spruce-800"
          data-cc-btn=""
          onClick={onStart}
        >
          {labels.startButton}
          <MicIcon className="h-4 w-4" strokeWidth={1.8} />
        </Button>
        <p className="mt-3.5 text-center font-mono text-[10.5px] tracking-[0.06em] text-ink-500">
          {labels.startFootnote}
        </p>
      </div>
    </div>
  );
}

export type CandidateInterviewIntroProps = {
  jobTitle: string;
  labels: CandidateInterviewExperienceLabels;
};

export function CandidateInterviewIntro({
  jobTitle,
  labels,
}: CandidateInterviewIntroProps) {
  return (
    <div className="max-w-[34rem]">
      <CandidateMonoPill>
        <ShieldCheckIcon
          className="h-[13px] w-[13px] text-spruce-600"
          strokeWidth={1.9}
        />
        {labels.introPill}
      </CandidateMonoPill>
      <h1 className="mt-6 font-display text-[clamp(34px,5.4vw,52px)] font-normal leading-[1.04] tracking-[-0.02em] text-ink-950">
        {labels.introHeading}
      </h1>
      <p className="mt-[18px] max-w-[32rem] text-pretty text-[16.5px] leading-[1.62] text-ink-700">
        {labels.introDescription}
      </p>

      <div className="mt-8 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <CandidateBriefFact label={labels.roleLabel} value={jobTitle} />
        <CandidateBriefFact
          label={labels.formatLabel}
          value={labels.formatValue}
        />
        <CandidateBriefFact
          label={labels.lengthLabel}
          value={labels.lengthValue}
        />
      </div>
    </div>
  );
}

export type CandidatePreflightExperienceProps = {
  candidateEmail: string;
  candidateName: string;
  consentAccepted: boolean;
  consentCopy: string;
  labels: CandidateInterviewExperienceLabels;
  onCandidateEmailChange: (value: string) => void;
  onCandidateNameChange: (value: string) => void;
  onConsentChange: (value: boolean) => void;
};

export function CandidatePreflightExperience({
  candidateEmail,
  candidateName,
  consentAccepted,
  consentCopy,
  labels,
  onCandidateEmailChange,
  onCandidateNameChange,
  onConsentChange,
}: CandidatePreflightExperienceProps) {
  return (
    <>
      <div className="flex items-start gap-[13px]">
        <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-ink-900 text-white">
          <MailIcon className="h-[18px] w-[18px]" />
        </span>
        <div>
          <h2 className="font-display text-[26px] font-normal leading-[1.15] tracking-[-0.014em] text-ink-950">
            {labels.preflightHeading}
          </h2>
          <p className="mt-[5px] text-[13.5px] leading-[1.55] text-ink-600">
            {labels.preflightSubtitle}
          </p>
        </div>
      </div>

      <div className="mt-[22px] grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-[7px] block font-title text-[12.5px] font-semibold tracking-[-0.006em] text-ink-950">
            {labels.nameLabel}
          </span>
          <CandidateTextInput
            onChange={(event) => onCandidateNameChange(event.target.value)}
            placeholder={labels.namePlaceholder}
            value={candidateName}
          />
        </label>
        <label className="block">
          <span className="mb-[7px] block font-title text-[12.5px] font-semibold tracking-[-0.006em] text-ink-950">
            {labels.emailLabel}{" "}
            <span className="font-normal text-ink-500">
              {labels.emailOptional}
            </span>
          </span>
          <CandidateTextInput
            onChange={(event) => onCandidateEmailChange(event.target.value)}
            placeholder={labels.emailPlaceholder}
            type="email"
            value={candidateEmail}
          />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-[18px] border border-ink-100 bg-paper-inset px-4 py-3.5">
        <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-spruce-50 text-spruce-800">
          <MicIcon className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <p className="text-[13.5px] leading-[1.55] text-ink-700">
          {labels.audioOnlyNotice}
        </p>
      </div>

      <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-[18px] border border-ink-100 bg-paper-inset px-4 py-[15px]">
        <span className="relative mt-0.5 grid shrink-0 place-items-center">
          <input
            checked={consentAccepted}
            className="peer h-[19px] w-[19px] cursor-pointer appearance-none rounded-[6px] border-[1.5px] border-ink-400 bg-white outline-none transition-colors checked:border-spruce-800 checked:bg-spruce-800 focus-visible:ring-2 focus-visible:ring-spruce-600 focus-visible:ring-offset-2"
            onChange={(event) => onConsentChange(event.target.checked)}
            type="checkbox"
          />
          <CheckIcon
            className="pointer-events-none absolute h-[11px] w-[11px] text-white opacity-0 transition-opacity peer-checked:opacity-100"
            strokeWidth={3}
          />
        </span>
        <span className="text-[13px] leading-[1.6] text-ink-700">
          {consentCopy}
        </span>
      </label>
    </>
  );
}

function CandidateTextInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-[46px] w-full rounded-[13px] border border-ink-300 bg-paper-sunken px-3.5 text-[14.5px] text-ink-950 outline-none transition placeholder:text-ink-500 focus:border-ink-900 focus:bg-white focus:ring-1 focus:ring-ink-900 ${className ?? ""}`}
      {...props}
    />
  );
}

function CandidateSoftPill({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<CandidateIconProps>;
  label: string;
}) {
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-full border border-ink-200 bg-white px-3.5 text-[13.5px] text-ink-700">
      <Icon className="h-3.5 w-3.5 text-spruce-600" />
      {label}
    </span>
  );
}

function CandidateFairnessRow({
  body,
  icon: Icon,
  isLast = false,
  title,
}: {
  body: string;
  icon: React.ComponentType<CandidateIconProps>;
  isLast?: boolean;
  title: string;
}) {
  return (
    <div
      className={`flex gap-[15px] border-t border-ink-100 pt-4 ${isLast ? "" : "pb-4"}`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-spruce-50 text-spruce-800">
        <Icon className="h-[17px] w-[17px]" />
      </span>
      <div>
        <p className="mb-[3px] font-title text-[14.5px] font-semibold tracking-[-0.008em] text-ink-950">
          {title}
        </p>
        <p className="text-[13.5px] leading-[1.55] text-ink-600">{body}</p>
      </div>
    </div>
  );
}

function CandidateBriefFact({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[20px] border border-ink-200 bg-white px-4 py-[15px]">
      <p className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-500">
        {label}
      </p>
      <p className="mt-[9px] font-title text-[14px] font-semibold leading-[1.35] tracking-[-0.008em] text-ink-950">
        {value}
      </p>
    </div>
  );
}

/**
 * Joins the builder's response modes into the one phrase the pills show. The
 * words come from the caller so this package keeps no English of its own; the
 * "audio when the list is empty" default is a product rule, not copy.
 */
export function formatCandidateModes(
  modes: CandidateExperienceMode[],
  labels: CandidateExperienceModeLabels,
) {
  const resolved = modes.map((mode) => {
    if (mode === "form" || mode === "text") {
      return labels.formFallback;
    }

    if (mode === "audio") {
      return labels.audio;
    }

    return mode;
  });

  return resolved.length > 0 ? resolved.join(", ") : labels.audio;
}

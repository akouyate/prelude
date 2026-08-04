"use client";

import * as React from "react";
import {
  CheckCircle,
  Mail,
  Microphone as Mic,
  ShieldCheck,
} from "iconoir-react";

import { Button } from "../components/button";
import { Input } from "../components/input";

type CandidateExperienceMode = string;

type CandidateExperienceDetails = {
  companyName: string;
  description?: string;
  estimatedMinutes: number | null;
  jobTitle: string;
  responseModes: CandidateExperienceMode[];
  roleTitle: string;
};

export type CandidateWelcomeExperienceProps = CandidateExperienceDetails & {
  disclosureCopy: string;
  evidenceNotice?: {
    body: string;
    title: string;
  };
  onStart: () => void;
};

export function CandidateWelcomeExperience({
  companyName,
  disclosureCopy,
  evidenceNotice = {
    body: "Your words are saved as transcript evidence for recruiter review.",
    title: "Transcribed for review",
  },
  estimatedMinutes,
  onStart,
  responseModes,
  roleTitle,
}: CandidateWelcomeExperienceProps) {
  return (
    <section className="mx-auto flex flex-1 items-center justify-center py-10">
      <div className="w-full max-w-xl">
        <div className="inline-flex items-center gap-2 rounded-full bg-[#eef0e3] px-3 py-1 text-xs font-semibold uppercase tracking-[0.13em] text-olive-900">
          <ShieldCheck aria-hidden="true" className="h-4 w-4" />
          Private interview
        </div>
        <p className="mt-8 text-sm font-medium text-ink-600">
          {companyName} invites you to a first conversation
        </p>
        <h1 className="mt-4 text-4xl font-semibold leading-[1.08] tracking-normal text-ink-950 sm:text-5xl lg:text-6xl">
          {roleTitle}
        </h1>
        <p className="mt-5 text-base leading-7 text-ink-700">
          {disclosureCopy} We listen to{" "}
          <span className="font-display text-xl italic text-ink-950">
            what you say
          </span>
          .
        </p>

        <div className="mt-7 flex flex-wrap gap-2">
          <CandidateSoftPill
            icon={Mic}
            label={formatCandidateModes(responseModes)}
          />
          <CandidateSoftPill
            icon={CheckCircle}
            label={
              estimatedMinutes
                ? `About ${estimatedMinutes} minutes`
                : "A few minutes"
            }
          />
          <CandidateSoftPill icon={ShieldCheck} label="Human reviewed" />
        </div>

        <div className="mt-7 rounded-[2rem] border border-ink-100 bg-white/70 p-6">
          <p className="text-base font-semibold text-ink-950">
            How this interview works
          </p>
          <div className="mt-4 divide-y divide-ink-100">
            <CandidateFairnessRow
              body="Only the content of your answers reaches the recruiter."
              title="Answers, not appearance"
            />
            <CandidateFairnessRow
              body="There is no timer on answers. Pause and think."
              title="Go at your own pace"
            />
            <CandidateFairnessRow
              body={evidenceNotice.body}
              title={evidenceNotice.title}
            />
          </div>
        </div>

        <Button className="mt-7 h-14 w-full text-base" onClick={onStart}>
          Get started
          <Mic aria-hidden="true" className="h-4 w-4" />
        </Button>
        <p className="mt-4 text-center text-sm text-ink-400">
          No account needed. You can take your time on every answer.
        </p>
      </div>
    </section>
  );
}

export function CandidateInterviewIntro({
  companyName,
  description,
  estimatedMinutes,
  jobTitle,
  responseModes,
  roleTitle,
}: CandidateExperienceDetails) {
  return (
    <div className="max-w-2xl">
      <div className="inline-flex items-center gap-2 rounded-full border border-ink-100 bg-white/70 px-3 py-1 text-xs font-semibold text-ink-700">
        <ShieldCheck aria-hidden="true" className="h-4 w-4" />
        Private first screen
      </div>
      <h1 className="mt-6 text-3xl font-semibold leading-tight tracking-normal text-ink-950 sm:text-4xl lg:text-5xl">
        Let&apos;s get you ready
      </h1>
      <p className="mt-4 max-w-xl text-base leading-7 text-ink-600">
        {description ?? (
          <>
            {roleTitle} at {companyName}. Answer naturally; the recruiter
            reviews your answers, not your face, accent, tone, emotion, or
            protected attributes.
          </>
        )}
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <CandidateBriefFact label="Role" value={jobTitle} />
        <CandidateBriefFact
          label="Format"
          value={formatCandidateModes(responseModes)}
        />
        <CandidateBriefFact
          label="Length"
          value={
            estimatedMinutes ? `About ${estimatedMinutes} min` : "A few minutes"
          }
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
  estimatedMinutes: number | null;
  jobTitle: string;
  onCandidateEmailChange: (value: string) => void;
  onCandidateNameChange: (value: string) => void;
  onConsentChange: (value: boolean) => void;
};

export function CandidatePreflightExperience({
  candidateEmail,
  candidateName,
  consentAccepted,
  consentCopy,
  estimatedMinutes,
  jobTitle,
  onCandidateEmailChange,
  onCandidateNameChange,
  onConsentChange,
}: CandidatePreflightExperienceProps) {
  return (
    <>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink-900 text-white">
          <Mail aria-hidden="true" className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-xl font-semibold">Before you start</h2>
          <p className="mt-1 text-sm leading-6 text-ink-600">
            {jobTitle}
            {estimatedMinutes ? ` · about ${estimatedMinutes} minutes` : ""}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium text-ink-900">Your name</span>
          <Input
            className="mt-1 h-11 bg-white"
            onChange={(event) => onCandidateNameChange(event.target.value)}
            placeholder="Your name"
            value={candidateName}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium text-ink-900">Email optional</span>
          <Input
            className="mt-1 h-11 bg-white"
            onChange={(event) => onCandidateEmailChange(event.target.value)}
            placeholder="you@example.com"
            type="email"
            value={candidateEmail}
          />
        </label>
      </div>

      <div className="mt-5 rounded-3xl border border-ink-100 bg-ink-50/70 p-4 text-sm leading-6 text-ink-600">
        This interview is audio-first. You only need your microphone.
      </div>

      <label className="mt-5 flex cursor-pointer gap-3 rounded-3xl border border-ink-100 bg-ink-50/70 p-4 text-sm leading-6 text-ink-700">
        <input
          checked={consentAccepted}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-ink-900"
          onChange={(event) => onConsentChange(event.target.checked)}
          type="checkbox"
        />
        <span>{consentCopy}</span>
      </label>
    </>
  );
}

function CandidateSoftPill({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3.5 py-2 text-sm font-medium text-ink-700">
      <Icon aria-hidden={true} className="h-4 w-4 text-ink-500" />
      {label}
    </span>
  );
}

function CandidateFairnessRow({
  body,
  title,
}: {
  body: string;
  title: string;
}) {
  return (
    <div className="flex gap-4 py-4 first:pt-0 last:pb-0">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#eef0e3] text-olive-900">
        <ShieldCheck aria-hidden="true" className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-semibold text-ink-950">{title}</p>
        <p className="mt-1 text-sm leading-6 text-ink-500">{body}</p>
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
    <div className="rounded-3xl border border-ink-100 bg-white/60 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold leading-5 text-ink-950">
        {value}
      </p>
    </div>
  );
}

export function formatCandidateModes(modes: CandidateExperienceMode[]) {
  const labels = modes.map((mode) => {
    if (mode === "form" || mode === "text") {
      return "form fallback";
    }

    if (mode === "audio") {
      return "audio";
    }

    return mode;
  });

  return labels.length > 0 ? labels.join(", ") : "audio";
}

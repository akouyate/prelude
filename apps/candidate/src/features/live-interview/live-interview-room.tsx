"use client";

import * as React from "react";
import { Button, Input } from "@prelude/ui";
import {
  Camera,
  CheckCircle,
  Mail,
  Microphone as Mic,
  PhoneXmark as PhoneOff,
  Refresh as RefreshCcw,
  ShieldCheck,
  WarningTriangle as AlertTriangle,
} from "iconoir-react";

import type { PublicInterviewContext } from "../../server/public-interviews";
import {
  completeProductSession,
  connectRoom,
  createSession,
  resumeStorageKey,
  stopLocalStream,
  toCandidateError,
} from "./live-interview-client";
import type {
  ConnectedRoom,
  LiveInterviewSession,
  RoomStatus,
} from "./live-interview-types";

type CandidateStep = "welcome" | "setup";

type PublishedInterview = Extract<
  PublicInterviewContext,
  { kind: "published" }
>["interview"];

const statusCopy: Record<RoomStatus, string> = {
  ready: "Ready",
  preparing: "Preparing your room",
  permission_required: "Allow microphone",
  connecting: "Connecting",
  interviewer_joining: "Interviewer is joining",
  connected: "Live now",
  reconnecting: "Reconnecting",
  failed: "Needs attention",
  completed: "Completed",
};

export function LiveInterviewRoom({
  context,
  token,
}: {
  context: PublicInterviewContext;
  token: string;
}) {
  const [status, setStatus] = React.useState<RoomStatus>("ready");
  const [step, setStep] = React.useState<CandidateStep>("welcome");
  const [session, setSession] = React.useState<LiveInterviewSession | null>(
    null,
  );
  const [candidateName, setCandidateName] = React.useState("");
  const [candidateEmail, setCandidateEmail] = React.useState("");
  const [hasAcceptedConsent, setHasAcceptedConsent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = React.useState(false);
  const [isAudioPlaybackBlocked, setIsAudioPlaybackBlocked] =
    React.useState(false);
  const [localStream, setLocalStream] = React.useState<MediaStream | null>(
    null,
  );
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const roomRef = React.useRef<ConnectedRoom | null>(null);
  const localStreamRef = React.useRef<MediaStream | null>(null);
  const startInFlightRef = React.useRef(false);
  const completedProductSessionIdsRef = React.useRef(new Set<string>());
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  React.useEffect(() => {
    localStreamRef.current = localStream;
    if (videoRef.current) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  React.useEffect(() => {
    return () => {
      stopLocalStream(localStreamRef.current);
      roomRef.current?.disconnect();
    };
  }, []);

  React.useEffect(() => {
    if (status === "ready" || status === "failed" || status === "completed") {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setElapsedSeconds((currentSeconds) => currentSeconds + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [status]);

  const completeCurrentSession = React.useCallback(
    (nextSession: LiveInterviewSession | null) => {
      if (!nextSession?.productSessionId || !nextSession.resumeToken) {
        return;
      }
      if (
        completedProductSessionIdsRef.current.has(nextSession.productSessionId)
      ) {
        return;
      }

      completedProductSessionIdsRef.current.add(nextSession.productSessionId);
      void completeProductSession(nextSession);
    },
    [],
  );

  const startInterview = React.useCallback(async () => {
    if (
      startInFlightRef.current ||
      context.kind === "not_found" ||
      !hasAcceptedConsent ||
      candidateName.trim().length <= 1
    ) {
      return;
    }

    startInFlightRef.current = true;
    let grantedStream: MediaStream | null = null;

    setError(null);
    setIsAudioPlaybackBlocked(false);
    setElapsedSeconds(0);
    setStatus("preparing");

    try {
      const nextSession = await createSession({
        candidateEmail,
        candidateName,
        consentAccepted: hasAcceptedConsent,
        resumeToken:
          window.localStorage.getItem(resumeStorageKey(token)) ?? undefined,
        token,
        videoEnabled: isVideoEnabled,
      });
      if (nextSession.resumeToken) {
        window.localStorage.setItem(
          resumeStorageKey(token),
          nextSession.resumeToken,
        );
      }
      setSession(nextSession);

      setStatus("permission_required");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video:
          nextSession.allowedModalities.includes("video") && isVideoEnabled,
      });
      grantedStream = stream;
      setLocalStream(stream);

      setStatus("connecting");
      roomRef.current = await connectRoom({
        session: nextSession,
        stream,
        onReconnecting: () => setStatus("reconnecting"),
        onConnected: () => setStatus("interviewer_joining"),
        onReady: () => setStatus("interviewer_joining"),
        onDisconnected: () => {
          completeCurrentSession(nextSession);
          setStatus("completed");
        },
        onAudioPlaybackBlocked: () => setIsAudioPlaybackBlocked(true),
        onAudioPlaybackReady: () => {
          setIsAudioPlaybackBlocked(false);
          setStatus((currentStatus) =>
            currentStatus === "interviewer_joining" ||
            currentStatus === "reconnecting"
              ? "connected"
              : currentStatus,
          );
        },
      });
    } catch (cause) {
      roomRef.current?.disconnect();
      roomRef.current = null;
      stopLocalStream(grantedStream);
      setLocalStream(null);
      setStatus("failed");
      setError(toCandidateError(cause));
    } finally {
      startInFlightRef.current = false;
    }
  }, [
    candidateEmail,
    candidateName,
    completeCurrentSession,
    context.kind,
    hasAcceptedConsent,
    isVideoEnabled,
    token,
  ]);

  const endInterview = React.useCallback(() => {
    completeCurrentSession(session);
    roomRef.current?.disconnect();
    roomRef.current = null;
    stopLocalStream(localStream);
    setLocalStream(null);
    setIsAudioPlaybackBlocked(false);
    setStatus("completed");
  }, [completeCurrentSession, localStream, session]);

  const enableAudio = React.useCallback(async () => {
    try {
      await roomRef.current?.startAudio();
      setIsAudioPlaybackBlocked(false);
    } catch {
      setIsAudioPlaybackBlocked(true);
    }
  }, []);

  const isBusy =
    status === "preparing" ||
    status === "permission_required" ||
    status === "connecting";
  const isRoomActive =
    status === "interviewer_joining" ||
    status === "connected" ||
    status === "reconnecting";
  const interview = context.kind === "not_found" ? null : context.interview;
  const allowedModes = interview?.responseModes ?? ["audio", "video"];
  const canStart = hasAcceptedConsent && candidateName.trim().length > 1;

  if (!interview) {
    return <UnavailableInterview />;
  }

  if (status === "ready" && step === "welcome") {
    return (
      <WelcomeScreen
        allowedModes={allowedModes}
        interview={interview}
        onStart={() => setStep("setup")}
      />
    );
  }

  if (status === "completed") {
    return (
      <section className="mx-auto flex flex-1 items-center justify-center py-10">
        <CompletionPanel
          candidateName={candidateName}
          companyName={interview.companyName}
          elapsedSeconds={elapsedSeconds}
        />
      </section>
    );
  }

  if (isBusy || isRoomActive) {
    return (
      <LiveInterviewStage
        allowedModes={allowedModes}
        elapsedSeconds={elapsedSeconds}
        isAudioPlaybackBlocked={isAudioPlaybackBlocked}
        isRoomActive={isRoomActive}
        isVideoEnabled={isVideoEnabled}
        localStream={localStream}
        onEnableAudio={enableAudio}
        onEndInterview={endInterview}
        status={status}
        videoRef={videoRef}
      />
    );
  }

  return (
    <section className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,430px)] lg:py-12">
      <InterviewIntro allowedModes={allowedModes} interview={interview} />
      <div className="rounded-[2rem] border border-ink-100 bg-white/82 p-5 text-ink-900 backdrop-blur">
        <PreflightPanel
          allowedModes={allowedModes}
          candidateEmail={candidateEmail}
          candidateName={candidateName}
          consentAccepted={hasAcceptedConsent}
          estimatedMinutes={interview.estimatedMinutes}
          isVideoEnabled={isVideoEnabled}
          jobTitle={interview.jobTitle}
          onCandidateEmailChange={setCandidateEmail}
          onCandidateNameChange={setCandidateName}
          onConsentChange={setHasAcceptedConsent}
          onVideoEnabledChange={setIsVideoEnabled}
        />

        {error ? <InlineAlert message={error} /> : null}

        {isAudioPlaybackBlocked ? (
          <div className="mt-4 rounded-3xl border border-gold-200 bg-gold-50 p-4 text-sm text-ink-900">
            <p className="font-semibold">Audio paused by your browser</p>
            <p className="mt-1 leading-6 text-ink-600">
              Tap once to hear the interviewer on this device.
            </p>
            <Button
              className="mt-3 h-11 w-full"
              onClick={enableAudio}
              variant="secondary"
            >
              <Mic aria-hidden="true" className="h-4 w-4" />
              Enable audio
            </Button>
          </div>
        ) : null}

        <div className="mt-5">
          {isRoomActive ? (
            <Button className="h-12 w-full" onClick={endInterview}>
              <PhoneOff aria-hidden="true" className="h-4 w-4" />
              End interview
            </Button>
          ) : (
            <Button
              className="h-12 w-full"
              disabled={isBusy || !canStart}
              onClick={startInterview}
            >
              {isBusy ? (
                <RefreshCcw
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin"
                />
              ) : (
                <Mic aria-hidden="true" className="h-4 w-4" />
              )}
              {startButtonLabel({
                canStart,
                candidateName,
                hasAcceptedConsent,
              })}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function WelcomeScreen({
  allowedModes,
  interview,
  onStart,
}: {
  allowedModes: string[];
  interview: PublishedInterview;
  onStart: () => void;
}) {
  return (
    <section className="mx-auto flex flex-1 items-center justify-center py-10">
      <div className="w-full max-w-xl">
        <div className="inline-flex items-center gap-2 rounded-full bg-[#eef0e3] px-3 py-1 text-xs font-semibold uppercase tracking-[0.13em] text-olive-900">
          <ShieldCheck aria-hidden="true" className="h-4 w-4" />
          Private interview
        </div>
        <p className="mt-8 text-sm font-medium text-ink-600">
          {interview.companyName} invites you to a first conversation
        </p>
        <h1 className="mt-4 text-4xl font-semibold leading-[1.08] tracking-normal text-ink-950 sm:text-5xl lg:text-6xl">
          {interview.roleTitle}
        </h1>
        <p className="mt-5 text-base leading-7 text-ink-700">
          A short, AI-guided voice interview. We listen to{" "}
          <span className="font-display text-xl italic text-ink-950">
            what you say
          </span>
          , never your accent, tone, emotion, appearance, or any protected
          attribute.
        </p>

        <div className="mt-7 flex flex-wrap gap-2">
          <SoftPill icon={Mic} label={formatModes(allowedModes)} />
          <SoftPill
            icon={CheckCircle}
            label={
              interview.estimatedMinutes
                ? `About ${interview.estimatedMinutes} minutes`
                : "A few minutes"
            }
          />
          <SoftPill icon={ShieldCheck} label="Human reviewed" />
        </div>

        <div className="mt-7 rounded-[2rem] border border-ink-100 bg-white/70 p-6">
          <p className="text-base font-semibold text-ink-950">
            How this interview works
          </p>
          <div className="mt-4 divide-y divide-ink-100">
            <FairnessRow
              title="Answers, not appearance"
              body="Only the content of your answers reaches the recruiter."
            />
            <FairnessRow
              title="Go at your own pace"
              body="There is no timer on answers. Pause and think."
            />
            <FairnessRow
              title="Transcribed for review"
              body="Your words are saved as transcript evidence for recruiter review."
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

function InterviewIntro({
  allowedModes,
  interview,
}: {
  allowedModes: string[];
  interview: PublishedInterview;
}) {
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
        {interview.roleTitle} at {interview.companyName}. Answer naturally; the
        recruiter reviews your answers, not your face, accent, tone, emotion, or
        protected attributes.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <BriefFact label="Role" value={interview.jobTitle} />
        <BriefFact label="Format" value={formatModes(allowedModes)} />
        <BriefFact
          label="Length"
          value={
            interview.estimatedMinutes
              ? `About ${interview.estimatedMinutes} min`
              : "A few minutes"
          }
        />
      </div>
    </div>
  );
}

function CompletionPanel({
  candidateName,
  companyName,
  elapsedSeconds,
}: {
  candidateName: string;
  companyName: string;
  elapsedSeconds: number;
}) {
  const firstName = candidateName.trim().split(/\s+/)[0] || "there";

  return (
    <div className="rounded-[2rem] border border-ink-100 bg-white/82 p-6 text-center text-ink-900 backdrop-blur">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-meadow-100 text-meadow-700">
        <CheckCircle aria-hidden="true" className="h-8 w-8" />
      </span>
      <h2 className="mt-5 text-2xl font-semibold leading-tight sm:text-3xl">
        Thank you,{" "}
        <span className="font-display italic text-ink-950">{firstName}</span>.
      </h2>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ink-600">
        Your interview is complete. {companyName} will review your answers and
        follow up with the next step.
      </p>
      <div className="mt-6 rounded-3xl border border-ink-100 bg-white/70 px-4 py-3 text-left text-sm text-ink-700">
        <div className="flex items-center justify-between gap-4 border-b border-ink-100 pb-3">
          <span>Duration</span>
          <strong className="font-semibold text-ink-950">
            {formatDuration(elapsedSeconds)}
          </strong>
        </div>
        <div className="flex items-center justify-between gap-4 pt-3">
          <span>Transcript</span>
          <strong className="font-semibold text-ink-950">Saved</strong>
        </div>
      </div>
      <p className="mt-5 text-sm text-ink-400">
        You can close this window. There is nothing more to do.
      </p>
    </div>
  );
}

function PreflightPanel({
  allowedModes,
  candidateEmail,
  candidateName,
  consentAccepted,
  estimatedMinutes,
  isVideoEnabled,
  jobTitle,
  onCandidateEmailChange,
  onCandidateNameChange,
  onConsentChange,
  onVideoEnabledChange,
}: {
  allowedModes: string[];
  candidateEmail: string;
  candidateName: string;
  consentAccepted: boolean;
  estimatedMinutes: number | null;
  isVideoEnabled: boolean;
  jobTitle: string;
  onCandidateEmailChange: (value: string) => void;
  onCandidateNameChange: (value: string) => void;
  onConsentChange: (value: boolean) => void;
  onVideoEnabledChange: (value: boolean) => void;
}) {
  const canUseVideo = allowedModes.includes("video");

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

      {canUseVideo ? (
        <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-ink-900">
            How would you like to join?
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <ModeChoice
              active={isVideoEnabled}
              description="Best signal if you are comfortable."
              icon={Camera}
              label="Audio + camera"
              onClick={() => onVideoEnabledChange(true)}
            />
            <ModeChoice
              active={!isVideoEnabled}
              description="Your microphone stays on."
              icon={Mic}
              label="Audio only"
              onClick={() => onVideoEnabledChange(false)}
            />
          </div>
        </fieldset>
      ) : (
        <div className="mt-5 rounded-3xl border border-ink-100 bg-ink-50/70 p-4 text-sm leading-6 text-ink-600">
          This interview is configured for audio. Your camera will not be used.
        </div>
      )}

      <label className="mt-5 flex cursor-pointer gap-3 rounded-3xl border border-ink-100 bg-ink-50/70 p-4 text-sm leading-6 text-ink-700">
        <input
          checked={consentAccepted}
          className="mt-1 h-4 w-4 shrink-0 accent-ink-900"
          onChange={(event) => onConsentChange(event.target.checked)}
          type="checkbox"
        />
        <span>
          I agree to join this AI-guided screening interview. My answers may be
          recorded as transcript evidence for recruiter review, and Prelude
          should not assess protected attributes, appearance, accent, tone, or
          emotion.
        </span>
      </label>
    </>
  );
}

function UnavailableInterview() {
  return (
    <section className="flex flex-1 flex-col justify-center py-10">
      <div className="max-w-lg rounded-[2rem] border border-ink-100 bg-white/82 p-6 text-ink-900 backdrop-blur">
        <AlertTriangle aria-hidden="true" className="h-6 w-6 text-coral-800" />
        <h1 className="mt-4 text-3xl font-semibold">Interview unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-ink-600">
          This link is invalid, unpublished, or no longer available. Ask the
          recruiter for a fresh interview link.
        </p>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: RoomStatus }) {
  const isLive = status === "connected";
  const isReconnecting = status === "reconnecting";
  const Icon = isLive ? CheckCircle : isReconnecting ? RefreshCcw : Mic;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eef0e3] px-2.5 py-1 text-xs font-semibold text-olive-900">
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {statusCopy[status]}
    </span>
  );
}

function LiveInterviewStage({
  allowedModes,
  elapsedSeconds,
  isAudioPlaybackBlocked,
  isRoomActive,
  isVideoEnabled,
  localStream,
  onEnableAudio,
  onEndInterview,
  status,
  videoRef,
}: {
  allowedModes: string[];
  elapsedSeconds: number;
  isAudioPlaybackBlocked: boolean;
  isRoomActive: boolean;
  isVideoEnabled: boolean;
  localStream: MediaStream | null;
  onEnableAudio: () => void;
  onEndInterview: () => void;
  status: RoomStatus;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const showVideo = Boolean(
    localStream && allowedModes.includes("video") && isVideoEnabled,
  );

  return (
    <section className="-mx-4 -mb-5 mt-5 flex min-h-[calc(100vh-5.25rem)] flex-col overflow-hidden rounded-t-[2rem] bg-[radial-gradient(circle_at_50%_-10%,#3c421f_0%,#1d1c16_38%,#131210_100%)] px-5 pb-5 pt-6 text-white sm:-mx-6 sm:rounded-[2.25rem] sm:px-8">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-white/82">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10">
            <Mic aria-hidden="true" className="h-4 w-4" />
          </span>
          Live interview
        </div>
        <StatusPill status={status} />
      </div>

      <div className="grid flex-1 place-items-center py-10 text-center">
        <div className="w-full max-w-3xl">
          <div className="relative mx-auto grid h-32 w-32 place-items-center">
            <span className="absolute inset-0 rounded-full border border-olive-300/40 motion-safe:animate-[cc-ring_2.4s_ease-out_infinite]" />
            <span className="absolute inset-0 rounded-full border border-olive-300/30 motion-safe:animate-[cc-ring_2.4s_ease-out_infinite_1.2s]" />
            <span className="grid h-16 w-16 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,oklch(0.826_0.199_121.3),oklch(0.507_0.122_121.25))]">
              <Mic aria-hidden="true" className="h-7 w-7 text-ink-950" />
            </span>
          </div>

          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-olive-200">
            {isRoomActive ? "Interviewer" : "Connecting"}
          </p>
          <h2 className="mx-auto mt-4 max-w-2xl text-2xl font-semibold leading-tight tracking-normal sm:text-4xl lg:text-5xl">
            {statusDescription(status)}
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-white/58 sm:text-base">
            You can ask to repeat the question, take a moment to think, or
            answer naturally. The interviewer will wait while you finish.
          </p>

          {showVideo ? (
            <div className="mx-auto mt-8 max-w-sm overflow-hidden rounded-[1.75rem] border border-white/10 bg-ink-950">
              <video
                ref={videoRef}
                aria-label="Local camera preview"
                autoPlay
                className="aspect-video w-full object-cover"
                muted
                playsInline
              />
            </div>
          ) : null}

          {isAudioPlaybackBlocked ? (
            <div className="mx-auto mt-6 max-w-sm rounded-3xl border border-gold-200/30 bg-white/8 p-4 text-sm text-white">
              <p className="font-semibold">Audio paused by your browser</p>
              <p className="mt-1 leading-6 text-white/58">
                Tap once to hear the interviewer on this device.
              </p>
              <Button
                className="mt-3 h-11 w-full bg-white text-ink-950 hover:bg-ink-100"
                onClick={onEnableAudio}
                variant="secondary"
              >
                <Mic aria-hidden="true" className="h-4 w-4" />
                Enable audio
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="ml-auto flex w-full items-center justify-between gap-3 rounded-full border border-white/10 bg-ink-950/70 p-2 text-white backdrop-blur sm:w-auto">
        <Button
          className="h-10 bg-coral-500/20 px-4 text-coral-100 hover:bg-coral-500/30"
          onClick={onEndInterview}
        >
          <PhoneOff aria-hidden="true" className="h-4 w-4" />
          Quit
        </Button>
        <span className="h-6 w-px bg-white/10" />
        <span className="px-3 text-sm font-semibold tabular-nums">
          {formatDuration(elapsedSeconds)}
        </span>
        <span className="h-6 w-px bg-white/10" />
        <div className="flex h-7 items-end gap-1 px-3">
          {[0, 1, 2, 3, 4].map((bar) => (
            <span
              className="w-1 rounded-full bg-olive-200 motion-safe:animate-[cc-wave_.7s_ease-in-out_infinite]"
              key={bar}
              style={{
                animationDelay: `${bar * 0.1}s`,
                height: `${14 + ((bar * 7) % 14)}px`,
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ModeChoice({
  active,
  description,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  description: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`cursor-pointer rounded-3xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e5e8d6] ${
        active
          ? "border-ink-900 bg-[#eef0e3]"
          : "border-ink-100 bg-white/70 hover:border-ink-300"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-ink-950">
        <Icon aria-hidden={true} className="h-4 w-4" />
        {label}
      </span>
      <span className="mt-2 block text-xs leading-5 text-ink-600">
        {description}
      </span>
    </button>
  );
}

function Capability({
  active,
  icon: Icon,
  label,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-ink-100 bg-white/70 px-3 py-2">
      <Icon aria-hidden={true} className="h-4 w-4 text-ink-700" />
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-xs text-ink-500">
        {active ? "Ready" : "Off"}
      </span>
    </div>
  );
}

function SoftPill({
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

function FairnessRow({ body, title }: { body: string; title: string }) {
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

function BriefFact({ label, value }: { label: string; value: string }) {
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

function startButtonLabel({
  canStart,
  candidateName,
  hasAcceptedConsent,
}: {
  canStart: boolean;
  candidateName: string;
  hasAcceptedConsent: boolean;
}) {
  if (canStart) {
    return "Join the interview";
  }

  if (candidateName.trim().length <= 1) {
    return "Enter your name to join";
  }

  if (!hasAcceptedConsent) {
    return "Accept consent to join";
  }

  return "Join the interview";
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function InlineAlert({ message }: { message: string }) {
  return (
    <div className="mt-4 flex gap-2 rounded-3xl bg-coral-50 p-4 text-sm text-ink-900">
      <AlertTriangle
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-coral-800"
      />
      <div>
        <p className="font-semibold">Needs attention</p>
        <p className="mt-1 leading-6">{message}</p>
      </div>
    </div>
  );
}

function formatModes(modes: string[]) {
  const labels = modes.map((mode) => {
    if (mode === "form") {
      return "form fallback";
    }

    if (mode === "audio") {
      return "audio";
    }

    if (mode === "video") {
      return "camera optional";
    }

    return mode;
  });

  return labels.length > 0 ? labels.join(", ") : "audio";
}

function statusDescription(status: RoomStatus) {
  if (status === "preparing") {
    return "Creating your secure interview room.";
  }
  if (status === "permission_required") {
    return "Your browser will ask for microphone access next.";
  }
  if (status === "connecting") {
    return "Connecting your microphone to the interviewer.";
  }
  if (status === "interviewer_joining") {
    return "The interviewer is joining. You can relax and answer naturally.";
  }
  if (status === "connected") {
    return "You are live. The interviewer will wait while you finish speaking.";
  }
  if (status === "reconnecting") {
    return "Connection changed. We are reconnecting you automatically.";
  }
  if (status === "failed") {
    return "Something needs your attention before the interview can start.";
  }

  return "Ready when you are.";
}

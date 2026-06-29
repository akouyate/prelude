"use client";

import * as React from "react";
import { candidateConsentCopy, candidateDisclosureCopy } from "@prelude/core";
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
  fetchLiveSessionState,
  fetchLiveTranscript,
  resumeStorageKey,
  stopLocalStream,
  toCandidateError,
} from "./live-interview-client";
import type {
  ConnectedRoom,
  LiveInterviewSession,
  LiveTranscriptTurn,
  RoomStatus,
} from "./live-interview-types";
import {
  hasClosingTranscript,
  selectInterviewerView,
  shouldKeepCurrentRuntimeStatus,
  statusFromSessionState,
  statusFromTranscriptTurn,
  transcriptTurnsFromSessionState,
} from "./live-interview-runtime";
import { prepareVoiceLevelMeter, VoiceLevelMeter } from "./voice-level-meter";

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
  agent_joined: "Interviewer joined",
  connected: "Live now",
  interviewer_speaking: "Interviewer speaking",
  candidate_speaking: "Listening to you",
  listening: "Your turn",
  reconnecting: "Reconnecting",
  closing: "Wrapping up",
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
  const [transcriptTurns, setTranscriptTurns] = React.useState<
    LiveTranscriptTurn[]
  >([]);
  // The interviewer's currently-spoken segment, streamed in from the LiveKit
  // transcription paced to the audio. It drives the live word-by-word reveal;
  // finalized turns live in transcriptTurns for history.
  const [interviewerCaption, setInterviewerCaption] =
    React.useState<LiveTranscriptTurn | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const roomRef = React.useRef<ConnectedRoom | null>(null);
  const localStreamRef = React.useRef<MediaStream | null>(null);
  const startInFlightRef = React.useRef(false);
  const completionTimerRef = React.useRef<number | null>(null);
  const serverCompletionScheduledRef = React.useRef(false);
  const completedProductSessionIdsRef = React.useRef(new Set<string>());
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const mergeTranscriptTurns = React.useCallback(
    (incomingTurns: LiveTranscriptTurn[]) => {
      setTranscriptTurns((currentTurns) => {
        const byTurnId = new Map(
          currentTurns.map((turn) => [turn.turnId, turn] as const),
        );

        incomingTurns.forEach((incomingTurn) => {
          const currentTurn = byTurnId.get(incomingTurn.turnId);
          if (!currentTurn || incomingTurn.isFinal || !currentTurn.isFinal) {
            byTurnId.set(incomingTurn.turnId, incomingTurn);
          }
        });

        return Array.from(byTurnId.values()).sort(
          (left, right) =>
            Date.parse(left.startedAt) - Date.parse(right.startedAt),
        );
      });
    },
    [],
  );

  // The candidate sees one foreground line — the interviewer's live caption while
  // it streams, then the finalized question — above a few dimmed previous ones.
  const interviewerView = React.useMemo(
    () =>
      selectInterviewerView({
        finalTurns: transcriptTurns,
        caption: interviewerCaption,
      }),
    [interviewerCaption, transcriptTurns],
  );

  React.useEffect(() => {
    localStreamRef.current = localStream;
    if (videoRef.current) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  React.useEffect(() => {
    return () => {
      if (completionTimerRef.current) {
        window.clearTimeout(completionTimerRef.current);
      }
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

  const scheduleServerCompletion = React.useCallback(
    (nextSession: LiveInterviewSession | null, hasClosingTurn: boolean) => {
      if (serverCompletionScheduledRef.current) {
        return;
      }

      serverCompletionScheduledRef.current = true;
      completeCurrentSession(nextSession);
      setStatus("closing");

      const delayMs = hasClosingTurn ? 2200 : 3600;
      completionTimerRef.current = window.setTimeout(() => {
        roomRef.current?.disconnect();
        roomRef.current = null;
        stopLocalStream(localStreamRef.current);
        setLocalStream(null);
        setIsAudioPlaybackBlocked(false);
        setStatus("completed");
      }, delayMs);
    },
    [completeCurrentSession],
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

    prepareVoiceLevelMeter();
    startInFlightRef.current = true;
    let grantedStream: MediaStream | null = null;

    setError(null);
    setIsAudioPlaybackBlocked(false);
    setTranscriptTurns([]);
    setInterviewerCaption(null);
    setElapsedSeconds(0);
    serverCompletionScheduledRef.current = false;
    if (completionTimerRef.current) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
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
        onRoomConnected: () => setStatus("interviewer_joining"),
        onInterviewerJoined: () => setStatus("interviewer_joining"),
        onInterviewerReady: () => setStatus("connected"),
        onDisconnected: ({ intentional }) => {
          if (intentional) {
            if (!serverCompletionScheduledRef.current) {
              completeCurrentSession(nextSession);
              setStatus("completed");
            }
            return;
          }

          roomRef.current = null;
          stopLocalStream(stream);
          setLocalStream(null);
          setError(
            "The live interview connection closed unexpectedly. Please refresh the page and retry.",
          );
          setStatus("failed");
        },
        onAudioPlaybackBlocked: () => setIsAudioPlaybackBlocked(true),
        onAudioPlaybackReady: () => {
          setIsAudioPlaybackBlocked(false);
        },
        onTranscriptTurn: (turn) => {
          mergeTranscriptTurns([turn]);
          setStatus((currentStatus) =>
            statusFromTranscriptTurn(turn, currentStatus),
          );
        },
        onInterviewerCaption: (caption) => {
          setInterviewerCaption(caption);
          setStatus((currentStatus) =>
            statusFromTranscriptTurn(caption, currentStatus),
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
    mergeTranscriptTurns,
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
    status === "agent_joined" ||
    status === "connected" ||
    status === "interviewer_speaking" ||
    status === "candidate_speaking" ||
    status === "listening" ||
    status === "closing" ||
    status === "reconnecting";
  const interview = context.kind === "not_found" ? null : context.interview;
  const allowedModes = interview?.responseModes ?? ["audio", "video"];
  const canStart = hasAcceptedConsent && candidateName.trim().length > 1;
  const isLiveExperience = isBusy || isRoomActive;

  React.useEffect(() => {
    if (!isLiveExperience) {
      return undefined;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isLiveExperience]);

  React.useEffect(() => {
    if (!session?.sessionId || !isRoomActive) {
      return undefined;
    }

    let isCancelled = false;

    const loadTranscript = async () => {
      try {
        const turns = await fetchLiveTranscript(session.sessionId);
        if (!isCancelled) {
          mergeTranscriptTurns(turns);
        }
      } catch {
        // Transcript is a progressive enhancement for the room UI.
      }
    };

    void loadTranscript();
    const interval = window.setInterval(loadTranscript, 2500);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [isRoomActive, mergeTranscriptTurns, session?.sessionId]);

  React.useEffect(() => {
    if (!session?.sessionId || session.livekit.isMock || !isRoomActive) {
      return undefined;
    }

    let isCancelled = false;

    const loadSessionState = async () => {
      try {
        const state = await fetchLiveSessionState(session.sessionId);
        if (isCancelled) {
          return;
        }

        const stateTurns = transcriptTurnsFromSessionState(state);
        if (stateTurns.length > 0) {
          mergeTranscriptTurns(stateTurns);
        }

        const nextStatus = statusFromSessionState(state);
        if (nextStatus === "completed") {
          scheduleServerCompletion(session, hasClosingTranscript(state));
          return;
        }
        if (nextStatus === "failed") {
          setStatus("failed");
          setError(
            "The interviewer could not complete this session. Please ask the recruiter for a fresh link.",
          );
          return;
        }

        setStatus((currentStatus) =>
          shouldKeepCurrentRuntimeStatus(currentStatus, nextStatus)
            ? currentStatus
            : nextStatus,
        );
      } catch {
        // Runtime state polling is a fallback signal; LiveKit remains primary.
      }
    };

    void loadSessionState();
    const interval = window.setInterval(loadSessionState, 1250);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [
    isRoomActive,
    mergeTranscriptTurns,
    scheduleServerCompletion,
    session,
  ]);

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

  if (isLiveExperience) {
    return (
      <LiveInterviewStage
        activeText={interviewerView.activeText}
        activeTurnId={interviewerView.activeTurnId}
        allowedModes={allowedModes}
        elapsedSeconds={elapsedSeconds}
        isAudioPlaybackBlocked={isAudioPlaybackBlocked}
        isRoomActive={isRoomActive}
        isStreaming={interviewerView.isStreaming}
        isVideoEnabled={isVideoEnabled}
        localStream={localStream}
        onEnableAudio={enableAudio}
        onEndInterview={endInterview}
        previousTurns={interviewerView.previous}
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
          {candidateDisclosureCopy} We listen to{" "}
          <span className="font-display text-xl italic text-ink-950">
            what you say
          </span>
          .
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
        <span>{candidateConsentCopy}</span>
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
  activeText,
  activeTurnId,
  allowedModes,
  elapsedSeconds,
  isAudioPlaybackBlocked,
  isRoomActive,
  isStreaming,
  isVideoEnabled,
  localStream,
  onEnableAudio,
  onEndInterview,
  previousTurns,
  status,
  videoRef,
}: {
  activeText: string | null;
  activeTurnId: string | null;
  allowedModes: string[];
  elapsedSeconds: number;
  isAudioPlaybackBlocked: boolean;
  isRoomActive: boolean;
  isStreaming: boolean;
  isVideoEnabled: boolean;
  localStream: MediaStream | null;
  onEnableAudio: () => void;
  onEndInterview: () => void;
  previousTurns: LiveTranscriptTurn[];
  status: RoomStatus;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const showVideo = Boolean(
    localStream && allowedModes.includes("video") && isVideoEnabled,
  );
  const activeDisplayText = activeText ?? statusDescription(status);
  const activeWords = React.useMemo(
    () => splitTranscriptWords(activeDisplayText),
    [activeDisplayText],
  );
  const activeSizeClass = activeTextSizeClass(activeDisplayText);
  const stageScrollRef = React.useRef<HTMLDivElement | null>(null);
  // Keep the live edge (the word being spoken) in view when a long turn — the
  // closing especially — grows past the viewport, instead of letting it clip.
  React.useEffect(() => {
    const container = stageScrollRef.current;
    if (!container || !isStreaming) {
      return;
    }
    if (container.scrollHeight > container.clientHeight) {
      container.scrollTop = container.scrollHeight;
    }
  }, [activeWords.length, isStreaming]);
  const isConnectingOnly =
    status === "preparing" ||
    status === "permission_required" ||
    status === "connecting";

  return (
    <section className="fixed inset-0 z-50 flex h-[100svh] flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_-10%,#3c421f_0%,#1d1c16_38%,#131210_100%)] px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] text-white supports-[height:100dvh]:h-[100dvh] sm:px-8">
      <div className="pointer-events-none absolute left-1/2 top-[30%] h-[120vh] w-[150vw] -translate-x-1/2 opacity-70">
        <div className="absolute left-1/2 top-1/2 h-full w-full -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(closest-side,oklch(0.7_0.17_121.25_/_0.34),oklch(0.55_0.13_121.25_/_0.13)_45%,transparent_72%)] blur-3xl motion-safe:animate-[cc-aura_4.4s_ease-in-out_infinite]" />
      </div>
      <div className="pointer-events-none absolute inset-0 opacity-45 [background-image:url('data:image/svg+xml;utf8,<svg_xmlns=%22http://www.w3.org/2000/svg%22_width=%22160%22_height=%22160%22><filter_id=%22n%22><feTurbulence_type=%22fractalNoise%22_baseFrequency=%220.8%22_numOctaves=%222%22/></filter><rect_width=%22100%25%22_height=%22100%25%22_filter=%22url(%23n)%22_opacity=%220.04%22/></svg>')]" />

      <div className="flex shrink-0 items-center justify-between gap-4">
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/42">
            Powered by Prelude.ai
          </p>
          <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-white/82">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10">
              <Mic aria-hidden="true" className="h-4 w-4" />
            </span>
            Live interview
          </div>
        </div>
        <StatusPill status={status} />
      </div>

      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-y-auto py-4 sm:py-10"
        ref={stageScrollRef}
      >
        <div className="m-auto w-full max-w-4xl">
          {isConnectingOnly ? (
            <ConnectingInterviewState status={status} />
          ) : (
            <div
              aria-live="polite"
              className="mx-auto max-w-3xl text-left"
              key={activeTurnId ?? status}
            >
              <div className="mb-5 inline-flex items-center gap-2 sm:mb-7">
                <span className="h-2 w-2 rounded-full bg-olive-200 motion-safe:animate-[cc-livedot_1.6s_ease-in-out_infinite]" />
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-olive-200">
                  Interviewer
                </span>
              </div>

              <div className="flex flex-col gap-3">
                {previousTurns.map((turn) => (
                  <p
                    className="max-w-2xl animate-[cc-histIn_.5s_ease_both] text-base font-medium leading-7 text-white/32 sm:text-xl"
                    key={turn.turnId}
                  >
                    {turn.text}
                  </p>
                ))}
                <p
                  className={`font-semibold leading-[1.2] tracking-normal text-[#fef9f2] ${activeSizeClass}`}
                >
                  {activeWords.map((word, index) => {
                    // Each word mounts exactly when its delta arrives, so the
                    // entrance animation tracks the voice. Keying by turn+index
                    // (not by text) keeps a growing word stable in place while a
                    // new question re-keys and replays the reveal. The last word
                    // while streaming is the one being spoken — gently lit.
                    const isLiveWord =
                      isStreaming && index === activeWords.length - 1;

                    return (
                      <span
                        className={`mr-[0.24em] inline-block${
                          isStreaming
                            ? " animate-[cc-wordIn_.42s_cubic-bezier(.2,.7,.2,1)_both]"
                            : ""
                        }${isLiveWord ? " text-[oklch(0.9_0.14_121.3)]" : ""}`}
                        key={`${activeTurnId ?? "status"}:${index}`}
                      >
                        {word}
                      </span>
                    );
                  })}
                  {isStreaming ? (
                    <span className="inline-block h-[0.92em] w-[3px] translate-y-[0.08em] bg-olive-200 motion-safe:animate-[cc-blink_1s_step-end_infinite]" />
                  ) : null}
                </p>
              </div>

              <p className="mt-7 max-w-xl text-sm leading-6 text-white/50 sm:text-base">
                You can ask to repeat the question, take a moment to think, or
                answer naturally. The interviewer will wait while you finish.
              </p>
            </div>
          )}

          {showVideo ? (
            <div className="absolute bottom-24 left-5 w-28 overflow-hidden rounded-3xl border border-white/10 bg-ink-950 sm:bottom-8 sm:left-8 sm:w-44">
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

      <div className="ml-auto flex w-full shrink-0 items-center justify-between gap-3 rounded-full border border-white/10 bg-ink-950/70 p-2 text-white backdrop-blur sm:w-auto">
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
        <VoiceLevelMeter isActive={isRoomActive} stream={localStream} />
      </div>
    </section>
  );
}

function ConnectingInterviewState({ status }: { status: RoomStatus }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="relative mx-auto grid h-28 w-28 place-items-center sm:h-36 sm:w-36">
        <span className="absolute inset-0 rounded-full border border-olive-300/40 motion-safe:animate-[cc-ring_2.4s_ease-out_infinite]" />
        <span className="absolute inset-0 rounded-full border border-olive-300/30 motion-safe:animate-[cc-ring_2.4s_ease-out_infinite_1.2s]" />
        <span className="grid h-16 w-16 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,oklch(0.826_0.199_121.3),oklch(0.507_0.122_121.25))]">
          <Mic aria-hidden="true" className="h-7 w-7 text-ink-950" />
        </span>
      </div>
      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-olive-200">
        Connecting
      </p>
      <h2 className="mx-auto mt-4 max-w-2xl text-2xl font-semibold leading-tight tracking-normal sm:text-4xl">
        {statusDescription(status)}
      </h2>
      <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-white/58 sm:text-base">
        One moment while we set up your private room.
      </p>
    </div>
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
  if (status === "agent_joined") {
    return "The interviewer has joined and is getting ready.";
  }
  if (status === "connected") {
    return "You are live. The interviewer will wait while you finish speaking.";
  }
  if (status === "interviewer_speaking") {
    return "The interviewer is speaking.";
  }
  if (status === "candidate_speaking") {
    return "Keep going. The interviewer is listening.";
  }
  if (status === "listening") {
    return "Your turn. Answer naturally when you are ready.";
  }
  if (status === "reconnecting") {
    return "Connection changed. We are reconnecting you automatically.";
  }
  if (status === "closing") {
    return "Thank you. The interviewer is wrapping up the conversation.";
  }
  if (status === "failed") {
    return "Something needs your attention before the interview can start.";
  }

  return "Ready when you are.";
}

function splitTranscriptWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}

// The active line is sized to its length: short questions stay large and
// theatrical, long statements (the closing especially) shrink so they fit the
// viewport rather than overflowing off the bottom. The scroll container is the
// safety net for anything still taller than the screen.
function activeTextSizeClass(text: string): string {
  const length = text.trim().length;
  if (length > 220) {
    return "text-xl sm:text-2xl lg:text-3xl";
  }
  if (length > 120) {
    return "text-2xl sm:text-3xl lg:text-4xl";
  }
  return "text-3xl sm:text-5xl lg:text-6xl";
}

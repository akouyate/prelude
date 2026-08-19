"use client";

import * as React from "react";
import {
  candidateConsentCopyFor,
  candidateDisclosureCopyFor,
} from "@prelude/core";
import {
  AlertIcon,
  ArrowLeftIcon,
  BrandMark,
  Button,
  CandidateInterviewIntro,
  CandidateMonoPill,
  CandidatePreflightExperience,
  CandidateScreenHeader,
  CandidateWelcomeExperience,
  CandidateWordmark,
  CheckIcon,
  ClockIcon,
  HangUpIcon,
  MicIcon,
  PencilIcon,
  RestartIcon,
  SkipForwardIcon,
  TranscriptIcon,
  formatCandidateModes,
  type CandidateInterviewExperienceLabels,
} from "@prelude/ui";

import type { PublicInterviewContext } from "../../server/public-interviews";
import {
  candidateExperienceCopy,
  type CandidateExperienceCopy,
} from "./candidate-experience-copy";
import {
  completeProductSession,
  connectRoom,
  createSession,
  fetchLiveSessionState,
  fetchLiveTranscript,
  markProductSessionLifecycle,
  resumeStorageKey,
  stopLocalStream,
  submitFormInterview,
  toCandidateError,
} from "./live-interview-client";
import type {
  CandidateInactivityNotice,
  ConnectedRoom,
  LiveInterviewSession,
  LiveTranscriptTurn,
  RoomStatus,
} from "./live-interview-types";
import {
  hasClosingTranscript,
  inactivityNoticeFromSessionState,
  selectInterviewerView,
  shouldKeepCurrentRuntimeStatus,
  statusFromSessionState,
  statusFromTranscriptTurn,
  transcriptTurnsFromSessionState,
} from "./live-interview-runtime";
import {
  LIVE_INTERVIEW_RECOVERY_POLICY,
  recoverLiveInterviewConnection,
} from "./live-interview-recovery";
import { prepareVoiceLevelMeter, VoiceLevelMeter } from "./voice-level-meter";

type CandidateStep = "welcome" | "setup" | "form";

type CandidateInterview = Exclude<
  PublicInterviewContext,
  { kind: "not_found" }
>["interview"];

// Shared button shapes for the light screens. The pill, the Figtree label and
// the sheen (data-cc-btn, see globals.css) are the candidate signature.
const primaryActionClass =
  "gap-2.5 rounded-full font-title font-medium hover:bg-spruce-800";
const quietActionClass =
  "gap-2.5 rounded-full border border-ink-300 bg-paper-sunken font-title font-medium text-ink-950 hover:border-ink-900 hover:bg-paper-sunken";
// On the dark stage the shared focus ring (tuned for paper) disappears, so
// buttons there take the pale live-stage highlight instead.
const stageFocusRingClass = "focus-visible:ring-spruce-300";

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
  processing: "Preparing the next question",
  listening: "Your turn",
  reconnecting: "Reconnecting",
  closing: "Wrapping up",
  failed: "Needs attention",
  completed: "Completed",
  abandoned: "Ended",
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
  // finalized turns remain in transcriptTurns for recruiter review, not for
  // the candidate's foreground display.
  const [interviewerCaption, setInterviewerCaption] =
    React.useState<LiveTranscriptTurn | null>(null);
  const [formAnswers, setFormAnswers] = React.useState<Record<string, string>>(
    {},
  );
  const [isSubmittingForm, setIsSubmittingForm] = React.useState(false);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [inactivityNotice, setInactivityNotice] =
    React.useState<CandidateInactivityNotice | null>(null);
  const roomRef = React.useRef<ConnectedRoom | null>(null);
  const localStreamRef = React.useRef<MediaStream | null>(null);
  const sessionRef = React.useRef<LiveInterviewSession | null>(null);
  const startAbortRef = React.useRef<AbortController | null>(null);
  const recoveryAbortRef = React.useRef<AbortController | null>(null);
  const connectionGenerationRef = React.useRef(0);
  const activeConnectionGenerationRef = React.useRef<number | null>(null);
  const startInFlightRef = React.useRef(false);
  const completionTimerRef = React.useRef<number | null>(null);
  const serverCompletionScheduledRef = React.useRef(false);
  const userAbandoningRef = React.useRef(false);
  const serverFailureHandledRef = React.useRef(false);
  const completedProductSessionIdsRef = React.useRef(new Set<string>());
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

  // The candidate sees one foreground line: the interviewer's live caption while
  // it streams, then the latest finalized question — with the line before it
  // held faded above so the thread of the conversation stays visible.
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
  }, [localStream]);

  React.useEffect(() => {
    return () => {
      if (completionTimerRef.current) {
        window.clearTimeout(completionTimerRef.current);
      }
      startAbortRef.current?.abort();
      recoveryAbortRef.current?.abort();
      activeConnectionGenerationRef.current = null;
      stopLocalStream(localStreamRef.current);
      roomRef.current?.disconnect();
    };
  }, []);

  React.useEffect(() => {
    if (
      status === "ready" ||
      status === "failed" ||
      status === "completed" ||
      status === "abandoned"
    ) {
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
        recoveryAbortRef.current?.abort();
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
    const startController = new AbortController();
    startAbortRef.current = startController;
    let grantedStream: MediaStream | null = null;
    let nextSession: LiveInterviewSession | null = null;

    setError(null);
    setIsAudioPlaybackBlocked(false);
    setTranscriptTurns([]);
    setInterviewerCaption(null);
    setElapsedSeconds(0);
    setInactivityNotice(null);
    serverCompletionScheduledRef.current = false;
    serverFailureHandledRef.current = false;
    userAbandoningRef.current = false;
    if (completionTimerRef.current) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    setStatus("preparing");

    try {
      if (context.kind === "preview") {
        setStatus("permission_required");
        grantedStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        startController.signal.throwIfAborted();
        setLocalStream(grantedStream);
      }

      nextSession = await createSession({
        candidateEmail,
        candidateName,
        consentAccepted: hasAcceptedConsent,
        resumeToken:
          context.kind === "preview"
            ? undefined
            : (window.localStorage.getItem(resumeStorageKey(token)) ??
              undefined),
        preview: context.kind === "preview",
        signal: startController.signal,
        token,
        videoEnabled: false,
      });
      if (context.kind !== "preview" && nextSession.resumeToken) {
        window.localStorage.setItem(
          resumeStorageKey(token),
          nextSession.resumeToken,
        );
      }
      sessionRef.current = nextSession;
      setSession(nextSession);

      if (!grantedStream) {
        setStatus("permission_required");
        grantedStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        startController.signal.throwIfAborted();
        setLocalStream(grantedStream);
      }

      const stream = grantedStream;

      async function connectPreparedSession(
        preparedSession: LiveInterviewSession,
        preparedStream: MediaStream,
        signal?: AbortSignal,
      ) {
        const connectionGeneration = connectionGenerationRef.current + 1;
        connectionGenerationRef.current = connectionGeneration;
        activeConnectionGenerationRef.current = connectionGeneration;

        let connectedRoom: ConnectedRoom;
        try {
          connectedRoom = await connectRoom({
            session: preparedSession,
            signal,
            stream: preparedStream,
            onReconnecting: () => setStatus("reconnecting"),
            onRoomConnected: () => setStatus("interviewer_joining"),
            onInterviewerJoined: () => setStatus("interviewer_joining"),
            onInterviewerReady: () => setStatus("connected"),
            onDisconnected: ({ intentional }) => {
              if (
                activeConnectionGenerationRef.current !== connectionGeneration
              ) {
                return;
              }

              activeConnectionGenerationRef.current = null;
              roomRef.current = null;

              if (serverFailureHandledRef.current) {
                setStatus("failed");
                return;
              }

              if (intentional) {
                if (userAbandoningRef.current) {
                  setStatus("abandoned");
                  return;
                }
                if (!serverCompletionScheduledRef.current) {
                  completeCurrentSession(preparedSession);
                  setStatus("completed");
                }
                return;
              }

              // If recovery still owns this generation, its acceptance check
              // will retry inside the same five-minute window.
              if (recoveryAbortRef.current) {
                return;
              }

              void recoverDisconnectedSession(preparedSession, preparedStream);
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
          signal?.throwIfAborted();
        } catch (cause) {
          if (activeConnectionGenerationRef.current === connectionGeneration) {
            activeConnectionGenerationRef.current = null;
          }
          throw cause;
        }

        if (activeConnectionGenerationRef.current === connectionGeneration) {
          roomRef.current = connectedRoom;
        } else {
          connectedRoom.disconnect();
        }

        return connectionGeneration;
      }

      async function recoverDisconnectedSession(
        disconnectedSession: LiveInterviewSession,
        disconnectedStream: MediaStream,
      ) {
        if (
          recoveryAbortRef.current ||
          userAbandoningRef.current ||
          serverCompletionScheduledRef.current
        ) {
          return;
        }

        const recoveryController = new AbortController();
        recoveryAbortRef.current = recoveryController;
        const recoveryDeadline =
          Date.now() + LIVE_INTERVIEW_RECOVERY_POLICY.recoveryWindowMs;
        let latestSession = disconnectedSession;
        setError(null);
        setIsAudioPlaybackBlocked(false);
        setInterviewerCaption(null);
        setStatus("reconnecting");

        try {
          while (!recoveryController.signal.aborted) {
            const remainingRecoveryMs = recoveryDeadline - Date.now();
            if (remainingRecoveryMs <= 0) {
              throw new Error("recovery_exhausted");
            }

            const recoveredConnection = await recoverLiveInterviewConnection<{
              connectionGeneration: number;
              session: LiveInterviewSession;
            }>({
              acceptResult: ({ connectionGeneration }) =>
                activeConnectionGenerationRef.current === connectionGeneration,
              signal: recoveryController.signal,
              onAttempt: () => setStatus("reconnecting"),
              policy: {
                ...LIVE_INTERVIEW_RECOVERY_POLICY,
                recoveryWindowMs: remainingRecoveryMs,
              },
              attempt: async ({ signal }) => {
                const refreshedSession =
                  context.kind === "preview"
                    ? latestSession
                    : await createSession({
                        candidateEmail,
                        candidateName,
                        consentAccepted: hasAcceptedConsent,
                        resumeToken:
                          latestSession.resumeToken ??
                          window.localStorage.getItem(
                            resumeStorageKey(token),
                          ) ??
                          undefined,
                        preview: false,
                        signal,
                        token,
                        videoEnabled: false,
                      });
                latestSession = refreshedSession;
                sessionRef.current = refreshedSession;
                if (
                  context.kind !== "preview" &&
                  refreshedSession.resumeToken
                ) {
                  window.localStorage.setItem(
                    resumeStorageKey(token),
                    refreshedSession.resumeToken,
                  );
                }
                const connectionGeneration = await connectPreparedSession(
                  refreshedSession,
                  disconnectedStream,
                  signal,
                );
                return {
                  connectionGeneration,
                  session: refreshedSession,
                };
              },
            });

            if (
              activeConnectionGenerationRef.current !==
              recoveredConnection.connectionGeneration
            ) {
              continue;
            }

            // Release recovery ownership before publishing the recovered room.
            // A later disconnect will therefore start a fresh recovery cycle.
            if (recoveryAbortRef.current === recoveryController) {
              recoveryAbortRef.current = null;
            }
            if (!recoveryController.signal.aborted) {
              sessionRef.current = recoveredConnection.session;
              setSession(recoveredConnection.session);
            }
            return;
          }
        } catch {
          if (recoveryController.signal.aborted) {
            return;
          }

          stopLocalStream(disconnectedStream);
          setLocalStream(null);
          await markProductSessionLifecycle(latestSession, "fail");
          setError(
            "We could not restore the live connection. Your existing answers are saved; try joining again.",
          );
          setStatus("failed");
        } finally {
          if (recoveryAbortRef.current === recoveryController) {
            recoveryAbortRef.current = null;
          }
        }
      }

      setStatus("connecting");
      await connectPreparedSession(nextSession, stream, startController.signal);
    } catch (cause) {
      roomRef.current?.disconnect();
      roomRef.current = null;
      if (startController.signal.aborted) {
        stopLocalStream(grantedStream);
        setLocalStream(null);
        return;
      }
      if (nextSession) {
        await markProductSessionLifecycle(nextSession, "fail");
      }
      stopLocalStream(grantedStream);
      setLocalStream(null);
      setStatus("failed");
      setError(toCandidateError(cause));
    } finally {
      if (startAbortRef.current === startController) {
        startAbortRef.current = null;
      }
      startInFlightRef.current = false;
    }
  }, [
    candidateEmail,
    candidateName,
    completeCurrentSession,
    context.kind,
    hasAcceptedConsent,
    mergeTranscriptTurns,
    token,
  ]);

  const endInterview = React.useCallback(() => {
    userAbandoningRef.current = true;
    startAbortRef.current?.abort();
    startAbortRef.current = null;
    recoveryAbortRef.current?.abort();
    recoveryAbortRef.current = null;
    activeConnectionGenerationRef.current = null;
    if (sessionRef.current) {
      void markProductSessionLifecycle(sessionRef.current, "abandon");
    }
    roomRef.current?.disconnect();
    roomRef.current = null;
    stopLocalStream(localStream);
    setLocalStream(null);
    setIsAudioPlaybackBlocked(false);
    setStatus("abandoned");
  }, [localStream]);

  const retryAfterAbandon = React.useCallback(() => {
    userAbandoningRef.current = false;
    sessionRef.current = null;
    setSession(null);
    setTranscriptTurns([]);
    setInterviewerCaption(null);
    setError(null);
    setStatus("ready");
    setStep("setup");
  }, []);

  const backToWelcome = React.useCallback(() => {
    setError(null);
    setStatus("ready");
    setStep("welcome");
  }, []);

  const openFormFallback = React.useCallback(() => {
    setError(null);
    setStatus("ready");
    setStep("form");
  }, []);

  const confirmCandidatePresence = React.useCallback(() => {
    setInactivityNotice(null);
    void roomRef.current?.sendControl("candidate_presence_confirmed");
  }, []);

  const repeatCurrentQuestion = React.useCallback(() => {
    setInactivityNotice(null);
    void roomRef.current?.sendControl("repeat_question");
  }, []);

  // Publishing this is not what makes it work: the worker only honours it on a
  // preview session, from the kind it holds server-side.
  const skipCurrentQuestion = React.useCallback(() => {
    setInactivityNotice(null);
    void roomRef.current?.sendControl("skip_question");
  }, []);

  const continueInWriting = React.useCallback(() => {
    const currentSession = sessionRef.current;
    if (currentSession) {
      void markProductSessionLifecycle(currentSession, "abandon");
    }
    activeConnectionGenerationRef.current = null;
    roomRef.current?.disconnect();
    roomRef.current = null;
    stopLocalStream(localStreamRef.current);
    setLocalStream(null);
    setInactivityNotice(null);
    setError(null);
    setStatus("ready");
    setStep("form");
  }, []);

  const updateFormAnswer = React.useCallback(
    (questionId: string, value: string) => {
      setFormAnswers((currentAnswers) => ({
        ...currentAnswers,
        [questionId]: value,
      }));
    },
    [],
  );

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
    status === "processing" ||
    status === "listening" ||
    status === "closing" ||
    status === "reconnecting";
  const interview = context.kind === "not_found" ? null : context.interview;
  const allowedModes = interview?.responseModes ?? ["audio"];
  const formQuestions = interview?.questions ?? [];
  const isFormFallbackAvailable =
    allowedModes.includes("form") && formQuestions.length > 0;
  const canStart = hasAcceptedConsent && candidateName.trim().length > 1;
  const isLiveExperience = isBusy || isRoomActive;
  const isPreview = context.kind === "preview";
  /*
   * The pre-join surfaces render in the INTERVIEW's language, resolved once
   * server-side (`resolveCandidateRenderingLanguage`) and carried on the
   * context. The same resolved value is what the server stamps as
   * `consentLanguage`, so what the candidate read and what the record says can
   * never drift apart. A `not_found` context never reaches those screens; it
   * falls through to `UnavailableInterview`.
   */
  const renderingLanguage =
    context.kind === "not_found" ? "fr" : context.interview.language;
  /*
   * The second axis of the statutory copy, resolved server-side on the same
   * context as the language and stamped from the same value
   * (`prepareCandidateSession`). A preview is pinned to `false` here as well as
   * on its own context: a preview starts no egress, so it must never claim one
   * — and pinning it at the render site means turning `RECORDING_ENABLED` on
   * cannot make a preview describe a recording that will not happen.
   */
  const recordingActive =
    context.kind === "published" ? context.interview.recordingActive : false;
  // `candidateExperienceCopy` hands back the module-level table for the
  // language, so `copy` is a stable reference and a legitimate memo dependency.
  const copy = candidateExperienceCopy(renderingLanguage);
  const estimatedMinutes = interview?.estimatedMinutes ?? null;
  const modesLabel = React.useMemo(
    () =>
      formatCandidateModes(allowedModes, {
        audio: copy.modeAudio,
        formFallback: copy.modeFormFallback,
      }),
    [allowedModes, copy],
  );
  /*
   * Assembled here rather than inside @prelude/ui, for the same reason the
   * console assembles `EnterpriseShellLabels`: the package takes finished copy,
   * and composing a sentence is a translation concern only this side can do.
   *
   * Memoized because the live room re-renders roughly once a second (three
   * polling intervals drive it), and rebuilding 33 strings — several of them
   * interpolated — on every tick is pure waste. Every dependency below is
   * reference-stable across those ticks: `copy` is the module table, `interview`
   * comes off the `context` prop, and the rest are primitives.
   */
  const preJoinLabels: CandidateInterviewExperienceLabels = React.useMemo(
    () => ({
      answersBody: copy.answersBody,
      answersTitle: copy.answersTitle,
      audioOnlyNotice: copy.audioOnlyNotice,
      controllerLine: copy.controllerLine(interview?.companyName ?? ""),
      durationPill: estimatedMinutes
        ? copy.durationLong(estimatedMinutes)
        : copy.durationUnknown,
      emailLabel: copy.emailLabel,
      emailOptional: copy.emailOptional,
      emailPlaceholder: copy.emailPlaceholder,
      evidenceBody: isPreview ? copy.previewEvidenceBody : copy.evidenceBody,
      evidenceTitle: isPreview ? copy.previewEvidenceTitle : copy.evidenceTitle,
      fairnessHeading: copy.fairnessHeading,
      fairnessKicker: copy.fairnessKicker,
      formatLabel: copy.formatLabel,
      formatValue: modesLabel,
      humanReviewedPill: copy.humanReviewedPill,
      introDescription: isPreview
        ? copy.previewIntroDescription
        : copy.introDescription({
            companyName: interview?.companyName ?? "",
            roleTitle: interview?.roleTitle ?? "",
          }),
      introHeading: copy.introHeading,
      introPill: copy.introPill,
      invitation: copy.invitation(interview?.companyName ?? ""),
      lengthLabel: copy.lengthLabel,
      lengthValue: estimatedMinutes
        ? copy.durationShort(estimatedMinutes)
        : copy.durationUnknown,
      listeningNoteEmphasis: copy.listeningNoteEmphasis,
      listeningNoteLead: copy.listeningNoteLead,
      modesPill: modesLabel,
      nameLabel: copy.nameLabel,
      namePlaceholder: copy.namePlaceholder,
      paceBody: copy.paceBody,
      paceTitle: copy.paceTitle,
      preflightHeading: copy.preflightHeading,
      preflightSubtitle: copy.preflightSubtitle({
        jobTitle: interview?.jobTitle ?? "",
        minutes: estimatedMinutes,
      }),
      privacyNoticeLink: copy.privacyNoticeLink,
      privacyPill: copy.privacyPill,
      roleLabel: copy.roleLabel,
      startButton: copy.startButton,
      startFootnote: copy.startFootnote,
    }),
    [copy, estimatedMinutes, interview, isPreview, modesLabel],
  );
  const primaryStartLabel =
    isPreview && canStart
      ? copy.previewStart
      : startButtonLabel({
          canStart,
          candidateName,
          copy,
          hasAcceptedConsent,
        });

  const submitWrittenAnswers = React.useCallback(async () => {
    if (context.kind === "not_found" || !canStart || !isFormFallbackAvailable) {
      return;
    }

    const answers = formQuestions.map((question) => ({
      questionId: question.id,
      text: formAnswers[question.id]?.trim() ?? "",
    }));
    if (answers.some((answer) => answer.text.length <= 1)) {
      setError("Please answer each question before submitting.");
      return;
    }

    if (context.kind === "preview") {
      sessionRef.current = null;
      setSession(null);
      setElapsedSeconds(0);
      setStatus("completed");
      return;
    }

    setError(null);
    setIsSubmittingForm(true);
    try {
      const result = await submitFormInterview({
        answers,
        candidateEmail,
        candidateName,
        consentAccepted: hasAcceptedConsent,
        resumeToken:
          window.localStorage.getItem(resumeStorageKey(token)) ?? undefined,
        token,
      });
      if (result.resumeToken) {
        window.localStorage.setItem(
          resumeStorageKey(token),
          result.resumeToken,
        );
      }
      sessionRef.current = null;
      setSession(null);
      setElapsedSeconds(0);
      setStatus("completed");
    } catch (cause) {
      setError(toCandidateError(cause));
    } finally {
      setIsSubmittingForm(false);
    }
  }, [
    canStart,
    candidateEmail,
    candidateName,
    context.kind,
    formAnswers,
    formQuestions,
    hasAcceptedConsent,
    isFormFallbackAvailable,
    token,
  ]);

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
        setInactivityNotice(inactivityNoticeFromSessionState(state));

        const nextStatus = statusFromSessionState(state);
        if (nextStatus === "completed") {
          scheduleServerCompletion(session, hasClosingTranscript(state));
          return;
        }
        if (nextStatus === "failed") {
          if (recoveryAbortRef.current) {
            return;
          }
          if (!serverFailureHandledRef.current) {
            serverFailureHandledRef.current = true;
            await markProductSessionLifecycle(session, "fail");
          }
          activeConnectionGenerationRef.current = null;
          roomRef.current?.disconnect();
          roomRef.current = null;
          stopLocalStream(localStreamRef.current);
          setLocalStream(null);
          setInactivityNotice(null);
          setStatus("failed");
          setError(
            "This attempt ended before completion. Your existing answers are saved, and you can retry using the same link.",
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
  }, [isRoomActive, mergeTranscriptTurns, scheduleServerCompletion, session]);

  if (!interview) {
    return <UnavailableInterview />;
  }

  const blockedInvitation = blockingInvitationCopy(
    context.kind === "published" ? context.invitation?.status : null,
  );
  if (blockedInvitation) {
    return (
      <UnavailableInterview
        message={blockedInvitation.message}
        title={blockedInvitation.title}
      />
    );
  }

  if (status === "ready" && step === "welcome") {
    return (
      <>
        <CandidateScreenHeader
          left={<CandidateWordmark className="h-[23px]" />}
          right={<CandidateMonoPill>{copy.headerPill}</CandidateMonoPill>}
        />
        <CandidateWelcomeExperience
          disclosureCopy={
            isPreview
              ? copy.previewDisclosureCopy
              : candidateDisclosureCopyFor(renderingLanguage, recordingActive)
                  .text
          }
          labels={preJoinLabels}
          onStart={() => setStep("setup")}
          /*
           * Sibling of the interview the candidate is already on, so the notice
           * resolves the same token — same controller, same language — with no
           * authentication. The recruiter preview runs on a preview token that
           * no public notice route answers, so it gets no link (the controller
           * line itself still renders).
           */
          privacyNoticeHref={
            isPreview ? null : `/interview/${encodeURIComponent(token)}/privacy`
          }
          roleTitle={interview.roleTitle}
        />
      </>
    );
  }

  if (status === "completed") {
    return (
      <CompletionPanel
        candidateName={candidateName}
        companyName={interview.companyName}
        elapsedSeconds={elapsedSeconds}
        isPreview={context.kind === "preview"}
      />
    );
  }

  if (status === "abandoned") {
    return (
      <AbandonedPanel
        companyName={interview.companyName}
        copy={copy}
        onRetry={retryAfterAbandon}
      />
    );
  }

  if (step === "form") {
    return (
      <FormFallbackPanel
        answers={formAnswers}
        canSubmit={canStart && !isSubmittingForm}
        description={
          context.kind === "preview"
            ? "Use this fallback to test the complete written experience. These answers stay outside the candidate pipeline."
            : undefined
        }
        error={error}
        isSubmitting={isSubmittingForm}
        onAnswerChange={updateFormAnswer}
        onBack={() => {
          setError(null);
          setStep("setup");
        }}
        onSubmit={submitWrittenAnswers}
        questions={formQuestions}
        roleTitle={interview.roleTitle}
      />
    );
  }

  if (isLiveExperience) {
    return (
      <LiveInterviewStage
        activeText={interviewerView.activeText}
        activeTurnId={interviewerView.activeTurnId}
        elapsedSeconds={elapsedSeconds}
        isAudioPlaybackBlocked={isAudioPlaybackBlocked}
        inactivityNotice={inactivityNotice}
        isFormFallbackAvailable={isFormFallbackAvailable}
        isPreview={isPreview}
        isRoomActive={isRoomActive}
        isStreaming={interviewerView.isStreaming}
        localStream={localStream}
        onEnableAudio={enableAudio}
        copy={copy}
        onEndInterview={endInterview}
        onConfirmPresence={confirmCandidatePresence}
        onContinueInWriting={continueInWriting}
        onRepeatQuestion={repeatCurrentQuestion}
        onSkipQuestion={skipCurrentQuestion}
        status={status}
      />
    );
  }

  return (
    <>
      <CandidateScreenHeader
        left={
          <button
            className="inline-flex items-center gap-2 py-1.5 font-title text-[14.5px] font-medium text-ink-700 transition-colors hover:text-spruce-600"
            onClick={backToWelcome}
            type="button"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {copy.back}
          </button>
        }
        right={<CandidateWordmark />}
      />
      <div className="flex flex-1 items-center justify-center px-[clamp(1.125rem,5vw,2.75rem)] pb-16 pt-2">
        <div className="grid w-full max-w-[1120px] grid-cols-1 items-center gap-[clamp(1.75rem,4vw,3.5rem)] motion-safe:animate-[cc-in_.5s_cubic-bezier(.2,.7,.2,1)_both] min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(380px,430px)]">
          <CandidateInterviewIntro
            jobTitle={interview.jobTitle}
            labels={preJoinLabels}
          />
          <div className="rounded-[32px] border border-ink-200 bg-white p-[clamp(1.25rem,3vw,1.625rem)]">
            <CandidatePreflightExperience
              candidateEmail={candidateEmail}
              candidateName={candidateName}
              consentAccepted={hasAcceptedConsent}
              consentCopy={
                isPreview
                  ? copy.previewConsentCopy
                  : candidateConsentCopyFor(renderingLanguage, recordingActive)
                      .text
              }
              labels={preJoinLabels}
              onCandidateEmailChange={setCandidateEmail}
              onCandidateNameChange={setCandidateName}
              onConsentChange={setHasAcceptedConsent}
            />

            {error ? <InlineAlert message={error} /> : null}

            {isAudioPlaybackBlocked ? (
              <div className="mt-4 rounded-[18px] border border-clay-300 bg-clay-50 p-4">
                <p className="font-title text-[14.5px] font-semibold tracking-[-0.008em] text-ink-950">
                  {copy.audioBlockedTitle}
                </p>
                <p className="mt-1 text-[13.5px] leading-[1.55] text-ink-700">
                  {copy.audioBlockedBody}
                </p>
                <Button
                  className={`mt-3 h-11 text-[14.5px] ${quietActionClass} w-full`}
                  data-cc-btn="light"
                  onClick={enableAudio}
                  variant="secondary"
                >
                  <MicIcon className="h-4 w-4" />
                  {copy.audioBlockedEnable}
                </Button>
              </div>
            ) : null}

            <Button
              className={`mt-5 h-[50px] w-full text-[15px] ${primaryActionClass}`}
              data-cc-btn=""
              disabled={isBusy || !canStart}
              onClick={startInterview}
            >
              {isBusy ? (
                <RestartIcon className="h-4 w-4 motion-safe:animate-spin" />
              ) : (
                <MicIcon className="h-4 w-4" />
              )}
              {primaryStartLabel}
            </Button>
            {isFormFallbackAvailable ? (
              <Button
                className={`mt-2.5 h-[50px] w-full text-[15px] ${quietActionClass}`}
                data-cc-btn="light"
                disabled={isBusy || !canStart}
                onClick={openFormFallback}
                variant="secondary"
              >
                <PencilIcon className="h-4 w-4" />
                {copy.writtenFallback}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

function CompletionPanel({
  candidateName,
  companyName,
  elapsedSeconds,
  isPreview,
}: {
  candidateName: string;
  companyName: string;
  elapsedSeconds: number;
  isPreview: boolean;
}) {
  const firstName = candidateName.trim().split(/\s+/)[0] || "there";

  return (
    <>
      <CandidateScreenHeader left={<CandidateWordmark />} />
      <div className="flex flex-1 items-center justify-center px-[clamp(1.125rem,5vw,2.75rem)] pb-[4.5rem] pt-6">
        <div className="w-full max-w-[560px] text-center motion-safe:animate-[cc-in_.55s_cubic-bezier(.2,.7,.2,1)_both]">
          <span className="mb-[26px] inline-grid h-[68px] w-[68px] place-items-center rounded-full bg-spruce-50 text-spruce-800">
            <CheckIcon className="h-[30px] w-[30px]" strokeWidth={1.8} />
          </span>
          <h1 className="mb-4 font-display text-[clamp(36px,6vw,54px)] font-normal leading-[1.04] tracking-[-0.02em] text-ink-950">
            Thank you, <span className="italic">{firstName}</span>.
          </h1>
          <p className="mx-auto max-w-[32rem] text-pretty text-[17px] leading-[1.62] text-ink-700">
            {isPreview
              ? "The live test is complete. No candidate profile, recording, or recruiter notification was created."
              : `Your interview is complete. ${companyName} will review your answers and follow up with the next step if there's a match.`}
          </p>

          <div className="mt-8 inline-flex w-full min-w-0 flex-col rounded-[24px] border border-ink-200 bg-white px-6 py-1 text-left sm:w-auto sm:min-w-[300px]">
            <CompletionRow icon={ClockIcon}>
              Duration
              <strong className="ml-[5px] font-mono text-[13px] font-normal text-ink-950">
                {formatDuration(elapsedSeconds)}
              </strong>
            </CompletionRow>
            <CompletionRow icon={TranscriptIcon} isLast={!isPreview}>
              {isPreview
                ? "Temporary live-test transcript, never stored"
                : "Transcript saved for recruiter review"}
            </CompletionRow>
            {isPreview ? (
              <CompletionRow icon={CheckIcon} isLast>
                No candidate profile created
              </CompletionRow>
            ) : null}
          </div>

          <p className="mt-7 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-500">
            You can close this window
          </p>
        </div>
      </div>
    </>
  );
}

function CompletionRow({
  children,
  icon: Icon,
  isLast = false,
}: {
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  isLast?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-[13px] py-[15px] ${isLast ? "" : "border-b border-ink-100"}`}
    >
      <Icon className="h-[17px] w-[17px] shrink-0 text-spruce-600" />
      <span className="text-[14px] text-ink-700">{children}</span>
    </div>
  );
}

/*
 * Legal ruling R5.2/R5.3: withdrawing consent has to be as easy as giving it
 * (GDPR art. 7(3)), which includes being readable — so the Quit control and the
 * panel it leads to follow the consent language, not the room's English.
 */
function AbandonedPanel({
  companyName,
  copy,
  onRetry,
}: {
  companyName: string;
  copy: CandidateExperienceCopy;
  onRetry: () => void;
}) {
  return (
    <>
      <CandidateScreenHeader left={<CandidateWordmark />} />
      <div className="flex flex-1 items-center justify-center px-[clamp(1.125rem,5vw,2.75rem)] pb-[4.5rem] pt-6">
        <div className="w-full max-w-[480px] text-center motion-safe:animate-[cc-in_.5s_cubic-bezier(.2,.7,.2,1)_both]">
          <span className="mb-6 inline-grid h-16 w-16 place-items-center rounded-full bg-paper-muted text-ink-700">
            <HangUpIcon className="h-7 w-7" strokeWidth={1.8} />
          </span>
          <h1 className="mb-3.5 font-display text-[clamp(32px,5vw,44px)] font-normal leading-[1.05] tracking-[-0.02em] text-ink-950">
            {copy.abandonedTitle}
          </h1>
          <p className="mx-auto max-w-[28rem] text-pretty text-[16px] leading-[1.62] text-ink-700">
            {copy.abandonedBody(companyName)}
          </p>
          <Button
            className={`mt-7 h-[52px] w-full text-[15.5px] ${primaryActionClass}`}
            data-cc-btn=""
            onClick={onRetry}
          >
            <RestartIcon className="h-4 w-4" />
            {copy.abandonedRetry}
          </Button>
          <p className="mt-4 text-[13.5px] text-ink-500">
            {copy.abandonedClosing}
          </p>
        </div>
      </div>
    </>
  );
}

function FormFallbackPanel({
  answers,
  canSubmit,
  description,
  error,
  isSubmitting,
  onAnswerChange,
  onBack,
  onSubmit,
  questions,
  roleTitle,
}: {
  answers: Record<string, string>;
  canSubmit: boolean;
  description?: string;
  error: string | null;
  isSubmitting: boolean;
  onAnswerChange: (questionId: string, value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  questions: CandidateInterview["questions"];
  roleTitle: string;
}) {
  const isComplete = questions.every(
    (question) => (answers[question.id] ?? "").trim().length > 1,
  );

  return (
    <>
      <CandidateScreenHeader
        left={<CandidateWordmark />}
        right={
          <CandidateMonoPill tone="tint">Written fallback</CandidateMonoPill>
        }
      />
      <div className="flex flex-1 items-start justify-center px-[clamp(1.125rem,5vw,2.75rem)] pb-16 pt-2">
        <div className="w-full max-w-[720px] motion-safe:animate-[cc-in_.5s_cubic-bezier(.2,.7,.2,1)_both]">
          <h1 className="font-display text-[clamp(32px,5vw,46px)] font-normal leading-[1.05] tracking-[-0.02em] text-ink-950">
            Answer in writing
          </h1>
          <p className="mt-4 max-w-[40rem] text-pretty text-[16px] leading-[1.62] text-ink-700">
            {roleTitle}.{" "}
            {description ??
              "Use this fallback only if audio is not available on your device. The recruiter still reviews your answers manually."}
          </p>

          <div className="mt-[26px] flex flex-col gap-3">
            {questions.map((question, index) => (
              <label
                className="block rounded-[24px] border border-ink-200 bg-white p-[clamp(1rem,2.4vw,1.375rem)]"
                key={question.id}
              >
                <span className="block font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-500">
                  Question {index + 1}
                </span>
                <span className="mt-2.5 block font-display text-[22px] leading-[1.3] tracking-[-0.01em] text-ink-950">
                  {question.prompt}
                </span>
                <textarea
                  aria-label={`Answer question ${index + 1}: ${question.prompt}`}
                  className="mt-3.5 min-h-[120px] w-full resize-y rounded-[18px] border border-ink-300 bg-paper-sunken px-[15px] py-[13px] text-[14.5px] leading-[1.6] text-ink-950 outline-none transition placeholder:text-ink-500 focus:border-ink-900 focus:bg-white focus:ring-1 focus:ring-ink-900"
                  onChange={(event) =>
                    onAnswerChange(question.id, event.target.value)
                  }
                  placeholder="Write your answer..."
                  value={answers[question.id] ?? ""}
                />
              </label>
            ))}
          </div>

          {error ? <InlineAlert message={error} /> : null}

          <div className="mt-[22px] flex flex-wrap justify-end gap-2.5">
            <Button
              className={`h-[50px] px-5 text-[15px] ${quietActionClass}`}
              data-cc-btn="light"
              onClick={onBack}
              variant="secondary"
            >
              Back to audio
            </Button>
            <Button
              className={`h-[50px] px-6 text-[15px] ${primaryActionClass}`}
              data-cc-btn=""
              disabled={!canSubmit || !isComplete}
              onClick={onSubmit}
            >
              {isSubmitting ? (
                <RestartIcon className="h-4 w-4 motion-safe:animate-spin" />
              ) : (
                <CheckIcon className="h-4 w-4" />
              )}
              {isComplete ? "Submit answers" : "Answer each question"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function UnavailableInterview({
  message = "This link is invalid, unpublished, or no longer available. Ask the recruiter for a fresh interview link.",
  title = "Interview unavailable",
}: {
  message?: string;
  title?: string;
}) {
  return (
    <>
      <CandidateScreenHeader left={<CandidateWordmark />} />
      <div className="flex flex-1 items-center justify-center px-[clamp(1.125rem,5vw,2.75rem)] pb-[4.5rem] pt-6">
        <div className="w-full max-w-[480px] text-center motion-safe:animate-[cc-in_.5s_cubic-bezier(.2,.7,.2,1)_both]">
          <span className="mb-6 inline-grid h-[60px] w-[60px] place-items-center rounded-full bg-clay-50 text-clay-600">
            <AlertIcon className="h-[27px] w-[27px]" />
          </span>
          <h1 className="mb-3.5 font-display text-[clamp(30px,5vw,42px)] font-normal leading-[1.06] tracking-[-0.02em] text-ink-950">
            {title}
          </h1>
          <p className="mx-auto max-w-[26rem] text-pretty text-[16px] leading-[1.62] text-ink-700">
            {message}
          </p>
        </div>
      </div>
    </>
  );
}

function StatusPill({ status }: { status: RoomStatus }) {
  return (
    <span className="inline-flex h-[29px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[rgba(63,208,165,0.14)] px-3 font-mono text-[10px] uppercase tracking-[0.09em] text-spruce-300">
      <span className="h-1.5 w-1.5 rounded-full bg-spruce-400 motion-safe:animate-[cc-livedot_1.9s_ease-in-out_infinite]" />
      {statusCopy[status]}
    </span>
  );
}

export function LiveInterviewStage({
  activeText,
  activeTurnId,
  copy,
  elapsedSeconds,
  isAudioPlaybackBlocked,
  inactivityNotice,
  isFormFallbackAvailable,
  isPreview,
  isRoomActive,
  isStreaming,
  localStream,
  onConfirmPresence,
  onContinueInWriting,
  onEnableAudio,
  onEndInterview,
  onRepeatQuestion,
  onSkipQuestion,
  status,
}: {
  activeText: string | null;
  activeTurnId: string | null;
  // Legal ruling R5.2: the Quit control is the only in-interview way to withdraw
  // consent, so it follows the consent language even though the rest of the
  // stage is still English. Taking the whole copy table (like `AbandonedPanel`,
  // the panel this control leads to) rather than one pre-picked string keeps the
  // two halves of that flow reading from the same source.
  copy: CandidateExperienceCopy;
  elapsedSeconds: number;
  isAudioPlaybackBlocked: boolean;
  inactivityNotice: CandidateInactivityNotice | null;
  isFormFallbackAvailable: boolean;
  isPreview: boolean;
  isRoomActive: boolean;
  isStreaming: boolean;
  localStream: MediaStream | null;
  onConfirmPresence: () => void;
  onContinueInWriting: () => void;
  onEnableAudio: () => void;
  onEndInterview: () => void;
  onRepeatQuestion: () => void;
  onSkipQuestion: () => void;
  status: RoomStatus;
}) {
  const hasInterviewerLine = activeText !== null;
  const activeDisplayText = activeText ?? statusDescription(status);
  const activeWords = React.useMemo(
    () => splitTranscriptWords(activeDisplayText),
    [activeDisplayText],
  );
  const isConnectingOnly =
    status === "preparing" ||
    status === "permission_required" ||
    status === "connecting";
  // The aura breathes with the voice and the meter brightens on the candidate's
  // turn, so the room reads as alive without any extra chrome.
  const isInterviewerSpeaking =
    status === "interviewer_speaking" || status === "closing";
  const isCandidateTurn =
    status === "listening" || status === "candidate_speaking";
  const canSkip =
    isPreview && !isConnectingOnly && status !== "interviewer_joining";
  // The control channel carries no acknowledgement, so the button stays inert
  // outside the states where the worker has a current question to move on from
  // — a greyed control is honest, one that silently does nothing is not.
  const canSendSkip =
    isCandidateTurn ||
    status === "interviewer_speaking" ||
    status === "processing";

  return (
    <section className="fixed inset-0 z-50 flex h-[100svh] flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_-12%,#0E4438_0%,#0A2A22_34%,#08150F_100%)] px-[clamp(1.125rem,5vw,2.75rem)] pb-[calc(env(safe-area-inset-bottom)+clamp(1rem,3vh,1.625rem))] pt-[calc(env(safe-area-inset-top)+clamp(1rem,3vh,1.625rem))] font-sans text-[#F4F3EF] supports-[height:100dvh]:h-[100dvh]">
      <div
        className="pointer-events-none absolute left-1/2 top-[22%] h-[min(760px,90vh)] w-[min(1180px,150vw)] -translate-x-1/2 transition-opacity duration-[900ms]"
        style={{ opacity: isInterviewerSpeaking ? 1 : 0.3 }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(closest-side,rgba(30,180,142,0.34),rgba(15,107,87,0.15)_46%,transparent_74%)] motion-safe:animate-[cc-aura_4.6s_ease-in-out_infinite]" />
      </div>
      <div className="pointer-events-none absolute inset-0 opacity-45 [background-image:url('data:image/svg+xml;utf8,<svg_xmlns=%22http://www.w3.org/2000/svg%22_width=%22160%22_height=%22160%22><filter_id=%22n%22><feTurbulence_type=%22fractalNoise%22_baseFrequency=%220.8%22_numOctaves=%222%22/></filter><rect_width=%22100%25%22_height=%22100%25%22_filter=%22url(%23n)%22_opacity=%220.04%22/></svg>')]" />

      <div className="relative flex shrink-0 items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-[9px]">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[rgba(244,243,239,0.48)]">
              Powered by
            </span>
            <BrandMark
              appearance="on-dark"
              className="opacity-80"
              labelClassName="h-[15px] w-auto max-w-none"
            />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[rgba(244,243,239,0.1)]">
              <MicIcon className="h-[15px] w-[15px]" />
            </span>
            <span className="font-title text-[14.5px] font-semibold tracking-[-0.008em] text-[rgba(244,243,239,0.82)]">
              Live interview
            </span>
            {/*
              The stage covers the whole viewport, including the recruiter
              preview toolbar. Without this, a recruiter running a live test has
              no way to tell it apart from a real candidate session.
            */}
            {isPreview ? (
              <span className="inline-flex h-[26px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[rgba(244,243,239,0.1)] px-[11px] font-mono text-[9.5px] uppercase tracking-[0.12em] text-[rgba(244,243,239,0.72)]">
                Recruiter live test · not recorded
              </span>
            ) : null}
          </div>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center py-[clamp(1.25rem,4vh,3rem)]">
        <div className="w-full max-w-[840px]">
          {isConnectingOnly ? (
            <ConnectingInterviewState status={status} />
          ) : (
            <div className="mx-auto max-h-[62svh] w-full max-w-[780px] overflow-y-auto">
              {/*
                The "Interviewer" attribution only appears over words the
                interviewer actually said. Before the first line lands we still
                show where the session is, but unattributed.
              */}
              {hasInterviewerLine ? (
                <div className="mb-[clamp(18px,2.6vh,28px)] inline-flex items-center gap-[9px]">
                  <span className="h-[7px] w-[7px] rounded-full bg-spruce-300 motion-safe:animate-[cc-livedot_1.6s_ease-in-out_infinite]" />
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-spruce-300">
                    Interviewer
                  </span>
                </div>
              ) : null}

              <div
                aria-busy={isStreaming}
                aria-live="polite"
                className="flex flex-col gap-3.5"
              >
                <p
                  className="text-pretty font-display font-normal leading-[1.18] tracking-[-0.016em] text-[#F4F3EF]"
                  key={activeTurnId ?? status}
                  style={{ fontSize: activeTextSize(activeDisplayText) }}
                >
                  {activeWords.map((word, index) => {
                    // The reveal replays for every new line: keying by turn+index
                    // (not by text) keeps a growing word stable in place while a
                    // new question re-keys and remounts. While the caption
                    // streams, each word mounts as its delta arrives, so the
                    // animation already tracks the voice and needs no delay; a
                    // line that lands complete is staggered by hand at the
                    // design's word cadence. cc-word-reveal also lights the word
                    // as it is spoken, then settles it into the reading colour.
                    return (
                      <span
                        className="cc-word-reveal mr-[0.24em] inline-block"
                        key={`${activeTurnId ?? "status"}:${index}`}
                        style={
                          isStreaming
                            ? undefined
                            : { animationDelay: revealDelay(index) }
                        }
                      >
                        {word}
                      </span>
                    );
                  })}
                  {isStreaming ? (
                    <span className="inline-block h-[0.9em] w-[3px] translate-y-[0.08em] bg-spruce-300 motion-safe:animate-[cc-blink_1s_step-end_infinite]" />
                  ) : null}
                </p>
              </div>

              {hasInterviewerLine ? (
                <p className="mt-[clamp(22px,3vh,32px)] max-w-[34rem] text-[15px] leading-[1.62] text-[rgba(244,243,239,0.5)]">
                  You can ask to repeat the question, take a moment to think, or
                  answer naturally. The interviewer will wait while you finish.
                </p>
              ) : null}
            </div>
          )}

          {inactivityNotice && !isConnectingOnly ? (
            <div className="mx-auto w-full max-w-[780px]">
              <CandidateInactivityAlert
                isFormFallbackAvailable={isFormFallbackAvailable}
                notice={inactivityNotice}
                onConfirmPresence={onConfirmPresence}
                onContinueInWriting={onContinueInWriting}
                onRepeatQuestion={onRepeatQuestion}
              />
            </div>
          ) : null}

          {isAudioPlaybackBlocked ? (
            <div className="mx-auto mt-6 max-w-sm rounded-[24px] border border-[rgba(244,243,239,0.14)] bg-[rgba(28,52,44,0.72)] p-4">
              <p className="font-title text-[15px] font-semibold tracking-[-0.008em]">
                Audio paused by your browser
              </p>
              <p className="mt-[5px] text-[13.5px] leading-[1.5] text-[rgba(244,243,239,0.6)]">
                Tap once to hear the interviewer on this device.
              </p>
              <Button
                className={`mt-4 h-[38px] w-full gap-2 rounded-full bg-[#F4F3EF] px-4 font-title text-[13.5px] font-medium text-ink-950 hover:bg-white ${stageFocusRingClass}`}
                data-cc-btn="flat"
                onClick={onEnableAudio}
                variant="secondary"
              >
                <MicIcon className="h-[15px] w-[15px]" />
                Enable audio
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative ml-auto flex w-full shrink-0 items-center justify-between gap-2.5 rounded-full border border-[rgba(244,243,239,0.1)] bg-[rgba(6,17,12,0.88)] p-2 sm:w-auto">
        <Button
          className={`h-10 gap-2 rounded-full bg-[rgba(224,138,106,0.18)] px-4 font-title text-[13.5px] font-medium text-[#F6C3AB] hover:bg-[rgba(224,138,106,0.28)] ${stageFocusRingClass}`}
          data-cc-btn="flat"
          onClick={onEndInterview}
        >
          <HangUpIcon className="h-[15px] w-[15px]" />
          {copy.quit}
        </Button>
        <span className="h-[22px] w-px bg-[rgba(244,243,239,0.12)]" />
        <span className="px-2 font-mono text-[13px] tabular-nums text-[#F4F3EF]">
          {formatDuration(elapsedSeconds)}
        </span>
        <span className="h-[22px] w-px bg-[rgba(244,243,239,0.12)]" />
        <div
          className="transition-opacity duration-500"
          style={{ opacity: isCandidateTurn ? 1 : 0.5 }}
        >
          <VoiceLevelMeter isActive={isRoomActive} stream={localStream} />
        </div>
        {canSkip ? (
          <>
            <span className="h-[22px] w-px bg-[rgba(244,243,239,0.12)]" />
            <Button
              className={`h-10 gap-2 whitespace-nowrap rounded-full border border-[rgba(244,243,239,0.16)] bg-[rgba(244,243,239,0.06)] px-4 font-title text-[13.5px] font-medium text-[#F4F3EF] hover:border-[rgba(244,243,239,0.32)] hover:bg-[rgba(244,243,239,0.14)] ${stageFocusRingClass}`}
              data-cc-btn="flat"
              disabled={!canSendSkip}
              onClick={onSkipQuestion}
              title="Preview only — moves the interviewer on without you speaking"
              variant="secondary"
            >
              <SkipForwardIcon className="h-[15px] w-[15px]" />
              Skip question
            </Button>
          </>
        ) : null}
      </div>

      {canSkip ? (
        <p className="relative mt-2.5 shrink-0 self-end font-mono text-[9.5px] uppercase tracking-[0.12em] text-[rgba(244,243,239,0.34)]">
          Skip is preview only · candidates never see it
        </p>
      ) : null}
    </section>
  );
}

function CandidateInactivityAlert({
  isFormFallbackAvailable,
  notice,
  onConfirmPresence,
  onContinueInWriting,
  onRepeatQuestion,
}: {
  isFormFallbackAvailable: boolean;
  notice: CandidateInactivityNotice;
  onConfirmPresence: () => void;
  onContinueInWriting: () => void;
  onRepeatQuestion: () => void;
}) {
  const [remainingSeconds, setRemainingSeconds] = React.useState(() =>
    inactivitySecondsRemaining(notice.expiresAt),
  );

  React.useEffect(() => {
    setRemainingSeconds(inactivitySecondsRemaining(notice.expiresAt));
    if (!notice.expiresAt) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      setRemainingSeconds(inactivitySecondsRemaining(notice.expiresAt));
    }, 250);
    return () => window.clearInterval(interval);
  }, [notice.expiresAt]);

  const isWarning = notice.stage === "warning";

  return (
    <div
      aria-live="assertive"
      className="mt-[26px] w-full rounded-[24px] border border-[rgba(244,243,239,0.14)] bg-[rgba(28,52,44,0.72)] p-[clamp(1rem,2vw,1.25rem)]"
      role="alert"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-title text-[15px] font-semibold tracking-[-0.008em] text-[#F4F3EF]">
            {isWarning ? "Are you still with us?" : "We are waiting for you"}
          </p>
          <p className="mt-[5px] text-[13.5px] leading-[1.5] text-[rgba(244,243,239,0.6)]">
            {isWarning
              ? "Confirm that you are here to keep this attempt open."
              : "You can continue speaking whenever you are ready."}
          </p>
        </div>
        {isWarning && remainingSeconds !== null ? (
          <span className="inline-flex h-7 shrink-0 items-center rounded-full bg-[#F4F3EF] px-3 font-mono text-[12.5px] tabular-nums text-ink-950">
            {remainingSeconds}s
          </span>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          className={`h-[38px] gap-2 rounded-full bg-[#F4F3EF] px-[15px] font-title text-[13.5px] font-medium text-ink-950 hover:bg-white ${stageFocusRingClass}`}
          data-cc-btn="flat"
          onClick={onConfirmPresence}
          variant="secondary"
        >
          <CheckIcon className="h-[15px] w-[15px]" />
          I&apos;m here
        </Button>
        <Button
          className={`h-[38px] gap-2 rounded-full border border-[rgba(244,243,239,0.2)] bg-transparent px-[15px] font-title text-[13.5px] font-medium text-[#F4F3EF] hover:border-[rgba(244,243,239,0.2)] hover:bg-[rgba(244,243,239,0.1)] ${stageFocusRingClass}`}
          data-cc-btn="flat"
          onClick={onRepeatQuestion}
          variant="secondary"
        >
          <RestartIcon className="h-[15px] w-[15px]" />
          Repeat question
        </Button>
        {isFormFallbackAvailable ? (
          <Button
            className={`h-[38px] gap-2 rounded-full border border-[rgba(244,243,239,0.2)] bg-transparent px-[15px] font-title text-[13.5px] font-medium text-[#F4F3EF] hover:border-[rgba(244,243,239,0.2)] hover:bg-[rgba(244,243,239,0.1)] ${stageFocusRingClass}`}
            data-cc-btn="flat"
            onClick={onContinueInWriting}
            variant="secondary"
          >
            <PencilIcon className="h-[15px] w-[15px]" />
            Continue in writing
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ConnectingInterviewState({ status }: { status: RoomStatus }) {
  return (
    <div className="text-center">
      <div className="relative mx-auto grid h-[clamp(104px,14vw,140px)] w-[clamp(104px,14vw,140px)] place-items-center">
        <span className="absolute inset-0 rounded-full border border-[rgba(63,208,165,0.4)] motion-safe:animate-[cc-ring_2.4s_ease-out_infinite]" />
        <span className="absolute inset-0 rounded-full border border-[rgba(63,208,165,0.3)] motion-safe:animate-[cc-ring_2.4s_ease-out_1.2s_infinite]" />
        <span className="grid h-[62px] w-[62px] place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#7FE3BE,#0F6B57)] text-spruce-950 motion-safe:animate-[cc-breathe_2.6s_ease-in-out_infinite]">
          <MicIcon className="h-[26px] w-[26px]" />
        </span>
      </div>
      <p className="mt-[30px] font-mono text-[10.5px] uppercase tracking-[0.16em] text-spruce-300">
        Connecting
      </p>
      <h2 className="mx-auto mt-4 max-w-[26ch] text-balance font-display text-[clamp(26px,4vw,40px)] font-normal leading-[1.14] tracking-[-0.016em]">
        {statusDescription(status)}
      </h2>
      <p className="mx-auto mt-4 max-w-[30rem] text-[15px] leading-[1.6] text-[rgba(244,243,239,0.58)]">
        One moment while we set up your private room.
      </p>
    </div>
  );
}

function startButtonLabel({
  canStart,
  candidateName,
  copy,
  hasAcceptedConsent,
}: {
  canStart: boolean;
  candidateName: string;
  copy: CandidateExperienceCopy;
  hasAcceptedConsent: boolean;
}) {
  if (canStart) {
    return copy.startJoin;
  }

  if (candidateName.trim().length <= 1) {
    return copy.startNameRequired;
  }

  if (!hasAcceptedConsent) {
    return copy.startConsentRequired;
  }

  return copy.startJoin;
}

function blockingInvitationCopy(status: string | null | undefined) {
  if (status === "expired") {
    return {
      message:
        "This interview link has expired. Ask the recruiter for a fresh link.",
      title: "Interview expired",
    };
  }

  if (status === "completed") {
    return {
      message:
        "This interview has already been completed. Ask the recruiter for a new link if you need another attempt.",
      title: "Interview completed",
    };
  }

  if (status === "superseded") {
    return {
      message:
        "This interview attempt was replaced by a newer one. Refresh the page or use the latest link from the recruiter.",
      title: "Interview replaced",
    };
  }

  return null;
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function inactivitySecondsRemaining(expiresAt: string | null) {
  if (!expiresAt) {
    return null;
  }
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

function InlineAlert({ message }: { message: string }) {
  return (
    <div className="mt-4 flex gap-3 rounded-[18px] border border-clay-300 bg-clay-50 p-4">
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-clay-600" />
      <div>
        <p className="font-title text-[14.5px] font-semibold tracking-[-0.008em] text-ink-950">
          Needs attention
        </p>
        <p className="mt-1 text-[13.5px] leading-[1.55] text-ink-700">
          {message}
        </p>
      </div>
    </div>
  );
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
  if (status === "processing") {
    return "Take a moment. The interviewer is preparing the next question.";
  }
  if (status === "listening") {
    return "Your turn. Answer naturally when you are ready.";
  }
  if (status === "reconnecting") {
    return "Your connection changed. We are restoring the interview automatically.";
  }
  if (status === "closing") {
    return "Thank you. The interviewer is wrapping up the conversation.";
  }
  if (status === "failed") {
    return "Something needs your attention before the interview can start.";
  }
  if (status === "abandoned") {
    return "This interview attempt was ended before completion.";
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
// A line that arrives already complete (polling fallback, or a reconnect
// replaying a finalized turn) has no voice to pace it, so the reveal is
// staggered by hand at the interviewer's speaking cadence and capped so a long
// closing statement does not keep its tail hidden.
const revealWordStepMs = 115;
const revealMaxSteps = 28;

function revealDelay(index: number) {
  return `${Math.min(index, revealMaxSteps) * revealWordStepMs}ms`;
}

function activeTextSize(text: string): string {
  const length = text.trim().length;
  if (length > 220) {
    return "clamp(20px,2.4vw,30px)";
  }
  if (length > 120) {
    return "clamp(24px,3vw,38px)";
  }
  return "clamp(28px,4.2vw,52px)";
}

#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));
const sessionId = args.sessionId ?? process.env.SESSION_ID;
const realtimeApiUrl =
  args.realtimeApiUrl ??
  process.env.REALTIME_API_URL ??
  "http://127.0.0.1:8080";

if (!sessionId) {
  fail(
    "SESSION_ID is required. Example: make live-smoke-report SESSION_ID=is_xxx REALTIME_API_URL=http://127.0.0.1:8080",
  );
}

const baseUrl = `${trimTrailingSlash(realtimeApiUrl)}/v1/interview-sessions/${encodeURIComponent(sessionId)}`;

try {
  const [sessionResponse, transcriptResponse] = await Promise.all([
    getJSON(baseUrl),
    getJSON(`${baseUrl}/transcript`),
  ]);

  const session = sessionResponse.session;
  if (!session) {
    fail(`Realtime API did not return a session object for ${sessionId}.`);
  }

  const events = [...(session.events ?? [])].sort(compareEvents);
  const transcript = transcriptResponse.transcript ?? [];
  const report = buildReport({ session, events, transcript });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatMarkdown(report));
  }

  if (args.strict) {
    if (report.decision === "Blocker") {
      process.exitCode = 2;
    } else if (report.decision === "Retry needed") {
      process.exitCode = 1;
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--json") {
      parsed.json = true;
    } else if (value === "--strict") {
      parsed.strict = true;
    } else if (value === "--session-id") {
      parsed.sessionId = values[index + 1];
      index += 1;
    } else if (value === "--realtime-api-url") {
      parsed.realtimeApiUrl = values[index + 1];
      index += 1;
    } else if (value?.startsWith("--session-id=")) {
      parsed.sessionId = value.slice("--session-id=".length);
    } else if (value?.startsWith("--realtime-api-url=")) {
      parsed.realtimeApiUrl = value.slice("--realtime-api-url=".length);
    }
  }
  return parsed;
}

async function getJSON(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  const body = await response.text();
  let json;
  try {
    json = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${body.slice(0, 240)}`);
  }

  if (!response.ok) {
    throw new Error(
      `GET ${url} failed with ${response.status}: ${JSON.stringify(json)}`,
    );
  }
  return json;
}

function buildReport({ session, events, transcript }) {
  const counts = countBy(events, (event) => event.type);
  const firstEvent = events[0];
  const sessionStarted = firstOf(events, "session_started");
  const candidateJoined = firstOf(events, "candidate_joined");
  const candidateReady = firstMatching(events, (event) =>
    [
      "candidate_ready",
      "candidate_media_ready",
      "candidate_media_published",
    ].includes(event.type),
  );
  const firstQuestion = firstOf(events, "question_asked");
  const completed = lastOf(events, "session_completed");
  const failedEvents = events.filter(
    (event) => event.type === "session_failed",
  );
  const candidateTurns = transcript.filter(
    (turn) => turn.speaker === "candidate",
  );
  const interviewerTurns = transcript.filter(
    (turn) => turn.speaker === "interviewer",
  );
  const finalizedTurnIds = new Set(
    events
      .filter((event) => event.type === "candidate_turn_finalized")
      .map(
        (event) =>
          event.payload?.transcript_turn?.turn_id ??
          event.payload?.transcriptTurn?.turnId,
      )
      .filter(Boolean),
  );
  const answerEvaluations = events.filter(
    (event) => event.type === "answer_evaluated",
  );
  const answerEvaluationCoverage = answerEvaluations.every((event) =>
    (event.payload?.turn_ids ?? event.payload?.turnIds ?? []).every((turnId) =>
      finalizedTurnIds.has(turnId),
    ),
  );
  const sequence = sequenceHealth(events);
  const totalQuestions =
    completed?.payload?.total_questions ?? completed?.payload?.totalQuestions;
  const completedQuestions =
    completed?.payload?.completed_questions ??
    completed?.payload?.completedQuestions;
  const questionCompletionRate =
    typeof totalQuestions === "number" && totalQuestions > 0
      ? round(completedQuestions / totalQuestions, 3)
      : null;
  const firstQuestionDelayMs =
    sessionStarted && firstQuestion
      ? millisecondsBetween(
          sessionStarted.occurred_at,
          firstQuestion.occurred_at,
        )
      : null;
  const readiness = {
    candidateJoinedBeforeFirstQuestion:
      candidateJoined && firstQuestion
        ? eventSequence(candidateJoined) < eventSequence(firstQuestion)
        : null,
    mediaReadyBeforeFirstQuestion:
      candidateReady && firstQuestion
        ? eventSequence(candidateReady) < eventSequence(firstQuestion)
        : null,
  };

  const anomalies = [];
  const warnings = [];

  if (!sequence.contiguous) {
    anomalies.push(`Event sequence is not contiguous: ${sequence.reason}`);
  }
  if (failedEvents.length > 0) {
    anomalies.push(
      `${failedEvents.length} session_failed event(s) were emitted.`,
    );
  }
  if (!firstQuestion) {
    anomalies.push("No question_asked event found.");
  }
  if (interviewerTurns.length === 0) {
    anomalies.push("Transcript has no interviewer turn.");
  }
  if (session.status === "completed" && candidateTurns.length === 0) {
    anomalies.push("Completed session has no candidate transcript turn.");
  }
  if (!answerEvaluationCoverage) {
    anomalies.push(
      "At least one answer_evaluated event references an unknown candidate turn.",
    );
  }
  if (readiness.candidateJoinedBeforeFirstQuestion === false) {
    anomalies.push(
      "First interviewer question was emitted before candidate_joined.",
    );
  }
  if (readiness.mediaReadyBeforeFirstQuestion === false) {
    anomalies.push(
      "First interviewer question was emitted before candidate media readiness.",
    );
  }

  if (session.status !== "completed") {
    warnings.push(`Session status is ${session.status}, not completed.`);
  }
  if (!candidateJoined) {
    warnings.push(
      "No candidate_joined event found; readiness gate cannot be proven.",
    );
  }
  if (!candidateReady) {
    warnings.push(
      "No candidate media readiness event found; media readiness cannot be proven.",
    );
  }
  if (firstQuestionDelayMs === null) {
    warnings.push("Cannot compute time to first interviewer question.");
  }

  const decision =
    anomalies.length > 0
      ? "Blocker"
      : warnings.length > 0
        ? "Retry needed"
        : "Pass";

  return {
    generatedAt: new Date().toISOString(),
    realtimeApiUrl,
    sessionId: session.id,
    status: session.status,
    candidateId: session.candidate_id,
    interviewPlanId: session.interview_plan_id,
    livekitRoomName: session.livekit_room_name,
    eventCount: events.length,
    counts,
    transcript: {
      turns: transcript.length,
      candidateTurns: candidateTurns.length,
      interviewerTurns: interviewerTurns.length,
    },
    metrics: {
      firstQuestionDelayMs,
      questionCompletionRate,
      completedQuestions: completedQuestions ?? null,
      totalQuestions: totalQuestions ?? null,
      followupCount: counts.followup_asked ?? 0,
      repromptCount: counts.soft_reprompted ?? 0,
      bargeInAcceptedCount: counts.barge_in_accepted ?? 0,
      answerEvaluatedCount: counts.answer_evaluated ?? 0,
      providerErrorCount: failedEvents.length,
    },
    readiness,
    answerClassifications: countBy(answerEvaluations, (event) =>
      event.payload?.classification
        ? String(event.payload.classification)
        : "unknown",
    ),
    sequence,
    warnings,
    anomalies,
    decision,
  };
}

function formatMarkdown(report) {
  return `# Live Interview Smoke Report

- Generated: ${report.generatedAt}
- Decision: **${report.decision}**
- Session: \`${report.sessionId}\`
- Candidate: \`${report.candidateId ?? "unknown"}\`
- Plan: \`${report.interviewPlanId ?? "unknown"}\`
- Status: \`${report.status}\`
- Room: \`${report.livekitRoomName ?? "unknown"}\`
- API: \`${report.realtimeApiUrl}\`

## Replay

- Events: ${report.eventCount}
- Sequence contiguous: ${formatBoolean(report.sequence.contiguous)}
- Transcript turns: ${report.transcript.turns}
- Interviewer turns: ${report.transcript.interviewerTurns}
- Candidate turns: ${report.transcript.candidateTurns}

## Metrics

- Time to first interviewer question: ${formatMs(report.metrics.firstQuestionDelayMs)}
- Question completion rate: ${formatRate(report.metrics.questionCompletionRate)}
- Completed questions: ${formatCount(report.metrics.completedQuestions)} / ${formatCount(report.metrics.totalQuestions)}
- Follow-ups: ${report.metrics.followupCount}
- Reprompts: ${report.metrics.repromptCount}
- Accepted barge-ins: ${report.metrics.bargeInAcceptedCount}
- Answer evaluations: ${report.metrics.answerEvaluatedCount}
- Provider errors: ${report.metrics.providerErrorCount}

## Readiness Gate

- Candidate joined before first question: ${formatNullableBoolean(report.readiness.candidateJoinedBeforeFirstQuestion)}
- Media ready before first question: ${formatNullableBoolean(report.readiness.mediaReadyBeforeFirstQuestion)}

## Answer Classifications

${formatMap(report.answerClassifications)}

## Event Counts

${formatMap(report.counts)}

## Warnings

${formatList(report.warnings)}

## Anomalies

${formatList(report.anomalies)}
`;
}

function sequenceHealth(events) {
  if (events.length === 0) {
    return { contiguous: false, reason: "no events" };
  }
  for (let index = 0; index < events.length; index += 1) {
    const expected = index + 1;
    const actual = eventSequence(events[index]);
    if (actual !== expected) {
      return {
        contiguous: false,
        reason: `expected sequence ${expected}, got ${actual ?? "missing"}`,
      };
    }
  }
  return { contiguous: true, reason: null };
}

function compareEvents(left, right) {
  return eventSequence(left) - eventSequence(right);
}

function eventSequence(event) {
  return event.sequence_number ?? event.sequence ?? 0;
}

function firstOf(events, type) {
  return events.find((event) => event.type === type);
}

function lastOf(events, type) {
  return events.findLast((event) => event.type === type);
}

function firstMatching(events, predicate) {
  return events.find(predicate);
}

function countBy(items, keyFn) {
  return items.reduce((accumulator, item) => {
    const key = keyFn(item);
    if (!key) {
      return accumulator;
    }
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}

function millisecondsBetween(start, end) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }
  return Math.max(0, endMs - startMs);
}

function formatMs(value) {
  return value === null || value === undefined ? "unknown" : `${value} ms`;
}

function formatRate(value) {
  return value === null || value === undefined
    ? "unknown"
    : `${round(value * 100, 1)}%`;
}

function formatCount(value) {
  return value === null || value === undefined ? "unknown" : String(value);
}

function formatBoolean(value) {
  return value ? "yes" : "no";
}

function formatNullableBoolean(value) {
  if (value === null || value === undefined) {
    return "unknown";
  }
  return formatBoolean(value);
}

function formatMap(map) {
  const entries = Object.entries(map).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0) {
    return "- none";
  }
  return entries.map(([key, value]) => `- \`${key}\`: ${value}`).join("\n");
}

function formatList(items) {
  if (items.length === 0) {
    return "- none";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

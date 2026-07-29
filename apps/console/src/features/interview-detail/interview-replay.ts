export type InterviewReplayChapter = {
  endMs: number;
  id: string;
  label: string;
  questionNumber: number;
  startMs: number;
};

type ReplayTurn = {
  endedAt: string | null;
  questionId: string | null;
  startedAt: string;
};

type ReplayQuestionGroup = {
  candidateTurns: ReplayTurn[];
  interviewerTurns: ReplayTurn[];
  questionId: string | null;
};

type ReplayQuestion = {
  id: string;
  prompt: string;
};

export function buildInterviewReplayChapters({
  questionAnswerSequence,
  questions,
  totalDurationMs,
  transcriptTurns,
}: {
  questionAnswerSequence: ReplayQuestionGroup[];
  questions: ReplayQuestion[];
  totalDurationMs: number;
  transcriptTurns: ReplayTurn[];
}): InterviewReplayChapter[] {
  const recordingStartMs = earliestTimestamp(
    transcriptTurns.map((turn) => turn.startedAt),
  );

  if (recordingStartMs === null) {
    return [];
  }

  const provisional = questions.flatMap((question, questionIndex) => {
    const group = questionAnswerSequence.find(
      (candidateAnswer) => candidateAnswer.questionId === question.id,
    );
    const groupedTurns = [
      ...(group?.interviewerTurns ?? []),
      ...(group?.candidateTurns ?? []),
    ];
    const turns =
      groupedTurns.length > 0
        ? groupedTurns
        : transcriptTurns.filter((turn) => turn.questionId === question.id);
    const startedAt = earliestTimestamp(turns.map((turn) => turn.startedAt));

    if (startedAt === null) {
      return [];
    }

    const naturalEndAt = latestTimestamp(
      turns.map((turn) => turn.endedAt ?? turn.startedAt),
    );

    return [
      {
        id: question.id,
        label: question.prompt,
        naturalEndMs:
          naturalEndAt === null
            ? startedAt - recordingStartMs
            : naturalEndAt - recordingStartMs,
        questionNumber: questionIndex + 1,
        startMs: Math.max(0, startedAt - recordingStartMs),
      },
    ];
  });

  return provisional
    .sort((left, right) => left.startMs - right.startMs)
    .map((chapter, index, chapters) => {
      const nextStartMs = chapters[index + 1]?.startMs;
      const naturalEndMs = Math.max(
        chapter.startMs + 1_000,
        chapter.naturalEndMs + 600,
      );
      const boundedEndMs =
        nextStartMs === undefined
          ? naturalEndMs
          : Math.min(nextStartMs, naturalEndMs);
      const endMs =
        totalDurationMs > 0
          ? Math.min(totalDurationMs, boundedEndMs)
          : boundedEndMs;

      return {
        endMs: Math.max(chapter.startMs + 250, endMs),
        id: chapter.id,
        label: chapter.label,
        questionNumber: chapter.questionNumber,
        startMs: chapter.startMs,
      };
    });
}

export function replayOffsetMs(
  value: string | null,
  transcriptTurns: ReplayTurn[],
) {
  if (!value) {
    return 0;
  }

  const recordingStartMs = earliestTimestamp(
    transcriptTurns.map((turn) => turn.startedAt),
  );
  const valueMs = timestamp(value);

  if (recordingStartMs === null || valueMs === null) {
    return 0;
  }

  return Math.max(0, valueMs - recordingStartMs);
}

export function formatReplayTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes =
    hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const paddedSeconds = String(seconds).padStart(2, "0");

  return hours > 0
    ? `${hours}:${paddedMinutes}:${paddedSeconds}`
    : `${paddedMinutes}:${paddedSeconds}`;
}

function earliestTimestamp(values: string[]) {
  const timestamps = values
    .map(timestamp)
    .filter((value): value is number => value !== null);

  return timestamps.length > 0 ? Math.min(...timestamps) : null;
}

function latestTimestamp(values: string[]) {
  const timestamps = values
    .map(timestamp)
    .filter((value): value is number => value !== null);

  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@prelude/db";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// The signed R2 GET URL is short-lived: it is minted per page load and never
// persisted, so a leaked link expires quickly.
const SIGNED_URL_TTL_SECONDS = 900;

export type CandidateRecordingStatus = "available" | "processing" | "failed";

export type CandidateRecording = {
  durationMs: number | null;
  status: CandidateRecordingStatus;
  // Signed R2 GET URL — only set when status is "available" and storage is
  // configured. Null otherwise (still processing, failed, or no creds on the box).
  url: string | null;
};

type RecordingRow = {
  durationMs: number | null;
  // Nullable: the object is cleared when a recording is erased (retention sweep
  // or an erasure request), leaving a tombstone row.
  objectKey: string | null;
  status: string;
};

type SelectedRecording = {
  durationMs: number | null;
  objectKey: string | null;
  status: CandidateRecordingStatus;
};

// selectRecording is the pure policy: a session can own several recordings
// (reconnects), so prefer the latest available one; otherwise surface that an
// egress is still in flight, or that every attempt failed.
export function selectRecording(
  recordings: RecordingRow[],
): SelectedRecording | null {
  if (recordings.length === 0) {
    return null;
  }

  const available = recordings.find((recording) => recording.status === "available");
  if (available) {
    return {
      durationMs: available.durationMs,
      objectKey: available.objectKey,
      status: "available",
    };
  }

  if (recordings.some((recording) => recording.status === "recording")) {
    return { durationMs: null, objectKey: null, status: "processing" };
  }

  return { durationMs: null, objectKey: null, status: "failed" };
}

export async function getRecordingPlayback(
  realtimeSessionId: string | null,
): Promise<CandidateRecording | null> {
  if (!realtimeSessionId) {
    return null;
  }

  const recordings = await prisma.liveInterviewRecording.findMany({
    orderBy: { startedAt: "desc" },
    where: { sessionId: realtimeSessionId },
  });

  const selected = selectRecording(
    recordings.map((recording) => ({
      durationMs: recording.durationMs,
      objectKey: recording.objectKey,
      status: recording.status,
    })),
  );
  if (!selected) {
    return null;
  }

  const url =
    selected.status === "available" && selected.objectKey
      ? await signRecordingUrl(selected.objectKey)
      : null;

  return { durationMs: selected.durationMs, status: selected.status, url };
}

async function signRecordingUrl(objectKey: string): Promise<string | null> {
  const bucket = process.env.EGRESS_R2_BUCKET;
  const endpoint = process.env.EGRESS_R2_ENDPOINT;
  const accessKeyId = process.env.EGRESS_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.EGRESS_R2_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const client = new S3Client({
    credentials: { accessKeyId, secretAccessKey },
    endpoint,
    forcePathStyle: true,
    region: process.env.EGRESS_R2_REGION ?? "auto",
  });

  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
}

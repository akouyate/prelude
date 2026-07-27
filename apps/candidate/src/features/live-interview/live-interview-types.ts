export type RoomStatus =
  | "ready"
  | "preparing"
  | "permission_required"
  | "connecting"
  | "interviewer_joining"
  | "agent_joined"
  | "connected"
  | "interviewer_speaking"
  | "candidate_speaking"
  | "processing"
  | "listening"
  | "reconnecting"
  | "closing"
  | "failed"
  | "completed"
  | "abandoned";

export type LiveInterviewSession = {
  sessionId: string;
  productSessionId: string | null;
  resumeToken: string | null;
  allowedModalities: Array<"audio" | "video" | "form">;
  livekit: {
    roomName: string;
    url: string;
    token: string;
    participant: string;
    expiresAt: string;
    isMock: boolean;
  };
};

export type LiveTranscriptTurn = {
  turnId: string;
  sessionId: string;
  questionId?: string;
  speaker: "candidate" | "interviewer" | "system";
  text: string;
  isFinal: boolean;
  startedAt: string;
  endedAt?: string;
};

export type LiveSessionEvent = {
  eventId: string;
  sequence: number;
  type: string;
  actor: "agent" | "candidate" | "system" | string;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export type LiveSessionState = {
  sessionId: string;
  status: string;
  events: LiveSessionEvent[];
};

export type ConnectedRoom = {
  disconnect: () => void;
  sendControl: (
    type: "candidate_presence_confirmed" | "repeat_question",
  ) => Promise<void>;
  startAudio: () => Promise<void>;
};

export type CandidateInactivityNotice = {
  stage: "check_in" | "warning";
  expiresAt: string | null;
};

export type LiveTranscriptTurnHandler = (turn: LiveTranscriptTurn) => void;

export type RoomDisconnectedEvent = {
  intentional: boolean;
};

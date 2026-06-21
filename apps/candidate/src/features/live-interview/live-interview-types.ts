export type RoomStatus =
  | "ready"
  | "preparing"
  | "permission_required"
  | "connecting"
  | "interviewer_joining"
  | "connected"
  | "reconnecting"
  | "failed"
  | "completed";

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

export type ConnectedRoom = {
  disconnect: () => void;
  startAudio: () => Promise<void>;
};

export type LiveTranscriptTurnHandler = (turn: LiveTranscriptTurn) => void;

export type RoomDisconnectedEvent = {
  intentional: boolean;
};

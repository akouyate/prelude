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

export type ConnectedRoom = {
  disconnect: () => void;
  startAudio: () => Promise<void>;
};

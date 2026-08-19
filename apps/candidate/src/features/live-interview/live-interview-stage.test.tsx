import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { candidateExperienceCopy } from "./candidate-experience-copy";
import { LiveInterviewStage } from "./live-interview-room";
import type { RoomStatus } from "./live-interview-types";

// The stage is a client component that Next server-renders anyway, so static
// markup is enough to pin down what a candidate is allowed to see. Anything
// finer would need a DOM environment this app does not carry.
function renderStage({
  isPreview,
  status,
}: {
  isPreview: boolean;
  status: RoomStatus;
}) {
  return renderToStaticMarkup(
    <LiveInterviewStage
      activeText="Tell me about a project you shipped recently."
      activeTurnId="turn_1"
      // The stage takes the whole copy table, like `AbandonedPanel`: French here
      // so the Quit control is checked in the consent language (ruling R5.2).
      copy={candidateExperienceCopy("fr")}
      elapsedSeconds={42}
      inactivityNotice={null}
      isAudioPlaybackBlocked={false}
      isFormFallbackAvailable={false}
      isPreview={isPreview}
      isRoomActive
      isStreaming={false}
      localStream={null}
      onConfirmPresence={() => undefined}
      onContinueInWriting={() => undefined}
      onEnableAudio={() => undefined}
      onEndInterview={() => undefined}
      onRepeatQuestion={() => undefined}
      onSkipQuestion={() => undefined}
      status={status}
    />,
  );
}

// `disabled` has to be read off the skip button itself: asserting on the whole
// document would pass or fail on any other disabled control on the stage.
function skipButton(markup: string) {
  const label = markup.indexOf("Skip question");
  if (label === -1) throw new Error("no skip control in the rendered stage");
  const opening = markup.lastIndexOf("<button", label);
  return markup.slice(opening, markup.indexOf("</button>", label));
}

describe("live interview stage", () => {
  it("renders the quit control in the consent language", () => {
    // Ruling R5.2: withdrawing has to be as readable as consenting, so the Quit
    // control follows the consent language, not the room's English chrome.
    expect(renderStage({ isPreview: false, status: "listening" })).toContain(
      "Quitter",
    );
  });

  it("offers the skip control to a recruiter preview once the room is live", () => {
    const markup = renderStage({ isPreview: true, status: "listening" });

    expect(markup).toContain("Skip question");
    expect(markup).toContain("Skip is preview only · candidates never see it");
    expect(skipButton(markup)).not.toContain('disabled=""');
  });

  it("never shows the skip control to a candidate", () => {
    const markup = renderStage({ isPreview: false, status: "listening" });

    expect(markup).not.toContain("Skip question");
    expect(markup).not.toContain("preview only");
  });

  it("hides the skip control until the interviewer has joined the preview", () => {
    const connectingStatuses: RoomStatus[] = [
      "preparing",
      "permission_required",
      "connecting",
      "interviewer_joining",
    ];

    for (const status of connectingStatuses) {
      expect(renderStage({ isPreview: true, status })).not.toContain(
        "Skip question",
      );
    }
  });

  it("keeps the skip control inert while no question is in flight", () => {
    // The control channel has no acknowledgement: outside a running question
    // the worker would drop the message and the recruiter would read that as a
    // bug.
    const markup = renderStage({ isPreview: true, status: "agent_joined" });

    expect(markup).toContain("Skip question");
    expect(skipButton(markup)).toContain('disabled=""');
  });
});

import {
  candidateDisclosureCopy,
  candidateDisclosureCopyFr,
} from "@prelude/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PublicInterviewContext } from "../../server/public-interviews";
import { LiveInterviewRoom } from "./live-interview-room";

// Same reasoning as `live-interview-stage.test.tsx`: the room is a client
// component Next server-renders anyway, and its first paint is the welcome
// screen, so static markup is enough to pin what language a candidate is
// greeted in. `renderToStaticMarkup` escapes apostrophes, so assertions compare
// against the escaped form of the expected copy.
function renderWelcome(language: "en" | "fr") {
  const context: PublicInterviewContext = {
    interview: {
      companyName: "Acme",
      estimatedMinutes: 6,
      id: "interview_1",
      jobId: "job_1",
      jobTitle: "Ingénieur backend",
      language,
      organizationId: "org_1",
      publicToken: "pub_1",
      questions: [
        { id: "q1", prompt: "Parlez-moi d'un incident.", signal: null },
      ],
      responseModes: ["audio"],
      roleTitle: "Ingénieur backend",
    },
    invitation: null,
    kind: "published",
  };

  return renderToStaticMarkup(
    <LiveInterviewRoom context={context} token="tok_candidate" />,
  );
}

function escaped(value: string) {
  return value.replace(/'/gu, "&#x27;");
}

describe("live interview welcome screen language", () => {
  it("greets a French interview with the French disclosure and chrome", () => {
    const markup = renderWelcome("fr");

    expect(markup).toContain(escaped(candidateDisclosureCopyFr));
    expect(markup).toContain("Nous écoutons");
    expect(markup).toContain("ce que vous dites");
    expect(markup).toContain("Entretien confidentiel");
    expect(markup).toContain("Acme vous invite à un premier échange");
    expect(markup).toContain("Environ 6 minutes");
    expect(markup).toContain("Revu par un humain");
    expect(markup).toContain("Commencer");
    expect(markup).not.toContain("Human reviewed");
    expect(markup).not.toContain("We listen to");
  });

  it("greets an English interview with the English disclosure and chrome", () => {
    const markup = renderWelcome("en");

    expect(markup).toContain(escaped(candidateDisclosureCopy));
    expect(markup).toContain("We listen to");
    expect(markup).toContain("Private interview");
    expect(markup).toContain("About 6 minutes");
    expect(markup).toContain("Human reviewed");
    expect(markup).toContain("Get started");
    expect(markup).not.toContain("Revu par un humain");
  });
});

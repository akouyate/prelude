import {
  candidateDisclosureCopyV3,
  candidateDisclosureCopyV3Fr,
  candidateDisclosureCopyV3NoRecording,
  candidateDisclosureCopyV3NoRecordingFr,
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
function renderWelcome(language: "en" | "fr", recordingActive = false) {
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
      recordingActive,
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

    expect(markup).toContain(escaped(candidateDisclosureCopyV3NoRecordingFr));
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

    expect(markup).toContain(escaped(candidateDisclosureCopyV3NoRecording));
    expect(markup).toContain("We listen to");
    expect(markup).toContain("Private interview");
    expect(markup).toContain("About 6 minutes");
    expect(markup).toContain("Human reviewed");
    expect(markup).toContain("Get started");
    expect(markup).not.toContain("Revu par un humain");
  });

  it("greets a candidate with the variant that matches what the deployment does", () => {
    // The defect this replaces: the room rendered the v2 copy — which announces
    // an audio recording — on a deployment that records nothing. Over-disclosure
    // is still a false statement, so the variant follows the resolved flag.
    const off = renderWelcome("fr");
    expect(off).toContain(escaped(candidateDisclosureCopyV3NoRecordingFr));
    expect(off).not.toContain(escaped(candidateDisclosureCopyV3Fr));

    const on = renderWelcome("fr", true);
    expect(on).toContain(escaped(candidateDisclosureCopyV3Fr));
    expect(on).not.toContain(escaped(candidateDisclosureCopyV3NoRecordingFr));

    expect(renderWelcome("en", true)).toContain(
      escaped(candidateDisclosureCopyV3),
    );
    expect(renderWelcome("en")).toContain(
      escaped(candidateDisclosureCopyV3NoRecording),
    );
  });

  it("names the controller and links the notice, in the interview language", () => {
    // GDPR art. 13 layer 1. The href is built from the candidate's own token,
    // so the notice resolves the same interview — and the same controller —
    // without asking the candidate to authenticate.
    expect(renderWelcome("fr")).toContain(
      escaped(
        "Cet entretien est mené pour Acme, responsable du traitement de vos données. HireCall le conduit pour son compte.",
      ),
    );
    expect(renderWelcome("fr")).toContain(
      "Consulter la notice de confidentialité",
    );
    expect(renderWelcome("fr")).toContain(
      'href="/interview/tok_candidate/privacy"',
    );

    expect(renderWelcome("en")).toContain(
      "This interview is run for Acme, the data controller. HireCall conducts it on their behalf.",
    );
    expect(renderWelcome("en")).toContain("Read the privacy notice");
  });

  it("drops the notice link in the recruiter preview, keeping the controller line", () => {
    // A preview token is not a published-interview token: no public notice
    // route answers it, so linking there would 404 the recruiter.
    const markup = renderToStaticMarkup(
      <LiveInterviewRoom context={previewContext()} token="prev_token" />,
    );

    expect(markup).toContain(
      escaped(
        "Cet entretien est mené pour Acme, responsable du traitement de vos données. HireCall le conduit pour son compte.",
      ),
    );
    expect(markup).not.toContain("Consulter la notice de confidentialité");
    expect(markup).not.toContain("/privacy");
  });

  it("renders marketing demo disclosure without recruiter-preview chrome or an eight-minute promise", () => {
    const markup = renderToStaticMarkup(
      <LiveInterviewRoom
        context={marketingDemoContext()}
        token="pvtk_marketing_secret"
      />,
    );

    expect(markup).toContain("Practice interview");
    expect(markup).toContain("real candidate-style AI voice interview");
    expect(markup).toContain("A few minutes");
    expect(markup).toContain('href="/preview/pvtk_marketing_secret/privacy"');
    expect(markup).not.toContain("About 8 minutes");
    expect(markup).not.toContain("recruiter preview mode");
    expect(markup).not.toContain("Start live test");
    expect(markup).not.toContain("Exit preview");
  });

  it("keeps expired marketing links free of recruiter instructions", () => {
    const markup = renderToStaticMarkup(
      <LiveInterviewRoom
        context={{ kind: "not_found", previewVariant: "marketing_demo" }}
        token="pvtk_expired"
      />,
    );

    expect(markup).toContain("Demo interview unavailable");
    expect(markup).toContain("Return to HireCall&#x27;s demo roles");
    expect(markup).not.toContain("Ask the recruiter");
  });
});

function previewContext(): PublicInterviewContext {
  return {
    expiresAt: new Date(Date.now() + 60_000),
    interview: {
      companyName: "Acme",
      estimatedMinutes: 6,
      id: "preview_1",
      jobId: "job_1",
      jobTitle: "Ingénieur backend",
      language: "fr",
      organizationId: "org_1",
      publicToken: "prev_token",
      questions: [],
      // A recruiter preview records nothing, whatever the deployment flag says.
      recordingActive: false,
      responseModes: ["audio"],
      roleTitle: "Ingénieur backend",
    },
    kind: "preview",
    marketingDemo: null,
    previewVariant: "recruiter_preview",
    returnPath: "/roles/new?draftId=draft_1",
  };
}

function marketingDemoContext(): PublicInterviewContext {
  return {
    expiresAt: new Date(Date.now() + 60_000),
    interview: {
      companyName: "HireCall",
      estimatedMinutes: null,
      id: "preview_marketing_1",
      jobId: "job_demo",
      jobTitle: "Account Executive",
      language: "en",
      organizationId: "org_marketing_demo_system",
      publicToken: "pvtk_marketing_secret",
      questions: [],
      recordingActive: false,
      responseModes: ["audio"],
      roleTitle: "Account Executive",
    },
    kind: "preview",
    marketingDemo: {
      postInterviewQuestions: [
        {
          id: "confidence",
          max: 5,
          maxLabel: "Very confident",
          min: 1,
          minLabel: "Not confident",
          prompt: "How confident did you feel?",
          required: true,
          type: "scale",
        },
      ],
      returnTarget: "https://www.hirecall.test/demo/result",
      roleSlug: "account-executive",
      roleVersion: 1,
    },
    previewVariant: "marketing_demo",
    returnPath: "https://www.hirecall.test/demo/result",
  };
}

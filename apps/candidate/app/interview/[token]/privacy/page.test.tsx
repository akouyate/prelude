import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicInterviewContext } from "../../../../src/server/public-interviews";

const getPublicInterviewContextMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);

vi.mock("../../../../src/server/public-interviews", () => ({
  getPublicInterviewContext: getPublicInterviewContextMock,
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

const { default: CandidatePrivacyNoticePage } = await import("./page");

function publishedContext(
  language: "en" | "fr",
  companyName = "Acme Talent",
  recordingActive = false,
): PublicInterviewContext {
  return {
    interview: {
      companyName,
      estimatedMinutes: 6,
      id: "interview_1",
      jobId: "job_1",
      jobTitle: "Ingénieur backend",
      language,
      organizationId: "org_1",
      publicToken: "pub_1",
      questions: [],
      // The loader resolves this once for the whole request; the notice reads
      // it rather than re-reading the environment.
      recordingActive,
      responseModes: ["audio"],
      roleTitle: "Ingénieur backend",
    },
    invitation: null,
    kind: "published",
  };
}

async function renderNotice(token = "ci_token") {
  const element = await CandidatePrivacyNoticePage({
    params: Promise.resolve({ token }),
  });

  return renderToStaticMarkup(element);
}

function escaped(value: string) {
  return value.replace(/'/gu, "&#x27;");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("candidate privacy notice page", () => {
  it("resolves the controller and the language from the public interview", async () => {
    // No authentication: the notice has to be readable from the same link the
    // candidate was sent, or the art. 13 information is not "provided".
    getPublicInterviewContextMock.mockResolvedValue(publishedContext("fr"));

    const markup = await renderNotice("ci_token");

    expect(getPublicInterviewContextMock).toHaveBeenCalledWith("ci_token");
    expect(markup).toContain(
      "Notice de confidentialité — entretien de présélection",
    );
    expect(markup).toContain("Qui est responsable de vos données");
    expect(markup).toContain("Acme Talent");
    expect(markup).toContain("Dernière mise à jour");
    expect(markup).not.toContain("Who is responsible for your data");
    expect(markup).not.toContain("{companyName}");
  });

  it("renders an English interview in English", async () => {
    getPublicInterviewContextMock.mockResolvedValue(
      publishedContext("en", "Northwind"),
    );

    const markup = await renderNotice();

    expect(markup).toContain("Privacy notice — screening interview");
    expect(markup).toContain("Who is responsible for your data");
    expect(markup).toContain("Northwind");
    expect(markup).not.toContain("Qui est responsable");
  });

  it("says nothing about a recording while recording is off", async () => {
    getPublicInterviewContextMock.mockResolvedValue(publishedContext("fr"));

    const markup = await renderNotice();

    expect(markup).not.toContain("enregistrement audio");
    expect(markup).not.toContain(
      escaped("L'enregistrement audio de votre voix."),
    );
    expect(markup).not.toContain("Cloudflare");
    expect(markup).toContain(
      escaped(
        "Vous disposez des droits d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité.",
      ),
    );
  });

  it("describes the recording once the deployment turns it on", async () => {
    getPublicInterviewContextMock.mockResolvedValue(
      publishedContext("fr", "Acme Talent", true),
    );

    const markup = await renderNotice();

    expect(markup).toContain(escaped("L'enregistrement audio de votre voix."));
    expect(markup).toContain("Cloudflare R2");
    expect(markup).toContain("90 jours au maximum");
  });

  it("links back to the interview it belongs to", async () => {
    getPublicInterviewContextMock.mockResolvedValue(publishedContext("fr"));

    const markup = await renderNotice("ci_abc");

    expect(markup).toContain('href="/interview/ci_abc"');
    expect(markup).toContain("Retour");
  });

  it("is a 404 for a token no published interview answers", async () => {
    getPublicInterviewContextMock.mockResolvedValue({ kind: "not_found" });

    await expect(renderNotice()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});

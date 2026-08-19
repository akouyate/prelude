import { describe, expect, it } from "vitest";

import {
  candidatePrivacyNotice,
  NOTICE_UPDATED_DATE,
  type CandidatePrivacyNotice,
  type PrivacyNoticeBullet,
  type PrivacyNoticeSection,
  type PrivacyNoticeSectionId,
} from "./privacy-notice-copy";

const languages = ["en", "fr"] as const;

function bulletTexts(bullets: PrivacyNoticeBullet[]): string[] {
  return bullets.flatMap((bullet) => [
    bullet.text,
    ...bulletTexts(bullet.items ?? []),
  ]);
}

/** Every rendered sentence of the notice, in document order. */
function entries(notice: CandidatePrivacyNotice): string[] {
  return notice.sections.flatMap((section) =>
    section.blocks.flatMap((block) =>
      block.kind === "paragraph" ? [block.text] : bulletTexts(block.items),
    ),
  );
}

/**
 * The shape of the notice with the wording removed: what the parity check
 * compares between languages, so a missing bullet fails loudly while a
 * translated sentence does not.
 */
function outline(notice: CandidatePrivacyNotice) {
  return notice.sections.map((section) => ({
    blocks: section.blocks.map((block) =>
      block.kind === "paragraph"
        ? "paragraph"
        : `list(${bulletTexts(block.items).length})`,
    ),
    id: section.id,
  }));
}

function sectionOf(
  notice: CandidatePrivacyNotice,
  id: PrivacyNoticeSectionId,
): PrivacyNoticeSection {
  const section = notice.sections.find((candidate) => candidate.id === id);

  if (!section) {
    throw new Error(`missing notice section: ${id}`);
  }

  return section;
}

function noticeFor(
  language: (typeof languages)[number],
  recordingActive: boolean,
) {
  return candidatePrivacyNotice({
    companyName: "Acme Talent",
    language,
    recordingActive,
  });
}

describe("candidate privacy notice copy", () => {
  it("keeps English and French on the same sections and the same blocks", () => {
    // The notice is a statutory text: a section or a bullet present on one side
    // only would under-inform whichever candidate reads the shorter one.
    [true, false].forEach((recordingActive) => {
      expect(outline(noticeFor("en", recordingActive))).toEqual(
        outline(noticeFor("fr", recordingActive)),
      );
    });
  });

  it("hides every recording block when the recording is off", () => {
    languages.forEach((language) => {
      expect(outline(noticeFor(language, false))).toEqual([
        { blocks: ["paragraph"], id: "controller" },
        { blocks: ["list(3)", "paragraph"], id: "what-we-process" },
        { blocks: ["list(1)", "paragraph"], id: "legal-bases" },
        { blocks: ["list(5)", "paragraph"], id: "access" },
        { blocks: ["list(2)"], id: "retention" },
        {
          blocks: ["paragraph", "paragraph", "paragraph"],
          id: "rights",
        },
        { blocks: ["paragraph"], id: "stopping" },
      ]);
    });
  });

  it("adds exactly the recording blocks when the recording is on", () => {
    languages.forEach((language) => {
      expect(outline(noticeFor(language, true))).toEqual([
        { blocks: ["paragraph"], id: "controller" },
        { blocks: ["list(4)", "paragraph"], id: "what-we-process" },
        { blocks: ["list(2)", "paragraph"], id: "legal-bases" },
        { blocks: ["list(6)", "paragraph", "paragraph"], id: "access" },
        { blocks: ["list(3)"], id: "retention" },
        {
          blocks: ["paragraph", "paragraph", "paragraph"],
          id: "rights",
        },
        { blocks: ["paragraph"], id: "stopping" },
      ]);
    });
  });

  it("carries the same number of recording-conditional entries in both languages", () => {
    const counts = languages.map((language) => {
      const on = entries(noticeFor(language, true));
      const off = entries(noticeFor(language, false));
      const shared = on.filter((entry) => off.includes(entry));

      return {
        // Five entries appear only with the recording on.
        added: on.length - off.length,
        // Plus the one entry whose sentence grows a clause in place.
        rewritten: off.length - shared.length,
      };
    });

    expect(counts).toEqual([
      { added: 5, rewritten: 1 },
      { added: 5, rewritten: 1 },
    ]);
  });

  it("never mentions the recording anywhere once it is off", () => {
    const recordingWords = [
      /enregistr/iu,
      /recording/iu,
      /Cloudflare/u,
      /90 jours/u,
      /90 days/u,
    ];

    languages.forEach((language) => {
      const text = entries(noticeFor(language, false)).join(" ");

      recordingWords.forEach((word) => {
        expect(`${language} ${word.source}: ${word.test(text)}`).toBe(
          `${language} ${word.source}: false`,
        );
      });
    });
  });

  it("interpolates the controller everywhere and leaves no slot behind", () => {
    languages.forEach((language) => {
      [true, false].forEach((recordingActive) => {
        const notice = noticeFor(language, recordingActive);
        const text = [
          notice.title,
          notice.lastUpdated,
          ...notice.sections.map((section) => section.heading),
          ...entries(notice),
        ].join(" ");

        expect(`${language}: ${text.includes("{")}`).toBe(`${language}: false`);
        expect(`${language}: ${text.includes("Acme Talent")}`).toBe(
          `${language}: true`,
        );
      });
    });
  });

  it("stamps the notice with its own updated date", () => {
    expect(NOTICE_UPDATED_DATE).toBe("2026-08-19");
    expect(noticeFor("fr", false).lastUpdated).toBe(
      `Dernière mise à jour : ${NOTICE_UPDATED_DATE}`,
    );
    expect(noticeFor("en", false).lastUpdated).toBe(
      `Last updated: ${NOTICE_UPDATED_DATE}`,
    );
  });

  it("renders the controller paragraph as the ruling wrote it", () => {
    const fr = sectionOf(noticeFor("fr", false), "controller");
    const en = sectionOf(noticeFor("en", false), "controller");

    expect(fr.heading).toBe("Qui est responsable de vos données");
    expect(fr.blocks[0]).toEqual({
      kind: "paragraph",
      text:
        "Cet entretien est mené pour Acme Talent, responsable du traitement de vos données au sens du RGPD. " +
        "HireCall fournit l'outil d'entretien et traite vos données pour le compte de Acme Talent, sur ses instructions, sans les utiliser à d'autres fins.",
    });
    expect(en.heading).toBe("Who is responsible for your data");
    expect(en.blocks[0]).toEqual({
      kind: "paragraph",
      text:
        "This interview is run for Acme Talent, the data controller under the GDPR. " +
        "HireCall provides the interview tool and processes your data on behalf of Acme Talent, on their instructions, and for no other purpose.",
    });
  });

  it("splices the withdrawal right into the rights sentence, in place", () => {
    // The only [RECORDING] marker that sits mid-sentence: with the recording
    // off the enumeration has to close cleanly, not trail a dangling clause.
    const rightsFor = (recordingActive: boolean) =>
      sectionOf(noticeFor("fr", recordingActive), "rights").blocks[0];

    expect(rightsFor(false)).toEqual({
      kind: "paragraph",
      text: "Vous disposez des droits d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité.",
    });
    expect(rightsFor(true)).toEqual({
      kind: "paragraph",
      text: "Vous disposez des droits d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité, ainsi que du droit de retirer votre consentement à l'enregistrement.",
    });
  });

  it("prints the rights contact in both languages", () => {
    languages.forEach((language) => {
      const text = entries(noticeFor(language, false)).join(" ");

      expect(`${language}: ${text.includes("privacy@hirecall.ai")}`).toBe(
        `${language}: true`,
      );
      expect(`${language}: ${text.includes("www.cnil.fr")}`).toBe(
        `${language}: true`,
      );
    });
  });
});

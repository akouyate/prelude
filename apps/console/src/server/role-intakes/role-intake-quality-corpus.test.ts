import { describe, expect, it } from "vitest";

import {
  RoleIntakeProcessingError,
  detectRoleIntakeDocumentSignature,
  extractRoleIntakeDocument,
} from "./role-intake-processor";
import { createQualityFixtureBytes } from "./fixtures/bytes";
import { ROLE_INTAKE_QUALITY_FIXTURES } from "./fixtures/manifest";
import { isAcceptedTitle } from "./role-intake-quality";

describe("executable role intake quality corpus", () => {
  for (const fixture of ROLE_INTAKE_QUALITY_FIXTURES) {
    it(`${fixture.id} produces ${fixture.expectedOutcome}`, async () => {
      const bytes = createQualityFixtureBytes(fixture);

      if (fixture.expectedOutcome === "extract") {
        const result = await extractRoleIntakeDocument(bytes);
        expect(result.detectedMimeType).toBe(
          fixture.format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
        expect(result.draft.description.length).toBeGreaterThan(0);
        expect(result.warnings.map((warning) => warning.code)).toEqual(
          fixture.expectedWarningCodes,
        );
        expect(
          isAcceptedTitle(
            result.draft.title ?? undefined,
            fixture.acceptedTitleAliases,
          ),
        ).toBe(true);
        if (fixture.expectedLocation) {
          expect(result.draft.location).toBe(fixture.expectedLocation);
        }
        if (fixture.id === "en-missing-location-docx") {
          expect(result.draft.location).toBeNull();
        }
        if (fixture.id === "fr-multipage-docx") {
          expect(countPageBreaks(bytes)).toBe(1);
          expect(result.pageCount).toBeNull();
        }
        if (fixture.id === "en-sparse-pdf") {
          expect(result.pageCount).toBe(1);
          expect(result.textLength).toBeLessThan(100);
        }
        for (const factGroup of fixture.requiredDescriptionFactGroups) {
          expect(
            hasRequiredDescriptionFact(result.draft.description, factGroup),
          ).toBe(true);
        }
        expect(result.textLength).toBe(result.draft.description.length);
        return;
      }

      const error = await getProcessingError(bytes);
      expect(error.code).toBe(fixture.expectedWarningCodes[0]);
      expect([...error.details.warningCodes, error.code]).toEqual(
        fixture.expectedWarningCodes,
      );
      if (error.details.signatureValid) {
        expect(error.details.textLength).toBe(0);
        expect(error.details.parserVersion).toMatch(
          fixture.format === "pdf"
            ? /^pdfjs-dist-\d+\.\d+\.\d+$/
            : /^mammoth-\d+\.\d+\.\d+$/,
        );
      } else {
        expect(detectRoleIntakeDocumentSignature(bytes)).toBe(
          fixture.format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
      }

      if (fixture.id === "en-scanned-pdf") {
        expect(error.details.detectedMimeType).toBe("application/pdf");
        expect(error.details.pageCount).toBe(1);
        expect(hasImageOnlyPdfStructure(bytes)).toBe(true);
      }
      if (fixture.id === "fr-empty-docx") {
        expect(error.details.detectedMimeType).toBe(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
        expect(error.details.pageCount).toBeNull();
      }
      if (fixture.id === "en-corrupt-docx") {
        expect(detectRoleIntakeDocumentSignature(bytes)).toBe(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
      }
      if (fixture.id === "en-hostile-docx") {
        expect(error.code).toBe("docx_unsupported_structure");
      }
    }, 15_000);
  }
});

async function getProcessingError(
  bytes: Buffer,
): Promise<RoleIntakeProcessingError> {
  try {
    await extractRoleIntakeDocument(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(RoleIntakeProcessingError);
    return error as RoleIntakeProcessingError;
  }
  throw new Error("Expected role intake extraction to fail.");
}

function countPageBreaks(bytes: Buffer): number {
  return (bytes.toString("utf8").match(/<w:br w:type="page"\/>/g) ?? []).length;
}

function hasImageOnlyPdfStructure(bytes: Buffer): boolean {
  const source = bytes.toString("latin1");
  return (
    source.includes("/Subtype /Image") &&
    source.includes("/Width 1 /Height 1") &&
    !source.includes(" BT")
  );
}

function hasRequiredDescriptionFact(description: string, factGroup: string) {
  const normalized = description.toLocaleLowerCase("en-US");
  const markers: Record<string, readonly string[]> = {
    responsibilities: [
      "own",
      "piloter",
      "negotiate",
      "améliorer",
      "improve",
      "operations",
    ],
    stakeholders: ["stakeholders", "équipes", "parties prenantes", "teams"],
    impact: ["impact", "measure", "mesurer", "reduce", "réduire"],
  };
  return (markers[factGroup] ?? []).some((marker) =>
    normalized.includes(marker),
  );
}

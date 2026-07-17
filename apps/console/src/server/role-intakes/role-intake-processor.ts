import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import net from "node:net";
import { dirname, join } from "node:path";

import type { ImportedRoleDraft, RoleIntakeWarning } from "@prelude/contracts";
import mammoth from "mammoth";
import * as yauzl from "yauzl";

const MAX_PDF_PAGES = 100;
const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 500_000;
const CLAMAV_CHUNK_BYTES = 64 * 1024;
const CLAMAV_TIMEOUT_MS = 20_000;
const requireFromModule = createRequire(import.meta.url);

export type RoleIntakeScanResult =
  | { kind: "clean"; version: string }
  | { kind: "infected"; signature: string | null; version: string }
  | { kind: "unavailable"; reason: string };

export type RoleIntakeScanner = {
  scan(input: Buffer): Promise<RoleIntakeScanResult>;
};

export type RoleIntakeExtractionResult = {
  detectedMimeType:
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  draft: ImportedRoleDraft;
  parserVersion: string;
  sha256: string;
  warnings: RoleIntakeWarning[];
};

export class RoleIntakeProcessingError extends Error {
  constructor(
    readonly code:
      | "docx_unsupported_structure"
      | "document_corrupt"
      | "no_usable_text"
      | "parser_timeout"
      | "unsupported_document",
    message: string,
  ) {
    super(message);
    this.name = "RoleIntakeProcessingError";
  }
}

export async function scanRoleIntakeDocument(
  input: Buffer,
): Promise<RoleIntakeScanResult> {
  const host = process.env.ROLE_INTAKE_CLAMAV_HOST?.trim();
  if (!host) {
    return { kind: "unavailable", reason: "ClamAV is not configured." };
  }

  const port = Number(process.env.ROLE_INTAKE_CLAMAV_PORT ?? "3310");
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    return { kind: "unavailable", reason: "ClamAV port is invalid." };
  }

  try {
    const response = await scanWithClamAv({ host, input, port });
    if (response.includes("FOUND")) {
      const signature = response.match(/stream:\s*(.+?)\s+FOUND/i)?.[1] ?? null;
      return { kind: "infected", signature, version: "clamav" };
    }
    if (response.includes("OK")) {
      return { kind: "clean", version: "clamav" };
    }
    return { kind: "unavailable", reason: "ClamAV returned an unknown result." };
  } catch {
    return { kind: "unavailable", reason: "ClamAV is unavailable." };
  }
}

export async function extractRoleIntakeDocument(
  input: Buffer,
): Promise<RoleIntakeExtractionResult> {
  const detectedMimeType = await detectMimeType(input);
  const extraction =
    detectedMimeType === "application/pdf"
      ? await extractPdfText(input)
      : await extractDocxText(input);
  const normalizedText = normalizeText(extraction.text);

  if (!normalizedText) {
    throw new RoleIntakeProcessingError(
      "no_usable_text",
      "Prelude could not find usable text in this document. Start from a manual brief instead.",
    );
  }

  const text = normalizedText.slice(0, MAX_EXTRACTED_CHARACTERS);
  const warnings = [...extraction.warnings];
  if (normalizedText.length > MAX_EXTRACTED_CHARACTERS) {
    warnings.push({
      code: "extraction_truncated",
      message: "The extracted text was shortened before review.",
    });
  }

  const fields = inferExplicitFields(text);
  return {
    detectedMimeType,
    draft: {
      description: text,
      location: fields.location,
      title: fields.title,
    },
    parserVersion: detectedMimeType === "application/pdf" ? "pdfjs-dist" : "mammoth",
    sha256: createHash("sha256").update(input).digest("hex"),
    warnings,
  };
}

async function detectMimeType(
  input: Buffer,
): Promise<
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
> {
  if (input.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }

  if (input.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    await inspectDocxPackage(input);
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  throw new RoleIntakeProcessingError(
    "unsupported_document",
    "The document is not a valid PDF or DOCX file.",
  );
}

async function extractPdfText(input: Buffer): Promise<{
  text: string;
  warnings: RoleIntakeWarning[];
}> {
  try {
    const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as {
      getDocument: (source: Record<string, unknown>) => {
        destroy: () => Promise<void>;
        promise: Promise<{
          getPage: (pageNumber: number) => Promise<{
            getTextContent: () => Promise<{ items: Array<{ str?: unknown }> }>;
          }>;
          numPages: number;
        }>;
      };
    };
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(input),
      disableWorker: true,
      isEvalSupported: false,
      stopAtErrors: true,
      standardFontDataUrl: standardFontDataUrl(),
      useWorkerFetch: false,
    });
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      await loadingTask.destroy();
      throw new RoleIntakeProcessingError(
        "unsupported_document",
        "The PDF has too many pages for a role brief.",
      );
    }

    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => (typeof item.str === "string" ? item.str : ""))
          .join(" "),
      );
    }
    await loadingTask.destroy();

    return { text: pages.join("\n\n"), warnings: [] };
  } catch (error) {
    if (error instanceof RoleIntakeProcessingError) {
      throw error;
    }
    const failure = new RoleIntakeProcessingError(
      "document_corrupt",
      "Prelude could not read this PDF safely.",
    );
    failure.cause = error;
    throw failure;
  }
}

function standardFontDataUrl(): string {
  const pdfEntrypoint = requireFromModule.resolve("pdfjs-dist/legacy/build/pdf.mjs");
  // NodeBinaryDataFactory reads this value with fs.readFile, therefore this is
  // intentionally a filesystem path (not a file:// URL).
  return `${join(dirname(pdfEntrypoint), "../../standard_fonts")}/`;
}

async function extractDocxText(input: Buffer): Promise<{
  text: string;
  warnings: RoleIntakeWarning[];
}> {
  try {
    const result = await mammoth.extractRawText({ buffer: input });
    return {
      text: result.value,
      warnings: result.messages.map((message) => ({
        code: "docx_parser_notice",
        message: message.message.slice(0, 240),
      })),
    };
  } catch {
    throw new RoleIntakeProcessingError(
      "document_corrupt",
      "Prelude could not read this DOCX file safely.",
    );
  }
}

async function inspectDocxPackage(input: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(input, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) {
        reject(
          new RoleIntakeProcessingError(
            "document_corrupt",
            "Prelude could not read this DOCX file safely.",
          ),
        );
        return;
      }

      let completed = false;
      let totalUncompressed = 0;
      let hasContentTypes = false;
      let hasDocument = false;

      const fail = (error: RoleIntakeProcessingError) => {
        if (completed) {
          return;
        }
        completed = true;
        zip.close();
        reject(error);
      };

      const next = () => {
        if (!completed) {
          zip.readEntry();
        }
      };

      zip.on("error", () =>
        fail(
          new RoleIntakeProcessingError(
            "document_corrupt",
            "Prelude could not read this DOCX file safely.",
          ),
        ),
      );
      zip.on("entry", (entry) => {
        const name = entry.fileName.replaceAll("\\", "/");
        totalUncompressed += entry.uncompressedSize;

        if (
          name.startsWith("/") ||
          name.split("/").includes("..") ||
          totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES ||
          /(^|\/)vbaProject\.bin$/i.test(name) ||
          /(^|\/)embeddings\//i.test(name) ||
          /oleObject/i.test(name)
        ) {
          fail(
            new RoleIntakeProcessingError(
              "docx_unsupported_structure",
              "The DOCX contains an unsupported or unsafe structure.",
            ),
          );
          return;
        }

        hasContentTypes ||= name === "[Content_Types].xml";
        hasDocument ||= name === "word/document.xml";

        if (!name.endsWith(".rels")) {
          next();
          return;
        }

        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail(
              new RoleIntakeProcessingError(
                "document_corrupt",
                "Prelude could not inspect this DOCX file safely.",
              ),
            );
            return;
          }

          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          stream.on("error", () =>
            fail(
              new RoleIntakeProcessingError(
                "document_corrupt",
                "Prelude could not inspect this DOCX file safely.",
              ),
            ),
          );
          stream.on("end", () => {
            const relationships = Buffer.concat(chunks).toString("utf8");
            if (/TargetMode\s*=\s*["']External["']/i.test(relationships)) {
              fail(
                new RoleIntakeProcessingError(
                  "docx_unsupported_structure",
                  "The DOCX references external content and cannot be imported.",
                ),
              );
              return;
            }
            next();
          });
        });
      });
      zip.on("end", () => {
        if (completed) {
          return;
        }
        if (!hasContentTypes || !hasDocument) {
          fail(
            new RoleIntakeProcessingError(
              "unsupported_document",
              "The selected ZIP file is not a DOCX document.",
            ),
          );
          return;
        }
        completed = true;
        resolve();
      });
      next();
    });
  });
}

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inferExplicitFields(text: string): {
  location: string | null;
  title: string | null;
} {
  return {
    location: findLabelledValue(text, ["location", "localisation"]),
    title: findLabelledValue(text, ["job title", "role", "poste", "intitulé du poste"]),
  };
}

function findLabelledValue(text: string, labels: string[]): string | null {
  const source = labels.map(escapeRegex).join("|");
  const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:${source})\\s*[:\-]\\s*([^\\n]{2,160})`, "im"));
  return match?.[1]?.trim() || null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function scanWithClamAv(input: {
  host: string;
  input: Buffer;
  port: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: input.host, port: input.port });
    const response: Buffer[] = [];
    let settled = false;
    const timeout = setTimeout(() => {
      socket.destroy(new Error("ClamAV scan timed out."));
    }, CLAMAV_TIMEOUT_MS);

    const finish = (value: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve(value);
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    socket.once("connect", () => {
      socket.write(Buffer.from("zINSTREAM\0"));
      for (let offset = 0; offset < input.input.length; offset += CLAMAV_CHUNK_BYTES) {
        const chunk = input.input.subarray(offset, offset + CLAMAV_CHUNK_BYTES);
        const size = Buffer.allocUnsafe(4);
        size.writeUInt32BE(chunk.length, 0);
        socket.write(size);
        socket.write(chunk);
      }
      // A zero-length chunk terminates INSTREAM. Half-closing the request lets
      // clamd answer immediately while still allowing us to read its response.
      socket.end(Buffer.alloc(4));
    });
    socket.on("data", (chunk) => {
      response.push(Buffer.from(chunk));
      const text = Buffer.concat(response).toString("utf8");
      if (text.includes("\0") || text.includes("\n")) {
        finish(text);
      }
    });
    socket.once("error", fail);
    socket.once("end", () => {
      finish(Buffer.concat(response).toString("utf8"));
    });
  });
}

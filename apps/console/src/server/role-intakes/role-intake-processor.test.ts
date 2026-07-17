import { describe, expect, it } from "vitest";

import {
  RoleIntakeProcessingError,
  extractRoleIntakeDocument,
} from "./role-intake-processor";

describe("role intake document processing", () => {
  it("extracts deterministic text from a normal PDF without an LLM", async () => {
    const result = await extractRoleIntakeDocument(
      createPdf("Job Title: Product Manager"),
    );

    expect(result.detectedMimeType).toBe("application/pdf");
    expect(result.draft.description).toContain("Job Title: Product Manager");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  }, 15_000);

  it("rejects a document whose bytes do not match PDF or DOCX", async () => {
    await expect(extractRoleIntakeDocument(Buffer.from("not a role brief"))).rejects.toMatchObject(
      {
        code: "unsupported_document",
      } satisfies Partial<RoleIntakeProcessingError>,
    );
  });

  it("rejects DOCX packages that reference external content", async () => {
    const docx = createStoredZip([
      { name: "[Content_Types].xml", value: "<Types />" },
      { name: "word/document.xml", value: "<w:document />" },
      {
        name: "word/_rels/document.xml.rels",
        value: '<Relationship TargetMode="External" Target="https://example.test" />',
      },
    ]);

    await expect(extractRoleIntakeDocument(docx)).rejects.toMatchObject({
      code: "docx_unsupported_structure",
    } satisfies Partial<RoleIntakeProcessingError>);
  });
});

function createPdf(text: string): Buffer {
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${text.replace(/[()\\]/g, "\\$&")}) Tj\nET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, "utf8");
}

function createStoredZip(entries: Array<{ name: string; value: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.from(entry.value, "utf8");
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const fullLocal = Buffer.concat([local, name, content]);
    localParts.push(fullLocal);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(Buffer.concat([central, name]));
    localOffset += fullLocal.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(entries.length, 8);
  footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(centralDirectory.length, 12);
  footer.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, footer]);
}

function crc32(input: Buffer): number {
  let value = 0xffffffff;
  for (const byte of input) {
    value ^= byte;
    for (let index = 0; index < 8; index += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

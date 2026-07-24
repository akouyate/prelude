import type { RoleIntakeQualityFixture } from "../role-intake-quality";

export function createQualityFixtureBytes(
  fixture: RoleIntakeQualityFixture,
): Buffer {
  switch (fixture.id) {
    case "en-clean-pdf":
      return createPdf([
        [
          "Job Title: Product Manager",
          "Location: Paris",
          "Own product discovery, align stakeholders, and measure customer impact.",
        ],
      ]);
    case "fr-clean-docx":
      return createDocx([
        "Intitulé du poste : Responsable recrutement",
        "Localisation : Paris",
        "Piloter les recrutements, aligner les équipes et mesurer leur impact.",
      ]);
    case "en-sparse-pdf":
      return createPdf([
        [
          "Job Title: Buyer",
          "Location: London",
          "Negotiate supplier contracts.",
        ],
      ]);
    case "fr-multipage-docx":
      return createDocx(
        [
          "Intitulé du poste : Responsable des opérations",
          "Localisation : Lyon",
          "Piloter les opérations.",
          "Aligner les parties prenantes.",
          "Mesurer et améliorer l'impact.",
        ],
        {
          pageBreakBeforeParagraphs: [3],
        },
      );
    case "fr-unicode-docx":
      return createDocx([
        "Intitulé du poste : Responsable expérience client",
        "Localisation : Montréal",
        "Améliorer l’expérience client, aligner les équipes et mesurer l’impact.",
      ]);
    case "en-missing-location-docx":
      return createDocx([
        "Job Title: Operations Manager",
        "Own operations, align stakeholders, and measure business impact.",
      ]);
    case "en-scanned-pdf":
      return createImageOnlyPdf();
    case "fr-empty-docx":
      return createDocx([]);
    case "en-corrupt-pdf":
      return Buffer.from("%PDF-1.4\ntruncated", "utf8");
    case "en-corrupt-docx":
      return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    case "en-hostile-docx":
      return createDocx(["Job Title: Unsafe"], {
        externalRelationship: true,
      });
    default:
      throw new Error(
        `No synthetic bytes are defined for fixture ${fixture.id}.`,
      );
  }
}

function createPdf(pages: readonly (readonly string[])[]): Buffer {
  const pageObjectNumbers = pages.map((_, index) => 3 + index * 2);
  const fontObjectNumber = 3 + pages.length * 2;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    ...pages.flatMap((lines, index) => {
      const contentObjectNumber = 4 + index * 2;
      const commands = lines.flatMap((line, lineIndex) => [
        `(${escapePdfText(line)}) Tj`,
        ...(lineIndex < lines.length - 1 ? ["T*"] : []),
      ]);
      const stream = lines.length
        ? `BT\n/F1 14 Tf\n18 TL\n72 720 Td\n${commands.join("\n")}\nET\n`
        : "";
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
      ];
    }),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output, "utf8");
}

function createDocx(
  paragraphs: readonly string[],
  options: {
    externalRelationship?: boolean;
    pageBreakBeforeParagraphs?: readonly number[];
  } = {},
): Buffer {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs
      .map((paragraph, index) => {
        const pageBreak = options.pageBreakBeforeParagraphs?.includes(index)
          ? '<w:r><w:br w:type="page"/></w:r>'
          : "";
        return `<w:p>${pageBreak}<w:r><w:t xml:space="preserve">${escapeXml(paragraph)}</w:t></w:r></w:p>`;
      })
      .join("")}
  </w:body>
</w:document>`;
  const entries = [
    {
      name: "[Content_Types].xml",
      value: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      value: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    { name: "word/document.xml", value: document },
    ...(options.externalRelationship
      ? [
          {
            name: "word/_rels/document.xml.rels",
            value:
              '<Relationships><Relationship TargetMode="External" Target="https://example.test/private" /></Relationships>',
          },
        ]
      : []),
  ];
  return createStoredZip(entries);
}

function createImageOnlyPdf(): Buffer {
  const imageStream = Buffer.from([0, 0, 0]);
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
    ),
    Buffer.from(
      "<< /Length 36 >>\nstream\nq\n100 0 0 100 72 600 cm\n/Im1 Do\nQ\nendstream",
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${imageStream.length} >>\nstream\n`,
      ),
      imageStream,
      Buffer.from("\nendstream"),
    ]),
  ];

  return createPdfDocument(objects);
}

function createPdfDocument(objects: readonly Buffer[]): Buffer {
  const header = Buffer.from("%PDF-1.4\n");
  const parts: Buffer[] = [header];
  const offsets = [0];
  let offset = header.length;

  for (const [index, object] of objects.entries()) {
    const prefix = Buffer.from(`${index + 1} 0 obj\n`);
    const suffix = Buffer.from("\nendobj\n");
    offsets.push(offset);
    parts.push(prefix, object, suffix);
    offset += prefix.length + object.length + suffix.length;
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  xref += offsets
    .slice(1)
    .map((entryOffset) => `${String(entryOffset).padStart(10, "0")} 00000 n \n`)
    .join("");
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}

function createStoredZip(
  entries: readonly { name: string; value: string }[],
): Buffer {
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

function escapePdfText(value: string): string {
  return value.replace(/[()\\]/g, "\\$&");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

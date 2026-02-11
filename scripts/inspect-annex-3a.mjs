import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const inputFile = resolve(root, "data/source/annex-3a.pdf");

const start = Number(process.argv[2] ?? 1);
const end = Number(process.argv[3] ?? start);

function groupLines(items) {
  const linesByY = new Map();
  for (const item of items) {
    if (!item || typeof item.str !== "string") continue;
    const y = Math.round(item.transform[5]);
    const x = item.transform[4];
    const line = linesByY.get(y) ?? [];
    line.push({ x, str: item.str });
    linesByY.set(y, line);
  }

  return Array.from(linesByY.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) =>
      parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

async function inspect() {
  const data = new Uint8Array(readFileSync(inputFile));
  const pdf = await getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const last = Math.min(end, pdf.numPages);

  for (let pageNum = start; pageNum <= last; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    const lines = groupLines(content.items);

    console.log(`\n--- Page ${pageNum} ---`);
    for (const line of lines) {
      console.log(line);
    }
  }
}

inspect().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Official Annex 3A PDF URL (authoritative control catalogue).
const DOWNLOAD_URL =
  "https://www.cyber.gc.ca/sites/default/files/cyber/publications/itsg33-ann3a-eng.pdf";

// Resolve output paths relative to repo root.
const root = resolve(process.cwd());
const outputDir = resolve(root, "data/source");
const outputFile = resolve(outputDir, "annex-3a.pdf");
const checksumFile = resolve(outputDir, "annex-3a.pdf.sha256");

// Ensure the output folder exists.
mkdirSync(outputDir, { recursive: true });

console.log(`Downloading: ${DOWNLOAD_URL}`);
const response = await fetch(DOWNLOAD_URL);
if (!response.ok) {
  throw new Error(`Download failed: ${response.status} ${response.statusText}`);
}

// Download into a buffer so we can hash and save the file.
const arrayBuffer = await response.arrayBuffer();
const buffer = Buffer.from(arrayBuffer);

// Write a checksum so we can verify the file later.
const hash = createHash("sha256").update(buffer).digest("hex");
writeFileSync(outputFile, buffer);
writeFileSync(checksumFile, `${hash}  ${outputFile}\n`, "utf-8");

console.log(`Saved PDF: ${outputFile}`);
console.log(`SHA-256: ${hash}`);

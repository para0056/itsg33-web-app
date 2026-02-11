import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Resolve repo root relative to this script location.
const root = resolve(fileURLToPath(import.meta.url), "..", "..");

// Input PDF and output directories.
const inputFile = resolve(root, "data/source/annex-3a.pdf");
const outputDir = resolve(root, "data/controls/controls");
const indexFile = resolve(root, "data/controls/controls-index.json");

// Map of section headers we care about to output field names.
const SECTION_HEADERS = new Map([
  ["control", "statement"],
  ["supplemental guidance", "supplemental_guidance"],
  ["control enhancements", "enhancements"],
  ["related controls", "related_controls"],
  ["references", "references"],
]);

const START_MARKER = "3. Security Control Definitions";
const tocDots = /\.{2,}/;
const tocPage = /\s\d{1,3}$/;
const controlHeadingRegex = /^([A-Z]{2})\s*-\s*(\d{1,3})\s+(.+)$/;
const relatedControlsRegex = /related controls\s*:\s*([^\.]+(?:\.|$))/i;
const controlIdRegex = /\b([A-Z]{2})\s*-\s*(\d{1,3})\b/g;
const enhancementHeaderRegex = /^\((\d+)\)\s+(.+)$/;
const controlPartRegex = /^\(([A-Z])\)\s*(.+)$/;
const controlSubPartRegex = /^\(([a-z])\)\s*(.+)$/;
const SPLIT_TOKEN_FIXES = [
  [/\bARC HITECTURE\b/g, "ARCHITECTURE"],
  [/\bMON ITOR\b/g, "MONITOR"],
];

// Normalize header strings so they match our map keys.
function normalizeHeader(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// Detect TOC-style lines (dot leaders + trailing page numbers).
function isTocLine(line) {
  return tocDots.test(line) && tocPage.test(line);
}

// Normalize control IDs to "AC-2" style.
function normalizeControlId(match) {
  return `${match[1]}-${match[2]}`;
}

function hasUnbalancedOpenParen(text) {
  const opens = (text.match(/\(/g) ?? []).length;
  const closes = (text.match(/\)/g) ?? []).length;
  return opens > closes;
}

function isLikelyHeadingContinuation(line) {
  if (!line) return false;
  if (line.includes(":")) return false;
  if (controlHeadingRegex.test(line)) return false;
  return /^[A-Z0-9\s/\-()|]+$/.test(line);
}

// Extract related control IDs from a text block.
function extractRelatedControls(text) {
  if (!text) return [];
  const match = text.match(relatedControlsRegex);
  if (!match) return [];

  const ids = [];
  let idMatch;
  while ((idMatch = controlIdRegex.exec(match[1])) !== null) {
    ids.push(normalizeControlId(idMatch));
  }

  return Array.from(new Set(ids));
}

// Fix split ALL-CAPS words like "ARC HITECTURE" -> "ARCHITECTURE".
function normalizeSplitCaps(text) {
  let normalized = text;
  for (const [pattern, replacement] of SPLIT_TOKEN_FIXES) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

// Group PDF text items into lines (by y-position) and stitch them in reading order.
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

  const sorted = Array.from(linesByY.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) =>
      parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .map(normalizeSplitCaps);

  return sorted;
}

// Split the document into controls based on headings like "AC - 1 ACCESS CONTROL...".
function splitControls(lines) {
  const controls = [];
  let current = null;
  let started = false;

  for (const line of lines) {
    if (!started) {
      if (line.includes(START_MARKER)) {
        started = true;
      }
      continue;
    }

    if (isTocLine(line)) continue;

    if (
      current &&
      current.lines.length === 0 &&
      hasUnbalancedOpenParen(current.control_name) &&
      isLikelyHeadingContinuation(line)
    ) {
      current.control_name = `${current.control_name} ${line}`.replace(/\s+/g, " ").trim();
      continue;
    }

    const match = line.match(controlHeadingRegex);
    if (match) {
      if (current) controls.push(current);
      current = {
        control_id: `${match[1]}-${match[2]}`,
        control_name: match[3].trim(),
        lines: [],
      };
      continue;
    }

    if (current) current.lines.push(line);
  }

  if (current) controls.push(current);
  return controls;
}

// Partition each control into sections (statement, guidance, enhancements, etc.).
function parseSections(control) {
  const sectioned = {};
  let currentSection = null;

  for (const line of control.lines) {
    const match = line.match(/^([A-Za-z][A-Za-z ]+):\s*(.*)$/);
    if (match) {
      const header = normalizeHeader(match[1]);
      if (SECTION_HEADERS.has(header)) {
        currentSection = SECTION_HEADERS.get(header);
        if (!sectioned[currentSection]) sectioned[currentSection] = [];
        if (match[2]) sectioned[currentSection].push(match[2].trim());
        continue;
      }
    }

    if (!currentSection) {
      currentSection = "statement";
      if (!sectioned[currentSection]) sectioned[currentSection] = [];
    }

    sectioned[currentSection].push(line);
  }

  return sectioned;
}

// Parse the Control: section into ordered parts (A/B/(a)/(b)).
function parseStatementParts(lines = []) {
  const parts = [];
  let current = null;

  for (const line of lines) {
    const partMatch = line.match(controlPartRegex);
    const subPartMatch = line.match(controlSubPartRegex);

    if (partMatch) {
      if (current) parts.push(current);
      current = { id: partMatch[1], text: partMatch[2].trim(), subparts: [] };
      continue;
    }

    if (subPartMatch && current) {
      current.subparts.push({ id: subPartMatch[1], text: subPartMatch[2].trim() });
      continue;
    }

    if (current) {
      if (current.subparts.length > 0) {
        const last = current.subparts[current.subparts.length - 1];
        last.text = `${last.text} ${line}`.trim();
      } else {
        current.text = `${current.text} ${line}`.trim();
      }
    }
  }

  if (current) parts.push(current);
  return parts;
}

// Parse enhancements into structured objects with statement + optional guidance.
function parseEnhancements(lines = [], controlId) {
  const enhancements = [];
  let current = null;

  for (const line of lines) {
    const headerMatch = line.match(enhancementHeaderRegex);
    if (headerMatch) {
      if (current) enhancements.push(current);
      current = {
        enhancement_id: `${controlId}(${headerMatch[1]})`,
        title: headerMatch[2].trim(),
        statement: "",
      };
      continue;
    }

    if (!current) {
      // Skip preamble text before the first enhancement header.
      continue;
    }

    if (line.toLowerCase().startsWith("enhancement supplemental guidance")) {
      const guidance = line.split(":").slice(1).join(":").trim();
      if (guidance) current.supplemental_guidance = guidance;
      continue;
    }

    if (current.supplemental_guidance !== undefined) {
      current.supplemental_guidance =
        `${current.supplemental_guidance} ${line}`.trim();
    } else {
      current.statement = `${current.statement} ${line}`.trim();
    }
  }

  if (current) enhancements.push(current);

  return enhancements;
}

function buildKeywords(controlName, enhancements) {
  const keywords = new Set();
  if (controlName) keywords.add(controlName);

  for (const enhancement of enhancements) {
    if (enhancement.enhancement_id) keywords.add(enhancement.enhancement_id);
    if (enhancement.title) keywords.add(enhancement.title);
  }

  return Array.from(keywords);
}

// Main extraction flow: read PDF, parse controls, and write JSON outputs.
async function extract() {
  const data = new Uint8Array(readFileSync(inputFile));
  const pdf = await getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const allLines = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
    allLines.push(...groupLines(content.items));
  }

  const rawControls = splitControls(allLines);
  if (!rawControls.length) {
    throw new Error("No controls found. Check the parser or PDF version.");
  }

  mkdirSync(outputDir, { recursive: true });

  const indexMap = new Map();
  for (const control of rawControls) {
    const sections = parseSections(control);

    const supplementalGuidance = sections.supplemental_guidance
      ? sections.supplemental_guidance.join(" ")
      : undefined;

    const relatedControls = Array.from(
      new Set([
        ...extractRelatedControls(supplementalGuidance ?? ""),
        ...(Array.isArray(sections.related_controls)
          ? extractRelatedControls(sections.related_controls.join(" "))
          : []),
      ]),
    );

    const enhancements = parseEnhancements(sections.enhancements ?? [], control.control_id);
    const statementParts = parseStatementParts(sections.statement ?? []);

    const record = {
      control_id: control.control_id,
      control_name: control.control_name,
      family_id: control.control_id.split("-")[0],
      statement: sections.statement ? sections.statement.join(" ") : undefined,
      statement_parts: statementParts.length ? statementParts : undefined,
      supplemental_guidance: supplementalGuidance,
      enhancements: enhancements.length ? enhancements : undefined,
      related_controls: relatedControls.length ? relatedControls : undefined,
      references: sections.references,
      raw_text: control.lines,
    };

    indexMap.set(record.control_id, {
      control_id: record.control_id,
      control_name: record.control_name,
      family_id: record.family_id,
      aliases: [],
      keywords: buildKeywords(record.control_name, enhancements),
    });

    writeFileSync(
      resolve(outputDir, `${control.control_id}.json`),
      JSON.stringify(record, null, 2),
      "utf-8",
    );
  }

  const index = Array.from(indexMap.values());
  writeFileSync(indexFile, JSON.stringify(index, null, 2), "utf-8");

  console.log(`Extracted ${index.length} controls.`);
  console.log(`Index: ${indexFile}`);
  console.log(`Controls: ${outputDir}`);
}

extract().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

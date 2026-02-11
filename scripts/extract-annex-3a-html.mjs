import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const outputDir = resolve(root, "data/controls/controls");
const indexFile = resolve(root, "data/controls/controls-index.json");
const metadataFile = resolve(root, "data/controls/catalog-metadata.json");

const SOURCE_URL =
  "https://www.cyber.gc.ca/en/guidance/annex-3a-security-control-catalogue-itsg-33";
const SOURCE_API_URL =
  "https://www.cyber.gc.ca/api/cccs/page/v1/get?lang=en&url=/en/guidance/annex-3a-security-control-catalogue-itsg-33";

// Control headings are normalized from the CCCS HTML (e.g., "AC-2 ACCOUNT MANAGEMENT").
const controlHeadingRegex = /^([A-Z]{2})-(\d{1,3})\s+(.+)$/;
const partRegex = /^\(([A-Z]{1,2})\)\s*(.+)$/;
const subPartRegex = /^\(([a-z])\)\s*(.+)$/;
const enhancementHeaderRegex = /^\((\d+)\)\s*(.+)$/;
const controlIdRegex = /\b([A-Z]{2})-(\d{1,3})\b/g;

function cleanText(value) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function extractRelatedControls(text) {
  // Related controls are embedded in guidance prose, so we parse them from that sentence.
  const relatedMatch = text.match(/Related controls:\s*(.+?)\./i);
  if (!relatedMatch) return [];

  const ids = [];
  let match;
  while ((match = controlIdRegex.exec(relatedMatch[1])) !== null) {
    ids.push(`${match[1]}-${match[2]}`);
  }

  return Array.from(new Set(ids));
}

function numberToAlpha(value, lower = false) {
  let n = value;
  let out = "";
  while (n > 0) {
    n -= 1;
    const charCode = (lower ? 97 : 65) + (n % 26);
    out = String.fromCharCode(charCode) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function stripPartMarker(text) {
  const partMatch = text.match(partRegex);
  if (partMatch) return { id: partMatch[1], text: partMatch[2].trim() };
  const subPartMatch = text.match(subPartRegex);
  if (subPartMatch) return { id: subPartMatch[1], text: subPartMatch[2].trim() };
  return null;
}

function parseStatementList($, listElement) {
  // Preserve list structure as statement_parts so the UI can render main parts/subparts clearly.
  const parts = [];

  $(listElement)
    .children("li")
    .each((index, li) => {
      const rawValue = Number.parseInt($(li).attr("value") ?? "", 10);
      const ordinal = Number.isFinite(rawValue) ? rawValue : index + 1;
      const derivedId = numberToAlpha(ordinal);

      const partClone = $(li).clone();
      partClone.children("ol").remove();
      const partTextRaw = cleanText(partClone.text());
      const parsedPart = stripPartMarker(partTextRaw);

      const part = {
        id: parsedPart?.id ?? derivedId,
        text: parsedPart?.text ?? partTextRaw,
        subparts: [],
      };

      const subList = $(li).children("ol");
      if (subList.length) {
        subList.children("li").each((subIndex, subLi) => {
          const subRawValue = Number.parseInt($(subLi).attr("value") ?? "", 10);
          const subOrdinal = Number.isFinite(subRawValue) ? subRawValue : subIndex + 1;
          const derivedSubId = numberToAlpha(subOrdinal, true);
          const subTextRaw = cleanText($(subLi).text());
          const parsedSub = stripPartMarker(subTextRaw);
          part.subparts.push({
            id: parsedSub?.id ?? derivedSubId,
            text: parsedSub?.text ?? subTextRaw,
          });
        });
      }

      parts.push(part);
    });

  return parts;
}

function parseEnhancementList($, listElement, controlId) {
  // Enhancements come as mixed HTML (headers, paragraphs, nested lists), so parse defensively.
  const enhancements = [];

  $(listElement)
    .children("li")
    .each((index, li) => {
      const rawValue = Number.parseInt($(li).attr("value") ?? "", 10);
      const number = Number.isFinite(rawValue) ? rawValue : index + 1;

      const headerClone = $(li).clone();
      headerClone.children("p").remove();
      headerClone.children("ol").remove();
      const headerRaw = cleanText(headerClone.text());
      const headerMatch = headerRaw.match(enhancementHeaderRegex);
      const title = headerMatch ? headerMatch[2].trim() : headerRaw;

      const record = {
        enhancement_id: `${controlId}(${headerMatch?.[1] ?? number})`,
        title: title || undefined,
        statement: "",
      };

      const statementParts = [];
      const guidanceParts = [];
      const paragraphs = $(li).children("p");
      const nestedStatements = $(li).children("ol");

      if (nestedStatements.length) {
        nestedStatements.children("li").each((_, nestedLi) => {
          const line = cleanText($(nestedLi).text());
          if (line) statementParts.push(line);
        });
      }

      if (!paragraphs.length && headerRaw && !headerRaw.includes("|")) {
        record.statement = headerRaw;
      }

      paragraphs.each((_, p) => {
        const line = cleanText($(p).text());
        if (!line) return;
        if (/^Enhancement Supplemental Guidance\s*:*/i.test(line)) {
          const guidance = line.replace(/^Enhancement Supplemental Guidance\s*:*/i, "").trim();
          if (guidance) guidanceParts.push(guidance);
          return;
        }

        if (guidanceParts.length) {
          guidanceParts.push(line);
        } else {
          statementParts.push(line);
        }
      });

      if (statementParts.length) {
        record.statement = statementParts.join(" ").trim();
      }
      if (guidanceParts.length) {
        record.supplemental_guidance = guidanceParts.join(" ").trim();
      }

      enhancements.push(record);
    });

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

async function fetchSourcePage() {
  const response = await fetch(SOURCE_API_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch source HTML: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const page = payload?.response?.page;
  const bodyHtml = page?.body?.[0];
  if (!bodyHtml || typeof bodyHtml !== "string") {
    throw new Error("Unexpected API response shape: page body missing");
  }

  return {
    page,
    bodyHtml,
  };
}

function extractCatalogMetadata(page, bodyHtml) {
  const $ = load(bodyHtml);
  const allText = cleanText($("body").text());
  const monthRegex =
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i;
  const versionRegex = /\b(?:version|revision)\s*([0-9]+(?:\.[0-9]+)*)\b/i;
  const annexRegex = /\bAnnex\s+([0-9]+[A-Z]?)\b/i;

  const paragraphTexts = $("p")
    .toArray()
    .map((paragraph) => cleanText($(paragraph).text()))
    .filter(Boolean);

  const revisionDate =
    paragraphTexts.find((text) => monthRegex.test(text))?.match(monthRegex)?.[0] ??
    allText.match(monthRegex)?.[0] ??
    null;

  const title = cleanText(page?.title ?? "");
  const revisionNumber = (title.match(versionRegex) ?? allText.match(versionRegex))?.[1] ?? null;
  const annexEdition = (title.match(annexRegex) ?? allText.match(annexRegex))?.[1] ?? null;

  return {
    catalog_title: title || null,
    catalog_edition: annexEdition ? `Annex ${annexEdition}` : null,
    catalog_revision_number: revisionNumber,
    catalog_revision_date: revisionDate,
    source_url: SOURCE_URL,
    source_api_url: SOURCE_API_URL,
    page_date_modified: page?.date_modified ?? null,
    page_date_created: page?.date_created ?? null,
    extracted_at: new Date().toISOString(),
  };
}

function parseControlsFromHtml(bodyHtml) {
  const $ = load(bodyHtml);
  const controls = [];

  const headings = $("h4").toArray();
  for (const heading of headings) {
    const headingText = cleanText($(heading).text());
    const match = headingText.match(controlHeadingRegex);
    if (!match) continue;

    const controlId = `${match[1]}-${match[2]}`;
    const controlName = match[3].trim();

    const blockNodes = [];
    let node = $(heading).next();
    while (node.length) {
      if (node.is("h4") && controlHeadingRegex.test(cleanText(node.text()))) {
        break;
      }
      blockNodes.push(node);
      node = node.next();
    }

    const statementLines = [];
    const statementParts = [];
    const supplementalGuidance = [];
    const references = [];
    let enhancements = [];
    let section = null;

    for (const nodeEl of blockNodes) {
      const tag = nodeEl[0]?.tagName?.toLowerCase();
      if (!tag) continue;

      if (tag === "p") {
        const text = cleanText(nodeEl.text());
        if (!text) continue;

        if (/^Control:\s*$/i.test(text)) {
          section = "statement";
          continue;
        }

        if (/^Supplemental Guidance\s*:/i.test(text)) {
          section = "supplemental_guidance";
          const value = text.replace(/^Supplemental Guidance\s*:/i, "").trim();
          if (value) supplementalGuidance.push(value);
          continue;
        }

        if (/^Control Enhancements:\s*$/i.test(text)) {
          section = "enhancements";
          continue;
        }

        if (/^References:\s*$/i.test(text)) {
          section = "references";
          continue;
        }

        if (section === "statement") statementLines.push(text);
        if (section === "supplemental_guidance") supplementalGuidance.push(text);
        if (section === "references") references.push(text);
        continue;
      }

      if (tag === "ol" && section === "statement") {
        const parsedParts = parseStatementList($, nodeEl);
        for (const part of parsedParts) {
          statementParts.push(part);
          if (part.text) statementLines.push(part.text);
          for (const sub of part.subparts ?? []) {
            if (sub.text) statementLines.push(sub.text);
          }
        }
        continue;
      }

      if (tag === "ol" && section === "enhancements") {
        enhancements = enhancements.concat(parseEnhancementList($, nodeEl, controlId));
        continue;
      }

      if (tag === "ul" && section === "references") {
        nodeEl
          .children("li")
          .each((_, li) => {
            const text = cleanText($(li).text());
            if (text) references.push(text);
          });
        continue;
      }
    }

    const statement = statementLines.join(" ").trim();
    const guidanceText = supplementalGuidance.join(" ").trim();
    const relatedControls = extractRelatedControls(guidanceText);

    controls.push({
      control_id: controlId,
      control_name: controlName,
      family_id: match[1],
      statement: statement || undefined,
      statement_parts: statementParts.length ? statementParts : undefined,
      supplemental_guidance: guidanceText || undefined,
      enhancements: enhancements.length ? enhancements : undefined,
      related_controls: relatedControls.length ? relatedControls : undefined,
      references: references.length ? references : undefined,
      source_url: SOURCE_URL,
      source_type: "html",
    });
  }

  return controls;
}

async function run() {
  const { page, bodyHtml } = await fetchSourcePage();
  const controls = parseControlsFromHtml(bodyHtml);
  const catalogMetadata = extractCatalogMetadata(page, bodyHtml);

  if (!controls.length) {
    throw new Error("No controls parsed from HTML source");
  }

  mkdirSync(outputDir, { recursive: true });

  const index = controls.map((control) => ({
    control_id: control.control_id,
    control_name: control.control_name,
    family_id: control.family_id,
    aliases: [],
    // Keep index keywords small and stable: control name + enhancement IDs/titles.
    keywords: buildKeywords(control.control_name, control.enhancements ?? []),
  }));

  for (const control of controls) {
    writeFileSync(
      resolve(outputDir, `${control.control_id}.json`),
      JSON.stringify(control, null, 2),
      "utf-8",
    );
  }

  writeFileSync(indexFile, JSON.stringify(index, null, 2), "utf-8");
  writeFileSync(metadataFile, JSON.stringify(catalogMetadata, null, 2), "utf-8");

  console.log(`Extracted ${controls.length} controls from HTML source.`);
  console.log(`Index: ${indexFile}`);
  console.log(`Metadata: ${metadataFile}`);
  console.log(`Controls: ${outputDir}`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

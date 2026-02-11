import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repoRoot = resolve(__dirname, "..");
const controlsDir = join(repoRoot, "data", "controls", "controls");
const outputCsv = join(repoRoot, "data", "controls", "assignments.csv");
const assignmentPattern = /\[Assignment:[^\]]+\]/gi;

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function normalizeSpaces(text) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeAssignment(text) {
  return normalizeSpaces(text);
}

function parseAssignmentTopic(assignment) {
  const inner = assignment.replace(/^\[/, "").replace(/\]$/, "");
  const withoutPrefix = inner.replace(/^Assignment:\s*/i, "").trim();
  return withoutPrefix.replace(/^organization-defined\s*/i, "").trim();
}

function categorizeTopic(topic) {
  const t = topic.toLowerCase();

  if (t.includes("frequency")) return "cadence";
  if (t.includes("time period") || t.includes("timeframe") || t.includes("period of time")) {
    return "time_window";
  }
  if (t.includes("personnel") || t.includes("roles") || t.includes("individuals")) {
    return "roles_responsibilities";
  }
  if (t.includes("number") || t.includes("threshold") || t.includes("limit")) return "threshold";
  if (t.includes("condition") || t.includes("criteria") || t.includes("circumstances")) {
    return "conditions";
  }
  if (t.includes("action") || t.includes("procedure") || t.includes("step")) return "actions";
  if (
    t.includes("security safeguard") ||
    t.includes("security control") ||
    t.includes("security function") ||
    t.includes("security attribute")
  ) {
    return "security_specification";
  }
  if (
    t.includes("component") ||
    t.includes("system") ||
    t.includes("device") ||
    t.includes("media") ||
    t.includes("account") ||
    t.includes("application") ||
    t.includes("service")
  ) {
    return "scope_inventory";
  }
  if (t.includes("external organization") || t.includes("provider")) {
    return "external_parties";
  }
  if (t.includes("test") || t.includes("assessment")) return "validation";

  return "general";
}

function guidanceForCategory(category, topic) {
  const commonTail = "Capture owner, rationale, and evidence in policy/procedure artifacts.";

  switch (category) {
    case "cadence":
      return {
        guidance:
          "Set an explicit cadence and trigger events so the activity occurs on a predictable schedule.",
        minimumFields: "cadence|trigger|owner|evidence",
        example:
          "Quarterly and within 30 days of major system change; owner: IT Security Manager; evidence: review ticket.",
      };
    case "time_window":
      return {
        guidance:
          "Specify exact duration and boundary conditions (start event, stop event, and exceptions).",
        minimumFields: "duration|start_trigger|end_trigger|exceptions|owner",
        example: "Within 24 hours of detection; exception for emergency outage approved by CISO.",
      };
    case "roles_responsibilities":
      return {
        guidance:
          "Name accountable roles (not just teams), decision authority, and required approvals.",
        minimumFields: "primary_role|approver|backup_role|responsibilities",
        example:
          "System Owner requests, ISSO approves, IAM Admin executes, SOC verifies closure.",
      };
    case "threshold":
      return {
        guidance: "Define a measurable threshold with unit, rationale, and escalation path.",
        minimumFields: "threshold_value|unit|rationale|escalation",
        example: "5 failed logins in 15 minutes triggers account lock and SOC alert.",
      };
    case "conditions":
      return {
        guidance:
          "Document objective if/then criteria and data sources used to evaluate the condition.",
        minimumFields: "condition_logic|data_source|decision_owner",
        example: "If external connection is untrusted, require MFA and managed device posture check.",
      };
    case "actions":
      return {
        guidance: "List concrete actions, responsible role, SLA, and completion evidence.",
        minimumFields: "action_steps|owner|sla|evidence",
        example: "Disable account, notify manager, create incident record, and verify lockout.",
      };
    case "security_specification":
      return {
        guidance:
          "Define the control/safeguard set, required configuration baseline, and verification method.",
        minimumFields: "control_set|configuration_standard|owner|verification_method",
        example: "Apply CIS benchmark L1, enforce via GPO, validate weekly with compliance scan.",
      };
    case "scope_inventory":
      return {
        guidance:
          "Enumerate in-scope assets/components with identifiers and include/exclude boundaries.",
        minimumFields: "asset_list|identifier_source|scope_boundaries|owner",
        example: "All internet-facing servers tagged ENV=prod in CMDB; excludes lab environment.",
      };
    case "external_parties":
      return {
        guidance:
          "List external organizations, trust boundaries, contacts, and governing agreements.",
        minimumFields: "organization_name|service_scope|contact|agreement_reference",
        example: "MSSP ABC, SIEM monitoring scope, 24x7 SOC contact, contract section 4.2.",
      };
    case "validation":
      return {
        guidance:
          "Define how testing/assessment is performed, pass criteria, and remediation workflow.",
        minimumFields: "method|frequency|pass_criteria|remediation_owner",
        example: "Monthly vuln scan; pass = no critical findings older than 14 days.",
      };
    default:
      return {
        guidance: `Specify organization-specific values for "${topic}" in measurable terms. ${commonTail}`,
        minimumFields: "defined_value|owner|rationale|evidence",
        example: "Documented in control profile with approval date and evidence location.",
      };
  }
}

function extractSnippet(text, assignment) {
  const flattened = normalizeSpaces(text);
  if (!flattened) return "";

  const idx = flattened.toLowerCase().indexOf(assignment.toLowerCase());
  if (idx === -1) {
    return flattened.slice(0, 220);
  }

  const start = Math.max(0, idx - 80);
  const end = Math.min(flattened.length, idx + assignment.length + 80);
  const snippet = flattened.slice(start, end);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < flattened.length ? "..." : "";
  return `${prefix}${snippet}${suffix}`;
}

function walk(value, path, onString) {
  if (typeof value === "string") {
    onString(path, value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, onString));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      walk(item, childPath, onString);
    }
  }
}

function collectAssignmentsInScope(scopeData) {
  const map = new Map();

  walk(scopeData, "", (path, text) => {
    const matches = text.match(assignmentPattern);
    if (!matches) return;

    for (const raw of matches) {
      const assignment = normalizeAssignment(raw);
      const current = map.get(assignment) ?? {
        count: 0,
        locations: new Set(),
        snippet: "",
      };

      current.count += 1;
      current.locations.add(path || "root");
      if (!current.snippet) {
        current.snippet = extractSnippet(text, assignment);
      }

      map.set(assignment, current);
    }
  });

  return map;
}

function buildRowsForControl(control) {
  const rows = [];
  const enhancements = Array.isArray(control.enhancements) ? control.enhancements : [];

  const controlScope = { ...control };
  delete controlScope.enhancements;

  const controlAssignments = collectAssignmentsInScope(controlScope);
  for (const [assignment, stats] of controlAssignments.entries()) {
    const topic = parseAssignmentTopic(assignment);
    const category = categorizeTopic(topic);
    const guidance = guidanceForCategory(category, topic);

    rows.push({
      control_id: control.control_id,
      control_name: control.control_name ?? "",
      enhancement_id: "",
      enhancement_title: "",
      assignment_placeholder: assignment,
      assignment_topic: topic,
      category,
      occurrence_count: stats.count,
      locations: Array.from(stats.locations).sort().join("|"),
      concise_guidance: guidance.guidance,
      minimum_fields: guidance.minimumFields,
      example_value: guidance.example,
      source_excerpt: stats.snippet,
    });
  }

  for (const enhancement of enhancements) {
    const enhancementAssignments = collectAssignmentsInScope(enhancement);
    for (const [assignment, stats] of enhancementAssignments.entries()) {
      const topic = parseAssignmentTopic(assignment);
      const category = categorizeTopic(topic);
      const guidance = guidanceForCategory(category, topic);

      rows.push({
        control_id: control.control_id,
        control_name: control.control_name ?? "",
        enhancement_id: enhancement.enhancement_id ?? "",
        enhancement_title: enhancement.title ?? "",
        assignment_placeholder: assignment,
        assignment_topic: topic,
        category,
        occurrence_count: stats.count,
        locations: Array.from(stats.locations).sort().join("|"),
        concise_guidance: guidance.guidance,
        minimum_fields: guidance.minimumFields,
        example_value: guidance.example,
        source_excerpt: stats.snippet,
      });
    }
  }

  return rows;
}

function compareRows(a, b) {
  if (a.control_id !== b.control_id) return a.control_id.localeCompare(b.control_id);
  if (a.enhancement_id !== b.enhancement_id) return a.enhancement_id.localeCompare(b.enhancement_id);
  return a.assignment_placeholder.localeCompare(b.assignment_placeholder);
}

function run() {
  const files = readdirSync(controlsDir)
    .filter((name) => extname(name) === ".json")
    .sort();

  const rows = [];
  for (const file of files) {
    const fullPath = join(controlsDir, file);
    const parsed = JSON.parse(readFileSync(fullPath, "utf8"));
    if (!parsed || typeof parsed !== "object") continue;

    if (!parsed.control_id) {
      parsed.control_id = basename(file, ".json");
    }

    rows.push(...buildRowsForControl(parsed));
  }

  rows.sort(compareRows);

  const headers = [
    "control_id",
    "control_name",
    "enhancement_id",
    "enhancement_title",
    "assignment_placeholder",
    "assignment_topic",
    "category",
    "occurrence_count",
    "locations",
    "concise_guidance",
    "minimum_fields",
    "example_value",
    "source_excerpt",
  ];

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  }

  writeFileSync(outputCsv, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${rows.length} assignment guidance rows to ${outputCsv}`);
}

run();

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const outputDir = resolve(root, "apps/web/public/api/controls");

mkdirSync(outputDir, { recursive: true });

const controls = [
  {
    control_id: "AC-2",
    control_name: "Account Management",
    family_id: "AC",
    aliases: ["onboarding", "offboarding", "JML"],
    keywords: ["account", "provisioning", "deprovisioning"],
    statement:
      "The organization manages information system accounts, including establishing, activating, modifying, reviewing, disabling, and removing accounts.",
    statement_parts: [
      "Identify account types and authorized users.",
      "Specify account access conditions and privileges.",
      "Review accounts at least annually.",
    ],
    supplemental_guidance:
      "Account management includes provisioning, deprovisioning, and periodic review of privileges.",
    enhancements: [
      {
        enhancement_id: "AC-2(1)",
        statement:
          "The organization employs automated mechanisms to support account management.",
      },
    ],
    examples: [
      {
        description: "Use automated provisioning workflows for new hires.",
        context: "Illustrative example only",
        confidence: "illustrative",
      },
    ],
    source_anchors: ["https://www.cyber.gc.ca/en/guidance/itsg-33"],
  },
  {
    control_id: "IA-2",
    control_name: "Identification and Authentication (Organizational Users)",
    family_id: "IA",
    aliases: ["MFA", "login", "authentication"],
    keywords: ["identity", "credentials"],
    statement: "The organization uniquely identifies and authenticates organizational users.",
    statement_parts: [
      "Uniquely identify organizational users.",
      "Authenticate organizational users prior to system access.",
    ],
    supplemental_guidance:
      "Authentication may include multi-factor methods where appropriate.",
    enhancements: [
      {
        enhancement_id: "IA-2(1)",
        statement:
          "The organization uses multi-factor authentication for privileged accounts.",
      },
    ],
    examples: [
      {
        description: "Require MFA for administrative access to cloud consoles.",
        context: "Illustrative example only",
        confidence: "illustrative",
      },
    ],
    source_anchors: ["https://www.cyber.gc.ca/en/guidance/itsg-33"],
  },
  {
    control_id: "CM-2",
    control_name: "Baseline Configuration",
    family_id: "CM",
    aliases: ["baseline", "configuration"],
    keywords: ["standard", "build"],
    statement:
      "The organization develops, documents, and maintains a current baseline configuration of the information system.",
    statement_parts: ["Establish baseline configuration.", "Review baseline periodically."],
    supplemental_guidance:
      "Baselines include hardware, software, and configuration settings.",
    enhancements: [
      {
        enhancement_id: "CM-2(1)",
        statement:
          "The organization reviews and updates the baseline configuration annually or when required.",
      },
    ],
    examples: [
      {
        description: "Use infrastructure-as-code to define system baselines.",
        context: "Illustrative example only",
        confidence: "illustrative",
      },
    ],
    source_anchors: ["https://www.cyber.gc.ca/en/guidance/itsg-33"],
  },
];

const index = controls.map((control) => ({
  control_id: control.control_id,
  control_name: control.control_name,
  family_id: control.family_id,
  aliases: control.aliases,
  keywords: control.keywords,
}));

writeFileSync(
  resolve(outputDir, "index"),
  JSON.stringify(index, null, 2),
  "utf-8",
);

for (const control of controls) {
  writeFileSync(
    resolve(outputDir, `${control.control_id}.json`),
    JSON.stringify(control, null, 2),
    "utf-8",
  );
}

console.log(`Wrote ${controls.length} controls to ${outputDir}`);

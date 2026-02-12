import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { fetchCatalogMetadata, fetchControl, fetchIndex } from "./api";
import type { CatalogMetadata, ControlIndexItem, ControlRecord } from "./types";

type LoadState = "idle" | "loading" | "success" | "error";

type StatementPart = {
  id: string;
  text: string;
  subparts?: Array<{ id: string; text: string }>;
};

type Enhancement = {
  enhancement_id?: string;
  title?: string;
  statement?: string;
  supplemental_guidance?: string;
};

// Rotated examples shown under the search box on each refresh.
const SEARCH_HINT_POOL = [
  "AC-2",
  "least privilege",
  "SI-4(12)",
  "remote access",
  "incident response",
  "audit",
  "SC-7",
  "CM-8",
  "wireless",
  "cryptographic protection",
];
const ASSIGNMENT_PATTERN = /\[Assignment:[^\]]+\]/gi;
const SOURCE_DATA_URL =
  "https://www.cyber.gc.ca/en/guidance/annex-3a-security-control-catalogue-itsg-33";

type SelectOptions = {
  updateUrl?: "push" | "replace" | "none";
  enhancementId?: string | null;
};

type AssignmentGuidance = {
  topic: string;
  concise: string;
  minimumFields: string;
  example: string;
};

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalControlId(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function canonicalEnhancementId(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9()]+/g, "");
}

function parseAssignmentTopic(assignment: string): string {
  const inner = assignment.replace(/^\[/, "").replace(/\]$/, "");
  const withoutPrefix = inner.replace(/^Assignment:\s*/i, "").trim();
  return withoutPrefix.replace(/^organization-defined\s*/i, "").trim();
}

function categorizeAssignmentTopic(topic: string): string {
  const value = topic.toLowerCase();

  if (value.includes("frequency")) return "cadence";
  if (value.includes("time period") || value.includes("timeframe")) return "time_window";
  if (value.includes("personnel") || value.includes("roles") || value.includes("individuals")) {
    return "roles_responsibilities";
  }
  if (value.includes("number") || value.includes("threshold") || value.includes("limit")) {
    return "threshold";
  }
  if (value.includes("condition") || value.includes("criteria") || value.includes("circumstances")) {
    return "conditions";
  }
  if (value.includes("action") || value.includes("procedure") || value.includes("step")) {
    return "actions";
  }
  if (
    value.includes("security safeguard") ||
    value.includes("security control") ||
    value.includes("security function") ||
    value.includes("security attribute")
  ) {
    return "security_specification";
  }
  if (
    value.includes("component") ||
    value.includes("system") ||
    value.includes("device") ||
    value.includes("media") ||
    value.includes("account") ||
    value.includes("application") ||
    value.includes("service")
  ) {
    return "scope_inventory";
  }
  if (value.includes("external organization") || value.includes("provider")) {
    return "external_parties";
  }
  if (value.includes("test") || value.includes("assessment")) return "validation";

  return "general";
}

function buildAssignmentGuidance(assignment: string): AssignmentGuidance {
  // Heuristic helper text for UX only. It is intentionally generic and non-authoritative.
  const topic = parseAssignmentTopic(assignment);
  const category = categorizeAssignmentTopic(topic);

  switch (category) {
    case "cadence":
      return {
        topic,
        concise: "Set an explicit cadence and trigger events so this activity runs predictably.",
        minimumFields: "cadence, trigger, owner, evidence",
        example: "Quarterly and within 30 days of major system change.",
      };
    case "time_window":
      return {
        topic,
        concise: "Define exact timing boundaries: start trigger, duration, and exceptions.",
        minimumFields: "duration, start trigger, end trigger, exceptions, owner",
        example: "Within 24 hours of detection; exception requires CISO approval.",
      };
    case "roles_responsibilities":
      return {
        topic,
        concise: "Name accountable roles and approval authority, not only team names.",
        minimumFields: "primary role, approver, backup role, responsibilities",
        example: "System Owner requests; ISSO approves; IAM Admin executes.",
      };
    case "threshold":
      return {
        topic,
        concise: "Define a measurable threshold with unit and escalation action.",
        minimumFields: "threshold value, unit, rationale, escalation",
        example: "5 failed logins in 15 minutes triggers lockout and SOC alert.",
      };
    case "conditions":
      return {
        topic,
        concise: "Document objective if/then criteria and data used to evaluate them.",
        minimumFields: "condition logic, data source, decision owner",
        example: "If remote access is untrusted, enforce MFA and managed device checks.",
      };
    case "actions":
      return {
        topic,
        concise: "List concrete actions, responsible role, SLA, and required evidence.",
        minimumFields: "action steps, owner, SLA, evidence",
        example: "Disable account, notify manager, open incident, verify closure.",
      };
    case "security_specification":
      return {
        topic,
        concise: "Specify safeguards/controls and the baseline configuration to enforce them.",
        minimumFields: "control set, configuration standard, owner, verification method",
        example: "Apply CIS L1 baseline and validate weekly with compliance scans.",
      };
    case "scope_inventory":
      return {
        topic,
        concise: "Enumerate in-scope systems/components with clear include/exclude boundaries.",
        minimumFields: "asset list, identifier source, scope boundaries, owner",
        example: "All internet-facing production servers from CMDB; lab excluded.",
      };
    case "external_parties":
      return {
        topic,
        concise: "Identify external parties, contacts, trust boundaries, and agreements.",
        minimumFields: "organization, scope, contact, agreement reference",
        example: "MSSP monitoring provider with 24x7 SOC contact and contract clause reference.",
      };
    case "validation":
      return {
        topic,
        concise: "Define test/assessment method, success criteria, and remediation process.",
        minimumFields: "method, frequency, pass criteria, remediation owner",
        example: "Monthly scan; no critical findings older than 14 days.",
      };
    default:
      return {
        topic,
        concise: "Define this value in measurable terms and document ownership and rationale.",
        minimumFields: "defined value, owner, rationale, evidence",
        example: "Recorded in control profile with approval date and evidence location.",
      };
  }
}

function formatLastUpdated(lastUpdated: string | null): string {
  if (!lastUpdated) return "Unknown";

  const parsed = new Date(lastUpdated);
  if (Number.isNaN(parsed.getTime())) return lastUpdated;
  return parsed.toLocaleString();
}

function formatCatalogRevision(metadata: CatalogMetadata | null): string | null {
  if (!metadata) return null;

  const parts = [];
  if (metadata.catalog_edition) parts.push(metadata.catalog_edition);
  if (metadata.catalog_revision_number) parts.push(`Revision ${metadata.catalog_revision_number}`);
  if (metadata.catalog_revision_date) parts.push(metadata.catalog_revision_date);

  if (!parts.length) return null;
  return parts.join(" \u2022 ");
}

function getRepoUrl(): string | null {
  const configured = import.meta.env.VITE_REPO_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (typeof window === "undefined") return null;

  const hostMatch = window.location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (!hostMatch) return null;

  const owner = hostMatch[1];
  const firstPathSegment = window.location.pathname.split("/").filter(Boolean)[0];
  if (!firstPathSegment) {
    return `https://github.com/${owner}/${owner}.github.io`;
  }

  return `https://github.com/${owner}/${firstPathSegment}`;
}

function enhancementAnchorId(value: string): string {
  return `enh-${value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

function formatItem(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return String(value ?? "");

  const record = value as Record<string, unknown>;
  const parts = [
    record.enhancement_id ?? record.id ?? record.control_id,
    record.text ?? record.statement ?? record.description,
    record.context,
  ].filter(Boolean);

  return parts.map(String).join(" ");
}

function renderTextWithAssignments(text: string): ReactNode {
  const matches = Array.from(text.matchAll(ASSIGNMENT_PATTERN));
  if (!matches.length) return text;

  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.index === undefined) continue;
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    nodes.push(
      <AssignmentToken key={`assignment-${match.index}`} assignment={match[0]} />,
    );

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return <>{nodes}</>;
}

function AssignmentToken({ assignment }: { assignment: string }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const guidance = useMemo(() => buildAssignmentGuidance(assignment), [assignment]);

  useEffect(() => {
    if (!pinned) return;

    function onDocumentMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setPinned(false);
    }

    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [pinned]);

  const showPopover = hovered || pinned;

  return (
    <span
      ref={rootRef}
      className="assignment-token-wrap"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className={`assignment-token-btn ${pinned ? "is-pinned" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          setPinned((value) => !value);
        }}
      >
        <strong className="assignment-token">{assignment}</strong>
      </button>
      {showPopover && (
        <div className="assignment-popover" role="note">
          <p className="assignment-popover-title">What to define</p>
          <p>{guidance.concise}</p>
          <p>
            <strong>Topic:</strong> {guidance.topic}
          </p>
          <p>
            <strong>Minimum fields:</strong> {guidance.minimumFields}
          </p>
          <p>
            <strong>Example:</strong> {guidance.example}
          </p>
        </div>
      )}
    </span>
  );
}

function pickRandomHints(items: string[], count: number): string[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, Math.max(0, Math.min(count, shuffled.length)));
}

function resolveControlIdFromIndex(value: string, items: ControlIndexItem[]): string | null {
  const canonical = canonicalControlId(value);
  const exact = items.find((item) => canonicalControlId(item.control_id) === canonical);
  return exact?.control_id ?? null;
}

function readUrlSelection(): { controlId: string | null; enhancementId: string | null } {
  if (typeof window === "undefined") {
    return { controlId: null, enhancementId: null };
  }

  const params = new URLSearchParams(window.location.search);
  const controlId = params.get("control")?.trim() || null;
  const enhancementId = params.get("enhancement")?.trim() || null;

  return { controlId, enhancementId };
}

function buildSelectionUrl(controlId: string, enhancementId: string | null = null): URL {
  const url = new URL(window.location.href);
  url.searchParams.set("control", controlId);
  if (enhancementId) {
    url.searchParams.set("enhancement", enhancementId);
    url.hash = enhancementAnchorId(enhancementId);
  } else {
    url.searchParams.delete("enhancement");
    url.hash = "";
  }
  return url;
}

function writeSelectionUrl(
  controlId: string,
  enhancementId: string | null,
  mode: "push" | "replace",
): void {
  if (typeof window === "undefined") return;
  const url = buildSelectionUrl(controlId, enhancementId);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "replace") {
    window.history.replaceState({}, "", next);
  } else {
    window.history.pushState({}, "", next);
  }
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Fallback for older browsers or insecure contexts where Clipboard API is unavailable.
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function renderStatementParts(parts: unknown[]) {
  return parts.map((part, index) => {
    const item = part as StatementPart;
    const label = item?.id ? `(${item.id}) ` : "";
    const subparts = Array.isArray(item?.subparts) ? item.subparts : [];

    return (
      <li key={`statement-part-${index}`}>
        {label}
        {item?.text ? renderTextWithAssignments(item.text) : String(part)}
        {subparts.length > 0 && (
          <ul>
            {subparts.map((subpart, subIndex) => (
              <li key={`statement-subpart-${index}-${subIndex}`}>
                ({subpart.id}) {renderTextWithAssignments(subpart.text)}
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  });
}

function renderEnhancements(
  items: unknown[],
  options: {
    controlId: string;
    copiedKey: string | null;
    onCopyEnhancementLink: (enhancementId: string) => void;
  },
) {
  return items.map((item, index) => {
    if (typeof item === "string") {
      return (
        <div key={`enh-${index}`} className="enhancement-card">
          <p>{renderTextWithAssignments(item)}</p>
        </div>
      );
    }

    const enhancement = item as Enhancement;
    const enhancementId = enhancement.enhancement_id ?? null;
    const anchorId = enhancementId ? enhancementAnchorId(enhancementId) : undefined;
    const copyKey = enhancementId ? `${options.controlId}:${canonicalEnhancementId(enhancementId)}` : null;

    return (
      <div key={`enh-${index}`} className="enhancement-card" id={anchorId}>
        <div className="enhancement-header">
          <div className="enhancement-heading">
            <span className="enhancement-id">
              {enhancement.enhancement_id ?? "Enhancement"}
            </span>
            {enhancement.title && <span className="enhancement-title">{enhancement.title}</span>}
          </div>
          {enhancementId && (
            <button
              type="button"
              className="copy-link-btn copy-link-btn-small"
              onClick={() => options.onCopyEnhancementLink(enhancementId)}
            >
              {options.copiedKey === copyKey ? "Copied" : "Link"}
            </button>
          )}
        </div>
        {enhancement.statement && (
          <p className="enhancement-statement">{renderTextWithAssignments(enhancement.statement)}</p>
        )}
        {enhancement.supplemental_guidance && (
          <p className="enhancement-guidance">
            {renderTextWithAssignments(enhancement.supplemental_guidance)}
          </p>
        )}
      </div>
    );
  });
}

export default function App() {
  const [searchExamples] = useState(() => pickRandomHints(SEARCH_HINT_POOL, 3));
  const enhancementsRef = useRef<HTMLElement | null>(null);
  const [index, setIndex] = useState<ControlIndexItem[]>([]);
  const [indexLastUpdated, setIndexLastUpdated] = useState<string | null>(null);
  const [catalogMetadata, setCatalogMetadata] = useState<CatalogMetadata | null>(null);
  const [indexState, setIndexState] = useState<LoadState>("idle");
  const [indexError, setIndexError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [control, setControl] = useState<ControlRecord | null>(null);
  const [controlState, setControlState] = useState<LoadState>("idle");
  const [controlError, setControlError] = useState<string | null>(null);
  const [pendingEnhancementId, setPendingEnhancementId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadIndex() {
      setIndexState("loading");
      setIndexError(null);

      try {
        const [indexResult, metadataResult] = await Promise.all([
          fetchIndex(),
          fetchCatalogMetadata().catch(() => null),
        ]);
        if (!cancelled) {
          setIndex(indexResult.items);
          setIndexLastUpdated(indexResult.lastUpdated);
          setCatalogMetadata(metadataResult);
          setIndexState("success");
        }
      } catch (err) {
        if (!cancelled) {
          setIndexError(String(err));
          setIndexState("error");
        }
      }
    }

    loadIndex();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!copiedKey) return;
    const timeoutId = window.setTimeout(() => setCopiedKey(null), 1200);
    return () => window.clearTimeout(timeoutId);
  }, [copiedKey]);

  const shown = useMemo(() => {
    const trimmed = normalizeText(query);
    if (!trimmed) return index;

    const rawQuery = query.trim();
    const rawQueryLower = rawQuery.toLowerCase();
    const canonicalQuery = canonicalControlId(rawQuery);
    const tokens = trimmed.split(/\s+/g).filter(Boolean);

    return index
      .map((item, originalIndex) => {
        const haystack = normalizeText(
          [
            item.control_id,
            item.control_name,
            ...(item.aliases ?? []),
            ...(item.keywords ?? []),
          ].join(" "),
        );

        if (!tokens.every((token) => haystack.includes(token))) {
          return null;
        }

        const controlIdLower = item.control_id.toLowerCase();
        const canonicalItemId = canonicalControlId(item.control_id);
        let score = 0;

        // ID matches should dominate ranking so direct lookups (e.g., SI-4) appear first.
        if (canonicalQuery && canonicalItemId === canonicalQuery) {
          score += 1000;
        } else if (canonicalQuery && canonicalItemId.startsWith(canonicalQuery)) {
          score += 500;
        }

        if (rawQueryLower && controlIdLower === rawQueryLower) {
          score += 300;
        } else if (rawQueryLower && controlIdLower.startsWith(rawQueryLower)) {
          score += 150;
        }

        score += tokens.filter((token) => normalizeText(item.control_id).includes(token)).length * 25;

        return { item, score, originalIndex };
      })
      .filter((entry): entry is { item: ControlIndexItem; score: number; originalIndex: number } =>
        Boolean(entry),
      )
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.originalIndex - right.originalIndex;
      })
      .map((entry) => entry.item);
  }, [index, query]);

  const handleSelect = useCallback(async (controlId: string, options: SelectOptions = {}) => {
    const { updateUrl = "push", enhancementId = null } = options;
    setSelectedId(controlId);
    setControlState("loading");
    setControlError(null);
    setPendingEnhancementId(enhancementId);

    if (updateUrl !== "none") {
      writeSelectionUrl(controlId, enhancementId, updateUrl);
    }

    try {
      const data = await fetchControl(controlId);
      setControl(data);
      setControlState("success");
    } catch (err) {
      setControl(null);
      setControlError(String(err));
      setControlState("error");
    }
  }, []);

  useEffect(() => {
    if (indexState !== "success") return;

    // On initial load, hydrate selected control/enhancement from URL query params.
    const { controlId, enhancementId } = readUrlSelection();
    if (!controlId) return;

    const resolvedControlId = resolveControlIdFromIndex(controlId, index) ?? controlId;
    void handleSelect(resolvedControlId, {
      updateUrl: "replace",
      enhancementId,
    });
  }, [index, indexState, handleSelect]);

  useEffect(() => {
    // Keep browser back/forward navigation in sync with current control selection.
    function onPopState() {
      const { controlId, enhancementId } = readUrlSelection();
      if (!controlId) {
        setSelectedId(null);
        setControl(null);
        setControlState("idle");
        setPendingEnhancementId(null);
        return;
      }

      const resolvedControlId = resolveControlIdFromIndex(controlId, index) ?? controlId;
      void handleSelect(resolvedControlId, {
        updateUrl: "none",
        enhancementId,
      });
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [handleSelect, index]);

  useEffect(() => {
    if (controlState !== "success" || !pendingEnhancementId) return;

    // Defer until the enhancement cards are rendered, then smooth-scroll to the target.
    const timeoutId = window.setTimeout(() => {
      const target = document.getElementById(enhancementAnchorId(pendingEnhancementId));
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      setPendingEnhancementId(null);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [controlState, pendingEnhancementId]);

  const handleCopyControlLink = useCallback(async (controlId: string) => {
    try {
      const url = buildSelectionUrl(controlId, null).toString();
      await copyTextToClipboard(url);
      setCopiedKey(`control:${canonicalControlId(controlId)}`);
      writeSelectionUrl(controlId, null, "replace");
    } catch (error) {
      console.error("Failed to copy control link", error);
    }
  }, []);

  const handleCopyEnhancementLink = useCallback(
    async (controlId: string, enhancementId: string) => {
      try {
        const url = buildSelectionUrl(controlId, enhancementId).toString();
        await copyTextToClipboard(url);
        const key = `${controlId}:${canonicalEnhancementId(enhancementId)}`;
        setCopiedKey(key);
        writeSelectionUrl(controlId, enhancementId, "replace");
      } catch (error) {
        console.error("Failed to copy enhancement link", error);
      }
    },
    [],
  );

  const statement = control?.statement ?? control?.control_statement ?? "";
  const enhancements = asArray(control?.enhancements);
  const hasEnhancements = enhancements.length > 0;
  const relatedControls = Array.isArray(control?.related_controls)
    ? control.related_controls
    : [];
  const repoUrl = useMemo(() => getRepoUrl(), []);
  const issuesUrl = repoUrl ? `${repoUrl}/issues` : null;
  const licenseUrl = repoUrl ? `${repoUrl}/blob/main/LICENSE` : null;
  const formattedLastUpdated = useMemo(
    () => formatLastUpdated(indexLastUpdated),
    [indexLastUpdated],
  );
  const revisionSummary = useMemo(
    () => formatCatalogRevision(catalogMetadata),
    [catalogMetadata],
  );
  const homePath = typeof window === "undefined" ? "/" : window.location.pathname;
  const handleGoHome = useCallback(() => {
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", window.location.pathname);
    }
    setQuery("");
    setSelectedId(null);
    setControl(null);
    setControlState("idle");
    setControlError(null);
    setPendingEnhancementId(null);
  }, []);

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">ITSG-33</p>
          {revisionSummary && <p className="catalog-revision muted">{revisionSummary}</p>}
          <h1>
            <a
              className="title-home-link"
              href={homePath}
              onClick={(event) => {
                event.preventDefault();
                handleGoHome();
              }}
            >
              Controls Browser
            </a>
          </h1>
          <p className="subhead">
            Search by ID, name, aliases, or keywords, and browse control details.
          </p>
          <p className="assignment-disclaimer muted">
            Assignment helper guidance is AI-generated for convenience and is not authoritative for
            your organization.
          </p>
          <nav className="hero-links" aria-label="Project links">
            {repoUrl && (
              <a href={repoUrl} target="_blank" rel="noreferrer">
                GitHub Repo
              </a>
            )}
            <a href={SOURCE_DATA_URL} target="_blank" rel="noreferrer">
              Source Data (CCCS)
            </a>
            {issuesUrl && (
              <a href={issuesUrl} target="_blank" rel="noreferrer">
                Report Issue
              </a>
            )}
          </nav>
        </div>
        <div className="stats">
          <div>
            <span className="label">Index</span>
            <span className="value">
              {indexState === "loading" ? "Loading..." : `${index.length} controls`}
            </span>
          </div>
          <div>
            <span className="label">Selected</span>
            <span className="value">{selectedId ?? "None"}</span>
          </div>
        </div>
      </header>

      <section className="panel search-panel">
        <label htmlFor="search" className="label">
          Search controls
        </label>
        <div className="search-input-wrap">
          <input
            id="search"
            type="search"
            placeholder="Search names, enhancement IDs, or titles (e.g., AC-2, least privilege, SI-4(12))"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setQuery("");
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="search-clear"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              X
            </button>
          )}
        </div>
        <div className="search-hints">
          <span className="muted">Examples:</span>
          {searchExamples.map((example) => (
            <button
              key={example}
              type="button"
              className="search-hint"
              onClick={() => setQuery(example)}
            >
              {example}
            </button>
          ))}
        </div>
        {indexState === "error" && (
          <p className="error">Failed to load index: {indexError}</p>
        )}
      </section>

      <div className="layout">
        <aside className="list">
          <div className="list-header">
            <h2>Controls</h2>
            <span className="muted">{shown.length} shown</span>
          </div>
          <ul key={query}>
            {shown.map((item) => (
              <li key={item.control_id}>
                <button
                  className={`control-select ${item.control_id === selectedId ? "active" : ""}`}
                  onClick={() => handleSelect(item.control_id)}
                >
                  <span className="id">{item.control_id}</span>
                  <span className="name">{item.control_name}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="detail">
          {!selectedId && (
            <div className="empty-state">
              <h3>Select a control</h3>
              <p>Choose a control from the list to view its details.</p>
            </div>
          )}

          {selectedId && controlState === "loading" && (
            <div className="empty-state">Loading control details...</div>
          )}

          {selectedId && controlState === "error" && (
            <div className="empty-state">
              <p className="error">Failed to load control: {controlError}</p>
            </div>
          )}

          {control && controlState === "success" && (
            <div className="control-card">
              <div className="control-title">
                <h2>
                  {control.control_id} {control.control_name ?? ""}
                </h2>
                <div className="control-title-actions">
                  {control?.control_id && (
                    <span className="pill">{control.control_id}</span>
                  )}
                  {control?.control_id && (
                    <button
                      type="button"
                      className="copy-link-btn"
                      onClick={() => void handleCopyControlLink(control.control_id)}
                    >
                      {copiedKey === `control:${canonicalControlId(control.control_id)}` ? "Copied" : "Link"}
                    </button>
                  )}
                  {hasEnhancements && (
                    <button
                      type="button"
                      className="jump-enhancements"
                      onClick={() =>
                        enhancementsRef.current?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        })
                      }
                    >
                      Jump to enhancements
                    </button>
                  )}
                </div>
              </div>

              {statement && (
                <section>
                  <h3>Statement</h3>
                  <p>{renderTextWithAssignments(statement)}</p>
                </section>
              )}

              {asArray(control.statement_parts).length > 0 && (
                <section>
                  <h3>Statement parts</h3>
                  <ul>{renderStatementParts(asArray(control.statement_parts))}</ul>
                </section>
              )}

              {(control.guidance || control.supplemental_guidance) && (
                <section>
                  <h3>Guidance</h3>
                  <p>{renderTextWithAssignments(control.guidance ?? control.supplemental_guidance ?? "")}</p>
                </section>
              )}

              {relatedControls.length > 0 && (
                <section>
                  <h3>Related controls</h3>
                  <div className="related-controls">
                    {relatedControls.map((controlId) => (
                      <button
                        key={`related-${controlId}`}
                        className="related-link"
                        onClick={() => handleSelect(controlId)}
                      >
                        {controlId}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {hasEnhancements && (
                <section ref={enhancementsRef}>
                  <h3>Enhancements</h3>
                  <div className="enhancements">
                    {renderEnhancements(enhancements, {
                      controlId: control.control_id,
                      copiedKey,
                      onCopyEnhancementLink: (enhancementId) =>
                        void handleCopyEnhancementLink(control.control_id, enhancementId),
                    })}
                  </div>
                </section>
              )}

              {asArray(control.examples).length > 0 && (
                <section>
                  <h3>Illustrative examples</h3>
                  <ul>
                    {asArray(control.examples).map((item, index) => (
                      <li key={`${control.control_id}-ex-${index}`}>
                        {renderTextWithAssignments(formatItem(item))}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {asArray(control.source_anchors).length > 0 && (
                <section>
                  <h3>Source anchors</h3>
                  <ul>
                    {asArray(control.source_anchors).map((item, index) => (
                      <li key={`${control.control_id}-src-${index}`}>
                        {renderTextWithAssignments(formatItem(item))}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </main>
      </div>

      <p className="page-meta muted">
        Data last updated: {indexState === "loading" ? "Loading..." : formattedLastUpdated}
      </p>

      <footer id="disclaimer" className="panel site-footer">
        <p>
          <strong>Independent project.</strong> This website is not affiliated with or endorsed by
          CCCS, CSE, TBS, or the Government of Canada.
        </p>
        <p>
          This is a convenience browsing tool. The authoritative source remains the official CCCS
          publication.
        </p>
        <div className="footer-links">
          <a href={SOURCE_DATA_URL} target="_blank" rel="noreferrer">
            Official CCCS Source
          </a>
          {repoUrl && (
            <a href={repoUrl} target="_blank" rel="noreferrer">
              Repository
            </a>
          )}
          {issuesUrl && (
            <a href={issuesUrl} target="_blank" rel="noreferrer">
              Issues
            </a>
          )}
          {licenseUrl && (
            <a href={licenseUrl} target="_blank" rel="noreferrer">
              License
            </a>
          )}
        </div>
      </footer>

      <div className="page-actions">
        <button
          type="button"
          className="back-to-top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          Back to top
        </button>
      </div>
    </div>
  );
}

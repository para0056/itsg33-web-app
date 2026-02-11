export type ControlIndexItem = {
    control_id: string;
    control_name: string;
    family_id: string;
    aliases?: string[];
    keywords?: string[];
};

export type ControlRecord = {
    control_id: string;
    control_name: string;
    statement?: string;
    control_statement?: string;
    statement_parts?: string[];
    guidance?: string;
    supplemental_guidance?: string;
    enhancements?: unknown[];
    examples?: unknown[];
    source_anchors?: unknown[];
};

export type ChatRequest = {
    question: string;
    control_ids: string[];
};

function tokenize(text: string): string[] {
    // Low-tech tokenization for lexical scoring.
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter(Boolean)
}

function normalizeControlId(id: string): string {
    return id.trim().toUpperCase();
}

export function extractControlIds(text: string): string[] {
    // Finds IDs like "AC-2" in arbitrary text.sss
    const matches = text.toUpperCase().match(/\b[A-Z]{2}-\d{1,3}\b/g);
    if (!matches) return [];
    return Array.from(new Set(matches));
}

function scoreControl(question: string, tokens: Set<string>, item: ControlIndexItem): number {
    // Combine "exact substring" and token overlap scoring
    let score = 0;
    const haystack = question.toLowerCase();
    const terms = [
        item.control_id,
        item.control_name,
        ...(item.aliases ?? []),
        ...(item.keywords ?? []),
    ].filter(Boolean) as string[];

    for (const term of terms) {
        const termLower = term.toLowerCase();
        if (termLower && haystack.includes(termLower)) {
            score += 3;
        }
        for (const token of tokenize(termLower)) {
            if (tokens.has(token)) score += 1;
        }
    }
    return score;
}

export function selectControlIds(
    question: string,
    controlIds: string[] | undefined,
    index: ControlIndexItem[],
    limit = 6,
): string[] {

    // Map normalized IDs back to canonical IDs from the index.
    const canonical = new Map(index.map((item) => [item.control_id.toUpperCase(), item.control_id]));
    const chosen: string[] = [];

    const add = (id: string) => {
        const norm = normalizeControlId(id);
        const canonicalId = canonical.get(norm);
        if (canonicalId && !chosen.includes(canonicalId)) {
            chosen.push(canonicalId);
        }
    };

    // 1) Prefer explicit control IDs provided by the caller
    if (controlIds?.length) {
        for (const id of controlIds) add(id);
        if (chosen.length) return chosen;
    }

    // 2) Then try IDs embedded in the question text
    for (const id of extractControlIds(question)) add(id);
    if (chosen.length) return chosen;

    // 3) Finally, fall back to lexical scoring against the index
    const tokens = new Set(tokenize(question));
    const scored = index
        .map((item) => ({ item, score: scoreControl(question, tokens, item) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);
    for (const entry of scored.slice(0, limit)) {
        chosen.push(entry.item.control_id);
    }
    return chosen;
}

export function buildControlContext(control: ControlRecord): string {
    // Assemble a compact prompt block per control
    const lines: string[] = [];

    lines.push(`Control ${control.control_id}: ${control.control_name ?? ""}`.trim());
    const statement = control.statement ?? control.control_statement ?? "";
    if (statement) {
        lines.push("Statement:");
        lines.push(statement.trim());
    }

    if (Array.isArray(control.statement_parts) && control.statement_parts.length) {
        lines.push("Statement parts:");
        for (const part of control.statement_parts) {
            lines.push(`- ${String(part)}`);
        }
    }

    const guidance = control.guidance ?? control.supplemental_guidance;
    if (guidance) {
        lines.push("Guidance:");
        lines.push(String(guidance));
    }

    // Keep enhancements short to avoid prompt dilution
    const enhancements = Array.isArray(control.enhancements)
        ? control.enhancements.slice(0, 3)
        : [];
    if (enhancements.length) {
        lines.push("Enhancements (selected):");
        for (const enhancement of enhancements) {
            if (typeof enhancement === "string") {
                lines.push(`- ${enhancement}`);
            } else if (enhancement && typeof enhancement === "object") {
                const id = (enhancement as any).enhancement_id ?? (enhancement as any).id ?? "";
                const text = (enhancement as any).text ?? (enhancement as any).statement ?? "";
                lines.push(`- ${[id, text].filter(Boolean).join(" ")}`.trim());
            }
        }
    }
    // Examples are explicity illustrative, not requirements.
    const examples = Array.isArray(control.examples) ? control.examples.slice(0, 2) : [];
    if (examples.length) {
        lines.push("Illustrative examples:");
        for (const example of examples) {
            if (typeof example === "string") {
                lines.push(`- ${example}`);
            } else if (example && typeof example === "object") {
                const desc = (example as any).description ?? (example as any).text ?? "";
                const context = (example as any).context ?? "";
                lines.push(`- ${[desc, context].filter(Boolean).join(" ")}`.trim());
            }
        }
    }
    return lines.join("\n");
}
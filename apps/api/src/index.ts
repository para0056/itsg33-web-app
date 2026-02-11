import { getJson } from "./r2";
import {
    buildControlContext,
    selectControlIds,
    type ChatRequest,
    type ControlIndexItem,
    type ControlRecord,
} from "./rag"

export interface Env {
    DATA: R2Bucket;
    AI: { run: (model: string, input: unknown) => Promise<unknown> };
    DATA_PREFIX: string;
    MODEL_NAME: string;
    ALLOWED_ORIGINS: string;
}

type ChatResponse = {
    answer: string;
    retrieved_controls: string[];
    citations: { control_id: string; anchors?: string[] }[];
};

function joinKey(prefix: string | undefined, path: string): string {
    // Builds an R2 object key with a clean prefix.
    const cleanPrefix = (prefix ?? "").replace(/\/+$/g, "");
    const cleanPath = path.replace(/^\/+/g, "");
    return cleanPrefix ? `${cleanPrefix}/${cleanPath}` : cleanPath;
}

function getAllowedOrigin(req: Request, env: Env): string {
    // Simple CORS allow list with "*" support.
    const origin = req.headers.get("Origin") ?? "";
    const allowed = (env.ALLOWED_ORIGINS ?? "*")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)

    if (allowed.includes("*")) return "*";
    if (origin && allowed.includes(origin)) return origin;
    return allowed[0] ?? "*";
}

function jsonResponse(
    req: Request,
    env: Env,
    body: unknown,
    status = 200,
): Response {
    // Standard JSON response with CORS headers.
    const headers = new Headers({
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": getAllowedOrigin(req, env),
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return new Response(JSON.stringify(body, null, 2), { status, headers });
}

function emptyResponse(req: Request, env: Env): Response {
    // Preflight response for CORS OPTIONS.
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": getAllowedOrigin(req, env),
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
    });
}

async function readJsonRequest<T>(req: Request): Promise<T | null> {
    // Guard against malformed JSON bodies.
    try {
        return (await req.json()) as T;
    } catch {
        return null;
    }
}

function extractAnchors(control: ControlRecord): string[] | undefined {
    // Normalize citation anchors into a string array.
    if (!Array.isArray(control.source_anchors)) return undefined;

    const anchors: string[] = [];
    for (const anchor of control.source_anchors) {
        if (typeof anchor === "string") {
            anchors.push(anchor);
        } else if (anchor && typeof anchor === "object") {
            const url = (anchor as any).url ?? (anchor as any).href;
            if (url) anchors.push(String(url));
        }
    }

    return anchors.length ? anchors : undefined;
}


function extractModelText(result: unknown): string {
    // Workers AI returns different shapes; pick the mostly likely text field.
    if (typeof result === "string") return result;
    if (!result || typeof result !== "object") return JSON.stringify(result ?? "");
    const candidate = result as any;
    return (
        candidate.response ??
        candidate.result ??
        candidate.message?.content ??
        JSON.stringify(result)
    );
}

async function handleIndex(req: Request, env: Env): Promise<Response> {
    // GET /api/controls/index
    const key = joinKey(env.DATA_PREFIX, "controls-index.json");
    const index = await getJson<ControlIndexItem[]>(env.DATA, key);
    if (!index) {
        return jsonResponse(req, env, { error: "controls-index.json not found" }, 404);
    }
    return jsonResponse(req, env, index);
}

async function handleControl(req: Request, env: Env, controlId: string): Promise<Response> {
    // GET /api/controls/:controlId
    const key = joinKey(env.DATA_PREFIX, `controls/${controlId}.json`);
    const control = await getJson<ControlRecord>(env.DATA, key);
    if (!control) {
        return jsonResponse(req, env, { error: "control not found" }, 404);
    }
    return jsonResponse(req, env, control);
}

async function handleChat(req: Request, env: Env): Promise<Response> {
    // POST /api/chat
    const payload = await readJsonRequest<ChatRequest>(req);
    if (!payload || !payload.question?.trim()) {
        return jsonResponse(req, env, { error: "question is required" }, 400);
    }

    const indexKey = joinKey(env.DATA_PREFIX, "controls-index.json");
    const index = await getJson<ControlIndexItem[]>(env.DATA, indexKey);
    if (!index) {
        return jsonResponse(req, env, { error: "controls-index not found" }, 500);
    }

    // Choose controls via explicit IDs, embedded IDs, or lexical scoring.
    const controlIds = selectControlIds(payload.question, payload.controlIds, index);
    const controls: ControlRecord[] = [];
    for (const controlId of controlIds) {
        const controlKey = joinKey(env.DATA_PREFIX, `controls/${controlId}.json`);
        const control = await getJson<ControlRecord>(env.DATA, controlKey);
        if (control) controls.push(control);
    }

    if (!controls.length) {
        const response: ChatResponse = {
            answer: "Insufficient information in the retrieved controls to answer this question.",
            retrieved_controls: [],
            citations: [],
        };
        return jsonResponse(req, env, response);
    }

    const contextBlocks = controls.map(buildControlContext);
    const context = contextBlocks.join("\n\n---\n\n");

    const system = [
        "You are an assistant answering questions about ITSG-33 controls.",
        "Use only the provided control text as authoritative requirements.",
        "If the context is insufficient, say so clearly.",
        "Label examples as illustrative and not authoritative.",
        "Cite control IDs in the response.",
    ].join(" ");

    if (!env.AI || !env.MODEL_NAME) {
        return jsonResponse(req, env, { error: "AI binding or model is not configured" }, 500);
    }

    const result = await env.AI.run(env.MODEL_NAME, {
        messages: [
            { role: "system", content: system },
            {
                role: "user",
                content: `Question: ${payload.question}\n\nControl context:\n${context}`,
            },
        ],
    });

    const answer = extractModelText(result);

    const citations = controls.map((control) => ({
        control_id: control.control_id,
        anchors: extractAnchors(control),
    }));

    const response: ChatResponse = {
        answer,
        retrieved_controls: controls.map((control) => control.control_id),
        citations,
    };

    return jsonResponse(req, env, response);
}

export default {
    async fetch(req: Request, env: Env): Promise<Response> {
        // Simple router for the three API endpoints.
        if (req.method === "OPTIONS") {
            return emptyResponse(req, env);
        }

        const url = new URL(req.url);
        const path = url.pathname;

        if (req.method === "GET" && path === "/api/controls/index") {
            return handleIndex(req, env);
        }

        if (req.method === "GET" && path.startsWith("/api/controls/")) {
            const controlId = path.replace("/api/controls/", "").trim();
            if (!controlId) {
                return jsonResponse(req, env, { error: "control id is required" }, 400);
            }
            return handleControl(req, env, controlId);
        }

        if (req.method === "POST" && path === "/api/chat") {
            return handleChat(req, env);
        }

        return jsonResponse(req, env, { error: "not found" }, 404);
    },
};
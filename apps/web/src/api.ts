import type { CatalogMetadata, ControlIndexItem, ControlRecord } from "./types";

// Supports both local dev and GitHub Pages by allowing an explicit API base override.
const API_BASE = (import.meta.env.VITE_API_BASE ?? import.meta.env.BASE_URL.replace(/\/$/, ""))
  .replace(/\/+$/, "");

export type IndexResponse = {
  items: ControlIndexItem[];
  lastUpdated: string | null;
};

function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${normalizedPath}` : normalizedPath;
}

async function requestJson<T>(path: string): Promise<T> {
  const res = await fetch(buildApiUrl(path));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchIndex(): Promise<IndexResponse> {
  const res = await fetch(buildApiUrl("/api/controls/index"));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }

  const items = (await res.json()) as ControlIndexItem[];
  // Keep this as a lightweight metadata signal for "Data last updated" in the UI.
  return {
    items,
    lastUpdated: res.headers.get("last-modified"),
  };
}

export function fetchControl(controlId: string): Promise<ControlRecord> {
  return requestJson(`/api/controls/${encodeURIComponent(controlId)}.json`);
}

export function fetchCatalogMetadata(): Promise<CatalogMetadata> {
  return requestJson("/api/controls/metadata.json");
}

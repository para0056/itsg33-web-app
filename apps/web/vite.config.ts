import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function normalizeBasePath(value?: string): string {
  if (!value) return "/";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/";

  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withTrailing = withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
  return withTrailing.replace(/\/{2,}/g, "/");
}

export default defineConfig({
  base: normalizeBasePath(process.env.VITE_BASE_PATH),
  plugins: [react()],
});

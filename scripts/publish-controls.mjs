import { mkdir, readdir, rm, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const sourceRoot = path.join(repoRoot, "data", "controls");
const sourceIndex = path.join(sourceRoot, "controls-index.json");
const sourceControlsDir = path.join(sourceRoot, "controls");
const sourceMetadata = path.join(sourceRoot, "catalog-metadata.json");

const targetRoot = path.join(repoRoot, "apps", "web", "public", "api", "controls");
const targetIndex = path.join(targetRoot, "index");
const targetMetadata = path.join(targetRoot, "metadata.json");

async function clearTargetControlJsonFiles() {
  // Remove only generated JSON payloads, keep non-JSON assets untouched.
  const entries = await readdir(targetRoot, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => rm(path.join(targetRoot, entry.name)))
  );
}

async function publish() {
  await mkdir(targetRoot, { recursive: true });
  await clearTargetControlJsonFiles();

  // The index intentionally stays extensionless because the web client calls /api/controls/index.
  await copyFile(sourceIndex, targetIndex);
  let metadataPublished = false;
  try {
    await copyFile(sourceMetadata, targetMetadata);
    metadataPublished = true;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const sourceEntries = await readdir(sourceControlsDir, { withFileTypes: true });
  const sourceJsonFiles = sourceEntries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".json")
  );

  await Promise.all(
    sourceJsonFiles.map((entry) =>
      copyFile(path.join(sourceControlsDir, entry.name), path.join(targetRoot, entry.name))
    )
  );

  console.log(
    `Published ${sourceJsonFiles.length} controls to ${targetRoot}${metadataPublished ? " (+ metadata)" : ""}`,
  );
}

publish().catch((error) => {
  console.error("Publish failed:", error);
  process.exitCode = 1;
});

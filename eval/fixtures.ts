// ---------------------------------------------------------------------------
// Fixture loader for the eval harness.
//
// Walks eval/fixtures/{bicep,cf}/<name>/ and returns a list of {meta, input,
// reference} bundles. Reference trees are optional (empty on first run,
// populated by `npm run eval:update-refs`).
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FixtureMeta } from "./score";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Fixture {
  meta: FixtureMeta;
  dir: string;
  /** Source IaC content. */
  input: string;
  /** Reference Terraform file map (relative-path -> content). Null if absent. */
  reference: Record<string, string> | null;
}

const FIXTURES_ROOT = path.resolve(__dirname, "fixtures");

export function loadFixtures(): Fixture[] {
  const out: Fixture[] = [];
  for (const group of ["bicep", "cf"] as const) {
    const groupDir = path.join(FIXTURES_ROOT, group);
    if (!fs.existsSync(groupDir)) continue;
    for (const name of fs.readdirSync(groupDir).sort()) {
      const dir = path.join(groupDir, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const metaPath = path.join(dir, "meta.json");
      if (!fs.existsSync(metaPath)) continue;
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as FixtureMeta;
      const inputPath = path.join(dir, meta.inputFile);
      const input = fs.readFileSync(inputPath, "utf8");
      const reference = loadReference(path.join(dir, "reference"));
      out.push({ meta, dir, input, reference });
    }
  }
  return out;
}

function loadReference(refDir: string): Record<string, string> | null {
  if (!fs.existsSync(refDir) || !fs.statSync(refDir).isDirectory()) return null;
  const files: Record<string, string> = {};
  for (const entry of fs.readdirSync(refDir)) {
    if (entry.startsWith(".")) continue;
    const full = path.join(refDir, entry);
    if (!fs.statSync(full).isFile()) continue;
    if (!entry.endsWith(".tf") && !entry.endsWith(".tfvars.example")) continue;
    files[entry] = fs.readFileSync(full, "utf8");
  }
  return Object.keys(files).length > 0 ? files : null;
}

export function writeReference(
  fixture: Fixture,
  files: Record<string, string>,
): void {
  const refDir = path.join(fixture.dir, "reference");
  fs.mkdirSync(refDir, { recursive: true });
  // Wipe prior references so deleted resources don't linger.
  for (const entry of fs.readdirSync(refDir)) {
    if (entry.startsWith(".")) continue;
    fs.unlinkSync(path.join(refDir, entry));
  }
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(refDir, name), content);
  }
  // Always keep the .gitkeep so the directory survives empty commits.
  fs.writeFileSync(path.join(refDir, ".gitkeep"), "");
}

// ---------------------------------------------------------------------------
// Deterministic resource-inventory extractors for source IaC (Bicep / CF).
//
// Shared between the eval harness scorer and the runtime pre-fetch + coverage
// check pipeline — single source of truth, so a regression in one path is
// caught by unit tests that cover both.
//
// Regex-only by design: we don't pull js-yaml into the browser bundle path
// (cf-modules.ts is client-side) and we want the exact same behaviour between
// the runtime and the scorer.
// ---------------------------------------------------------------------------

import type { SourceFormat } from "./types";
import { RESOURCE_TYPE_MAP } from "./mappings";
import { CF_RESOURCE_TYPE_MAP } from "./cf-mappings";

/** One resource declared in the source IaC. */
export interface SourceResource {
  /** Bicep `Microsoft.Foo/bar` or CF `AWS::Foo::Bar` (no API version suffix). */
  sourceType: string;
  /** Logical name as written in the source. */
  logicalName: string;
}

/** Extract `resource <name> 'Namespace/Type@version' = {` declarations. */
export function extractBicepResources(content: string): SourceResource[] {
  const out: SourceResource[] = [];
  const re = /^resource\s+([A-Za-z_][A-Za-z0-9_]*)\s+'([^']+)'/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const logicalName = m[1];
    const fullType = m[2];
    const sourceType = fullType.split("@")[0];
    out.push({ sourceType, logicalName });
  }
  return out;
}

/**
 * Extract CloudFormation resources from YAML or JSON text.
 *
 * YAML parsing is regex-based to keep this module free of heavy deps. We
 * accept `Type: AWS::X::Y` and `Type: 'AWS::X::Y'`; logical-name matching
 * locks to the first indentation we see under `Resources:` so nested
 * property keys don't get treated as resource names.
 */
export function extractCfResources(content: string): SourceResource[] {
  const out: SourceResource[] = [];
  const trimmed = content.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const doc = JSON.parse(trimmed) as Record<string, unknown>;
      const resources = doc.Resources;
      if (resources && typeof resources === "object") {
        for (const [logicalName, spec] of Object.entries(
          resources as Record<string, unknown>,
        )) {
          if (spec && typeof spec === "object") {
            const t = (spec as Record<string, unknown>).Type;
            if (typeof t === "string" && t.startsWith("AWS::")) {
              out.push({ sourceType: t, logicalName });
            }
          }
        }
      }
      return out;
    } catch {
      return out;
    }
  }

  const lines = content.split("\n");
  let inResources = false;
  let resourcesIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^Resources\s*:/.test(line)) {
      inResources = true;
      resourcesIndent = 0;
      continue;
    }
    if (!inResources) continue;
    if (/^\S/.test(line) && !/^Resources\s*:/.test(line)) {
      inResources = false;
      continue;
    }
    const headerMatch = line.match(
      /^(\s+)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/,
    );
    if (!headerMatch) continue;
    const indent = headerMatch[1].length;
    if (resourcesIndent === 0) resourcesIndent = indent;
    if (indent !== resourcesIndent) continue;

    const logicalName = headerMatch[2];
    for (let j = i + 1; j < Math.min(i + 25, lines.length); j++) {
      const next = lines[j];
      if (/^\s*$/.test(next)) continue;
      const nextIndent = next.match(/^(\s*)/)?.[1].length ?? 0;
      if (nextIndent <= indent) break;
      const tm = next.match(/^\s*Type:\s*['"]?(AWS::[A-Za-z0-9:]+)['"]?/);
      if (tm) {
        out.push({ sourceType: tm[1], logicalName });
        break;
      }
    }
  }
  return out;
}

/** Format-aware source inventory extractor. */
export function extractSourceResourceInventory(
  content: string,
  sourceFormat: SourceFormat,
): SourceResource[] {
  return sourceFormat === "bicep"
    ? extractBicepResources(content)
    : extractCfResources(content);
}

/**
 * Extract source resource lists from a multi-file project — useful for pre-
 * fetch + coverage in multi-file / nested-stacks mode. Logical names are
 * prefixed with the file path so collisions across modules are preserved.
 */
export function extractSourceResourceInventoryMultiFile(
  files: Record<string, string>,
  sourceFormat: SourceFormat,
): SourceResource[] {
  const out: SourceResource[] = [];
  for (const [filePath, content] of Object.entries(files)) {
    const inv = extractSourceResourceInventory(content, sourceFormat);
    for (const r of inv) {
      out.push({
        sourceType: r.sourceType,
        logicalName: `${filePath}:${r.logicalName}`,
      });
    }
  }
  return out;
}

/**
 * Given a source inventory, return the de-duplicated list of mapped TF types
 * we'd expect in the output. Types with a `null` entry (merged into parent)
 * and types with no entry at all (unknown) are excluded — the agent can still
 * fetch schemas mid-run for those via MCP.
 */
export function mappedTfTypes(
  sourceResources: SourceResource[],
  sourceFormat: SourceFormat,
): string[] {
  const map =
    sourceFormat === "bicep" ? RESOURCE_TYPE_MAP : CF_RESOURCE_TYPE_MAP;
  const set = new Set<string>();
  for (const r of sourceResources) {
    const mapped = map[r.sourceType];
    if (typeof mapped === "string" && mapped.length > 0) set.add(mapped);
  }
  return Array.from(set).sort();
}

/** Source types that appear in the inventory but have no mapping entry. */
export function unmappedSourceTypes(
  sourceResources: SourceResource[],
  sourceFormat: SourceFormat,
): string[] {
  const map =
    sourceFormat === "bicep" ? RESOURCE_TYPE_MAP : CF_RESOURCE_TYPE_MAP;
  const set = new Set<string>();
  for (const r of sourceResources) {
    if (!(r.sourceType in map)) set.add(r.sourceType);
  }
  return Array.from(set).sort();
}

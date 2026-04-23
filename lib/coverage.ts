// ---------------------------------------------------------------------------
// Resource-coverage computation, shared between the runtime pipeline (emits
// `coverage_report` SSE events after a conversion) and the eval harness
// scorer. Single implementation so both paths report the same numbers.
// ---------------------------------------------------------------------------

import type { SourceFormat } from "./types";
import { RESOURCE_TYPE_MAP } from "./mappings";
import { CF_RESOURCE_TYPE_MAP } from "./cf-mappings";
import type { SourceResource } from "./source-resource-inventory";
import type { GeneratedResource } from "./generated-resource-inventory";
import { extractGeneratedResources } from "./generated-resource-inventory";
import { extractSourceResourceInventory } from "./source-resource-inventory";

/** One row in the coverage report's expected list. */
export interface ExpectedResourceEntry {
  sourceType: string;
  logicalName: string;
  /**
   * TF type we expect to see in the output.
   * `null` means the source type has no direct TF equivalent (merged into
   * parent, custom resource, etc.) — excluded from the coverage score.
   * `undefined` means the source type is not in our built-in maps — also
   * excluded; the agent can still fetch it via MCP at runtime.
   */
  expectedTfType: string | null | undefined;
}

export interface CoverageReport {
  expected: ExpectedResourceEntry[];
  generated: GeneratedResource[];
  /** Source resources whose expected TF type appears in the output. */
  matched: SourceResource[];
  /** Source resources whose expected TF type is missing from the output. */
  missing: SourceResource[];
  /** Source types we didn't have a mapping for — excluded from coverage. */
  unmappedSourceTypes: string[];
  /** Coverage score in [0, 1]. */
  coverage: number;
}

export function computeCoverage(args: {
  sourceResources: SourceResource[];
  generatedResources: GeneratedResource[];
  sourceFormat: SourceFormat;
}): CoverageReport {
  const { sourceResources, generatedResources, sourceFormat } = args;
  const map =
    sourceFormat === "bicep" ? RESOURCE_TYPE_MAP : CF_RESOURCE_TYPE_MAP;

  const generatedTfTypes = new Set(generatedResources.map((r) => r.tfType));

  const expected: ExpectedResourceEntry[] = [];
  const matched: SourceResource[] = [];
  const missing: SourceResource[] = [];
  const unmappedSet = new Set<string>();

  for (const sr of sourceResources) {
    const mapped = map[sr.sourceType];
    expected.push({
      sourceType: sr.sourceType,
      logicalName: sr.logicalName,
      expectedTfType: mapped,
    });
    if (mapped === undefined) {
      unmappedSet.add(sr.sourceType);
      continue;
    }
    if (mapped === null) continue;
    if (generatedTfTypes.has(mapped)) {
      matched.push(sr);
    } else {
      missing.push(sr);
    }
  }

  const considered = matched.length + missing.length;
  const coverage = considered === 0 ? 1 : matched.length / considered;

  return {
    expected,
    generated: generatedResources,
    matched,
    missing,
    unmappedSourceTypes: Array.from(unmappedSet).sort(),
    coverage,
  };
}

/** Convenience: compute coverage directly from source content + file map. */
export function computeCoverageFromContent(args: {
  sourceContent: string;
  sourceFormat: SourceFormat;
  terraformFiles: Record<string, string>;
}): CoverageReport {
  return computeCoverage({
    sourceResources: extractSourceResourceInventory(
      args.sourceContent,
      args.sourceFormat,
    ),
    generatedResources: extractGeneratedResources(args.terraformFiles),
    sourceFormat: args.sourceFormat,
  });
}

// ---------------------------------------------------------------------------
// Pure scoring logic for the eval harness.
//
// The resource-inventory extraction and coverage computation live in the
// runtime-shared modules (lib/source-resource-inventory.ts,
// lib/generated-resource-inventory.ts, lib/coverage.ts) — this file just
// composes them with validation/cost/round budget checks and renders a
// per-fixture verdict.
// ---------------------------------------------------------------------------

import type { StreamEvent, CostInfo, SourceFormat } from "@/lib/types";
import type { SourceResource } from "@/lib/source-resource-inventory";
import { extractSourceResourceInventory } from "@/lib/source-resource-inventory";
import { extractGeneratedResources } from "@/lib/generated-resource-inventory";
import type { GeneratedResource } from "@/lib/generated-resource-inventory";
import { computeCoverage, type CoverageReport } from "@/lib/coverage";

// Re-export the extractors so existing imports from `@/eval/score` keep working.
export {
  extractBicepResources,
  extractCfResources,
  extractSourceResourceInventory,
} from "@/lib/source-resource-inventory";
export { extractGeneratedResources } from "@/lib/generated-resource-inventory";
export type { SourceResource } from "@/lib/source-resource-inventory";
export type { GeneratedResource } from "@/lib/generated-resource-inventory";

// ---------------------------------------------------------------------------
// Coverage wrapper — adds the fields the harness reports on.
// ---------------------------------------------------------------------------

export interface CoverageBreakdown extends CoverageReport {
  expectedCount: number;
}

export function resourceCoverage(
  sourceResources: SourceResource[],
  generatedResources: GeneratedResource[],
  sourceFormat: SourceFormat,
): CoverageBreakdown {
  const report = computeCoverage({
    sourceResources,
    generatedResources,
    sourceFormat,
  });
  return {
    ...report,
    expectedCount: report.matched.length + report.missing.length,
  };
}

// ---------------------------------------------------------------------------
// Structural (Jaccard) match against a reference tree
// ---------------------------------------------------------------------------

/**
 * Jaccard similarity between the `(tfType, tfName)` tuples in two file maps.
 * Returns 1.0 when both sets are equal, 0 when disjoint.
 */
export function structuralMatch(
  generated: Record<string, string>,
  reference: Record<string, string>,
): number {
  const key = (r: GeneratedResource) => `${r.tfType}.${r.tfName}`;
  const g = new Set(extractGeneratedResources(generated).map(key));
  const r = new Set(extractGeneratedResources(reference).map(key));
  if (g.size === 0 && r.size === 0) return 1;

  let intersection = 0;
  for (const k of g) if (r.has(k)) intersection++;
  const union = g.size + r.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Per-run SSE-event summary
// ---------------------------------------------------------------------------

export interface RunSummary {
  costInfo: CostInfo | null;
  model: string | null;
  toolCallCounts: Record<string, number>;
  totalRounds: number;
  validationPassed: boolean | null;
  validationOutput: string | null;
  terraformFiles: Record<string, string>;
  errored: boolean;
  errorMessage: string | null;
}

export function summariseEvents(events: StreamEvent[]): RunSummary {
  const counts: Record<string, number> = {};
  let totalRounds = 0;
  let costInfo: CostInfo | null = null;
  let model: string | null = null;
  let validationPassed: boolean | null = null;
  let validationOutput: string | null = null;
  let terraformFiles: Record<string, string> = {};
  let errored = false;
  let errorMessage: string | null = null;

  for (const e of events) {
    switch (e.type) {
      case "tool_start":
        counts[e.toolName] = (counts[e.toolName] ?? 0) + 1;
        totalRounds++;
        break;
      case "validation":
        validationPassed = e.passed;
        validationOutput = e.output;
        break;
      case "terraform_output":
        terraformFiles = e.files;
        break;
      case "done":
        costInfo = e.costInfo ?? null;
        model = e.model ?? null;
        break;
      case "error":
        errored = true;
        errorMessage = e.message;
        break;
    }
  }

  return {
    costInfo,
    model,
    toolCallCounts: counts,
    totalRounds,
    validationPassed,
    validationOutput,
    terraformFiles,
    errored,
    errorMessage,
  };
}

// ---------------------------------------------------------------------------
// Top-level fixture score
// ---------------------------------------------------------------------------

export interface FixtureMeta {
  name: string;
  sourceFormat: SourceFormat;
  inputFile: string;
  description: string;
  expectedResourceCount: number;
  maxCostUsd: number;
  maxRounds: number;
  expectValidationPass: boolean;
}

export interface FixtureScore {
  fixture: string;
  sourceFormat: SourceFormat;
  coverage: CoverageBreakdown;
  structuralMatch: number | null;
  hasReference: boolean;
  summary: RunSummary;
  budgetExceeded: {
    cost: boolean;
    rounds: boolean;
  };
  passed: boolean;
  failReasons: string[];
}

export function scoreFixture(args: {
  meta: FixtureMeta;
  sourceContent: string;
  events: StreamEvent[];
  reference: Record<string, string> | null;
}): FixtureScore {
  const { meta, sourceContent, events, reference } = args;

  const sourceResources = extractSourceResourceInventory(
    sourceContent,
    meta.sourceFormat,
  );

  const summary = summariseEvents(events);
  const generatedResources = extractGeneratedResources(summary.terraformFiles);
  const coverage = resourceCoverage(
    sourceResources,
    generatedResources,
    meta.sourceFormat,
  );
  const sm =
    reference && Object.keys(reference).length > 0
      ? structuralMatch(summary.terraformFiles, reference)
      : null;

  const costUsd = summary.costInfo?.totalCostUsd ?? 0;
  const budgetExceeded = {
    cost: costUsd > meta.maxCostUsd,
    rounds: summary.totalRounds > meta.maxRounds,
  };

  const failReasons: string[] = [];
  if (summary.errored) {
    failReasons.push(`errored: ${summary.errorMessage ?? "unknown"}`);
  }
  if (coverage.coverage < 1) {
    failReasons.push(
      `coverage ${(coverage.coverage * 100).toFixed(0)}% (missing: ${coverage.missing
        .map((m) => `${m.logicalName}:${m.sourceType}`)
        .join(", ")})`,
    );
  }
  if (meta.expectValidationPass && summary.validationPassed === false) {
    failReasons.push("validation failed");
  }
  if (budgetExceeded.cost) {
    failReasons.push(
      `cost $${costUsd.toFixed(4)} > budget $${meta.maxCostUsd.toFixed(2)}`,
    );
  }
  if (budgetExceeded.rounds) {
    failReasons.push(
      `rounds ${summary.totalRounds} > budget ${meta.maxRounds}`,
    );
  }

  return {
    fixture: meta.name,
    sourceFormat: meta.sourceFormat,
    coverage,
    structuralMatch: sm,
    hasReference: reference !== null,
    summary,
    budgetExceeded,
    passed: failReasons.length === 0,
    failReasons,
  };
}

// ---------------------------------------------------------------------------
// Token cost calculation for Claude API usage tracking.
// ---------------------------------------------------------------------------

import type { CostInfo } from "./types";
export type { CostInfo };

/** Cost per million tokens (USD). Opus tiers are ~5× Sonnet. */
const PRICING = {
  "claude-sonnet-4-20250514": {
    input: 3.0,
    output: 15.0,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-haiku-4-5-20251001": {
    input: 0.8,
    output: 4.0,
    cacheRead: 0.08,
    cacheWrite: 1.0,
  },
  "claude-opus-4-7": {
    input: 15.0,
    output: 75.0,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
} as const;

type ModelId = keyof typeof PRICING;

/**
 * Look up pricing by model ID, with a fuzzy match for Opus snapshots whose
 * exact ID might differ (e.g. `claude-opus-4-7-20260115`). Keeps `OPUS_MODEL_ID`
 * overridable in env without forcing a cost.ts edit per release.
 */
function pricingFor(model: string): typeof PRICING[ModelId] {
  if (model in PRICING) return PRICING[model as ModelId];
  if (model.startsWith("claude-opus-4")) return PRICING["claude-opus-4-7"];
  if (model.startsWith("claude-haiku-4")) return PRICING["claude-haiku-4-5-20251001"];
  return PRICING["claude-sonnet-4-20250514"];
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): CostInfo {
  const pricing = pricingFor(model);

  const totalCostUsd =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output +
    (cacheReadTokens / 1_000_000) * pricing.cacheRead +
    (cacheWriteTokens / 1_000_000) * pricing.cacheWrite;

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalCostUsd,
    model,
  };
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Format a token count for human display: 856, 12.5K, 1.2M */
export function formatTokens(count: number): string {
  if (count < 1_000) return count.toLocaleString();
  if (count < 1_000_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/** Human-readable model display name. */
export function formatModel(model: string): string {
  if (model.startsWith("claude-sonnet-4")) return "Claude Sonnet 4";
  if (model.startsWith("claude-haiku-4")) return "Claude Haiku 4.5";
  if (model.startsWith("claude-opus-4")) return "Claude Opus 4.7";
  return model;
}

export function addCosts(a: CostInfo, b: CostInfo): CostInfo {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    totalCostUsd: a.totalCostUsd + b.totalCostUsd,
    model: a.model,
  };
}

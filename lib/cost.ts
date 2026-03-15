// ---------------------------------------------------------------------------
// Token cost calculation for Claude API usage tracking.
// ---------------------------------------------------------------------------

import type { CostInfo } from "./types";
export type { CostInfo };

/** Cost per million tokens (USD) for Claude Sonnet. */
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
} as const;

type ModelId = keyof typeof PRICING;

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): CostInfo {
  const pricing = PRICING[model as ModelId] ?? PRICING["claude-sonnet-4-20250514"];

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

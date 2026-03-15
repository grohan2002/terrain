import { describe, it, expect } from "vitest";
import { calculateCost, addCosts, formatCost } from "@/lib/cost";

describe("calculateCost", () => {
  it("calculates Sonnet cost correctly", () => {
    const cost = calculateCost(
      "claude-sonnet-4-20250514",
      1_000_000, // 1M input tokens
      100_000,   // 100k output tokens
    );
    // $3.00 input + $1.50 output = $4.50
    expect(cost.totalCostUsd).toBeCloseTo(4.5, 2);
    expect(cost.inputTokens).toBe(1_000_000);
    expect(cost.outputTokens).toBe(100_000);
    expect(cost.model).toBe("claude-sonnet-4-20250514");
  });

  it("calculates Haiku cost correctly", () => {
    const cost = calculateCost(
      "claude-haiku-4-5-20251001",
      1_000_000,
      100_000,
    );
    // $0.80 input + $0.40 output = $1.20
    expect(cost.totalCostUsd).toBeCloseTo(1.2, 2);
  });

  it("includes cache tokens in cost", () => {
    const cost = calculateCost(
      "claude-sonnet-4-20250514",
      500_000,
      50_000,
      200_000,  // cache read
      100_000,  // cache write
    );
    // $1.50 input + $0.75 output + $0.06 cache read + $0.375 cache write = $2.685
    expect(cost.totalCostUsd).toBeCloseTo(2.685, 2);
    expect(cost.cacheReadTokens).toBe(200_000);
    expect(cost.cacheWriteTokens).toBe(100_000);
  });

  it("defaults to Sonnet pricing for unknown models", () => {
    const cost = calculateCost("unknown-model", 1_000_000, 0);
    // Should use Sonnet pricing: $3.00
    expect(cost.totalCostUsd).toBeCloseTo(3.0, 2);
  });
});

describe("addCosts", () => {
  it("sums two CostInfo objects", () => {
    const a = calculateCost("claude-sonnet-4-20250514", 100_000, 50_000);
    const b = calculateCost("claude-sonnet-4-20250514", 200_000, 100_000);
    const sum = addCosts(a, b);

    expect(sum.inputTokens).toBe(300_000);
    expect(sum.outputTokens).toBe(150_000);
    expect(sum.totalCostUsd).toBeCloseTo(a.totalCostUsd + b.totalCostUsd, 4);
  });

  it("preserves model from first argument", () => {
    const a = calculateCost("claude-sonnet-4-20250514", 100_000, 0);
    const b = calculateCost("claude-haiku-4-5-20251001", 100_000, 0);
    const sum = addCosts(a, b);
    expect(sum.model).toBe("claude-sonnet-4-20250514");
  });
});

describe("formatCost", () => {
  it("formats small costs with 4 decimal places", () => {
    expect(formatCost(0.0042)).toBe("$0.0042");
  });

  it("formats larger costs with 2 decimal places", () => {
    expect(formatCost(1.5)).toBe("$1.50");
  });

  it("formats costs at the threshold", () => {
    expect(formatCost(0.01)).toBe("$0.01");
  });
});

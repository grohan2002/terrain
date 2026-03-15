import { describe, it, expect } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  it("allows first request", () => {
    const result = checkRateLimit("conversion", "test-ip-1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9); // 10 max - 1 used
    expect(result.retryAfterMs).toBe(0);
  });

  it("allows requests within limit", () => {
    const ip = "test-ip-2";
    for (let i = 0; i < 10; i++) {
      const result = checkRateLimit("conversion", ip);
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks requests over limit", () => {
    const ip = "test-ip-3";
    // Use all 10 conversion requests
    for (let i = 0; i < 10; i++) {
      checkRateLimit("conversion", ip);
    }
    // 11th should be blocked
    const result = checkRateLimit("conversion", ip);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("deploy bucket has lower limit", () => {
    const ip = "test-ip-4";
    // Use all 2 deploy requests
    checkRateLimit("deploy", ip);
    checkRateLimit("deploy", ip);
    // 3rd should be blocked
    const result = checkRateLimit("deploy", ip);
    expect(result.allowed).toBe(false);
  });

  it("different identifiers have separate counters", () => {
    const result1 = checkRateLimit("conversion", "user-a");
    const result2 = checkRateLimit("conversion", "user-b");
    expect(result1.allowed).toBe(true);
    expect(result2.allowed).toBe(true);
  });

  it("returns allowed for unknown bucket", () => {
    const result = checkRateLimit("unknown" as "conversion", "test-ip");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(999);
  });
});

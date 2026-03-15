import { describe, it, expect } from "vitest";
import { ok, err } from "@/lib/tool-result";

describe("ok", () => {
  it("returns a success result", () => {
    const result = ok("some data");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("some data");
    }
  });

  it("includes optional metadata", () => {
    const result = ok("data", { key: "value" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metadata).toEqual({ key: "value" });
    }
  });
});

describe("err", () => {
  it("returns a failure result", () => {
    const result = err("something went wrong");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("something went wrong");
    }
  });

  it("includes optional error code", () => {
    const result = err("not found", "NOT_FOUND");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("NOT_FOUND");
    }
  });
});

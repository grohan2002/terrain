import { describe, it, expect } from "vitest";
import { multiFileCacheKey } from "@/lib/cache";

// ---------------------------------------------------------------------------
// multiFileCacheKey — deterministic hashing of multi-file projects
// ---------------------------------------------------------------------------

describe("multiFileCacheKey", () => {
  it("returns a string with multi: prefix", () => {
    const key = multiFileCacheKey({
      "main.bicep": "param x string",
    });
    expect(key).toContain("bicep:cache:multi:");
    expect(key.length).toBeGreaterThan(20);
  });

  it("produces the same key for identical content", () => {
    const files = {
      "main.bicep": "param x string",
      "modules/storage.bicep": "resource sa ...",
    };
    const key1 = multiFileCacheKey(files);
    const key2 = multiFileCacheKey(files);
    expect(key1).toBe(key2);
  });

  it("produces the same key regardless of key insertion order", () => {
    const files1 = {
      "main.bicep": "param x string",
      "modules/storage.bicep": "resource sa ...",
    };
    const files2 = {
      "modules/storage.bicep": "resource sa ...",
      "main.bicep": "param x string",
    };
    expect(multiFileCacheKey(files1)).toBe(multiFileCacheKey(files2));
  });

  it("produces different keys for different content", () => {
    const files1 = { "main.bicep": "param x string" };
    const files2 = { "main.bicep": "param y int" };
    expect(multiFileCacheKey(files1)).not.toBe(multiFileCacheKey(files2));
  });

  it("produces different keys for different file names with same content", () => {
    const files1 = { "a.bicep": "param x string" };
    const files2 = { "b.bicep": "param x string" };
    expect(multiFileCacheKey(files1)).not.toBe(multiFileCacheKey(files2));
  });
});

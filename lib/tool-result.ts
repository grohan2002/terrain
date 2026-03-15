// ---------------------------------------------------------------------------
// Structured tool return type for consistent error handling.
// ---------------------------------------------------------------------------

export type ToolResult =
  | { ok: true; data: string; metadata?: Record<string, unknown> }
  | { ok: false; error: string; code?: string };

/** Create a successful result. */
export function ok(data: string, metadata?: Record<string, unknown>): ToolResult {
  return { ok: true, data, metadata };
}

/** Create a failure result. */
export function err(error: string, code?: string): ToolResult {
  return { ok: false, error, code };
}

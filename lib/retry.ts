// ---------------------------------------------------------------------------
// Retry with exponential backoff + jitter for Claude API calls.
// Rate-limit-aware: parses Retry-After header and uses longer delays for 429s.
// ---------------------------------------------------------------------------

import { logger } from "./logger";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  retryOn?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 5,
  baseDelayMs: 2000,
  retryOn: defaultRetryOn,
};

function defaultRetryOn(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: number }).status;
    return status === 429 || status === 500 || status === 502 || status === 503;
  }
  // Network errors
  if (error instanceof Error && error.message.includes("fetch")) {
    return true;
  }
  return false;
}

/**
 * Extract the Retry-After delay (in ms) from an Anthropic API error.
 * The SDK attaches response headers to error objects.
 */
function extractRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;

  // The Anthropic SDK error may have `headers` as a Headers-like object or plain object
  const err = error as Record<string, unknown>;

  // Try err.headers (Anthropic SDK attaches this)
  let retryAfter: string | null | undefined;

  if (err.headers && typeof err.headers === "object") {
    const headers = err.headers as Record<string, unknown>;
    // Headers object with .get()
    if (typeof (headers as { get?: unknown }).get === "function") {
      retryAfter = (headers as { get: (k: string) => string | null }).get("retry-after");
    }
    // Plain object
    if (!retryAfter && typeof headers["retry-after"] === "string") {
      retryAfter = headers["retry-after"];
    }
  }

  // Also check err.error?.message for embedded retry info
  if (!retryAfter && typeof err.message === "string") {
    // Some rate-limit messages suggest a wait time
    const match = (err.message as string).match(/try again (?:in|after)\s+(\d+)\s*(?:second|sec|s)/i);
    if (match) {
      return parseInt(match[1], 10) * 1000;
    }
  }

  if (!retryAfter) return undefined;

  // Retry-After can be seconds (number) or an HTTP date
  const seconds = Number(retryAfter);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // Try as HTTP date
  const date = Date.parse(retryAfter);
  if (!isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return undefined;
}

function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    return (error as { status: number }).status === 429;
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const { maxRetries, baseDelayMs, retryOn } = { ...DEFAULT_OPTIONS, ...options };

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries || !retryOn(error)) {
        throw error;
      }

      let delay: number;

      if (isRateLimitError(error)) {
        // For rate limits, respect Retry-After header or use aggressive backoff
        const retryAfterMs = extractRetryAfterMs(error);

        // Exponential backoff starting at a longer base for rate limits
        const computedDelay = Math.min(
          60_000, // cap at 60s
          baseDelayMs * Math.pow(2, attempt) * (0.8 + Math.random() * 0.4),
        );

        // Use whichever is longer: the header or our computed delay
        delay = retryAfterMs ? Math.max(retryAfterMs + 500, computedDelay) : computedDelay;

        logger.warn(
          {
            attempt: attempt + 1,
            maxRetries,
            delayMs: Math.round(delay),
            retryAfterMs: retryAfterMs ?? "none",
          },
          "Rate limited (429) — waiting before retry",
        );
      } else {
        // Standard exponential backoff with jitter for server errors
        delay = baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);

        logger.warn(
          { attempt: attempt + 1, maxRetries, delayMs: Math.round(delay) },
          "Retrying after server error",
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

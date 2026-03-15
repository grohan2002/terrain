// ---------------------------------------------------------------------------
// Retry with exponential backoff + jitter for Claude API calls.
// ---------------------------------------------------------------------------

import { logger } from "./logger";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  retryOn?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
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

      // Exponential backoff with jitter
      const delay = baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);

      logger.warn(
        { attempt: attempt + 1, maxRetries, delayMs: Math.round(delay) },
        "Retrying after error",
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

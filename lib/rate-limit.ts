// ---------------------------------------------------------------------------
// Rate limiting — in-memory Map for dev, Upstash Redis for production.
// ---------------------------------------------------------------------------

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const BUCKETS: Record<string, RateLimitConfig> = {
  conversion: { maxRequests: 10, windowMs: 60_000 },
  deploy: { maxRequests: 2, windowMs: 60_000 },
};

// In-memory store (per-process, sufficient for development)
const store = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function checkRateLimit(
  bucket: keyof typeof BUCKETS,
  identifier: string,
): RateLimitResult {
  const config = BUCKETS[bucket];
  if (!config) {
    return { allowed: true, remaining: 999, retryAfterMs: 0 };
  }

  const key = `${bucket}:${identifier}`;
  const now = Date.now();
  const entry = store.get(key);

  // Window expired or first request
  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      retryAfterMs: 0,
    };
  }

  // Within window
  if (entry.count < config.maxRequests) {
    entry.count++;
    return {
      allowed: true,
      remaining: config.maxRequests - entry.count,
      retryAfterMs: 0,
    };
  }

  // Rate limited
  return {
    allowed: false,
    remaining: 0,
    retryAfterMs: entry.resetAt - now,
  };
}

/** Periodic cleanup to prevent memory leaks (every 5 minutes). */
if (typeof globalThis !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) {
        store.delete(key);
      }
    }
  }, 300_000).unref?.();
}

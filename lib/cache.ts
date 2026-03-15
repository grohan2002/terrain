// ---------------------------------------------------------------------------
// Redis caching layer for conversion results.
//
// Uses SHA-256 hash of bicep content as cache key with 24h TTL.
// Falls back gracefully when Redis is unavailable.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { env } from "./env";
import { logger } from "./logger";

let redis: import("ioredis").default | null = null;

async function getRedis() {
  if (redis) return redis;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    const Redis = (await import("ioredis")).default;
    redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 3000,
    });
    await redis.connect();
    logger.info("Redis cache connected");
    return redis;
  } catch (e) {
    logger.warn({ error: (e as Error).message }, "Redis connection failed, caching disabled");
    redis = null;
    return null;
  }
}

const CACHE_TTL = 86_400; // 24 hours in seconds
const KEY_PREFIX = "bicep:cache:";

function cacheKey(bicepContent: string): string {
  const hash = createHash("sha256").update(bicepContent).digest("hex");
  return `${KEY_PREFIX}${hash}`;
}

/** Cache key for multi-file projects — deterministic over sorted file paths. */
export function multiFileCacheKey(bicepFiles: Record<string, string>): string {
  const sorted = Object.keys(bicepFiles).sort();
  const combined = sorted.map((k) => `---FILE:${k}---\n${bicepFiles[k]}`).join("\n");
  const hash = createHash("sha256").update(combined).digest("hex");
  return `${KEY_PREFIX}multi:${hash}`;
}

export interface CachedConversion {
  terraformFiles: Record<string, string>;
  validationPassed: boolean;
  model: string;
}

export async function getCachedConversion(
  bicepContent: string,
): Promise<CachedConversion | null> {
  try {
    const client = await getRedis();
    if (!client) return null;

    const key = cacheKey(bicepContent);
    const raw = await client.get(key);
    if (!raw) return null;

    logger.debug({ key }, "Cache hit");
    return JSON.parse(raw) as CachedConversion;
  } catch (e) {
    logger.warn({ error: (e as Error).message }, "Cache read failed");
    return null;
  }
}

/**
 * Get cached conversion using a pre-computed cache key (for multi-file).
 * Unlike getCachedConversion, this does NOT re-hash the key.
 */
export async function getCachedConversionByKey(
  key: string,
): Promise<CachedConversion | null> {
  try {
    const client = await getRedis();
    if (!client) return null;

    const raw = await client.get(key);
    if (!raw) return null;

    logger.debug({ key }, "Cache hit (multi-file)");
    return JSON.parse(raw) as CachedConversion;
  } catch (e) {
    logger.warn({ error: (e as Error).message }, "Cache read failed");
    return null;
  }
}

export async function setCachedConversion(
  bicepContent: string,
  data: CachedConversion,
): Promise<void> {
  try {
    const client = await getRedis();
    if (!client) return;

    const key = cacheKey(bicepContent);
    await client.set(key, JSON.stringify(data), "EX", CACHE_TTL);
    logger.debug({ key }, "Cache set");
  } catch (e) {
    logger.warn({ error: (e as Error).message }, "Cache write failed");
  }
}

/**
 * Set cached conversion using a pre-computed cache key (for multi-file).
 * Unlike setCachedConversion, this does NOT re-hash the key.
 */
export async function setCachedConversionByKey(
  key: string,
  data: CachedConversion,
): Promise<void> {
  try {
    const client = await getRedis();
    if (!client) return;

    await client.set(key, JSON.stringify(data), "EX", CACHE_TTL);
    logger.debug({ key }, "Cache set (multi-file)");
  } catch (e) {
    logger.warn({ error: (e as Error).message }, "Cache write failed");
  }
}

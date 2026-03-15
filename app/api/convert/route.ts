// ---------------------------------------------------------------------------
// POST /api/convert — SSE endpoint for Bicep-to-Terraform conversion.
// Accepts both single-file (bicepContent) and multi-file (bicepFiles) payloads.
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { chatStream, chatStreamMultiFile } from "@/lib/agent/stream";
import { ConvertRequestSchema, ConvertMultiFileRequestSchema } from "@/lib/schemas";
import { createRequestLogger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { auditLog } from "@/lib/audit";
import { getCachedConversion, setCachedConversion, getCachedConversionByKey, setCachedConversionByKey, multiFileCacheKey } from "@/lib/cache";
import type { StreamEvent } from "@/lib/types";
import { v4 as uuid } from "uuid";

/** Allow up to 5 minutes for long conversions with many tool rounds. */
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const requestId = uuid();
  const log = createRequestLogger(requestId);
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";

  // Rate limit
  const rl = checkRateLimit("conversion", ip);
  if (!rl.allowed) {
    log.warn({ ip }, "Rate limited");
    return Response.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Detect multi-file vs single-file based on presence of `bicepFiles`
  const isMultiFile =
    typeof body === "object" &&
    body !== null &&
    "bicepFiles" in body;

  if (isMultiFile) {
    return handleMultiFile(body, request, requestId, log, ip);
  }

  return handleSingleFile(body, request, requestId, log, ip);
}

// ---------------------------------------------------------------------------
// Single-file handler (existing behavior)
// ---------------------------------------------------------------------------

function handleSingleFile(
  body: unknown,
  request: NextRequest,
  requestId: string,
  log: ReturnType<typeof createRequestLogger>,
  ip: string,
) {
  const parsed = ConvertRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { bicepContent, apiKey } = parsed.data;

  log.info({ ip, contentLength: bicepContent.length }, "Conversion started");
  auditLog("conversion.started", { contentLength: bicepContent.length }, undefined, ip);

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  function sendEvent(event: StreamEvent): void {
    const data = JSON.stringify(event);
    writer.write(encoder.encode(`data: ${data}\n\n`)).catch(() => {});
  }

  const signal = request.signal;

  // Check cache first (only when not using a custom API key)
  const cacheCheck = (async () => {
    if (!apiKey) {
      const cached = await getCachedConversion(bicepContent);
      if (cached) {
        log.info("Cache hit — replaying cached conversion");
        sendEvent({ type: "terraform_output", files: cached.terraformFiles });
        sendEvent({ type: "validation", passed: cached.validationPassed, output: "Cached result" });
        sendEvent({ type: "done", fullReply: "[Served from cache]", toolCalls: [] });
        writer.close().catch(() => {});
        return true;
      }
    }
    return false;
  })();

  cacheCheck.then((hit) => {
    if (hit) return;

    let cachedFiles: Record<string, string> | null = null;
    let cachedValidation = false;
    let cachedModel = "";

    function wrappedSendEvent(event: StreamEvent): void {
      if (event.type === "terraform_output") cachedFiles = event.files;
      if (event.type === "validation") cachedValidation = event.passed;
      if (event.type === "done" && "model" in event) cachedModel = event.model ?? "";
      sendEvent(event);
    }

    chatStream(bicepContent, wrappedSendEvent, signal, apiKey)
      .then(() => {
        log.info("Conversion completed");
        auditLog("conversion.completed", { contentLength: bicepContent.length }, undefined, ip);

        if (!apiKey && cachedFiles && Object.keys(cachedFiles).length > 0) {
          setCachedConversion(bicepContent, {
            terraformFiles: cachedFiles,
            validationPassed: cachedValidation,
            model: cachedModel,
          });
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ error: message }, "Conversion failed");
        auditLog("conversion.failed", { error: message }, undefined, ip);
        sendEvent({ type: "error", message });
      })
      .finally(() => {
        writer.close().catch(() => {});
      });
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Request-Id": requestId,
    },
  });
}

// ---------------------------------------------------------------------------
// Multi-file handler
// ---------------------------------------------------------------------------

function handleMultiFile(
  body: unknown,
  request: NextRequest,
  requestId: string,
  log: ReturnType<typeof createRequestLogger>,
  ip: string,
) {
  const parsed = ConvertMultiFileRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { bicepFiles, entryPoint, apiKey } = parsed.data;
  const fileCount = Object.keys(bicepFiles).length;

  log.info({ ip, fileCount, entryPoint }, "Multi-file conversion started");
  auditLog("conversion.multi_started", { fileCount, entryPoint }, undefined, ip);

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  function sendEvent(event: StreamEvent): void {
    const data = JSON.stringify(event);
    writer.write(encoder.encode(`data: ${data}\n\n`)).catch(() => {});
  }

  const signal = request.signal;
  const mfCacheKey = multiFileCacheKey(bicepFiles);

  // Check cache first (only when not using a custom API key)
  const cacheCheck = (async () => {
    if (!apiKey) {
      const cached = await getCachedConversionByKey(mfCacheKey);
      if (cached) {
        log.info("Multi-file cache hit — replaying cached conversion");
        sendEvent({ type: "terraform_output", files: cached.terraformFiles });
        sendEvent({ type: "validation", passed: cached.validationPassed, output: "Cached result" });
        sendEvent({ type: "done", fullReply: "[Served from cache]", toolCalls: [] });
        writer.close().catch(() => {});
        return true;
      }
    }
    return false;
  })();

  cacheCheck.then((hit) => {
    if (hit) return;

    // Track terraform output for caching
    let cachedFiles: Record<string, string> | null = null;
    let cachedValidation = false;
    let cachedModel = "";

    function wrappedSendEvent(event: StreamEvent): void {
      if (event.type === "terraform_output") cachedFiles = event.files;
      if (event.type === "validation") cachedValidation = event.passed;
      if (event.type === "done" && "model" in event) cachedModel = event.model ?? "";
      sendEvent(event);
    }

    chatStreamMultiFile(bicepFiles, entryPoint, wrappedSendEvent, signal, apiKey)
      .then(() => {
        log.info("Multi-file conversion completed");
        auditLog("conversion.multi_completed", { fileCount, entryPoint }, undefined, ip);

        // Cache successful conversions using pre-computed key (no double-hashing)
        if (!apiKey && cachedFiles && Object.keys(cachedFiles).length > 0) {
          setCachedConversionByKey(mfCacheKey, {
            terraformFiles: cachedFiles,
            validationPassed: cachedValidation,
            model: cachedModel,
          });
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ error: message }, "Multi-file conversion failed");
        auditLog("conversion.multi_failed", { error: message }, undefined, ip);
        sendEvent({ type: "error", message });
      })
      .finally(() => {
        writer.close().catch(() => {});
      });
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Request-Id": requestId,
    },
  });
}

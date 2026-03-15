// ---------------------------------------------------------------------------
// POST /api/deploy — SSE endpoint for deployment testing.
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { deployStream } from "@/lib/deploy-agent/stream";
import { DeployRequestSchema } from "@/lib/schemas";
import { createRequestLogger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { auditLog } from "@/lib/audit";
import type { DeployStreamEvent } from "@/lib/types";
import { v4 as uuid } from "uuid";

/** Allow up to 10 minutes for deployment + testing. */
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  const requestId = uuid();
  const log = createRequestLogger(requestId);
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";

  // Rate limit
  const rl = checkRateLimit("deploy", ip);
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

  // Parse & validate
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = DeployRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { terraformFiles, workingDir, resourceGroupName, bicepContent, apiKey } =
    parsed.data;

  log.info(
    { ip, resourceGroupName, fileCount: Object.keys(terraformFiles).length },
    "Deployment started",
  );
  auditLog("deployment.started", { resourceGroupName }, undefined, ip);

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  function sendEvent(event: DeployStreamEvent): void {
    const data = JSON.stringify(event);
    writer.write(encoder.encode(`data: ${data}\n\n`)).catch(() => {});
  }

  const signal = request.signal;

  deployStream(
    terraformFiles,
    workingDir,
    resourceGroupName,
    bicepContent,
    sendEvent,
    signal,
    apiKey,
  )
    .then(() => {
      log.info("Deployment completed");
      auditLog("deployment.completed", { resourceGroupName }, undefined, ip);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ error: message }, "Deployment failed");
      auditLog("deployment.failed", { resourceGroupName, error: message }, undefined, ip);
      sendEvent({ type: "error", message });
    })
    .finally(() => {
      writer.close().catch(() => {});
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

// ---------------------------------------------------------------------------
// POST /api/github/scan — Scan a GitHub repo for Bicep files.
//
// Returns a JSON payload of { files, entryPoint, stats } that the client
// can feed directly into setBicepFiles() for multi-file conversion.
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { v4 as uuid } from "uuid";
import { GitHubScanRequestSchema } from "@/lib/schemas";
import { createRequestLogger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { auditLog } from "@/lib/audit";
import { parseGitHubUrl, fetchRepoTree } from "@/lib/github";
import { detectEntryPoint } from "@/lib/bicep-modules";

export const maxDuration = 30; // seconds — tree + parallel file fetches

export async function POST(request: NextRequest) {
  const requestId = uuid();
  const log = createRequestLogger(requestId);
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";

  // -------------------------------------------------------------------------
  // Rate limit
  // -------------------------------------------------------------------------
  const rl = checkRateLimit("githubScan", ip);
  if (!rl.allowed) {
    log.warn({ ip }, "Rate limited (github scan)");
    return Response.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  // -------------------------------------------------------------------------
  // Parse & validate body
  // -------------------------------------------------------------------------
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = GitHubScanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { repoUrl, branch, subdirectory, token } = parsed.data;

  // -------------------------------------------------------------------------
  // Parse repo URL
  // -------------------------------------------------------------------------
  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = parseGitHubUrl(repoUrl));
  } catch (e) {
    return Response.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }

  log.info({ ip, owner, repo, branch, subdirectory }, "GitHub scan started");
  auditLog("github_scan.started", { owner, repo, branch, subdirectory }, undefined, ip);

  // -------------------------------------------------------------------------
  // Fetch tree + file contents
  // -------------------------------------------------------------------------
  try {
    const result = await fetchRepoTree({
      owner,
      repo,
      branch,
      subdirectory,
      token,
    });

    // Detect entry point using existing heuristics
    const entryPoint = detectEntryPoint(result.files);

    log.info(
      { owner, repo, bicepFiles: result.stats.bicepFilesFound, branch: result.stats.branch },
      "GitHub scan completed",
    );
    auditLog(
      "github_scan.completed",
      { owner, repo, bicepFiles: result.stats.bicepFilesFound },
      undefined,
      ip,
    );

    return Response.json({
      files: result.files,
      entryPoint,
      stats: result.stats,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error({ error: message, owner, repo }, "GitHub scan failed");
    auditLog(
      "github_scan.failed",
      { error: message, owner, repo },
      undefined,
      ip,
    );

    // Map error messages to appropriate HTTP status codes
    let status = 500;
    if (message.includes("not found") || message.includes("NOT_FOUND")) {
      status = 404;
    } else if (message.includes("rate limit")) {
      status = 429;
    } else if (message.includes("Invalid GitHub token")) {
      status = 401;
    }

    return Response.json({ error: message }, { status });
  }
}

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

  const { repoUrl, branch, subdirectory, token, sourceFormat } = parsed.data;

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

  log.info(
    { ip, owner, repo, branch, subdirectory, sourceFormat },
    "GitHub scan started",
  );
  auditLog(
    "github_scan.started",
    { owner, repo, branch, subdirectory, sourceFormat },
    undefined,
    ip,
  );

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
      sourceFormat,
    });

    // Detect entry point. For Bicep we use the existing module-aware heuristic;
    // for CloudFormation we use a minimal "common-name first, then alphabetic"
    // heuristic until lib/cf-modules.ts (Phase B) ships a smarter resolver.
    const entryPoint =
      sourceFormat === "cloudformation"
        ? detectCfEntryPointBasic(result.files)
        : detectEntryPoint(result.files);

    log.info(
      {
        owner,
        repo,
        sourceFiles: result.stats.sourceFilesFound,
        branch: result.stats.branch,
        sourceFormat,
      },
      "GitHub scan completed",
    );
    auditLog(
      "github_scan.completed",
      {
        owner,
        repo,
        sourceFiles: result.stats.sourceFilesFound,
        sourceFormat,
      },
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

// ---------------------------------------------------------------------------
// Minimal CloudFormation entry-point heuristic for Phase A. Phase B will
// replace this with a nested-stack-aware resolver in lib/cf-modules.ts.
// Priority: main.* / template.* in the root → sole root file → first root
// file alphabetically → first file overall.
// ---------------------------------------------------------------------------
function detectCfEntryPointBasic(files: Record<string, string>): string {
  const paths = Object.keys(files);
  if (paths.length === 0) return "";
  const isRoot = (p: string) => !p.includes("/");
  const PREFERRED = [
    "main.yaml",
    "main.yml",
    "main.json",
    "main.template",
    "template.yaml",
    "template.yml",
    "template.json",
    "template.template",
  ];
  for (const name of PREFERRED) {
    if (paths.includes(name)) return name;
  }
  const rootFiles = paths.filter(isRoot).sort();
  if (rootFiles.length > 0) return rootFiles[0];
  return paths.sort()[0];
}

// ---------------------------------------------------------------------------
// POST /api/deploy/destroy — Deterministic teardown (no LLM).
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { execSync } from "node:child_process";
import { DeployDestroySchema } from "@/lib/schemas";
import { createRequestLogger } from "@/lib/logger";
import { auditLog } from "@/lib/audit";
import { v4 as uuid } from "uuid";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const requestId = uuid();
  const log = createRequestLogger(requestId);

  // Parse & validate
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = DeployDestroySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { workingDir, resourceGroupName } = parsed.data;

  log.info({ workingDir, resourceGroupName }, "Destroy started");
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  auditLog("destroy.started", { resourceGroupName }, undefined, ip);

  // Detect CLI
  let cli: string;
  try {
    execSync("which tofu", { stdio: "pipe" });
    cli = "tofu";
  } catch {
    try {
      execSync("which terraform", { stdio: "pipe" });
      cli = "terraform";
    } catch {
      return Response.json(
        { error: "Neither 'tofu' nor 'terraform' found in PATH." },
        { status: 500 },
      );
    }
  }

  const outputs: string[] = [];

  // 1. Run tofu/terraform destroy
  try {
    const destroyOutput = execSync(
      `${cli} destroy -auto-approve -no-color -input=false`,
      {
        cwd: workingDir,
        timeout: 300_000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    outputs.push(`${cli} destroy:\n${destroyOutput}`);
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; status?: number };
    const combined = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n");
    outputs.push(
      `${cli} destroy failed (exit ${execErr.status ?? "unknown"}):\n${combined}`,
    );
    log.warn({ error: combined }, "Terraform destroy failed, continuing to delete RG");
  }

  // 2. Delete the Azure resource group (async, non-blocking)
  try {
    execSync(
      `az group delete -n "${resourceGroupName}" --yes --no-wait`,
      {
        timeout: 30_000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    outputs.push(`Resource group '${resourceGroupName}' deletion initiated.`);
  } catch (err: unknown) {
    const execErr = err as { stderr?: string };
    outputs.push(
      `Warning: Failed to delete resource group: ${execErr.stderr ?? "unknown error"}`,
    );
  }

  log.info({ resourceGroupName }, "Destroy completed");
  auditLog("destroy.completed", { resourceGroupName }, undefined, ip);

  return Response.json({
    success: true,
    output: outputs.join("\n\n"),
  });
}

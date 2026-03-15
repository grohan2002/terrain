// ---------------------------------------------------------------------------
// POST /api/deploy/setup — Pre-flight for deployment testing.
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { DeploySetupSchema } from "@/lib/schemas";
import { createRequestLogger } from "@/lib/logger";
import { v4 as uuid } from "uuid";

export const maxDuration = 120;

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

  const parsed = DeploySetupSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { terraformFiles, location } = parsed.data;

  // Generate unique resource group name
  const suffix = crypto.randomBytes(4).toString("hex");
  const resourceGroupName = `rg-bicep-test-${suffix}`;

  // Create temp working directory
  const workingDir = path.join(os.tmpdir(), `bicep-deploy-${suffix}`);

  log.info({ resourceGroupName, workingDir, location }, "Setup started");

  try {
    fs.mkdirSync(workingDir, { recursive: true });

    // Write all .tf files (preserving nested module paths like modules/storage/main.tf)
    for (const [filename, content] of Object.entries(terraformFiles)) {
      const filePath = path.join(workingDir, filename);
      // Prevent path traversal: ensure resolved path stays within workingDir
      const resolvedBase = path.resolve(workingDir) + path.sep;
      const resolvedFile = path.resolve(filePath);
      if (!resolvedFile.startsWith(resolvedBase) && resolvedFile !== path.resolve(workingDir)) {
        continue; // skip files with path traversal attempts
      }
      // Create parent directories for nested paths
      const parentDir = path.dirname(filePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, "utf-8");
    }

    // Write terraform.tfvars with resource group and location
    const tfvars = [
      `resource_group_name = "${resourceGroupName}"`,
      `location            = "${location}"`,
    ].join("\n");
    fs.writeFileSync(path.join(workingDir, "terraform.tfvars"), tfvars, "utf-8");

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

    // Create resource group
    try {
      execSync(
        `az group create -n "${resourceGroupName}" -l "${location}" -o none`,
        { timeout: 30_000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch (err: unknown) {
      const execErr = err as { stderr?: string };
      log.error({ error: execErr.stderr }, "Failed to create resource group");
      return Response.json(
        { error: `Failed to create resource group: ${execErr.stderr ?? "unknown error"}` },
        { status: 500 },
      );
    }

    // Run tofu/terraform init
    try {
      execSync(`${cli} init -input=false -no-color`, {
        cwd: workingDir,
        timeout: 120_000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; status?: number };
      const combined = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n");
      log.error({ error: combined }, `${cli} init failed`);
      return Response.json(
        { error: `${cli} init failed (exit ${execErr.status ?? "unknown"}):\n${combined}` },
        { status: 500 },
      );
    }

    log.info({ cli, resourceGroupName }, "Setup completed");
    return Response.json({ workingDir, resourceGroupName, cli });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ error: msg }, "Setup failed");
    return Response.json({ error: `Setup failed: ${msg}` }, { status: 500 });
  }
}

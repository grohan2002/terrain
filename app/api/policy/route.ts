// ---------------------------------------------------------------------------
// POST /api/policy — Evaluate OPA policies against Terraform files.
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequestLogger } from "@/lib/logger";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import type { PolicyViolation, PolicyResult } from "@/lib/types";

export const maxDuration = 60;

const PolicyRequestSchema = z.object({
  terraformFiles: z.record(z.string(), z.string()),
});

export async function POST(request: NextRequest) {
  const requestId = uuid();
  const log = createRequestLogger(requestId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PolicyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { terraformFiles } = parsed.data;

  // Check if OPA is available
  let opaAvailable = false;
  try {
    execSync("which opa", { stdio: "pipe" });
    opaAvailable = true;
  } catch {
    // OPA not installed
  }

  let violations: PolicyViolation[] = [];

  if (opaAvailable) {
    const tempDir = mkdtempSync(join(tmpdir(), "opa-eval-"));
    try {
      // Write TF files as a simple input JSON (simulating plan output)
      const resources = extractResources(terraformFiles);
      const inputJson = JSON.stringify({ resource_changes: resources });
      writeFileSync(join(tempDir, "input.json"), inputJson);

      // Find policy files
      const policiesDir = join(process.cwd(), "policies");
      const policyFiles = ["encryption.rego", "public_access.rego", "tagging.rego"];

      for (const policyFile of policyFiles) {
        const policyPath = join(policiesDir, policyFile);
        if (!existsSync(policyPath)) continue;

        const pkg = policyFile.replace(".rego", "");
        try {
          const output = execSync(
            `opa eval -i "${join(tempDir, "input.json")}" -d "${policyPath}" "data.bicep.${pkg}.deny" --format json`,
            { encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] },
          );

          const result = JSON.parse(output);
          const denials = result.result?.[0]?.expressions?.[0]?.value ?? [];
          for (const msg of denials) {
            violations.push({
              policy: pkg,
              rule: "deny",
              severity: "error",
              message: typeof msg === "string" ? msg : JSON.stringify(msg),
            });
          }
        } catch (e) {
          log.warn({ policy: policyFile, error: (e as Error).message }, "OPA eval failed");
        }
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } else {
    // Fallback: basic policy checks without OPA
    violations = runBasicPolicyChecks(terraformFiles);
  }

  const result: PolicyResult = {
    passed: violations.filter((v) => v.severity === "error").length === 0,
    violations,
    evaluatedAt: new Date().toISOString(),
  };

  log.info({ violationCount: violations.length, opaAvailable }, "Policy evaluation completed");

  return Response.json(result);
}

/** Extract resource-like structures from TF files for policy input. */
function extractResources(files: Record<string, string>) {
  const resources: { name: string; type: string; change: { after: Record<string, unknown> } }[] = [];
  const resourceRegex = /resource\s+"(\w+)"\s+"(\w+)"\s*\{/g;

  for (const [, content] of Object.entries(files)) {
    let match;
    while ((match = resourceRegex.exec(content)) !== null) {
      const type = match[1];
      const name = match[2];
      // Extract simple key-value pairs from the block
      const after: Record<string, unknown> = {};
      const blockStart = match.index + match[0].length;
      let depth = 1;
      let pos = blockStart;
      while (pos < content.length && depth > 0) {
        if (content[pos] === "{") depth++;
        if (content[pos] === "}") depth--;
        pos++;
      }
      const block = content.slice(blockStart, pos - 1);
      const kvRegex = /(\w+)\s*=\s*("([^"]*)"|true|false|\d+)/g;
      let kvMatch;
      while ((kvMatch = kvRegex.exec(block)) !== null) {
        const val = kvMatch[3] ?? kvMatch[2];
        after[kvMatch[1]] = val === "true" ? true : val === "false" ? false : val;
      }
      resources.push({ name, type, change: { after } });
    }
  }

  return resources;
}

/** Basic policy checks when OPA is not available. */
function runBasicPolicyChecks(files: Record<string, string>): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const resources = extractResources(files);

  for (const resource of resources) {
    // Check public access
    if (resource.change.after.public_network_access_enabled === true) {
      violations.push({
        policy: "public_access",
        rule: "deny",
        severity: "error",
        message: `Resource '${resource.name}' (${resource.type}) has public network access enabled`,
        resource: resource.name,
      });
    }

    // Check tagging
    if (!resource.change.after.tags) {
      violations.push({
        policy: "tagging",
        rule: "deny",
        severity: "warning",
        message: `Resource '${resource.name}' (${resource.type}) has no tags defined`,
        resource: resource.name,
      });
    }

    // Check HTTPS
    if (resource.type === "azurerm_storage_account" && resource.change.after.enable_https_traffic_only === false) {
      violations.push({
        policy: "public_access",
        rule: "deny",
        severity: "error",
        message: `Storage account '${resource.name}' does not enforce HTTPS-only traffic`,
        resource: resource.name,
      });
    }
  }

  return violations;
}

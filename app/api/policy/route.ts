// ---------------------------------------------------------------------------
// POST /api/policy — Evaluate OPA policies against Terraform files.
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
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
    // Fallback: comprehensive policy checks without OPA
    violations = runBasicPolicyChecks(terraformFiles);
  }

  const result: PolicyResult = {
    passed: violations.filter((v) => v.severity === "error").length === 0,
    violations,
    evaluatedAt: new Date().toISOString(),
    opaUsed: opaAvailable,
  };

  log.info({ violationCount: violations.length, opaAvailable }, "Policy evaluation completed");

  return Response.json(result);
}

// ---------------------------------------------------------------------------
// Resource extraction — parses Terraform HCL blocks into structured data
// ---------------------------------------------------------------------------

interface ExtractedResource {
  name: string;
  type: string;
  block: string; // Raw block content
  props: Record<string, string | boolean | number>; // Flat properties
  hasBlock: (name: string) => boolean; // Check if a nested block exists
}

/** Extract resource blocks from Terraform files with better parsing. */
function extractResources(files: Record<string, string>): ExtractedResource[] {
  const resources: ExtractedResource[] = [];
  const resourceRegex = /resource\s+"(\w+)"\s+"(\w+)"\s*\{/g;

  for (const [, content] of Object.entries(files)) {
    let match;
    while ((match = resourceRegex.exec(content)) !== null) {
      const type = match[1];
      const name = match[2];
      const blockStart = match.index + match[0].length;

      // Find the matching closing brace
      let depth = 1;
      let pos = blockStart;
      while (pos < content.length && depth > 0) {
        if (content[pos] === "{") depth++;
        if (content[pos] === "}") depth--;
        pos++;
      }
      const block = content.slice(blockStart, pos - 1);

      // Extract properties — handle strings, bools, numbers, references
      const props: Record<string, string | boolean | number> = {};
      const kvRegex = /^\s*(\w+)\s*=\s*(.+)/gm;
      let kvMatch;
      while ((kvMatch = kvRegex.exec(block)) !== null) {
        const key = kvMatch[1];
        let val = kvMatch[2].trim();
        // Remove trailing comments
        val = val.replace(/\s*#.*$/, "").replace(/\s*\/\/.*$/, "");
        if (val === "true") props[key] = true;
        else if (val === "false") props[key] = false;
        else if (/^-?\d+(\.\d+)?$/.test(val)) props[key] = parseFloat(val);
        else if (val.startsWith('"') && val.endsWith('"')) props[key] = val.slice(1, -1);
        else props[key] = val; // var.x, local.y, function calls, etc.
      }

      // Helper to check if a nested block exists
      const hasBlock = (blockName: string) => {
        const blockRegex = new RegExp(`\\b${blockName}\\s*\\{`, "m");
        return blockRegex.test(block);
      };

      resources.push({ name, type, block, props, hasBlock });
    }
  }

  return resources;
}

// ---------------------------------------------------------------------------
// Resource types that should have specific security configurations
// ---------------------------------------------------------------------------

const STORAGE_TYPES = new Set([
  "azurerm_storage_account",
]);

const DATABASE_TYPES = new Set([
  "azurerm_mssql_database", "azurerm_mssql_server",
  "azurerm_cosmosdb_account",
  "azurerm_postgresql_flexible_server", "azurerm_mysql_flexible_server",
  "azurerm_redis_cache",
]);

const NETWORK_TYPES = new Set([
  "azurerm_storage_account", "azurerm_key_vault",
  "azurerm_cosmosdb_account", "azurerm_container_registry",
  "azurerm_cognitive_account", "azurerm_search_service",
  "azurerm_mssql_server", "azurerm_postgresql_flexible_server",
  "azurerm_mysql_flexible_server",
]);

const TAGGABLE_TYPES = new Set([
  "azurerm_resource_group", "azurerm_storage_account",
  "azurerm_virtual_network", "azurerm_subnet",
  "azurerm_network_security_group", "azurerm_public_ip",
  "azurerm_linux_virtual_machine", "azurerm_windows_virtual_machine",
  "azurerm_key_vault", "azurerm_app_service_plan", "azurerm_service_plan",
  "azurerm_linux_web_app", "azurerm_windows_web_app",
  "azurerm_kubernetes_cluster", "azurerm_container_registry",
  "azurerm_cosmosdb_account", "azurerm_mssql_server",
  "azurerm_log_analytics_workspace", "azurerm_application_insights",
  "azurerm_lb", "azurerm_application_gateway", "azurerm_firewall",
  "azurerm_nat_gateway", "azurerm_bastion_host",
  "azurerm_postgresql_flexible_server", "azurerm_mysql_flexible_server",
]);

// ---------------------------------------------------------------------------
// Comprehensive policy checks fallback
// ---------------------------------------------------------------------------

function runBasicPolicyChecks(files: Record<string, string>): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const resources = extractResources(files);

  for (const resource of resources) {
    // --- TAGGING POLICY ---
    if (TAGGABLE_TYPES.has(resource.type) && !resource.hasBlock("tags")) {
      violations.push({
        policy: "tagging",
        rule: "require_tags",
        severity: "warning",
        message: `Resource '${resource.name}' (${resource.type}) has no tags defined. All resources should be tagged for cost tracking and governance.`,
        resource: resource.name,
      });
    }

    // --- PUBLIC ACCESS POLICY ---
    if (resource.props.public_network_access_enabled === true) {
      violations.push({
        policy: "public_access",
        rule: "deny_public_access",
        severity: "error",
        message: `Resource '${resource.name}' (${resource.type}) has public network access enabled.`,
        resource: resource.name,
      });
    }

    // Resources that SHOULD have public access explicitly disabled
    if (NETWORK_TYPES.has(resource.type) && resource.props.public_network_access_enabled === undefined) {
      violations.push({
        policy: "public_access",
        rule: "explicit_network_policy",
        severity: "warning",
        message: `Resource '${resource.name}' (${resource.type}) does not explicitly set public_network_access_enabled. Consider setting it to false.`,
        resource: resource.name,
      });
    }

    // --- ENCRYPTION POLICY ---
    // Storage: check HTTPS enforcement
    if (STORAGE_TYPES.has(resource.type)) {
      if (resource.props.https_traffic_only_enabled === false ||
          resource.props.enable_https_traffic_only === false) {
        violations.push({
          policy: "encryption",
          rule: "require_https",
          severity: "error",
          message: `Storage account '${resource.name}' does not enforce HTTPS-only traffic.`,
          resource: resource.name,
        });
      }

      // Check minimum TLS version
      const tls = resource.props.min_tls_version;
      if (typeof tls === "string" && (tls === "TLS1_0" || tls === "TLS1_1")) {
        violations.push({
          policy: "encryption",
          rule: "require_tls_1_2",
          severity: "error",
          message: `Storage account '${resource.name}' uses outdated TLS version '${tls}'. Use TLS1_2 or higher.`,
          resource: resource.name,
        });
      }
    }

    // --- DATABASE POLICY ---
    if (DATABASE_TYPES.has(resource.type)) {
      // SQL Server: check minimum TLS
      if (resource.type === "azurerm_mssql_server") {
        const tls = resource.props.minimum_tls_version;
        if (typeof tls === "string" && tls !== "1.2" && tls !== "Disabled") {
          violations.push({
            policy: "encryption",
            rule: "require_tls_1_2",
            severity: "error",
            message: `SQL Server '${resource.name}' uses TLS version '${tls}'. Use 1.2.`,
            resource: resource.name,
          });
        }
      }
    }

    // --- LOGGING & MONITORING POLICY ---
    // Key Vault: should have soft delete and purge protection
    if (resource.type === "azurerm_key_vault") {
      if (resource.props.purge_protection_enabled !== true) {
        violations.push({
          policy: "data_protection",
          rule: "require_purge_protection",
          severity: "warning",
          message: `Key Vault '${resource.name}' does not have purge protection enabled.`,
          resource: resource.name,
        });
      }
    }

    // Container Registry: admin access
    if (resource.type === "azurerm_container_registry") {
      if (resource.props.admin_enabled === true) {
        violations.push({
          policy: "access_control",
          rule: "deny_admin_access",
          severity: "error",
          message: `Container Registry '${resource.name}' has admin access enabled. Use managed identity instead.`,
          resource: resource.name,
        });
      }
    }

    // --- LIFECYCLE POLICY ---
    // Check stateful resources for lifecycle protection
    const statefulTypes = new Set([
      "azurerm_storage_account", "azurerm_key_vault",
      "azurerm_mssql_database", "azurerm_cosmosdb_account",
      "azurerm_postgresql_flexible_server", "azurerm_mysql_flexible_server",
    ]);
    if (statefulTypes.has(resource.type) && !resource.hasBlock("lifecycle")) {
      violations.push({
        policy: "data_protection",
        rule: "recommend_lifecycle",
        severity: "warning",
        message: `Stateful resource '${resource.name}' (${resource.type}) has no lifecycle block. Consider adding prevent_destroy = true for production.`,
        resource: resource.name,
      });
    }

    // --- NETWORK SECURITY ---
    // NSG rules allowing all inbound traffic
    if (resource.type === "azurerm_network_security_rule") {
      const access = resource.props.access;
      const direction = resource.props.direction;
      const srcAddr = resource.props.source_address_prefix;
      if (access === "Allow" && direction === "Inbound" && srcAddr === "*") {
        violations.push({
          policy: "network_security",
          rule: "deny_open_inbound",
          severity: "error",
          message: `NSG rule '${resource.name}' allows inbound traffic from all sources (*). Restrict the source address prefix.`,
          resource: resource.name,
        });
      }
    }
  }

  return violations;
}

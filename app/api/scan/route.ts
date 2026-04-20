// ---------------------------------------------------------------------------
// POST /api/scan — Run Trivy security scan on Terraform files.
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createRequestLogger } from "@/lib/logger";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import type { ScanFinding, ScanResult } from "@/lib/types";

export const maxDuration = 60;

const ScanRequestSchema = z.object({
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

  const parsed = ScanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { terraformFiles } = parsed.data;

  // Write TF files to a temp directory
  const tempDir = mkdtempSync(join(tmpdir(), "trivy-scan-"));

  try {
    for (const [filename, content] of Object.entries(terraformFiles)) {
      const filePath = join(tempDir, filename);
      // Prevent path traversal
      const resolvedBase = resolve(tempDir) + sep;
      if (!resolve(filePath).startsWith(resolvedBase)) continue;
      // Create parent directories for nested module paths
      const parentDir = dirname(filePath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
      writeFileSync(filePath, content);
    }

    // Try running trivy
    let trivyAvailable = false;
    try {
      execSync("which trivy", { stdio: "pipe" });
      trivyAvailable = true;
    } catch {
      // Trivy not installed
    }

    let findings: ScanFinding[] = [];

    if (trivyAvailable) {
      try {
        const output = execSync(
          `trivy config --format json --severity HIGH,CRITICAL --quiet "${tempDir}"`,
          { encoding: "utf-8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] },
        );

        const result = JSON.parse(output);
        if (result.Results) {
          for (const r of result.Results) {
            for (const m of r.Misconfigurations ?? []) {
              findings.push({
                ruleId: m.ID ?? m.AVDID ?? "unknown",
                severity: m.Severity?.toUpperCase() ?? "MEDIUM",
                title: m.Title ?? "Unknown issue",
                description: m.Description ?? "",
                resource: m.CauseMetadata?.Resource ?? "",
                file: r.Target ?? "",
                lines: m.CauseMetadata?.StartLine
                  ? { start: m.CauseMetadata.StartLine, end: m.CauseMetadata.EndLine }
                  : undefined,
                resolution: m.Resolution ?? undefined,
              });
            }
          }
        }
      } catch (e) {
        const execErr = e as { stdout?: string; stderr?: string };
        // Trivy exits non-zero when it finds issues — parse stdout
        try {
          const result = JSON.parse(execErr.stdout ?? "{}");
          if (result.Results) {
            for (const r of result.Results) {
              for (const m of r.Misconfigurations ?? []) {
                findings.push({
                  ruleId: m.ID ?? m.AVDID ?? "unknown",
                  severity: m.Severity?.toUpperCase() ?? "MEDIUM",
                  title: m.Title ?? "Unknown issue",
                  description: m.Description ?? "",
                  resource: m.CauseMetadata?.Resource ?? "",
                  file: r.Target ?? "",
                  lines: m.CauseMetadata?.StartLine
                    ? { start: m.CauseMetadata.StartLine, end: m.CauseMetadata.EndLine }
                    : undefined,
                  resolution: m.Resolution ?? undefined,
                });
              }
            }
          }
        } catch {
          log.warn("Failed to parse trivy output");
        }
      }
    } else {
      // Fallback: comprehensive static analysis for common misconfigurations
      findings = runBasicScan(terraformFiles);
    }

    const scanResult: ScanResult = {
      passed: findings.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH").length === 0,
      findings,
      scannedAt: new Date().toISOString(),
      scanner: trivyAvailable ? "trivy" : "built-in",
      trivyUsed: trivyAvailable,
    };

    log.info({ findingCount: findings.length, scanner: scanResult.scanner }, "Scan completed");

    return Response.json(scanResult);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Resource-aware security scanner fallback
// ---------------------------------------------------------------------------

interface ParsedResource {
  type: string;
  name: string;
  block: string;
  file: string;
  startLine: number;
  props: Record<string, string | boolean | number>;
  hasBlock: (name: string) => boolean;
}

/** Parse all resource blocks from Terraform files. */
function parseResources(files: Record<string, string>): ParsedResource[] {
  const resources: ParsedResource[] = [];
  const resourceRegex = /resource\s+"(\w+)"\s+"(\w+)"\s*\{/g;

  for (const [filename, content] of Object.entries(files)) {
    let match;
    while ((match = resourceRegex.exec(content)) !== null) {
      const type = match[1];
      const name = match[2];
      const startLine = content.slice(0, match.index).split("\n").length;
      const blockStart = match.index + match[0].length;

      // Find matching closing brace
      let depth = 1;
      let pos = blockStart;
      while (pos < content.length && depth > 0) {
        if (content[pos] === "{") depth++;
        if (content[pos] === "}") depth--;
        pos++;
      }
      const block = content.slice(blockStart, pos - 1);

      // Extract top-level key-value props
      const props: Record<string, string | boolean | number> = {};
      const kvRegex = /^\s*(\w+)\s*=\s*(.+)/gm;
      let kvMatch;
      while ((kvMatch = kvRegex.exec(block)) !== null) {
        const key = kvMatch[1];
        let val = kvMatch[2].trim();
        val = val.replace(/\s*#.*$/, "").replace(/\s*\/\/.*$/, "");
        if (val === "true") props[key] = true;
        else if (val === "false") props[key] = false;
        else if (/^-?\d+(\.\d+)?$/.test(val)) props[key] = parseFloat(val);
        else if (val.startsWith('"') && val.endsWith('"')) props[key] = val.slice(1, -1);
        else props[key] = val;
      }

      const hasBlock = (blockName: string) => {
        const bRegex = new RegExp(`\\b${blockName}\\s*\\{`, "m");
        return bRegex.test(block);
      };

      resources.push({ type, name, block, file: filename, startLine, props, hasBlock });
    }
  }

  return resources;
}

/** Comprehensive security scan without Trivy. */
function runBasicScan(files: Record<string, string>): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const resources = parseResources(files);

  for (const r of resources) {
    // --- STORAGE ACCOUNT ---
    if (r.type === "azurerm_storage_account") {
      // HTTPS not enforced
      if (r.props.https_traffic_only_enabled === false || r.props.enable_https_traffic_only === false) {
        findings.push({
          ruleId: "AZU-SEC-001",
          severity: "HIGH",
          title: "HTTPS not enforced on storage account",
          description: "Storage account allows unencrypted HTTP traffic, exposing data in transit.",
          resource: `azurerm_storage_account.${r.name}`,
          file: r.file,
          lines: { start: r.startLine, end: r.startLine },
          resolution: "Set https_traffic_only_enabled = true",
        });
      }

      // Outdated TLS
      const tls = r.props.min_tls_version;
      if (typeof tls === "string" && (tls === "TLS1_0" || tls === "TLS1_1")) {
        findings.push({
          ruleId: "AZU-SEC-002",
          severity: "HIGH",
          title: "Outdated TLS version on storage account",
          description: `Storage account uses ${tls} which has known vulnerabilities.`,
          resource: `azurerm_storage_account.${r.name}`,
          file: r.file,
          lines: { start: r.startLine, end: r.startLine },
          resolution: 'Set min_tls_version = "TLS1_2"',
        });
      }

      // No network rules (unrestricted access)
      if (!r.hasBlock("network_rules")) {
        findings.push({
          ruleId: "AZU-SEC-003",
          severity: "MEDIUM",
          title: "Storage account has no network rules",
          description: "Storage account is accessible from all networks. Consider restricting with network_rules.",
          resource: `azurerm_storage_account.${r.name}`,
          file: r.file,
          lines: { start: r.startLine, end: r.startLine },
          resolution: "Add a network_rules block with default_action = \"Deny\"",
        });
      }

      // Blob public access
      if (r.props.allow_nested_items_to_be_public === true ||
          r.props.allow_blob_public_access === true) {
        findings.push({
          ruleId: "AZU-SEC-004",
          severity: "HIGH",
          title: "Blob public access enabled",
          description: "Storage account allows public access to blob containers.",
          resource: `azurerm_storage_account.${r.name}`,
          file: r.file,
          lines: { start: r.startLine, end: r.startLine },
          resolution: "Set allow_nested_items_to_be_public = false",
        });
      }
    }

    // --- KEY VAULT ---
    if (r.type === "azurerm_key_vault") {
      if (r.props.purge_protection_enabled !== true) {
        findings.push({
          ruleId: "AZU-SEC-010",
          severity: "MEDIUM",
          title: "Key Vault missing purge protection",
          description: "Key Vault can be permanently deleted without recovery period.",
          resource: `azurerm_key_vault.${r.name}`,
          file: r.file,
          lines: { start: r.startLine, end: r.startLine },
          resolution: "Set purge_protection_enabled = true",
        });
      }

      if (!r.hasBlock("network_acls")) {
        findings.push({
          ruleId: "AZU-SEC-011",
          severity: "MEDIUM",
          title: "Key Vault has no network ACLs",
          description: "Key Vault is accessible from all networks.",
          resource: `azurerm_key_vault.${r.name}`,
          file: r.file,
          lines: { start: r.startLine, end: r.startLine },
          resolution: "Add network_acls block with default_action = \"Deny\"",
        });
      }
    }

    // --- SQL SERVER ---
    if (r.type === "azurerm_mssql_server") {
      const tls = r.props.minimum_tls_version;
      if (typeof tls === "string" && tls !== "1.2") {
        findings.push({
          ruleId: "AZU-SEC-020",
          severity: "HIGH",
          title: "SQL Server using outdated TLS",
          description: `SQL Server uses TLS ${tls}. TLS 1.2 should be minimum.`,
          resource: `azurerm_mssql_server.${r.name}`,
          file: r.file,
          lines: { start: r.startLine, end: r.startLine },
          resolution: 'Set minimum_tls_version = "1.2"',
        });
      }

      if (r.props.public_network_access_enabled === true) {
        findings.push({
          ruleId: "AZU-SEC-021",
          severity: "HIGH",
          title: "SQL Server publicly accessible",
          description: "SQL Server allows connections from the public internet.",
          resource: `azurerm_mssql_server.${r.name}`,
          file: r.file,
          lines: { start: r.startLine, end: r.startLine },
          resolution: "Set public_network_access_enabled = false",
        });
      }
    }

    // --- CONTAINER REGISTRY ---
    if (r.type === "azurerm_container_registry") {
      if (r.props.admin_enabled === true) {
        findings.push({
          ruleId: "AZU-SEC-030",
          severity: "HIGH",
          title: "Container Registry admin access enabled",
          description: "Admin account provides unrestricted access to the registry.",
          resource: `azurerm_container_registry.${r.name}`,
          file: r.file,
          lines: { start: r.startLine, end: r.startLine },
          resolution: "Set admin_enabled = false and use managed identity",
        });
      }
    }

    // --- VIRTUAL MACHINE ---
    if (r.type === "azurerm_linux_virtual_machine" || r.type === "azurerm_windows_virtual_machine") {
      if (r.props.disable_password_authentication === false) {
        findings.push({
          ruleId: "AZU-SEC-040",
          severity: "HIGH",
          title: "Password authentication enabled on VM",
          description: "VM allows password-based SSH/RDP which is less secure than key-based auth.",
          resource: `${r.type}.${r.name}`,
          file: r.file,
          lines: { start: r.startLine, end: r.startLine },
          resolution: "Set disable_password_authentication = true and use SSH keys",
        });
      }

      // Check for managed disk encryption
      if (r.props.encryption_at_host_enabled !== true) {
        findings.push({
          ruleId: "AZU-SEC-041",
          severity: "MEDIUM",
          title: "Host encryption not enabled on VM",
          description: "VM temp disks and cached data are not encrypted at the host level.",
          resource: `${r.type}.${r.name}`,
          file: r.file,
          lines: { start: r.startLine, end: r.startLine },
          resolution: "Set encryption_at_host_enabled = true",
        });
      }
    }

    // --- NSG RULES ---
    if (r.type === "azurerm_network_security_rule") {
      const access = r.props.access;
      const direction = r.props.direction;
      const srcAddr = r.props.source_address_prefix;
      const destPort = r.props.destination_port_range;

      if (access === "Allow" && direction === "Inbound" && srcAddr === "*") {
        const severity = (destPort === "22" || destPort === "3389" || destPort === "*") ? "CRITICAL" : "HIGH";
        findings.push({
          ruleId: "AZU-SEC-050",
          severity,
          title: `Unrestricted inbound access${destPort ? ` on port ${destPort}` : ""}`,
          description: `NSG rule allows inbound traffic from any source (*)${destPort === "22" ? " to SSH" : destPort === "3389" ? " to RDP" : ""}.`,
          resource: `azurerm_network_security_rule.${r.name}`,
          file: r.file,
          lines: { start: r.startLine, end: r.startLine },
          resolution: "Restrict source_address_prefix to specific IPs or CIDR ranges",
        });
      }
    }

    // --- COSMOS DB ---
    if (r.type === "azurerm_cosmosdb_account") {
      if (r.props.public_network_access_enabled !== false && r.props.is_virtual_network_filter_enabled !== true) {
        findings.push({
          ruleId: "AZU-SEC-060",
          severity: "MEDIUM",
          title: "Cosmos DB has no network restrictions",
          description: "Cosmos DB account is accessible from all networks.",
          resource: `azurerm_cosmosdb_account.${r.name}`,
          file: r.file,
          lines: { start: r.startLine, end: r.startLine },
          resolution: "Set public_network_access_enabled = false or enable virtual_network_filter",
        });
      }
    }

    // --- GENERIC: Public network access ---
    const publicAccessTypes = new Set([
      "azurerm_cognitive_account", "azurerm_search_service",
      "azurerm_postgresql_flexible_server", "azurerm_mysql_flexible_server",
      "azurerm_redis_cache", "azurerm_signalr_service",
    ]);
    if (publicAccessTypes.has(r.type) && r.props.public_network_access_enabled === true) {
      findings.push({
        ruleId: "AZU-SEC-070",
        severity: "HIGH",
        title: `Public network access enabled on ${r.type.replace("azurerm_", "")}`,
        description: "Resource is accessible from the public internet.",
        resource: `${r.type}.${r.name}`,
        file: r.file,
        lines: { start: r.startLine, end: r.startLine },
        resolution: "Set public_network_access_enabled = false",
      });
    }

    // --- GENERIC: No tags (LOW severity in security context) ---
    const taggableTypes = new Set([
      "azurerm_storage_account", "azurerm_key_vault", "azurerm_kubernetes_cluster",
      "azurerm_linux_virtual_machine", "azurerm_windows_virtual_machine",
      "azurerm_virtual_network", "azurerm_resource_group",
    ]);
    if (taggableTypes.has(r.type) && !r.hasBlock("tags")) {
      findings.push({
        ruleId: "AZU-SEC-080",
        severity: "LOW",
        title: "Resource missing tags",
        description: `${r.type.replace("azurerm_", "")} '${r.name}' has no tags for governance and cost tracking.`,
        resource: `${r.type}.${r.name}`,
        file: r.file,
        lines: { start: r.startLine, end: r.startLine },
        resolution: "Add tags block with environment, owner, and cost-center tags",
      });
    }
  }

  // Sort by severity: CRITICAL > HIGH > MEDIUM > LOW
  const severityOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  findings.sort((a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4));

  return findings;
}

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
      // Fallback: basic static analysis for common misconfigurations
      findings = runBasicScan(terraformFiles);
    }

    const scanResult: ScanResult = {
      passed: findings.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH").length === 0,
      findings,
      scannedAt: new Date().toISOString(),
      scanner: trivyAvailable ? "trivy" : "built-in",
    };

    log.info({ findingCount: findings.length, scanner: scanResult.scanner }, "Scan completed");

    return Response.json(scanResult);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Basic static analysis when Trivy is not available. */
function runBasicScan(files: Record<string, string>): ScanFinding[] {
  const findings: ScanFinding[] = [];

  for (const [filename, content] of Object.entries(files)) {
    const lines = content.split("\n");

    lines.forEach((line, idx) => {
      // Check for unencrypted storage
      if (/https_only\s*=\s*false/i.test(line)) {
        findings.push({
          ruleId: "BICEP-001",
          severity: "HIGH",
          title: "HTTPS not enforced",
          description: "Resource has HTTPS disabled, allowing unencrypted traffic.",
          resource: "",
          file: filename,
          lines: { start: idx + 1, end: idx + 1 },
          resolution: "Set https_only = true",
        });
      }

      // Check for public access
      if (/public_network_access_enabled\s*=\s*true/i.test(line)) {
        findings.push({
          ruleId: "BICEP-002",
          severity: "HIGH",
          title: "Public network access enabled",
          description: "Resource is accessible from the public internet.",
          resource: "",
          file: filename,
          lines: { start: idx + 1, end: idx + 1 },
          resolution: "Set public_network_access_enabled = false",
        });
      }

      // Check for missing encryption
      if (/encryption\s*{\s*}|encryption_at_rest\s*=\s*false/i.test(line)) {
        findings.push({
          ruleId: "BICEP-003",
          severity: "CRITICAL",
          title: "Missing or disabled encryption",
          description: "Data encryption is not properly configured.",
          resource: "",
          file: filename,
          lines: { start: idx + 1, end: idx + 1 },
          resolution: "Enable encryption with a customer-managed key",
        });
      }

      // Check for admin_enabled on container registry
      if (/admin_enabled\s*=\s*true/i.test(line)) {
        findings.push({
          ruleId: "BICEP-004",
          severity: "MEDIUM",
          title: "Admin access enabled",
          description: "Admin account is enabled on the container registry.",
          resource: "",
          file: filename,
          lines: { start: idx + 1, end: idx + 1 },
          resolution: "Disable admin access and use managed identity instead",
        });
      }

      // Check for minimum TLS version
      if (/min_tls_version\s*=\s*"(TLS1_0|TLS1_1|1\.0|1\.1)"/i.test(line)) {
        findings.push({
          ruleId: "BICEP-005",
          severity: "HIGH",
          title: "Outdated TLS version",
          description: "TLS version is below 1.2, which has known vulnerabilities.",
          resource: "",
          file: filename,
          lines: { start: idx + 1, end: idx + 1 },
          resolution: 'Set min_tls_version = "TLS1_2"',
        });
      }
    });
  }

  return findings;
}

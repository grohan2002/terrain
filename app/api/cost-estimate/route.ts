// ---------------------------------------------------------------------------
// POST /api/cost-estimate — Estimate monthly cost using Infracost or fallback.
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createRequestLogger } from "@/lib/logger";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import type { CostEstimateResult, ResourceCostEstimate } from "@/lib/types";

export const maxDuration = 120;

const CostEstimateRequestSchema = z.object({
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

  const parsed = CostEstimateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { terraformFiles } = parsed.data;

  // Check if infracost is available
  let infracostAvailable = false;
  try {
    execSync("which infracost", { stdio: "pipe" });
    infracostAvailable = true;
  } catch {
    // Infracost not installed
  }

  let result: CostEstimateResult;

  if (infracostAvailable) {
    const tempDir = mkdtempSync(join(tmpdir(), "infracost-"));
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

      const output = execSync(
        `infracost breakdown --path "${tempDir}" --format json --no-color`,
        { encoding: "utf-8", timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] },
      );

      const data = JSON.parse(output);
      const resources: ResourceCostEstimate[] = (data.projects?.[0]?.breakdown?.resources ?? []).map(
        (r: { name: string; resourceType: string; monthlyCost: string; hourlyCost: string; costComponents: { name: string; monthlyCost: string; unit: string; monthlyQuantity: string }[] }) => ({
          name: r.name,
          resourceType: r.resourceType ?? "",
          monthlyCost: parseFloat(r.monthlyCost ?? "0"),
          hourlyCost: parseFloat(r.hourlyCost ?? "0"),
          costComponents: (r.costComponents ?? []).map((c) => ({
            name: c.name,
            monthlyCost: parseFloat(c.monthlyCost ?? "0"),
            unit: c.unit ?? "",
            quantity: parseFloat(c.monthlyQuantity ?? "0"),
          })),
        }),
      );

      result = {
        totalMonthlyCost: parseFloat(data.totalMonthlyCost ?? "0"),
        totalHourlyCost: parseFloat(data.totalHourlyCost ?? "0"),
        resources,
        currency: "USD",
        estimatedAt: new Date().toISOString(),
      };
    } catch (e) {
      log.warn({ error: (e as Error).message }, "Infracost failed, using fallback");
      result = estimateFallback(terraformFiles);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } else {
    result = estimateFallback(terraformFiles);
  }

  log.info(
    { resourceCount: result.resources.length, totalMonthlyCost: result.totalMonthlyCost },
    "Cost estimate completed",
  );

  return Response.json(result);
}

/** Rough cost estimates for common Azure resources when infracost is unavailable. */
const RESOURCE_COSTS: Record<string, { monthly: number; label: string }> = {
  azurerm_resource_group: { monthly: 0, label: "Resource Group (free)" },
  azurerm_storage_account: { monthly: 21, label: "Storage Account (LRS)" },
  azurerm_virtual_network: { monthly: 0, label: "Virtual Network (free)" },
  azurerm_subnet: { monthly: 0, label: "Subnet (free)" },
  azurerm_network_interface: { monthly: 0, label: "Network Interface (free)" },
  azurerm_network_security_group: { monthly: 0, label: "NSG (free)" },
  azurerm_public_ip: { monthly: 3.65, label: "Public IP (Standard)" },
  azurerm_linux_virtual_machine: { monthly: 30.37, label: "VM (B1s)" },
  azurerm_windows_virtual_machine: { monthly: 52.56, label: "VM (B1s Windows)" },
  azurerm_app_service_plan: { monthly: 13.14, label: "App Service Plan (B1)" },
  azurerm_linux_web_app: { monthly: 0, label: "Web App (included in plan)" },
  azurerm_windows_web_app: { monthly: 0, label: "Web App (included in plan)" },
  azurerm_mssql_server: { monthly: 0, label: "SQL Server (free)" },
  azurerm_mssql_database: { monthly: 4.90, label: "SQL Database (Basic)" },
  azurerm_cosmosdb_account: { monthly: 24, label: "Cosmos DB (serverless)" },
  azurerm_key_vault: { monthly: 0.03, label: "Key Vault (Standard)" },
  azurerm_container_registry: { monthly: 5, label: "ACR (Basic)" },
  azurerm_kubernetes_cluster: { monthly: 73, label: "AKS (1 node B2s)" },
  azurerm_application_insights: { monthly: 2.30, label: "App Insights (5GB)" },
  azurerm_log_analytics_workspace: { monthly: 2.76, label: "Log Analytics (5GB)" },
  azurerm_redis_cache: { monthly: 16.06, label: "Redis Cache (C0 Basic)" },
  azurerm_servicebus_namespace: { monthly: 9.78, label: "Service Bus (Basic)" },
  azurerm_eventhub_namespace: { monthly: 11.16, label: "Event Hub (Basic)" },
  azurerm_function_app: { monthly: 0, label: "Function App (Consumption)" },
};

function estimateFallback(files: Record<string, string>): CostEstimateResult {
  const resources: ResourceCostEstimate[] = [];
  const resourceRegex = /resource\s+"(\w+)"\s+"(\w+)"/g;

  for (const [, content] of Object.entries(files)) {
    let match;
    while ((match = resourceRegex.exec(content)) !== null) {
      const type = match[1];
      const name = match[2];
      const costInfo = RESOURCE_COSTS[type];
      const monthly = costInfo?.monthly ?? 0;
      resources.push({
        name,
        resourceType: type,
        monthlyCost: monthly,
        hourlyCost: monthly / 730,
        costComponents: monthly > 0
          ? [{ name: costInfo?.label ?? type, monthlyCost: monthly, unit: "month", quantity: 1 }]
          : [],
      });
    }
  }

  const totalMonthlyCost = resources.reduce((sum, r) => sum + r.monthlyCost, 0);

  return {
    totalMonthlyCost,
    totalHourlyCost: totalMonthlyCost / 730,
    resources,
    currency: "USD",
    estimatedAt: new Date().toISOString(),
  };
}

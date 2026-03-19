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
  // Free resources
  azurerm_resource_group: { monthly: 0, label: "Resource Group (free)" },
  azurerm_virtual_network: { monthly: 0, label: "Virtual Network (free)" },
  azurerm_subnet: { monthly: 0, label: "Subnet (free)" },
  azurerm_network_interface: { monthly: 0, label: "Network Interface (free)" },
  azurerm_network_security_group: { monthly: 0, label: "NSG (free)" },
  azurerm_network_security_rule: { monthly: 0, label: "NSG Rule (free)" },
  azurerm_route_table: { monthly: 0, label: "Route Table (free)" },
  azurerm_route: { monthly: 0, label: "Route (free)" },
  azurerm_linux_web_app: { monthly: 0, label: "Web App (included in plan)" },
  azurerm_windows_web_app: { monthly: 0, label: "Web App (included in plan)" },
  azurerm_mssql_server: { monthly: 0, label: "SQL Server (free)" },
  azurerm_function_app: { monthly: 0, label: "Function App (Consumption)" },
  azurerm_linux_function_app: { monthly: 0, label: "Function App (Consumption)" },
  azurerm_windows_function_app: { monthly: 0, label: "Function App (Consumption)" },
  azurerm_management_lock: { monthly: 0, label: "Management Lock (free)" },
  azurerm_role_assignment: { monthly: 0, label: "Role Assignment (free)" },
  azurerm_user_assigned_identity: { monthly: 0, label: "Managed Identity (free)" },
  azurerm_monitor_diagnostic_setting: { monthly: 0, label: "Diagnostic Setting (free)" },

  // Paid resources — Storage & Data
  azurerm_storage_account: { monthly: 21, label: "Storage Account (LRS, 100GB)" },
  azurerm_storage_container: { monthly: 0, label: "Blob Container (included)" },
  azurerm_mssql_database: { monthly: 4.90, label: "SQL Database (Basic)" },
  azurerm_cosmosdb_account: { monthly: 24, label: "Cosmos DB (serverless)" },
  azurerm_cosmosdb_sql_database: { monthly: 0, label: "Cosmos SQL DB (included)" },
  azurerm_redis_cache: { monthly: 16.06, label: "Redis Cache (C0 Basic)" },
  azurerm_postgresql_flexible_server: { monthly: 12.50, label: "PostgreSQL Flex (B1ms)" },
  azurerm_mysql_flexible_server: { monthly: 12.50, label: "MySQL Flex (B1ms)" },

  // Paid resources — Compute
  azurerm_linux_virtual_machine: { monthly: 30.37, label: "VM (B1s Linux)" },
  azurerm_windows_virtual_machine: { monthly: 52.56, label: "VM (B1s Windows)" },
  azurerm_virtual_machine_scale_set: { monthly: 60.74, label: "VMSS (2x B1s)" },
  azurerm_linux_virtual_machine_scale_set: { monthly: 60.74, label: "VMSS (2x B1s)" },
  azurerm_windows_virtual_machine_scale_set: { monthly: 105.12, label: "VMSS (2x B1s Windows)" },
  azurerm_app_service_plan: { monthly: 13.14, label: "App Service Plan (B1)" },
  azurerm_service_plan: { monthly: 13.14, label: "Service Plan (B1)" },
  azurerm_container_group: { monthly: 35, label: "Container Instance (1vCPU/1.5GB)" },
  azurerm_kubernetes_cluster: { monthly: 73, label: "AKS (1 node B2s)" },

  // Paid resources — Networking
  azurerm_public_ip: { monthly: 3.65, label: "Public IP (Standard)" },
  azurerm_lb: { monthly: 18.25, label: "Load Balancer (Standard)" },
  azurerm_lb_rule: { monthly: 7.30, label: "LB Rule" },
  azurerm_application_gateway: { monthly: 22.63, label: "App Gateway (Standard v2)" },
  azurerm_nat_gateway: { monthly: 32.85, label: "NAT Gateway" },
  azurerm_firewall: { monthly: 912.50, label: "Azure Firewall (Standard)" },
  azurerm_firewall_policy: { monthly: 0, label: "Firewall Policy (free)" },
  azurerm_private_endpoint: { monthly: 7.30, label: "Private Endpoint" },
  azurerm_private_dns_zone: { monthly: 0.50, label: "Private DNS Zone" },
  azurerm_dns_zone: { monthly: 0.50, label: "DNS Zone" },
  azurerm_cdn_profile: { monthly: 0, label: "CDN Profile (free)" },
  azurerm_cdn_endpoint: { monthly: 0, label: "CDN Endpoint (pay-per-GB)" },
  azurerm_frontdoor: { monthly: 35, label: "Front Door (Standard)" },
  azurerm_virtual_network_peering: { monthly: 3.65, label: "VNet Peering (per GB)" },
  azurerm_virtual_network_gateway: { monthly: 27, label: "VPN Gateway (Basic)" },
  azurerm_express_route_circuit: { monthly: 43.80, label: "ExpressRoute (Metered 50Mbps)" },
  azurerm_bastion_host: { monthly: 138.70, label: "Azure Bastion (Basic)" },

  // Paid resources — Security & Management
  azurerm_key_vault: { monthly: 0.03, label: "Key Vault (Standard)" },
  azurerm_container_registry: { monthly: 5, label: "ACR (Basic)" },
  azurerm_application_insights: { monthly: 2.30, label: "App Insights (5GB)" },
  azurerm_log_analytics_workspace: { monthly: 2.76, label: "Log Analytics (5GB)" },

  // Paid resources — Messaging
  azurerm_servicebus_namespace: { monthly: 9.78, label: "Service Bus (Basic)" },
  azurerm_eventhub_namespace: { monthly: 11.16, label: "Event Hub (Basic)" },
  azurerm_eventgrid_topic: { monthly: 0, label: "Event Grid (pay-per-op)" },
  azurerm_signalr_service: { monthly: 48.58, label: "SignalR (Standard)" },

  // Misc
  random_string: { monthly: 0, label: "Random String (local)" },
  random_password: { monthly: 0, label: "Random Password (local)" },
  random_id: { monthly: 0, label: "Random ID (local)" },
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
      const monthly = costInfo?.monthly ?? 5; // Default $5/mo for unknown resources
      const label = costInfo?.label ?? `${type} (estimated)`;
      resources.push({
        name,
        resourceType: type,
        monthlyCost: monthly,
        hourlyCost: monthly / 730,
        costComponents: [{ name: label, monthlyCost: monthly, unit: "month", quantity: 1 }],
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

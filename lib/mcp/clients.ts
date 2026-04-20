// ---------------------------------------------------------------------------
// MCP (Model Context Protocol) client helpers.
//
// Connects the app to two MCP servers and exposes their tools so the Claude
// agent can query authoritative data instead of hallucinating:
//
//   1. HashiCorp Terraform MCP (sidecar container, streamable-HTTP transport)
//      - Provider schemas, module registry lookups
//      - Reduces hallucination when generating `azurerm_*` blocks
//
//   2. Microsoft Azure MCP (spawned as stdio child process inside this container)
//      - Live Azure API queries (AKS versions, resource name availability, etc.)
//      - Authenticates via AZURE_* env vars mapped from our ARM_* vars
//
// Design: singleton clients, tools listed once and cached, connection errors
// degrade gracefully (empty tool list + warn log).
// ---------------------------------------------------------------------------

import type Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { logger } from "@/lib/logger";

// ---- Allowlists -----------------------------------------------------------

/** Hard allowlist for Terraform MCP tools. Trim to reduce prompt tokens. */
const TERRAFORM_ALLOWED = new Set([
  "search_providers",
  "get_provider_details",
  "get_latest_provider_version",
  "search_modules",
  "get_module_details",
]);

/**
 * Hard allowlist for Azure MCP tools. Tool names follow the `azmcp-<area>-<action>`
 * convention per https://github.com/microsoft/mcp. If real names differ at runtime
 * we log the full list in the "MCP tools loaded" message and the user can adjust.
 */
const AZURE_ALLOWED = new Set([
  "azmcp-aks-get-versions",
  "azmcp-resource-check-name",
  "azmcp-group-list",
  "azmcp-subscription-list",
  "azmcp-resource-show",
  "azmcp-location-list",
]);

// ---- Types ----------------------------------------------------------------

interface CachedMcp {
  client: Client;
  tools: Anthropic.Tool[];
  /** Tool names that passed the allowlist and can be called. */
  callable: Set<string>;
}

// ---- Singletons -----------------------------------------------------------

let terraformMcp: CachedMcp | null = null;
let azureMcp: CachedMcp | null = null;
let terraformMcpInitPromise: Promise<CachedMcp | null> | null = null;
let azureMcpInitPromise: Promise<CachedMcp | null> | null = null;

// ---- Env flags ------------------------------------------------------------

function terraformEnabled(): boolean {
  return process.env.ENABLE_TERRAFORM_MCP !== "false";
}

function azureEnabled(): boolean {
  return process.env.ENABLE_AZURE_MCP !== "false";
}

function terraformUrl(): string {
  return process.env.TERRAFORM_MCP_URL || "http://terraform-mcp:8080/mcp";
}

// ---- Terraform MCP (streamable HTTP sidecar) ------------------------------

async function initTerraformMcp(): Promise<CachedMcp | null> {
  if (!terraformEnabled()) return null;

  const url = terraformUrl();
  try {
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({ name: "bicep-ui-terraform", version: "1.0.0" });
    await client.connect(transport);

    const { tools: mcpTools } = await client.listTools();
    const filtered = mcpTools.filter((t) => TERRAFORM_ALLOWED.has(t.name));
    const callable = new Set(filtered.map((t) => t.name));

    const anthropicTools: Anthropic.Tool[] = filtered.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    logger.info(
      {
        url,
        totalTools: mcpTools.length,
        allowedTools: anthropicTools.map((t) => t.name),
      },
      "Terraform MCP tools loaded",
    );

    return { client, tools: anthropicTools, callable };
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err), url },
      "Terraform MCP unavailable — conversion agent will run without it",
    );
    return null;
  }
}

// ---- Azure MCP (stdio child process) --------------------------------------

function buildAzureEnv(): Record<string, string> {
  // Map our ARM_* vars (used by tofu/terraform apply) to AZURE_* vars (used
  // by the Azure Identity SDK that Azure MCP relies on).
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  if (process.env.ARM_TENANT_ID && !env.AZURE_TENANT_ID) {
    env.AZURE_TENANT_ID = process.env.ARM_TENANT_ID;
  }
  if (process.env.ARM_CLIENT_ID && !env.AZURE_CLIENT_ID) {
    env.AZURE_CLIENT_ID = process.env.ARM_CLIENT_ID;
  }
  if (process.env.ARM_CLIENT_SECRET && !env.AZURE_CLIENT_SECRET) {
    env.AZURE_CLIENT_SECRET = process.env.ARM_CLIENT_SECRET;
  }
  if (process.env.ARM_SUBSCRIPTION_ID && !env.AZURE_SUBSCRIPTION_ID) {
    env.AZURE_SUBSCRIPTION_ID = process.env.ARM_SUBSCRIPTION_ID;
  }
  return env;
}

async function initAzureMcp(): Promise<CachedMcp | null> {
  if (!azureEnabled()) return null;

  try {
    // `azmcp` is installed via `npm install -g @azure/mcp` in the Dockerfile.
    // It speaks MCP over stdio when invoked as `azmcp server start`.
    const transport = new StdioClientTransport({
      command: "azmcp",
      args: ["server", "start"],
      env: buildAzureEnv(),
    });
    const client = new Client({ name: "bicep-ui-azure", version: "1.0.0" });
    await client.connect(transport);

    const { tools: mcpTools } = await client.listTools();
    const filtered = mcpTools.filter((t) => AZURE_ALLOWED.has(t.name));
    const callable = new Set(filtered.map((t) => t.name));

    const anthropicTools: Anthropic.Tool[] = filtered.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    logger.info(
      {
        totalTools: mcpTools.length,
        allowedTools: anthropicTools.map((t) => t.name),
        firstTenAvailable: mcpTools.slice(0, 10).map((t) => t.name),
      },
      "Azure MCP tools loaded",
    );

    return { client, tools: anthropicTools, callable };
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "Azure MCP unavailable — deploy agent will run without it",
    );
    return null;
  }
}

// ---- Public API -----------------------------------------------------------

/** Lazily connects to Terraform MCP and returns its allowed tool list. */
export async function getTerraformMcpTools(): Promise<Anthropic.Tool[]> {
  if (terraformMcp) return terraformMcp.tools;
  if (!terraformMcpInitPromise) terraformMcpInitPromise = initTerraformMcp();
  terraformMcp = await terraformMcpInitPromise;
  return terraformMcp?.tools ?? [];
}

/** Lazily connects to Azure MCP and returns its allowed tool list. */
export async function getAzureMcpTools(): Promise<Anthropic.Tool[]> {
  if (azureMcp) return azureMcp.tools;
  if (!azureMcpInitPromise) azureMcpInitPromise = initAzureMcp();
  azureMcp = await azureMcpInitPromise;
  return azureMcp?.tools ?? [];
}

/** Returns true if `name` is a callable Terraform MCP tool. */
export function isTerraformMcpTool(name: string): boolean {
  return !!terraformMcp && terraformMcp.callable.has(name);
}

/** Returns true if `name` is a callable Azure MCP tool. */
export function isAzureMcpTool(name: string): boolean {
  return !!azureMcp && azureMcp.callable.has(name);
}

/** Routes an MCP tool call to the right client and returns the text result. */
export async function callMcpTool(
  name: string,
  input: Record<string, unknown>,
): Promise<{ ok: true; data: string } | { ok: false; error: string }> {
  let cached: CachedMcp | null = null;
  if (terraformMcp?.callable.has(name)) cached = terraformMcp;
  else if (azureMcp?.callable.has(name)) cached = azureMcp;

  if (!cached) {
    return { ok: false, error: `Unknown MCP tool '${name}'` };
  }

  try {
    const result = await cached.client.callTool({ name, arguments: input });
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .map((c) => {
        if (c && typeof c === "object" && "type" in c && c.type === "text" && "text" in c) {
          return String((c as { text: unknown }).text ?? "");
        }
        return JSON.stringify(c);
      })
      .join("\n");
    return { ok: true, data: text || "(empty MCP response)" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ tool: name, error: msg }, "MCP tool call failed");
    return { ok: false, error: `MCP tool '${name}' failed: ${msg}` };
  }
}

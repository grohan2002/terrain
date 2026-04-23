// ---------------------------------------------------------------------------
// Deterministic schema pre-fetch.
//
// Before the first API call to Claude, we already know which source resources
// are in the template and which TF types we'd expect to emit (via the shared
// mapping tables). This module calls the HashiCorp Terraform MCP server up-
// front to fetch authoritative schemas for those TF types and returns a
// compact text block that can be appended to the first user message.
//
// Why: the agent currently lazily invokes `get_provider_details` mid-run,
// costing 3–5 extra rounds and still hallucinating attributes when it skips
// the check. Pre-fetching eliminates that class of failure. A strict token
// budget keeps the prompt from ballooning.
//
// Graceful degradation: any MCP error (server down, schema mismatch, parse
// failure) returns an empty block — the agent still has mid-run MCP lookups
// as a fallback.
// ---------------------------------------------------------------------------

import type { SourceFormat } from "./types";
import { extractSourceResourceInventory, mappedTfTypes } from "./source-resource-inventory";
import { callMcpTool } from "./mcp/clients";
import { logger } from "./logger";

/** Rough 1 token ≈ 4 characters heuristic — good enough for budgeting. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Hard ceilings. */
const MAX_TOTAL_TOKENS = 20_000;
const MAX_PER_SCHEMA_TOKENS = 1_500;
/** Upper bound on schemas we'll even attempt per run — protects against huge templates. */
const MAX_SCHEMAS = 25;

interface FetchedSchema {
  tfType: string;
  provider: "azurerm" | "aws";
  docId: string | null;
  body: string;
  tokens: number;
}

export interface PrefetchResult {
  /** Text block to append to the first user message. Empty if nothing fetched. */
  promptBlock: string;
  /** TF types whose schema we successfully fetched. */
  fetched: string[];
  /** TF types we wanted to fetch but skipped (budget / missing doc / error). */
  skipped: string[];
  /** True when we found at least one schema. */
  hasContent: boolean;
  /** Total estimated token cost of the block. */
  tokens: number;
}

const EMPTY_RESULT: PrefetchResult = {
  promptBlock: "",
  fetched: [],
  skipped: [],
  hasContent: false,
  tokens: 0,
};

function providerForTfType(tfType: string): "azurerm" | "aws" | null {
  if (tfType.startsWith("azurerm_")) return "azurerm";
  if (tfType.startsWith("aws_")) return "aws";
  return null;
}

// ---------------------------------------------------------------------------
// search_providers response parsing
//
// The HashiCorp MCP server returns a structured text payload listing all
// resource/data-source docs for a provider. The exact format can vary across
// versions, so we grep for both `providerDocID` markers and `title` lines —
// whichever format the server responds with, we end up with a
// `type_name -> docID` map. If parsing fails we return an empty map and the
// caller falls through to "no prefetch" (agent will fetch mid-run).
// ---------------------------------------------------------------------------

export function parseProviderDocIndex(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!text) return out;

  // Shape 1: JSON-ish blocks with `"title": "azurerm_storage_account", "providerDocID": "..."`
  const jsonish = /"title"\s*:\s*"([^"]+)"[\s\S]{0,200}?"providerDocID"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = jsonish.exec(text)) !== null) {
    const title = m[1];
    const id = m[2];
    if (title && id && !out[title]) out[title] = id;
  }
  // Shape 2: same pair in reverse order
  const jsonishRev = /"providerDocID"\s*:\s*"([^"]+)"[\s\S]{0,200}?"title"\s*:\s*"([^"]+)"/g;
  while ((m = jsonishRev.exec(text)) !== null) {
    const id = m[1];
    const title = m[2];
    if (title && id && !out[title]) out[title] = id;
  }
  // Shape 3: plain-text lines like "- azurerm_storage_account (id: 123456)"
  const plain = /(^|\n)\s*-?\s*([a-z][a-z0-9_]+)\s*\(\s*id\s*:\s*([A-Za-z0-9_-]+)\s*\)/g;
  while ((m = plain.exec(text)) !== null) {
    const title = m[2];
    const id = m[3];
    if (title && id && !out[title]) out[title] = id;
  }
  return out;
}

// ---------------------------------------------------------------------------
// prefetchSchemasForSource — top-level entry point
// ---------------------------------------------------------------------------

export async function prefetchSchemasForSource(args: {
  sourceContent: string;
  sourceFormat: SourceFormat;
}): Promise<PrefetchResult> {
  return prefetchSchemasForTypes({
    tfTypes: mappedTfTypes(
      extractSourceResourceInventory(args.sourceContent, args.sourceFormat),
      args.sourceFormat,
    ),
  });
}

export async function prefetchSchemasForMultiFile(args: {
  files: Record<string, string>;
  sourceFormat: SourceFormat;
}): Promise<PrefetchResult> {
  const tfTypes = new Set<string>();
  for (const content of Object.values(args.files)) {
    for (const t of mappedTfTypes(
      extractSourceResourceInventory(content, args.sourceFormat),
      args.sourceFormat,
    )) {
      tfTypes.add(t);
    }
  }
  return prefetchSchemasForTypes({ tfTypes: Array.from(tfTypes).sort() });
}

export async function prefetchSchemasForTypes(args: {
  tfTypes: string[];
}): Promise<PrefetchResult> {
  const tfTypes = args.tfTypes.slice(0, MAX_SCHEMAS);
  if (tfTypes.length === 0) return EMPTY_RESULT;

  // Group by provider.
  const byProvider: Record<"azurerm" | "aws", string[]> = {
    azurerm: [],
    aws: [],
  };
  for (const t of tfTypes) {
    const p = providerForTfType(t);
    if (p) byProvider[p].push(t);
  }

  // 1. One `search_providers` call per provider, collect doc indexes.
  const providerIndex: Record<string, Record<string, string>> = {};
  for (const [provider, types] of Object.entries(byProvider) as [
    "azurerm" | "aws",
    string[],
  ][]) {
    if (types.length === 0) continue;
    const res = await callMcpTool("search_providers", {
      providerName: provider,
      providerNamespace: "hashicorp",
      providerDataType: "resources",
    });
    if (!res.ok) {
      logger.warn(
        { provider, error: res.error },
        "Schema prefetch: search_providers failed — skipping this provider",
      );
      providerIndex[provider] = {};
      continue;
    }
    providerIndex[provider] = parseProviderDocIndex(res.data);
  }

  // 2. For each TF type, look up its docID and fetch details within budget.
  const fetched: FetchedSchema[] = [];
  const skipped: string[] = [];
  let totalTokens = 0;

  for (const tfType of tfTypes) {
    const provider = providerForTfType(tfType);
    if (!provider) {
      skipped.push(tfType);
      continue;
    }
    const docId = providerIndex[provider]?.[tfType];
    if (!docId) {
      skipped.push(tfType);
      continue;
    }

    const res = await callMcpTool("get_provider_details", {
      providerDocID: docId,
    });
    if (!res.ok) {
      logger.warn(
        { tfType, docId, error: res.error },
        "Schema prefetch: get_provider_details failed",
      );
      skipped.push(tfType);
      continue;
    }

    const tokens = estimateTokens(res.data);
    if (tokens > MAX_PER_SCHEMA_TOKENS) {
      // Skip oversized schemas; the agent can still request them mid-run.
      skipped.push(tfType);
      continue;
    }
    if (totalTokens + tokens > MAX_TOTAL_TOKENS) {
      skipped.push(tfType);
      continue;
    }

    fetched.push({ tfType, provider, docId, body: res.data, tokens });
    totalTokens += tokens;
  }

  if (fetched.length === 0) {
    return { ...EMPTY_RESULT, skipped };
  }

  const promptBlock = renderPromptBlock(fetched, skipped);
  return {
    promptBlock,
    fetched: fetched.map((f) => f.tfType),
    skipped,
    hasContent: true,
    tokens: estimateTokens(promptBlock),
  };
}

function renderPromptBlock(
  fetched: FetchedSchema[],
  skipped: string[],
): string {
  const lines: string[] = [];
  lines.push("## Pre-fetched provider schemas");
  lines.push("");
  lines.push(
    "These are the authoritative Terraform provider schemas for every resource type we expect to see in this conversion. Prefer these over your recalled knowledge.",
  );
  lines.push("");
  for (const f of fetched) {
    lines.push(`### ${f.tfType}`);
    lines.push("```");
    lines.push(f.body.trim());
    lines.push("```");
    lines.push("");
  }
  if (skipped.length > 0) {
    lines.push(
      `_Not pre-fetched (will need mid-run MCP lookup if referenced): ${skipped.join(", ")}_`,
    );
  }
  return lines.join("\n");
}

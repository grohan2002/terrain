// ---------------------------------------------------------------------------
// Agentic streaming loop for Bicep-to-Terraform conversion.
//
// Calls Claude with tools in a loop, streaming text deltas to the client
// and dispatching tool calls to local handlers until the model is done.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ContentBlock,
  ToolResultBlockParam,
  ToolUseBlock,
  TextBlock,
} from "@anthropic-ai/sdk/resources/messages";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bicepTools } from "./tools";
import { createToolHandlers, type ToolHandlerCallbacks } from "./tool-handlers";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_MULTI_FILE } from "./system-prompt";
import { withRetry } from "../retry";
import { getTerraformMcpTools, isTerraformMcpTool, callMcpTool } from "../mcp/clients";
import { calculateCost, addCosts, type CostInfo } from "../cost";
import {
  selectModelWithExpertMode,
  selectModelMultiFileWithExpertMode,
} from "../model-router";
import { buildDependencyGraph, buildMultiFileUserMessage, summarizeContext } from "../bicep-modules";
import { logger } from "../logger";
import type { BicepFiles, StreamEvent, ToolCallInfo, CoverageReportWire } from "../types";
import {
  prefetchSchemasForSource,
  prefetchSchemasForMultiFile,
} from "../schema-prefetch";
import { computeCoverageFromContent } from "../coverage";
import { extractSourceResourceInventoryMultiFile } from "../source-resource-inventory";
import { extractGeneratedResources } from "../generated-resource-inventory";
import { computeCoverage } from "../coverage";

/** Convert a CoverageReport into its SSE wire shape (drops extra fields). */
function toCoverageWire(
  r: ReturnType<typeof computeCoverage>,
): CoverageReportWire {
  return {
    expected: r.expected,
    generated: r.generated,
    matched: r.matched.map((m) => ({
      sourceType: m.sourceType,
      logicalName: m.logicalName,
    })),
    missing: r.missing.map((m) => ({
      sourceType: m.sourceType,
      logicalName: m.logicalName,
    })),
    unmappedSourceTypes: r.unmappedSourceTypes,
    coverage: r.coverage,
  };
}

// ---------------------------------------------------------------------------
// Isolated temp directory per conversion — prevents file accumulation
// ---------------------------------------------------------------------------

function createIsolatedOutputDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bicep-tf-"));
  return dir;
}

function cleanupOutputDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TOKENS = 8192;
const MAX_TOOL_ROUNDS = 30;

/**
 * Minimum inter-round delay (ms) to pace API calls and stay under
 * per-minute input-token rate limits. Each API call sends the full message
 * history, so spacing calls 8-12s apart keeps ~7 calls/min × ~4K tokens ≈ 28K.
 */
const ROUND_PACING_MS = 8_000;

/**
 * After this many rounds, compress older messages to reduce the growing
 * input-token count. Keeps the first user message + last N exchanges intact.
 */
const COMPRESS_AFTER_ROUND = 5;
const KEEP_RECENT_EXCHANGES = 3; // keep last 3 assistant+user pairs

// ---------------------------------------------------------------------------
// Rate-limit pacing: wait between rounds to avoid bursting token budget
// ---------------------------------------------------------------------------

let lastApiCallTime = 0;

export async function paceApiCall(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastApiCallTime;
  if (lastApiCallTime > 0 && elapsed < ROUND_PACING_MS) {
    const waitMs = ROUND_PACING_MS - elapsed;
    logger.info({ waitMs }, "Pacing: waiting between API rounds");
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastApiCallTime = Date.now();
}

// ---------------------------------------------------------------------------
// Message history compression — summarize older tool exchanges to reduce
// input tokens while preserving the original user request and recent context
// ---------------------------------------------------------------------------

export function compressMessages(messages: MessageParam[], round: number): MessageParam[] {
  // Only compress after threshold
  if (round <= COMPRESS_AFTER_ROUND) return messages;

  // messages[0] is always the original user prompt — keep it
  // Remaining messages come in pairs: [assistant, user(tool_results)]
  const pairCount = (messages.length - 1) / 2;
  if (pairCount <= KEEP_RECENT_EXCHANGES) return messages;

  const pairsToCompress = pairCount - KEEP_RECENT_EXCHANGES;
  const compressUpToIndex = 1 + pairsToCompress * 2; // index of first pair to keep

  // Build a compact summary of the compressed exchanges
  const summaryParts: string[] = [];
  for (let i = 1; i < compressUpToIndex; i += 2) {
    const assistantMsg = messages[i];
    if (assistantMsg.role === "assistant" && Array.isArray(assistantMsg.content)) {
      const toolNames = (assistantMsg.content as ContentBlock[])
        .filter((b): b is ToolUseBlock => b.type === "tool_use")
        .map((b) => b.name);
      const textParts = (assistantMsg.content as ContentBlock[])
        .filter((b): b is TextBlock => b.type === "text")
        .map((b) => {
          // Truncate long text blocks
          const text = b.text;
          return text.length > 200 ? text.slice(0, 200) + "…" : text;
        });
      if (toolNames.length > 0) {
        summaryParts.push(`Tools called: ${toolNames.join(", ")}`);
      }
      if (textParts.length > 0) {
        summaryParts.push(textParts.join(" "));
      }
    }
  }

  const summaryText =
    "[Earlier tool exchanges compressed to save tokens]\n" +
    summaryParts.join("\n");

  // Reconstruct: original user msg + summary + recent pairs
  const compressed: MessageParam[] = [
    messages[0], // original user prompt
    { role: "assistant", content: [{ type: "text", text: summaryText }] },
    { role: "user", content: [{ type: "text", text: "Continue with the conversion." }] },
    ...messages.slice(compressUpToIndex),
  ];

  logger.info(
    { originalCount: messages.length, compressedCount: compressed.length, pairsCompressed: pairsToCompress },
    "Compressed message history",
  );

  return compressed;
}

// ---------------------------------------------------------------------------
// Human-readable labels for tool names
// ---------------------------------------------------------------------------

function getToolLabel(toolName: string): string {
  const labels: Record<string, string> = {
    read_bicep_file: "Reading Bicep file",
    parse_bicep: "Parsing Bicep content",
    lookup_resource_mapping: "Looking up resource mapping",
    generate_terraform: "Generating Terraform HCL",
    write_terraform_files: "Writing Terraform files",
    validate_terraform: "Validating Terraform",
    format_terraform: "Formatting Terraform",
    list_bicep_files: "Listing Bicep files",
    read_bicep_file_content: "Reading module content",
  };
  return labels[toolName] ?? toolName;
}

// ---------------------------------------------------------------------------
// Main streaming entrypoint
// ---------------------------------------------------------------------------

export async function chatStream(
  bicepContent: string,
  emit: (event: StreamEvent) => void,
  signal?: AbortSignal,
  apiKey?: string,
  opts: { expertMode?: boolean } = {},
): Promise<void> {
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  const model = selectModelWithExpertMode(bicepContent, opts);

  // Accumulate full text and tool call info across rounds
  let fullReply = "";
  const allToolCalls: ToolCallInfo[] = [];
  let totalCost: CostInfo = {
    inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0,
    totalCostUsd: 0, model,
  };

  // Create an isolated temp directory for this conversion to prevent
  // leftover files from previous runs being picked up by format_terraform
  const outputDir = createIsolatedOutputDir();

  // Accumulate terraform files across multiple write_terraform_files calls
  // so a second call (e.g., just terraform.tfvars.example) doesn't replace
  // the entire output from the first call
  let accumulatedTerraformFiles: Record<string, string> = {};

  // Wire up callbacks so we can emit side-effects from tool handlers
  const handlerCallbacks: ToolHandlerCallbacks = {
    onTerraformOutput: (files) => {
      accumulatedTerraformFiles = { ...accumulatedTerraformFiles, ...files };
      emit({ type: "terraform_output", files: accumulatedTerraformFiles });
    },
    onValidation: (passed, output) => {
      emit({ type: "validation", passed, output });
    },
  };
  const handlers = createToolHandlers(handlerCallbacks);

  // Load Terraform MCP tools (HashiCorp official) so Claude can query real
  // provider schemas instead of hallucinating. Falls back to [] on any error.
  const mcpTools = await getTerraformMcpTools();
  const toolsForClaude = [...bicepTools, ...mcpTools];

  // Pre-fetch provider schemas for every azurerm_* type we expect to emit.
  // Eliminates the 3–5 wasted rounds the agent otherwise spends on mid-run
  // get_provider_details calls. Degrades to no-op if MCP is unavailable.
  const prefetch = await prefetchSchemasForSource({
    sourceContent: bicepContent,
    sourceFormat: "bicep",
  });
  if (prefetch.hasContent) {
    logger.info(
      { fetched: prefetch.fetched, skipped: prefetch.skipped, tokens: prefetch.tokens },
      "Schema prefetch populated",
    );
  }

  // Build initial messages array — tell Claude the exact output directory
  const userText =
    "Convert the following Azure Bicep template to Terraform/OpenTofu HCL. " +
    "The Bicep content is provided inline below — skip read_bicep_file and start with parse_bicep. " +
    "Batch your tool calls aggressively (all lookups in one turn, all generates in one turn).\n\n" +
    `IMPORTANT: Use this output directory for ALL file operations (write_terraform_files, validate_terraform, format_terraform): ${outputDir}\n\n` +
    "```bicep\n" +
    bicepContent +
    "\n```" +
    (prefetch.hasContent ? "\n\n" + prefetch.promptBlock : "");

  const messages: MessageParam[] = [
    {
      role: "user",
      content: [{ type: "text", text: userText }],
    },
  ];

  // Emits the coverage_report SSE event based on the final accumulated
  // terraform files. Called right before `done` in every exit path.
  const emitCoverage = (): void => {
    try {
      const report = computeCoverageFromContent({
        sourceContent: bicepContent,
        sourceFormat: "bicep",
        terraformFiles: accumulatedTerraformFiles,
      });
      emit({ type: "coverage_report", report: toCoverageWire(report) });
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "coverage_report emit failed",
      );
    }
  };

  let round = 0;

  try {
  while (round < MAX_TOOL_ROUNDS) {
    round++;

    // Check for cancellation
    if (signal?.aborted) {
      emit({ type: "error", message: "Conversion cancelled" });
      return;
    }

    emit({
      type: "progress",
      step: round,
      total: MAX_TOOL_ROUNDS,
      label: round === 1 ? "Starting conversion" : `Tool round ${round}`,
    });

    // Pace API calls to stay under per-minute token rate limits
    await paceApiCall();

    // Compress older messages to reduce input tokens
    const messagesToSend = compressMessages(messages, round);

    // Create the streaming request with retry
    const stream = await withRetry(() =>
      Promise.resolve(
        client.messages.stream({
          model,
          max_tokens: MAX_TOKENS,
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          tools: toolsForClaude,
          messages: messagesToSend,
        }),
      ),
    );

    // Forward text deltas as they arrive
    stream.on("text", (textDelta) => {
      fullReply += textDelta;
      emit({ type: "text_delta", text: textDelta });
    });

    // Wait for the complete message
    let finalMessage: Anthropic.Message;
    try {
      finalMessage = await stream.finalMessage();
    } catch (err: unknown) {
      if (signal?.aborted) {
        emit({ type: "error", message: "Conversion cancelled" });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "error", message: `API error: ${msg}` });
      return;
    }

    // Track cost
    const usage = finalMessage.usage;
    const roundCost = calculateCost(
      model,
      usage.input_tokens,
      usage.output_tokens,
      (usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0,
      (usage as unknown as Record<string, number>).cache_creation_input_tokens ?? 0,
    );
    totalCost = addCosts(totalCost, roundCost);

    // If the model did not request tool use, we are done
    if (finalMessage.stop_reason !== "tool_use") {
      emitCoverage();
      emit({
        type: "done",
        fullReply,
        toolCalls: allToolCalls,
        costInfo: totalCost,
        model,
      });
      return;
    }

    // Extract all ToolUseBlocks from the response
    const toolUseBlocks = finalMessage.content.filter(
      (block): block is ToolUseBlock => block.type === "tool_use",
    );

    // Process each tool call sequentially
    const toolResults: ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const toolInput = (toolUse.input ?? {}) as Record<string, unknown>;
      const toolCall: ToolCallInfo = {
        tool: toolUse.name,
        input: toolInput,
      };
      allToolCalls.push(toolCall);

      emit({
        type: "tool_start",
        toolName: toolUse.name,
        toolInput,
      });

      emit({
        type: "progress",
        step: round,
        total: MAX_TOOL_ROUNDS,
        label: getToolLabel(toolUse.name),
      });

      // Dispatch to handler — local first, then Terraform MCP fallback
      const handler = handlers[toolUse.name];
      let resultText: string;
      let isError = false;

      if (handler) {
        try {
          const result = await handler(toolInput);
          isError = !result.ok;
          resultText = result.ok ? result.data : result.error;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          resultText = `Error: Tool execution failed: ${msg}`;
          isError = true;
        }
      } else if (isTerraformMcpTool(toolUse.name)) {
        const result = await callMcpTool(toolUse.name, toolInput);
        isError = !result.ok;
        resultText = result.ok ? result.data : result.error;
      } else {
        resultText = `Error: Unknown tool '${toolUse.name}'`;
        isError = true;
      }

      emit({
        type: "tool_result",
        toolName: toolUse.name,
        isError,
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: resultText,
        is_error: isError,
      });
    }

    // Append the assistant's response and all tool results to messages
    messages.push({
      role: "assistant",
      content: finalMessage.content as ContentBlock[],
    });
    messages.push({
      role: "user",
      content: toolResults,
    });
  }

  // Exhausted max rounds
  emitCoverage();
  emit({
    type: "done",
    fullReply:
      fullReply +
      "\n\n[Reached maximum tool rounds. Some steps may not have completed.]",
    toolCalls: allToolCalls,
    costInfo: totalCost,
    model,
  });
  } finally {
    // Clean up isolated temp directory
    cleanupOutputDir(outputDir);
  }
}

// ---------------------------------------------------------------------------
// Multi-file streaming entrypoint
// ---------------------------------------------------------------------------

const MAX_TOKENS_MULTI = 16_384;
const MAX_TOOL_ROUNDS_MULTI = 40;

export async function chatStreamMultiFile(
  bicepFiles: BicepFiles,
  entryPoint: string,
  emit: (event: StreamEvent) => void,
  signal?: AbortSignal,
  apiKey?: string,
  opts: { expertMode?: boolean } = {},
): Promise<void> {
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  const model = selectModelMultiFileWithExpertMode(opts);

  // Validate token budget
  const ctx = summarizeContext(bicepFiles, entryPoint);
  if (ctx.exceedsTokenBudget) {
    emit({
      type: "error",
      message:
        `Project too large for single-pass conversion (${ctx.totalFiles} files, ` +
        `~${Math.round(ctx.totalBytes / 1024)}KB). Please convert individual modules ` +
        `separately using the single-file converter.`,
    });
    return;
  }

  // Build dependency graph and user message
  const graph = buildDependencyGraph(bicepFiles);
  const userMessage = buildMultiFileUserMessage(bicepFiles, entryPoint, graph, ctx);

  // Emit initial per-module progress
  const moduleFiles = graph.processingOrder.filter((f) => f !== entryPoint && f.endsWith(".bicep"));
  emit({
    type: "progress",
    step: 0,
    total: moduleFiles.length + 2, // +2 for entry point + validation
    label: `Analyzing ${Object.keys(bicepFiles).length}-file project`,
  });

  // Create an isolated temp directory for this conversion
  const outputDir = createIsolatedOutputDir();

  // Accumulate full text and tool call info across rounds
  let fullReply = "";
  const allToolCalls: ToolCallInfo[] = [];
  let totalCost: CostInfo = {
    inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0,
    totalCostUsd: 0, model,
  };

  // Accumulate terraform files across multiple write calls (same as single-file)
  let accumulatedTerraformFiles: Record<string, string> = {};

  // Wire up callbacks with bicepFiles context for the read_bicep_file_content tool
  const handlerCallbacks: ToolHandlerCallbacks = {
    onTerraformOutput: (files) => {
      accumulatedTerraformFiles = { ...accumulatedTerraformFiles, ...files };
      emit({ type: "terraform_output", files: accumulatedTerraformFiles });
    },
    onValidation: (passed, output) => {
      emit({ type: "validation", passed, output });
    },
  };
  const handlers = createToolHandlers({
    ...handlerCallbacks,
    bicepFilesContext: bicepFiles,
  });

  // Load Terraform MCP tools for authoritative provider schemas
  const mcpTools = await getTerraformMcpTools();
  const toolsForClaude = [...bicepTools, ...mcpTools];

  // Pre-fetch provider schemas for every azurerm_* type that appears anywhere
  // in the project — shared across modules to avoid redundant mid-run fetches.
  const prefetch = await prefetchSchemasForMultiFile({
    files: bicepFiles,
    sourceFormat: "bicep",
  });
  if (prefetch.hasContent) {
    logger.info(
      { fetched: prefetch.fetched, skipped: prefetch.skipped, tokens: prefetch.tokens },
      "Schema prefetch populated (multi-file Bicep)",
    );
  }

  // Build initial messages array — inject output directory path
  const userMessageWithDir = userMessage +
    `\n\nIMPORTANT: Use this output directory for ALL file operations (write_terraform_files, validate_terraform, format_terraform): ${outputDir}` +
    (prefetch.hasContent ? "\n\n" + prefetch.promptBlock : "");

  const messages: MessageParam[] = [
    {
      role: "user",
      content: [{ type: "text", text: userMessageWithDir }],
    },
  ];

  // Emit coverage_report based on accumulated files + multi-file source inventory.
  const emitCoverage = (): void => {
    try {
      const sourceResources = extractSourceResourceInventoryMultiFile(
        bicepFiles,
        "bicep",
      );
      const generatedResources = extractGeneratedResources(
        accumulatedTerraformFiles,
      );
      const report = computeCoverage({
        sourceResources,
        generatedResources,
        sourceFormat: "bicep",
      });
      emit({ type: "coverage_report", report: toCoverageWire(report) });
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "coverage_report emit failed (multi-file)",
      );
    }
  };

  let round = 0;

  try {
  while (round < MAX_TOOL_ROUNDS_MULTI) {
    round++;

    if (signal?.aborted) {
      emit({ type: "error", message: "Conversion cancelled" });
      return;
    }

    emit({
      type: "progress",
      step: round,
      total: MAX_TOOL_ROUNDS_MULTI,
      label: round === 1 ? "Starting multi-file conversion" : `Tool round ${round}`,
    });

    // Pace API calls to stay under per-minute token rate limits
    await paceApiCall();

    // Compress older messages to reduce input tokens
    const messagesToSend = compressMessages(messages, round);

    const stream = await withRetry(() =>
      Promise.resolve(
        client.messages.stream({
          model,
          max_tokens: MAX_TOKENS_MULTI,
          system: [{ type: "text", text: SYSTEM_PROMPT_MULTI_FILE, cache_control: { type: "ephemeral" } }],
          tools: toolsForClaude,
          messages: messagesToSend,
        }),
      ),
    );

    stream.on("text", (textDelta) => {
      fullReply += textDelta;
      emit({ type: "text_delta", text: textDelta });
    });

    let finalMessage: Anthropic.Message;
    try {
      finalMessage = await stream.finalMessage();
    } catch (err: unknown) {
      if (signal?.aborted) {
        emit({ type: "error", message: "Conversion cancelled" });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "error", message: `API error: ${msg}` });
      return;
    }

    // Track cost
    const usage = finalMessage.usage;
    const roundCost = calculateCost(
      model,
      usage.input_tokens,
      usage.output_tokens,
      (usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0,
      (usage as unknown as Record<string, number>).cache_creation_input_tokens ?? 0,
    );
    totalCost = addCosts(totalCost, roundCost);

    if (finalMessage.stop_reason !== "tool_use") {
      emitCoverage();
      emit({
        type: "done",
        fullReply,
        toolCalls: allToolCalls,
        costInfo: totalCost,
        model,
      });
      return;
    }

    // Extract and process tool calls
    const toolUseBlocks = finalMessage.content.filter(
      (block): block is ToolUseBlock => block.type === "tool_use",
    );

    const toolResults: ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const toolInput = (toolUse.input ?? {}) as Record<string, unknown>;
      const toolCall: ToolCallInfo = {
        tool: toolUse.name,
        input: toolInput,
      };
      allToolCalls.push(toolCall);

      emit({ type: "tool_start", toolName: toolUse.name, toolInput });

      // Build context-aware label for multi-file progress
      let progressLabel = getToolLabel(toolUse.name);
      if (toolUse.name === "parse_bicep") {
        const content = String(toolInput.content ?? "");
        // Try to identify which file is being parsed by matching content
        const matchedFile = Object.entries(bicepFiles).find(([, c]) => content === c);
        if (matchedFile) progressLabel = `Parsing ${matchedFile[0]}`;
      } else if (toolUse.name === "write_terraform_files") {
        progressLabel = "Writing all Terraform files";
      }

      emit({
        type: "progress",
        step: round,
        total: MAX_TOOL_ROUNDS_MULTI,
        label: progressLabel,
      });

      const handler = handlers[toolUse.name];
      let resultText: string;
      let isError = false;

      if (handler) {
        try {
          const result = await handler(toolInput);
          isError = !result.ok;
          resultText = result.ok ? result.data : result.error;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          resultText = `Error: Tool execution failed: ${msg}`;
          isError = true;
        }
      } else if (isTerraformMcpTool(toolUse.name)) {
        const result = await callMcpTool(toolUse.name, toolInput);
        isError = !result.ok;
        resultText = result.ok ? result.data : result.error;
      } else {
        resultText = `Error: Unknown tool '${toolUse.name}'`;
        isError = true;
      }

      emit({ type: "tool_result", toolName: toolUse.name, isError });

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: resultText,
        is_error: isError,
      });
    }

    messages.push({
      role: "assistant",
      content: finalMessage.content as ContentBlock[],
    });
    messages.push({
      role: "user",
      content: toolResults,
    });
  }

  // Exhausted max rounds
  emitCoverage();
  emit({
    type: "done",
    fullReply:
      fullReply +
      "\n\n[Reached maximum tool rounds. Some steps may not have completed.]",
    toolCalls: allToolCalls,
    costInfo: totalCost,
    model,
  });
  } finally {
    // Clean up isolated temp directory
    cleanupOutputDir(outputDir);
  }
}

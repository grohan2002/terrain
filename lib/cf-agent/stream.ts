// ---------------------------------------------------------------------------
// Agentic streaming loop for CloudFormation-to-Terraform conversion.
//
// Parallel to lib/agent/stream.ts::chatStream but uses the CF-specific
// tools, handlers, and system prompt. Shares paceApiCall and compressMessages
// with the Bicep agent (they're stateful helpers that must coordinate
// pacing across requests).
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ContentBlock,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { cloudformationTools } from "./tools";
import { createCfToolHandlers } from "./tool-handlers";
import { CF_SYSTEM_PROMPT, CF_SYSTEM_PROMPT_MULTI_FILE } from "./system-prompt";
import {
  buildCloudFormationDependencyGraph,
  buildCloudFormationMultiFileUserMessage,
  summarizeCloudFormationContext,
} from "../cf-modules";
import type { CloudFormationFiles } from "../types";
import {
  paceApiCall,
  compressMessages,
} from "../agent/stream";
import type { ToolHandlerCallbacks } from "../agent/tool-handlers";
import { withRetry } from "../retry";
import { calculateCost, addCosts, type CostInfo } from "../cost";
import {
  selectModelWithExpertMode,
  selectModelMultiFileWithExpertMode,
} from "../model-router";
import {
  getTerraformMcpTools,
  isTerraformMcpTool,
  callMcpTool,
} from "../mcp/clients";
import { logger } from "../logger";
import type { StreamEvent, ToolCallInfo, CoverageReportWire } from "../types";
import {
  prefetchSchemasForSource,
  prefetchSchemasForMultiFile,
} from "../schema-prefetch";
import {
  computeCoverage,
  computeCoverageFromContent,
} from "../coverage";
import { extractSourceResourceInventoryMultiFile } from "../source-resource-inventory";
import { extractGeneratedResources } from "../generated-resource-inventory";

/** Convert a CoverageReport into its SSE wire shape. */
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
// Isolated temp directory per conversion
// ---------------------------------------------------------------------------

function createIsolatedOutputDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cf-tf-"));
}

function cleanupOutputDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TOKENS = 8192;
const MAX_TOOL_ROUNDS = 30;

// ---------------------------------------------------------------------------
// Human-readable labels for progress UI
// ---------------------------------------------------------------------------

function getToolLabel(toolName: string): string {
  const labels: Record<string, string> = {
    read_cf_template: "Reading CloudFormation template",
    parse_cloudformation: "Parsing CloudFormation",
    lookup_cf_resource_mapping: "Looking up AWS resource mapping",
    read_cf_file_content: "Reading CloudFormation file content",
    generate_terraform: "Generating Terraform HCL",
    write_terraform_files: "Writing Terraform files",
    format_terraform: "Formatting Terraform",
    validate_terraform: "Validating Terraform",
    // Terraform MCP tool labels
    search_providers: "Searching providers",
    get_provider_details: "Fetching provider details",
    get_latest_provider_version: "Checking provider version",
    search_modules: "Searching modules",
    get_module_details: "Fetching module details",
  };
  return labels[toolName] ?? toolName;
}

// ---------------------------------------------------------------------------
// Main streaming entrypoint
// ---------------------------------------------------------------------------

export async function chatStreamCloudFormation(
  cfContent: string,
  emit: (event: StreamEvent) => void,
  signal?: AbortSignal,
  apiKey?: string,
  opts: { expertMode?: boolean } = {},
): Promise<void> {
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  // Reuse model router — its heuristics (small / simple input → Haiku) apply
  // equally to CF templates. Expert Mode promotes every run to Opus 4.7.
  const model = selectModelWithExpertMode(cfContent, opts);

  let fullReply = "";
  const allToolCalls: ToolCallInfo[] = [];
  let totalCost: CostInfo = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCostUsd: 0,
    model,
  };

  const outputDir = createIsolatedOutputDir();

  // Accumulate terraform files so a second write_terraform_files call doesn't
  // wipe out the first (matches the Bicep stream behaviour).
  let accumulatedTerraformFiles: Record<string, string> = {};

  const handlerCallbacks: ToolHandlerCallbacks = {
    onTerraformOutput: (files) => {
      accumulatedTerraformFiles = { ...accumulatedTerraformFiles, ...files };
      emit({ type: "terraform_output", files: accumulatedTerraformFiles });
    },
    onValidation: (passed, output) => {
      emit({ type: "validation", passed, output });
    },
  };
  const handlers = createCfToolHandlers(handlerCallbacks);

  // Load Terraform MCP tools — used for authoritative AWS provider schema
  // lookups (get_provider_details with provider: "aws").
  const mcpTools = await getTerraformMcpTools();
  const toolsForClaude = [...cloudformationTools, ...mcpTools];

  // Pre-fetch aws_* provider schemas for every resource type we expect. Kills
  // the 3–5 wasted rounds the agent otherwise spends on mid-run fetches.
  const prefetch = await prefetchSchemasForSource({
    sourceContent: cfContent,
    sourceFormat: "cloudformation",
  });
  if (prefetch.hasContent) {
    logger.info(
      { fetched: prefetch.fetched, skipped: prefetch.skipped, tokens: prefetch.tokens },
      "Schema prefetch populated (CloudFormation)",
    );
  }

  const userText =
    "Convert the following AWS CloudFormation template to Terraform/OpenTofu HCL " +
    "using the hashicorp/aws provider. The CF content is provided inline below — " +
    "skip read_cf_template and start with parse_cloudformation. " +
    "Batch your tool calls aggressively (all lookups in one turn, all generates in one turn).\n\n" +
    `IMPORTANT: Use this output directory for ALL file operations (write_terraform_files, validate_terraform, format_terraform): ${outputDir}\n\n` +
    "```\n" +
    cfContent +
    "\n```" +
    (prefetch.hasContent ? "\n\n" + prefetch.promptBlock : "");

  const messages: MessageParam[] = [
    {
      role: "user",
      content: [{ type: "text", text: userText }],
    },
  ];

  const emitCoverage = (): void => {
    try {
      const report = computeCoverageFromContent({
        sourceContent: cfContent,
        sourceFormat: "cloudformation",
        terraformFiles: accumulatedTerraformFiles,
      });
      emit({ type: "coverage_report", report: toCoverageWire(report) });
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "coverage_report emit failed (CF)",
      );
    }
  };

  let round = 0;

  try {
    while (round < MAX_TOOL_ROUNDS) {
      round++;

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

      await paceApiCall();

      const messagesToSend = compressMessages(messages, round);

      const stream = await withRetry(() =>
        Promise.resolve(
          client.messages.stream({
            model,
            max_tokens: MAX_TOKENS,
            system: [
              {
                type: "text",
                text: CF_SYSTEM_PROMPT,
                cache_control: { type: "ephemeral" },
              },
            ],
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

        // Dispatch: local handler first, then Terraform MCP fallback.
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

      messages.push({
        role: "assistant",
        content: finalMessage.content as ContentBlock[],
      });
      messages.push({
        role: "user",
        content: toolResults,
      });
    }

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
    cleanupOutputDir(outputDir);
    logger.info(
      { totalCost: totalCost.totalCostUsd, rounds: round, model },
      "CloudFormation conversion complete",
    );
  }
}

// ---------------------------------------------------------------------------
// Multi-file (nested-stacks) streaming entrypoint
// ---------------------------------------------------------------------------

const MAX_TOKENS_MULTI = 16_384;
const MAX_TOOL_ROUNDS_MULTI = 40;

export async function chatStreamCloudFormationMultiFile(
  cfFiles: CloudFormationFiles,
  entryPoint: string,
  emit: (event: StreamEvent) => void,
  signal?: AbortSignal,
  apiKey?: string,
  opts: { expertMode?: boolean } = {},
): Promise<void> {
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  // Multi-file default is Sonnet (nested-stack reasoning out-of-scope for Haiku);
  // Expert Mode bumps to Opus 4.7.
  const model = selectModelMultiFileWithExpertMode(opts);

  let fullReply = "";
  const allToolCalls: ToolCallInfo[] = [];
  let totalCost: CostInfo = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCostUsd: 0,
    model,
  };

  const outputDir = createIsolatedOutputDir();

  // Validate token budget before sending a single API request
  const ctx = summarizeCloudFormationContext(cfFiles, entryPoint);
  if (ctx.exceedsTokenBudget) {
    emit({
      type: "error",
      message:
        `Project exceeds the 80K-token budget (${ctx.totalLines} lines across ${ctx.totalFiles} files). ` +
        "Split into a smaller scope or convert templates individually.",
    });
    cleanupOutputDir(outputDir);
    return;
  }

  // Accumulate terraform files across multiple write_terraform_files calls so
  // a second call (e.g. just terraform.tfvars.example) doesn't replace the
  // entire output from the first call. Same pattern as the single-file path.
  let accumulatedTerraformFiles: Record<string, string> = {};

  const handlerCallbacks: ToolHandlerCallbacks = {
    onTerraformOutput: (files) => {
      accumulatedTerraformFiles = { ...accumulatedTerraformFiles, ...files };
      emit({ type: "terraform_output", files: accumulatedTerraformFiles });
    },
    onValidation: (passed, output) => {
      emit({ type: "validation", passed, output });
    },
  };
  const handlers = createCfToolHandlers({
    ...handlerCallbacks,
    cfFilesContext: cfFiles,
  });

  const mcpTools = await getTerraformMcpTools();
  const toolsForClaude = [...cloudformationTools, ...mcpTools];

  // Pre-fetch aws_* provider schemas for all CF resource types across nested stacks.
  const prefetch = await prefetchSchemasForMultiFile({
    files: cfFiles,
    sourceFormat: "cloudformation",
  });
  if (prefetch.hasContent) {
    logger.info(
      { fetched: prefetch.fetched, skipped: prefetch.skipped, tokens: prefetch.tokens },
      "Schema prefetch populated (multi-file CF)",
    );
  }

  // Build the multi-file project prompt (dependency graph + files in topo order)
  const graph = buildCloudFormationDependencyGraph(cfFiles);
  const userMessage = buildCloudFormationMultiFileUserMessage(
    cfFiles,
    entryPoint,
    graph,
    ctx,
  );
  const userMessageWithDir =
    userMessage +
    `\n\nIMPORTANT: Use this output directory for ALL file operations (write_terraform_files, validate_terraform, format_terraform): ${outputDir}` +
    (prefetch.hasContent ? "\n\n" + prefetch.promptBlock : "");

  const messages: MessageParam[] = [
    {
      role: "user",
      content: [{ type: "text", text: userMessageWithDir }],
    },
  ];

  const emitCoverage = (): void => {
    try {
      const sourceResources = extractSourceResourceInventoryMultiFile(
        cfFiles,
        "cloudformation",
      );
      const generatedResources = extractGeneratedResources(
        accumulatedTerraformFiles,
      );
      const report = computeCoverage({
        sourceResources,
        generatedResources,
        sourceFormat: "cloudformation",
      });
      emit({ type: "coverage_report", report: toCoverageWire(report) });
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "coverage_report emit failed (multi-file CF)",
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
        label:
          round === 1
            ? "Starting multi-file CloudFormation conversion"
            : `Tool round ${round}`,
      });

      await paceApiCall();

      const messagesToSend = compressMessages(messages, round);

      const stream = await withRetry(() =>
        Promise.resolve(
          client.messages.stream({
            model,
            max_tokens: MAX_TOKENS_MULTI,
            system: [
              {
                type: "text",
                text: CF_SYSTEM_PROMPT_MULTI_FILE,
                cache_control: { type: "ephemeral" },
              },
            ],
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

        emit({
          type: "tool_start",
          toolName: toolUse.name,
          toolInput,
        });

        // Per-file progress label for parse_cloudformation calls
        let progressLabel = getToolLabel(toolUse.name);
        if (toolUse.name === "parse_cloudformation") {
          const inputContent = String(toolInput.content ?? "");
          // Match by content prefix against the project files
          for (const [path, content] of Object.entries(cfFiles)) {
            if (inputContent.length > 0 && inputContent.startsWith(content.slice(0, 200))) {
              progressLabel = `Parsing ${path}`;
              break;
            }
          }
        } else if (toolUse.name === "read_cf_file_content") {
          const fp = String(toolInput.file_path ?? "").trim();
          if (fp) progressLabel = `Reading ${fp}`;
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

      messages.push({
        role: "assistant",
        content: finalMessage.content as ContentBlock[],
      });
      messages.push({
        role: "user",
        content: toolResults,
      });
    }

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
    cleanupOutputDir(outputDir);
    logger.info(
      {
        totalCost: totalCost.totalCostUsd,
        rounds: round,
        model,
        fileCount: Object.keys(cfFiles).length,
      },
      "Multi-file CloudFormation conversion complete",
    );
  }
}

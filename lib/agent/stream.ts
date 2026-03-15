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
} from "@anthropic-ai/sdk/resources/messages";
import { bicepTools } from "./tools";
import { createToolHandlers, type ToolHandlerCallbacks } from "./tool-handlers";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_MULTI_FILE } from "./system-prompt";
import { withRetry } from "../retry";
import { calculateCost, addCosts, type CostInfo } from "../cost";
import { selectModel, selectModelMultiFile } from "../model-router";
import { buildDependencyGraph, buildMultiFileUserMessage, summarizeContext } from "../bicep-modules";
import type { BicepFiles, StreamEvent, ToolCallInfo } from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TOKENS = 8192;
const MAX_TOOL_ROUNDS = 30;

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
): Promise<void> {
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  const model = selectModel(bicepContent);

  // Accumulate full text and tool call info across rounds
  let fullReply = "";
  const allToolCalls: ToolCallInfo[] = [];
  let totalCost: CostInfo = {
    inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0,
    totalCostUsd: 0, model,
  };

  // Wire up callbacks so we can emit side-effects from tool handlers
  const handlerCallbacks: ToolHandlerCallbacks = {
    onTerraformOutput: (files) => {
      emit({ type: "terraform_output", files });
    },
    onValidation: (passed, output) => {
      emit({ type: "validation", passed, output });
    },
  };
  const handlers = createToolHandlers(handlerCallbacks);

  // Build initial messages array
  const messages: MessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text:
            "Convert the following Azure Bicep template to Terraform/OpenTofu HCL. " +
            "The Bicep content is provided inline below — skip read_bicep_file and start with parse_bicep. " +
            "Batch your tool calls aggressively (all lookups in one turn, all generates in one turn).\n\n" +
            "```bicep\n" +
            bicepContent +
            "\n```",
        },
      ],
    },
  ];

  let round = 0;

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

    // Create the streaming request with retry
    const stream = await withRetry(() =>
      Promise.resolve(
        client.messages.stream({
          model,
          max_tokens: MAX_TOKENS,
          system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          tools: bicepTools,
          messages,
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

      // Dispatch to handler
      const handler = handlers[toolUse.name];
      let resultText: string;
      let isError = false;

      if (!handler) {
        resultText = `Error: Unknown tool '${toolUse.name}'`;
        isError = true;
      } else {
        try {
          const result = await handler(toolInput);
          isError = !result.ok;
          resultText = result.ok ? result.data : result.error;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          resultText = `Error: Tool execution failed: ${msg}`;
          isError = true;
        }
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
  emit({
    type: "done",
    fullReply:
      fullReply +
      "\n\n[Reached maximum tool rounds. Some steps may not have completed.]",
    toolCalls: allToolCalls,
    costInfo: totalCost,
    model,
  });
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
): Promise<void> {
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  const model = selectModelMultiFile();

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

  // Accumulate full text and tool call info across rounds
  let fullReply = "";
  const allToolCalls: ToolCallInfo[] = [];
  let totalCost: CostInfo = {
    inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0,
    totalCostUsd: 0, model,
  };

  // Wire up callbacks with bicepFiles context for the read_bicep_file_content tool
  const handlerCallbacks: ToolHandlerCallbacks = {
    onTerraformOutput: (files) => {
      emit({ type: "terraform_output", files });
    },
    onValidation: (passed, output) => {
      emit({ type: "validation", passed, output });
    },
  };
  const handlers = createToolHandlers({
    ...handlerCallbacks,
    bicepFilesContext: bicepFiles,
  });

  // Build initial messages array
  const messages: MessageParam[] = [
    {
      role: "user",
      content: [{ type: "text", text: userMessage }],
    },
  ];

  let round = 0;

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

    const stream = await withRetry(() =>
      Promise.resolve(
        client.messages.stream({
          model,
          max_tokens: MAX_TOKENS_MULTI,
          system: [{ type: "text", text: SYSTEM_PROMPT_MULTI_FILE, cache_control: { type: "ephemeral" } }],
          tools: bicepTools,
          messages,
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

      if (!handler) {
        resultText = `Error: Unknown tool '${toolUse.name}'`;
        isError = true;
      } else {
        try {
          const result = await handler(toolInput);
          isError = !result.ok;
          resultText = result.ok ? result.data : result.error;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          resultText = `Error: Tool execution failed: ${msg}`;
          isError = true;
        }
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
  emit({
    type: "done",
    fullReply:
      fullReply +
      "\n\n[Reached maximum tool rounds. Some steps may not have completed.]",
    toolCalls: allToolCalls,
    costInfo: totalCost,
    model,
  });
}

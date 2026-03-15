// ---------------------------------------------------------------------------
// Agentic streaming loop for the deployment testing agent.
//
// Deploys Terraform to Azure, runs smoke tests, and streams results.
// Mirrors lib/agent/stream.ts in structure.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ContentBlock,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { deployTools } from "./tools";
import { createDeployToolHandlers, type DeployToolCallbacks } from "./tool-handlers";
import { DEPLOY_SYSTEM_PROMPT } from "./system-prompt";
import { withRetry } from "../retry";
import { calculateCost, addCosts, type CostInfo } from "../cost";
import type { DeployStreamEvent, ToolCallInfo, DeploySummary } from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 8192;
const MAX_TOOL_ROUNDS = 40;

// ---------------------------------------------------------------------------
// Human-readable labels for deployment tool names
// ---------------------------------------------------------------------------

function getToolLabel(toolName: string): string {
  const labels: Record<string, string> = {
    terraform_plan: "Planning deployment",
    terraform_apply: "Deploying resources",
    get_terraform_outputs: "Reading outputs",
    check_azure_resource: "Checking resource",
    run_connectivity_test: "Testing connectivity",
    check_resource_config: "Validating config",
    terraform_destroy: "Destroying resources",
  };
  return labels[toolName] ?? toolName;
}

// ---------------------------------------------------------------------------
// Main streaming entrypoint
// ---------------------------------------------------------------------------

export async function deployStream(
  terraformFiles: Record<string, string>,
  workingDir: string,
  resourceGroupName: string,
  bicepContent: string,
  emit: (event: DeployStreamEvent) => void,
  signal?: AbortSignal,
  apiKey?: string,
): Promise<void> {
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();

  let fullReply = "";
  const allToolCalls: ToolCallInfo[] = [];
  let totalCost: CostInfo = {
    inputTokens: 0, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0,
    totalCostUsd: 0, model: MODEL,
  };

  // Track test results for the summary
  let testsPassed = 0;
  let testsFailed = 0;

  // Wire up callbacks
  const handlerCallbacks: DeployToolCallbacks = {
    onDeployProgress: (phase, detail) => {
      emit({ type: "deploy_progress", phase: phase as DeployStreamEvent extends { type: "deploy_progress"; phase: infer P } ? P : never, detail });
    },
    onTestResult: (testName, passed, detail) => {
      if (passed) testsPassed++;
      else testsFailed++;
      emit({ type: "test_result", testName, passed, detail });
    },
    onOutputs: (outputs) => {
      emit({ type: "outputs", outputs });
    },
  };
  const handlers = createDeployToolHandlers(handlerCallbacks);

  // Build the terraform files summary for context
  const filesSummary = Object.entries(terraformFiles)
    .map(([name, content]) => `--- ${name} ---\n${content}`)
    .join("\n\n");

  // Build initial messages
  const messages: MessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text:
            `Deploy the following Terraform configuration to Azure and run comprehensive smoke tests.\n\n` +
            `**Working directory:** ${workingDir}\n` +
            `**Resource group:** ${resourceGroupName}\n\n` +
            `Batch your tool calls aggressively (all resource checks in one turn, all connectivity tests in one turn).\n\n` +
            `## Terraform files\n\n\`\`\`hcl\n${filesSummary}\n\`\`\`\n\n` +
            `## Original Bicep (for config validation context)\n\n\`\`\`bicep\n${bicepContent}\n\`\`\``,
        },
      ],
    },
  ];

  let round = 0;

  while (round < MAX_TOOL_ROUNDS) {
    round++;

    if (signal?.aborted) {
      emit({ type: "error", message: "Deployment cancelled" });
      return;
    }

    emit({
      type: "progress",
      step: round,
      total: MAX_TOOL_ROUNDS,
      label: round === 1 ? "Starting deployment" : `Tool round ${round}`,
    });

    const stream = await withRetry(() =>
      Promise.resolve(
        client.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: [{ type: "text", text: DEPLOY_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          tools: deployTools,
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
        emit({ type: "error", message: "Deployment cancelled" });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "error", message: `API error: ${msg}` });
      return;
    }

    // Track cost
    const usage = finalMessage.usage;
    const roundCost = calculateCost(
      MODEL,
      usage.input_tokens,
      usage.output_tokens,
      (usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0,
      (usage as unknown as Record<string, number>).cache_creation_input_tokens ?? 0,
    );
    totalCost = addCosts(totalCost, roundCost);

    // Model is done (no more tool calls)
    if (finalMessage.stop_reason !== "tool_use") {
      const summary: DeploySummary = {
        resourceGroupName,
        resourcesDeployed: allToolCalls.filter((tc) => tc.tool === "terraform_apply").length > 0 ? 1 : 0,
        testsPassed,
        testsFailed,
        destroyed: false,
      };

      emit({
        type: "done",
        fullReply,
        toolCalls: allToolCalls,
        summary,
        costInfo: totalCost,
      });
      return;
    }

    // Process tool calls
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
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
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
  const summary: DeploySummary = {
    resourceGroupName,
    resourcesDeployed: allToolCalls.filter((tc) => tc.tool === "terraform_apply").length > 0 ? 1 : 0,
    testsPassed,
    testsFailed,
    destroyed: false,
  };

  emit({
    type: "done",
    fullReply:
      fullReply +
      "\n\n[Reached maximum tool rounds. Some tests may not have completed.]",
    toolCalls: allToolCalls,
    summary,
    costInfo: totalCost,
  });
}

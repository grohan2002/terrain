import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DeployStreamEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// Hoisted mocks — these must be available before vi.mock factories run
// ---------------------------------------------------------------------------

const {
  mockExecSync,
  mockFinalMessage,
  mockStreamObj,
  mockStreamFn,
  MockAnthropicClass,
} = vi.hoisted(() => {
  const mockFinalMessage = vi.fn();
  const mockStreamObj = {
    on: vi.fn((_event: string, _cb: (text: string) => void) => mockStreamObj),
    finalMessage: mockFinalMessage,
  };
  const mockStreamFn = vi.fn().mockReturnValue(mockStreamObj);
  // Must use regular function (not arrow) to be constructable with `new`
  const MockAnthropicClass = vi.fn(function () {
    return { messages: { stream: mockStreamFn } };
  });
  const mockExecSync = vi.fn((cmd: string) => {
    const cmdStr = String(cmd);
    if (cmdStr === "which tofu") return "/usr/local/bin/tofu";
    if (cmdStr === "which terraform") return "/usr/local/bin/terraform";
    if (cmdStr.includes("tofu plan")) return "Plan: 1 to add.";
    if (cmdStr.includes("tofu apply")) return "Apply complete!";
    if (cmdStr.includes("tofu output")) return JSON.stringify({ out1: { value: "val1" } });
    if (cmdStr.includes("tofu destroy")) return "Destroy complete!";
    if (cmdStr.includes("az resource show")) return JSON.stringify({ properties: { provisioningState: "Succeeded" } });
    if (cmdStr.includes("curl")) return "200";
    if (cmdStr.includes("dig")) return "1.2.3.4";
    if (cmdStr.includes("nc -z")) return "";
    return "";
  });
  return { mockExecSync, mockFinalMessage, mockStreamObj, mockStreamFn, MockAnthropicClass };
});

// ---------------------------------------------------------------------------
// Apply mocks
// ---------------------------------------------------------------------------

vi.mock("@anthropic-ai/sdk", () => ({
  default: MockAnthropicClass,
}));

vi.mock("@/lib/retry", () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: mockExecSync,
    default: { ...actual, execSync: mockExecSync },
  };
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { deployStream } from "@/lib/deploy-agent/stream";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMessage(opts: {
  stopReason: "end_turn" | "tool_use";
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
  inputTokens?: number;
  outputTokens?: number;
}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: opts.content,
    model: "claude-sonnet-4-20250514",
    stop_reason: opts.stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: opts.inputTokens ?? 100,
      output_tokens: opts.outputTokens ?? 50,
    },
  };
}

function collectEvents(
  terraformFiles?: Record<string, string>,
  workingDir?: string,
  resourceGroupName?: string,
  bicepContent?: string,
  signal?: AbortSignal,
  apiKey?: string,
): Promise<DeployStreamEvent[]> {
  const events: DeployStreamEvent[] = [];
  return deployStream(
    terraformFiles ?? { "main.tf": "# test" },
    workingDir ?? "/tmp/test",
    resourceGroupName ?? "rg-test",
    bicepContent ?? "param location string",
    (event) => events.push(event),
    signal,
    apiKey,
  ).then(() => events);
}

beforeEach(() => {
  // Selectively reset to preserve MockAnthropicClass constructor behavior
  mockFinalMessage.mockReset();
  mockStreamObj.on.mockReset();
  mockStreamObj.on.mockImplementation((_event: string) => mockStreamObj);
  mockStreamFn.mockReset();
  mockStreamFn.mockReturnValue(mockStreamObj);
  mockExecSync.mockReset();
  mockExecSync.mockImplementation((cmd: string) => {
    const cmdStr = String(cmd);
    if (cmdStr === "which tofu") return "/usr/local/bin/tofu";
    if (cmdStr === "which terraform") return "/usr/local/bin/terraform";
    if (cmdStr.includes("tofu plan")) return "Plan: 1 to add.";
    if (cmdStr.includes("tofu apply")) return "Apply complete!";
    if (cmdStr.includes("tofu output")) return JSON.stringify({ out1: { value: "val1" } });
    if (cmdStr.includes("tofu destroy")) return "Destroy complete!";
    if (cmdStr.includes("az resource show")) return JSON.stringify({ properties: { provisioningState: "Succeeded" } });
    if (cmdStr.includes("curl")) return "200";
    if (cmdStr.includes("dig")) return "1.2.3.4";
    if (cmdStr.includes("nc -z")) return "";
    return "";
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deployStream", () => {
  it("emits 'done' event on single round with end_turn", async () => {
    mockFinalMessage.mockResolvedValueOnce(
      createMessage({
        stopReason: "end_turn",
        content: [{ type: "text", text: "Deployment complete." }],
      }),
    );

    mockStreamObj.on.mockImplementation((event: string, cb: (text: string) => void) => {
      if (event === "text") cb("Deployment complete.");
      return mockStreamObj;
    });

    const events = await collectEvents();
    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.type).toBe("done");
  });

  it("emits 'text_delta' events for streamed text", async () => {
    mockFinalMessage.mockResolvedValueOnce(
      createMessage({
        stopReason: "end_turn",
        content: [{ type: "text", text: "Hello world." }],
      }),
    );

    mockStreamObj.on.mockImplementation((event: string, cb: (text: string) => void) => {
      if (event === "text") {
        cb("Hello ");
        cb("world.");
      }
      return mockStreamObj;
    });

    const events = await collectEvents();
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBeGreaterThanOrEqual(2);
  });

  it("processes tool_use blocks and calls handlers", async () => {
    mockFinalMessage
      .mockResolvedValueOnce(
        createMessage({
          stopReason: "tool_use",
          content: [
            { type: "text", text: "Planning..." },
            {
              type: "tool_use",
              id: "tu_1",
              name: "terraform_plan",
              input: { working_dir: "/tmp/test" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createMessage({
          stopReason: "end_turn",
          content: [{ type: "text", text: "Done." }],
        }),
      );

    const events = await collectEvents();
    const toolStarts = events.filter((e) => e.type === "tool_start");
    const toolResults = events.filter((e) => e.type === "tool_result");
    expect(toolStarts.length).toBeGreaterThanOrEqual(1);
    expect(toolResults.length).toBeGreaterThanOrEqual(1);
    expect(events.find((e) => e.type === "done")).toBeDefined();
  });

  it("tracks cost across rounds", async () => {
    mockFinalMessage
      .mockResolvedValueOnce(
        createMessage({
          stopReason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "terraform_plan",
              input: { working_dir: "/tmp/test" },
            },
          ],
          inputTokens: 500,
          outputTokens: 200,
        }),
      )
      .mockResolvedValueOnce(
        createMessage({
          stopReason: "end_turn",
          content: [{ type: "text", text: "Done." }],
          inputTokens: 300,
          outputTokens: 100,
        }),
      );

    const events = await collectEvents();
    const doneEvent = events.find(
      (e): e is Extract<DeployStreamEvent, { type: "done" }> => e.type === "done",
    );
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.costInfo).toBeDefined();
    expect(doneEvent!.costInfo!.inputTokens).toBe(800);
    expect(doneEvent!.costInfo!.outputTokens).toBe(300);
  });

  it("emits 'error' on API failure", async () => {
    mockFinalMessage.mockRejectedValueOnce(new Error("API overloaded"));

    const events = await collectEvents();
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent && errorEvent.type === "error") {
      expect(errorEvent.message).toContain("API overloaded");
    }
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const events = await collectEvents(
      undefined,
      undefined,
      undefined,
      undefined,
      controller.signal,
    );
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent && errorEvent.type === "error") {
      expect(errorEvent.message).toContain("cancelled");
    }
  });

  it("handles unknown tool names gracefully", async () => {
    mockFinalMessage
      .mockResolvedValueOnce(
        createMessage({
          stopReason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "nonexistent_tool",
              input: {},
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createMessage({
          stopReason: "end_turn",
          content: [{ type: "text", text: "Done." }],
        }),
      );

    const events = await collectEvents();
    const toolResult = events.find(
      (e): e is Extract<DeployStreamEvent, { type: "tool_result" }> =>
        e.type === "tool_result" && e.toolName === "nonexistent_tool",
    );
    expect(toolResult).toBeDefined();
    expect(toolResult!.isError).toBe(true);
  });

  it("emits 'progress' event each round", async () => {
    mockFinalMessage.mockResolvedValueOnce(
      createMessage({
        stopReason: "end_turn",
        content: [{ type: "text", text: "Done." }],
      }),
    );

    const events = await collectEvents();
    const progressEvents = events.filter((e) => e.type === "progress");
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("passes apiKey to Anthropic constructor when provided", async () => {
    mockFinalMessage.mockResolvedValueOnce(
      createMessage({
        stopReason: "end_turn",
        content: [{ type: "text", text: "Done." }],
      }),
    );

    await collectEvents(undefined, undefined, undefined, undefined, undefined, "sk-test-key");

    expect(MockAnthropicClass).toHaveBeenCalledWith({ apiKey: "sk-test-key" });
  });

  it("emits outputs event when get_terraform_outputs is called", async () => {
    mockFinalMessage
      .mockResolvedValueOnce(
        createMessage({
          stopReason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "get_terraform_outputs",
              input: { working_dir: "/tmp/test" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createMessage({
          stopReason: "end_turn",
          content: [{ type: "text", text: "Outputs retrieved." }],
        }),
      );

    const events = await collectEvents();
    const outputsEvent = events.find((e) => e.type === "outputs");
    expect(outputsEvent).toBeDefined();
    if (outputsEvent && outputsEvent.type === "outputs") {
      expect(outputsEvent.outputs).toHaveProperty("out1");
    }
  });

  it("includes summary with test counts in done event", async () => {
    mockFinalMessage
      .mockResolvedValueOnce(
        createMessage({
          stopReason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "check_azure_resource",
              input: {
                resource_id: "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa1",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createMessage({
          stopReason: "end_turn",
          content: [{ type: "text", text: "Done." }],
        }),
      );

    const events = await collectEvents();
    const doneEvent = events.find(
      (e): e is Extract<DeployStreamEvent, { type: "done" }> => e.type === "done",
    );
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.summary).toBeDefined();
    expect(doneEvent!.summary.testsPassed).toBeGreaterThanOrEqual(1);
    expect(doneEvent!.summary.resourceGroupName).toBe("rg-test");
  });
});

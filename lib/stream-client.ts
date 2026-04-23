// ---------------------------------------------------------------------------
// Client-side SSE consumer for the /api/convert endpoint.
//
// Uses fetch + ReadableStream to parse server-sent events and dispatch
// typed callbacks to the UI layer.
// ---------------------------------------------------------------------------

import type { BicepFiles, StreamEvent, ToolCallInfo, TerraformFiles, CostInfo, SourceFormat, CoverageReportWire } from "./types";

// ---------------------------------------------------------------------------
// Callback interface
// ---------------------------------------------------------------------------

export interface ConversionCallbacks {
  onTextDelta: (text: string) => void;
  onToolStart: (toolName: string, toolInput: Record<string, unknown>) => void;
  onToolResult: (toolName: string, isError: boolean) => void;
  onTerraformOutput: (files: TerraformFiles) => void;
  onValidation: (passed: boolean, output: string) => void;
  onProgress: (step: number, total: number, label: string) => void;
  onCoverageReport?: (report: CoverageReportWire) => void;
  onDone: (fullReply: string, toolCalls: ToolCallInfo[], costInfo?: CostInfo, model?: string) => void;
  onError: (message: string) => void;
}

// ---------------------------------------------------------------------------
// SSE consumer
// ---------------------------------------------------------------------------

export async function sendConversionStream(
  bicepContent: string,
  callbacks: ConversionCallbacks,
  signal?: AbortSignal,
  apiKey?: string,
  sourceFormat: SourceFormat = "bicep",
  expertMode = false,
): Promise<void> {
  let response: Response;

  try {
    response = await fetch("/api/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bicepContent,
        sourceFormat,
        expertMode,
        ...(apiKey ? { apiKey } : {}),
      }),
      signal,
    });
  } catch (err: unknown) {
    if (signal?.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.onError(`Network error: ${msg}`);
    return;
  }

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body.error) errorMsg = body.error;
    } catch {
      // Ignore parse errors
    }
    callbacks.onError(errorMsg);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError("Response body is not readable");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse complete SSE events from the buffer
      const lines = buffer.split("\n");

      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        // SSE data lines start with "data: "
        if (!trimmed.startsWith("data:")) continue;

        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;

        let event: StreamEvent;
        try {
          event = JSON.parse(jsonStr) as StreamEvent;
        } catch {
          continue; // Skip malformed events
        }

        dispatchEvent(event, callbacks);
      }
    }

    // Process any remaining data in the buffer
    if (buffer.trim()) {
      const remaining = buffer.trim();
      if (remaining.startsWith("data:")) {
        const jsonStr = remaining.slice(5).trim();
        if (jsonStr) {
          try {
            const event = JSON.parse(jsonStr) as StreamEvent;
            dispatchEvent(event, callbacks);
          } catch {
            // Ignore
          }
        }
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.onError(`Stream read error: ${msg}`);
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Internal dispatcher
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Multi-file SSE consumer — sends bicepFiles + entryPoint to the same endpoint
// ---------------------------------------------------------------------------

export async function sendMultiFileConversionStream(
  bicepFiles: BicepFiles,
  entryPoint: string,
  callbacks: ConversionCallbacks,
  signal?: AbortSignal,
  apiKey?: string,
  sourceFormat: SourceFormat = "bicep",
  expertMode = false,
): Promise<void> {
  let response: Response;

  try {
    response = await fetch("/api/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bicepFiles,
        entryPoint,
        sourceFormat,
        expertMode,
        ...(apiKey ? { apiKey } : {}),
      }),
      signal,
    });
  } catch (err: unknown) {
    if (signal?.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.onError(`Network error: ${msg}`);
    return;
  }

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body.error) errorMsg = body.error;
    } catch {
      // Ignore parse errors
    }
    callbacks.onError(errorMsg);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError("Response body is not readable");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;

        let event: StreamEvent;
        try {
          event = JSON.parse(jsonStr) as StreamEvent;
        } catch {
          continue;
        }
        dispatchEvent(event, callbacks);
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const remaining = buffer.trim();
      if (remaining.startsWith("data:")) {
        const jsonStr = remaining.slice(5).trim();
        if (jsonStr) {
          try {
            const event = JSON.parse(jsonStr) as StreamEvent;
            dispatchEvent(event, callbacks);
          } catch {
            // Ignore
          }
        }
      }
    }
  } catch (err: unknown) {
    if (signal?.aborted) return;
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.onError(`Stream read error: ${msg}`);
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Internal dispatcher
// ---------------------------------------------------------------------------

function dispatchEvent(
  event: StreamEvent,
  callbacks: ConversionCallbacks,
): void {
  switch (event.type) {
    case "text_delta":
      callbacks.onTextDelta(event.text);
      break;
    case "tool_start":
      callbacks.onToolStart(event.toolName, event.toolInput);
      break;
    case "tool_result":
      callbacks.onToolResult(event.toolName, event.isError);
      break;
    case "terraform_output":
      callbacks.onTerraformOutput(event.files);
      break;
    case "validation":
      callbacks.onValidation(event.passed, event.output);
      break;
    case "progress":
      callbacks.onProgress(event.step, event.total, event.label);
      break;
    case "coverage_report":
      callbacks.onCoverageReport?.(event.report);
      break;
    case "done":
      callbacks.onDone(event.fullReply, event.toolCalls, event.costInfo, event.model);
      break;
    case "error":
      callbacks.onError(event.message);
      break;
  }
}

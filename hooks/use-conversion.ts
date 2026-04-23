"use client";

import { useCallback, useRef } from "react";
import { useConversionStore } from "@/lib/store";
import { sendConversionStream, sendMultiFileConversionStream } from "@/lib/stream-client";
import type { ConversionCallbacks } from "@/lib/stream-client";
import type { ConversionHistoryEntry } from "@/lib/types";
import { toast } from "@/components/ui/sonner";
import { v4 as uuidv4 } from "uuid";

export function useConversion() {
  const abortRef = useRef<AbortController | null>(null);

  const startConversion = useCallback(
    async (bicepContentArg?: string, bicepFilenameArg?: string, apiKey?: string) => {
      const store = useConversionStore.getState();
      const bicepContent = bicepContentArg ?? store.bicepContent;
      const bicepFilename = bicepFilenameArg ?? (store.bicepFilename || undefined);

      if (!bicepContent.trim()) return;

      // Cancel any in-flight conversion
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Reset and set converting state
      store.resetConversion();
      store.resetStreamingText();
      store.setBicepContent(bicepContent, bicepFilename);
      store.setStatus("converting");

      toast("Conversion started", {
        description: bicepFilename || "Untitled.bicep",
      });

      store.addMessage({
        role: "user",
        content: `Convert Bicep file${bicepFilename ? ` (${bicepFilename})` : ""} to Terraform.`,
        timestamp: new Date().toISOString(),
      });

      const callbacks: ConversionCallbacks = {
        onTextDelta: (text) => {
          useConversionStore.getState().appendStreamingText(text);
        },

        onToolStart: (toolName, toolInput) => {
          const s = useConversionStore.getState();
          s.setActiveToolName(toolName);
          s.addToolCall({ tool: toolName, input: toolInput });
        },

        onToolResult: () => {
          useConversionStore.getState().setActiveToolName(null);
        },

        onTerraformOutput: (files) => {
          useConversionStore.getState().setTerraformFiles(files);
        },

        onValidation: (passed, output) => {
          const s = useConversionStore.getState();
          s.setStatus("validating");
          s.setValidationResult({ passed, output });
        },

        onProgress: (step, total, label) => {
          useConversionStore.getState().setProgress({ step, total, label });
        },

        onCoverageReport: (report) => {
          useConversionStore.getState().setCoverageReport(report);
        },

        onDone: (fullReply, toolCalls, costInfo) => {
          const s = useConversionStore.getState();
          s.setStatus("done");
          s.setActiveToolName(null);
          s.setProgress(null);
          if (costInfo) s.setCostInfo(costInfo);

          s.addMessage({
            role: "assistant",
            content: fullReply,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            timestamp: new Date().toISOString(),
          });

          const entry: ConversionHistoryEntry = {
            id: uuidv4(),
            timestamp: new Date().toISOString(),
            bicepFile: s.bicepFilename || (s.sourceFormat === "cloudformation" ? "untitled.yaml" : "untitled.bicep"),
            bicepContent: s.bicepContent,
            terraformFiles: s.terraformFiles,
            validationPassed: s.validationResult?.passed ?? false,
            agentConversation: s.messages,
            resourcesConverted: Object.keys(s.terraformFiles).length,
            // Multi-file metadata (Bicep-only for now)
            isMultiFile: s.isMultiFile,
            ...(s.isMultiFile
              ? {
                  bicepFiles: s.bicepFiles,
                  entryPoint: s.entryPoint,
                  bicepFileCount: Object.keys(s.bicepFiles).length,
                }
              : {}),
            // Source IaC format ("bicep" or "cloudformation")
            sourceFormat: s.sourceFormat,
            // Token usage and cost
            ...(costInfo ? { costInfo } : {}),
          };
          s.addHistoryEntry(entry);

          // Persist to server-side history (best-effort)
          fetch("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              bicepFilename: s.bicepFilename || "untitled.bicep",
              bicepContent: s.bicepContent,
              terraformFiles: s.terraformFiles,
              validationPassed: s.validationResult?.passed ?? false,
              model: costInfo?.model,
              inputTokens: costInfo?.inputTokens ?? 0,
              outputTokens: costInfo?.outputTokens ?? 0,
              totalCostUsd: costInfo?.totalCostUsd ?? 0,
              isMultiFile: s.isMultiFile,
              bicepFileCount: s.isMultiFile ? Object.keys(s.bicepFiles).length : undefined,
              entryPoint: s.isMultiFile ? s.entryPoint : undefined,
            }),
          }).catch(() => {}); // Swallow errors — localStorage is primary

          toast.success("Conversion complete", {
            description: `${Object.keys(s.terraformFiles).length} file(s) generated`,
          });
        },

        onError: (message) => {
          const s = useConversionStore.getState();
          s.setStatus("error");
          s.setActiveToolName(null);
          s.setProgress(null);

          s.addMessage({
            role: "assistant",
            content: `Error: ${message}`,
            timestamp: new Date().toISOString(),
          });

          toast.error("Conversion failed", { description: message });
        },
      };

      try {
        // Dispatch to multi-file or single-file stream based on store state
        if (store.isMultiFile && Object.keys(store.bicepFiles).length > 0) {
          await sendMultiFileConversionStream(
            store.bicepFiles,
            store.entryPoint,
            callbacks,
            controller.signal,
            apiKey,
            store.sourceFormat,
            store.expertMode,
          );
        } else {
          await sendConversionStream(
            bicepContent,
            callbacks,
            controller.signal,
            apiKey,
            store.sourceFormat,
            store.expertMode,
          );
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          useConversionStore.getState().setStatus("error");
          useConversionStore.getState().addMessage({
            role: "assistant",
            content: `Unexpected error: ${String(err)}`,
            timestamp: new Date().toISOString(),
          });
          toast.error("Unexpected error", { description: String(err) });
        }
      }
    },
    []
  );

  const cancelConversion = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const s = useConversionStore.getState();
    s.setStatus("idle");
    s.setActiveToolName(null);
    s.setProgress(null);
    toast("Conversion cancelled");
  }, []);

  return { startConversion, cancelConversion };
}

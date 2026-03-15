"use client";

import { useCallback, useRef } from "react";
import { useConversionStore } from "@/lib/store";
import { sendDeployStream } from "@/lib/deploy-stream-client";
import type { DeployCallbacks } from "@/lib/deploy-stream-client";
import type { TestResult } from "@/lib/types";
import { toast } from "@/components/ui/sonner";

export function useDeployment() {
  const abortRef = useRef<AbortController | null>(null);

  // ------------------------------------------------------------------
  // startDeployment — setup then SSE agent loop
  // ------------------------------------------------------------------
  const startDeployment = useCallback(async (apiKey?: string) => {
    const store = useConversionStore.getState();
    const terraformFiles = store.terraformFiles;
    const bicepContent = store.bicepContent;

    if (Object.keys(terraformFiles).length === 0) {
      toast.error("No Terraform files to deploy");
      return;
    }

    // Cancel any in-flight deployment
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Reset deployment state
    store.resetDeployment();
    store.setDeploymentStatus("deploying");

    toast("Deployment starting", {
      description: "Setting up environment…",
    });

    store.addDeployMessage({
      role: "user",
      content: "Deploy Terraform configuration and run smoke tests.",
      timestamp: new Date().toISOString(),
    });

    // Step 1: Setup — create RG, write files, tofu init
    let workingDir: string;
    let resourceGroupName: string;

    try {
      const setupRes = await fetch("/api/deploy/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terraformFiles }),
        signal: controller.signal,
      });

      if (!setupRes.ok) {
        const body = await setupRes.json().catch(() => ({ error: "Setup failed" }));
        throw new Error(body.error ?? `HTTP ${setupRes.status}`);
      }

      const setupData = await setupRes.json();
      workingDir = setupData.workingDir;
      resourceGroupName = setupData.resourceGroupName;

      store.setDeployWorkingDir(workingDir);
      store.setDeployResourceGroup(resourceGroupName);
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      store.setDeploymentStatus("error");
      store.addDeployMessage({
        role: "assistant",
        content: `Setup failed: ${msg}`,
        timestamp: new Date().toISOString(),
      });
      toast.error("Deployment setup failed", { description: msg });
      return;
    }

    toast("Environment ready", {
      description: `Resource group: ${resourceGroupName}`,
    });

    // Step 2: SSE agent loop
    const callbacks: DeployCallbacks = {
      onTextDelta: (text) => {
        useConversionStore.getState().appendDeployStreamingText(text);
      },

      onToolStart: (toolName, toolInput) => {
        const s = useConversionStore.getState();
        s.setDeployActiveToolName(toolName);
        s.addDeployToolCall({ tool: toolName, input: toolInput });
      },

      onToolResult: () => {
        useConversionStore.getState().setDeployActiveToolName(null);
      },

      onDeployProgress: (phase, detail) => {
        const s = useConversionStore.getState();
        s.setDeployPhase(phase as Parameters<typeof s.setDeployPhase>[0]);
        // Update deployment status based on phase
        if (phase === "testing") {
          s.setDeploymentStatus("testing");
        }
        s.addDeployMessage({
          role: "assistant",
          content: detail,
          timestamp: new Date().toISOString(),
        });
      },

      onTestResult: (testName, passed, detail) => {
        const s = useConversionStore.getState();
        // Categorize the test
        let category: TestResult["category"] = "existence";
        if (testName.startsWith("connectivity:")) category = "connectivity";
        else if (testName.startsWith("config:")) category = "config_validation";

        s.addTestResult({ testName, passed, detail, category });
      },

      onOutputs: (outputs) => {
        useConversionStore.getState().setDeployOutputs(outputs);
      },

      onProgress: (step, total, label) => {
        useConversionStore.getState().setDeploymentProgress({ step, total, label });
      },

      onDone: (fullReply, toolCalls, summary, costInfo) => {
        const s = useConversionStore.getState();
        s.setDeploymentStatus("awaiting_destroy");
        s.setDeployActiveToolName(null);
        s.setDeploymentProgress(null);
        s.setDeploySummary(summary);
        if (costInfo) s.setDeployCostInfo(costInfo);

        s.addDeployMessage({
          role: "assistant",
          content: fullReply,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          timestamp: new Date().toISOString(),
        });

        toast.success("Deployment tests complete", {
          description: `${summary.testsPassed} passed, ${summary.testsFailed} failed`,
        });
      },

      onError: (message) => {
        const s = useConversionStore.getState();
        s.setDeploymentStatus("error");
        s.setDeployActiveToolName(null);
        s.setDeploymentProgress(null);

        s.addDeployMessage({
          role: "assistant",
          content: `Error: ${message}`,
          timestamp: new Date().toISOString(),
        });

        toast.error("Deployment failed", { description: message });
      },
    };

    try {
      await sendDeployStream(
        terraformFiles,
        workingDir,
        resourceGroupName,
        bicepContent,
        callbacks,
        controller.signal,
        apiKey,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const s = useConversionStore.getState();
        s.setDeploymentStatus("error");
        s.addDeployMessage({
          role: "assistant",
          content: `Unexpected error: ${String(err)}`,
          timestamp: new Date().toISOString(),
        });
        toast.error("Unexpected error", { description: String(err) });
      }
    }
  }, []);

  // ------------------------------------------------------------------
  // destroyResources — deterministic teardown (no LLM)
  // ------------------------------------------------------------------
  const destroyResources = useCallback(async () => {
    const store = useConversionStore.getState();
    const workingDir = store.deployWorkingDir;
    const resourceGroupName = store.deployResourceGroup;

    if (!workingDir || !resourceGroupName) {
      toast.error("No deployment to destroy");
      return;
    }

    store.setDeploymentStatus("destroying");

    toast("Destroying resources", {
      description: `Resource group: ${resourceGroupName}`,
    });

    try {
      const res = await fetch("/api/deploy/destroy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workingDir, resourceGroupName }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const s = useConversionStore.getState();
      s.setDeploymentStatus("done");
      s.setDeploySummary(
        s.deploySummary
          ? { ...s.deploySummary, destroyed: true }
          : null,
      );

      s.addDeployMessage({
        role: "assistant",
        content: `Resources destroyed successfully.\n\n${data.output}`,
        timestamp: new Date().toISOString(),
      });

      toast.success("Resources destroyed", {
        description: `Resource group '${resourceGroupName}' deleted`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      useConversionStore.getState().setDeploymentStatus("error");
      toast.error("Destroy failed", { description: msg });
    }
  }, []);

  // ------------------------------------------------------------------
  // keepResources — skip destroy, mark done
  // ------------------------------------------------------------------
  const keepResources = useCallback(() => {
    const s = useConversionStore.getState();
    s.setDeploymentStatus("done");
    s.addDeployMessage({
      role: "assistant",
      content: `Resources kept. Resource group '${s.deployResourceGroup}' is still active.`,
      timestamp: new Date().toISOString(),
    });
    toast("Resources kept", {
      description: `Resource group '${s.deployResourceGroup}' still exists`,
    });
  }, []);

  // ------------------------------------------------------------------
  // cancelDeployment — abort the SSE stream
  // ------------------------------------------------------------------
  const cancelDeployment = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const s = useConversionStore.getState();
    s.setDeploymentStatus("idle");
    s.setDeployActiveToolName(null);
    s.setDeploymentProgress(null);
    toast("Deployment cancelled");
  }, []);

  return { startDeployment, destroyResources, keepResources, cancelDeployment };
}

"use client";

import { useMemo } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConversionStore } from "@/lib/store";

// ---------------------------------------------------------------------------
// The deployment pipeline steps in order
// ---------------------------------------------------------------------------

const STEPS = [
  { id: "terraform_plan", label: "Plan" },
  { id: "terraform_apply", label: "Apply" },
  { id: "get_terraform_outputs", label: "Outputs" },
  { id: "check_azure_resource", label: "Resources" },
  { id: "run_connectivity_test", label: "Connectivity" },
  { id: "check_resource_config", label: "Config" },
] as const;

type StepStatus = "pending" | "active" | "done" | "error";

export function DeployProgressTracker() {
  const deployToolCalls = useConversionStore((s) => s.deployToolCalls);
  const deployActiveToolName = useConversionStore((s) => s.deployActiveToolName);
  const deploymentStatus = useConversionStore((s) => s.deploymentStatus);

  // Derive which steps have completed — use useMemo to avoid new references
  const completedToolNames = useMemo(() => {
    const names = new Set<string>();
    for (const tc of deployToolCalls) {
      names.add(tc.tool);
    }
    return names;
  }, [deployToolCalls]);

  const stepStatuses = useMemo((): StepStatus[] => {
    return STEPS.map(({ id }) => {
      if (deployActiveToolName === id) return "active";
      if (completedToolNames.has(id)) return "done";
      if (deploymentStatus === "error") {
        // Mark the first pending step as error
        return "pending";
      }
      return "pending";
    });
  }, [completedToolNames, deployActiveToolName, deploymentStatus]);

  if (deploymentStatus === "idle" || deploymentStatus === "done") {
    return null;
  }

  return (
    <div className="flex items-center gap-1 px-3 py-2 bg-muted/40 border-b overflow-x-auto">
      {STEPS.map((step, i) => {
        const status = stepStatuses[i];
        return (
          <div key={step.id} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={cn(
                  "h-px w-4 shrink-0",
                  status === "done" || status === "active"
                    ? "bg-cta"
                    : "bg-border"
                )}
              />
            )}
            <div
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                status === "active" && "bg-cta/10 text-cta",
                status === "done" && "text-muted-foreground",
                status === "pending" && "text-muted-foreground/50",
                status === "error" && "text-destructive"
              )}
            >
              {status === "active" && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              {status === "done" && (
                <CheckCircle2 className="h-3 w-3 text-green-500" />
              )}
              {status === "pending" && (
                <Circle className="h-3 w-3" />
              )}
              {status === "error" && (
                <XCircle className="h-3 w-3" />
              )}
              {step.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

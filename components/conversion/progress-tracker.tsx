"use client";

import { Check, Loader2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConversionStore } from "@/lib/store";
import { Progress } from "@/components/ui/progress";

const STEPS = [
  { key: "read_bicep_file", label: "Reading file" },
  { key: "parse_bicep", label: "Parsing Bicep" },
  { key: "lookup_resource_mapping", label: "Mapping resources" },
  { key: "generate_terraform", label: "Generating Terraform" },
  { key: "write_terraform_files", label: "Writing files" },
  { key: "validate_terraform", label: "Validating" },
];

export function ProgressTracker() {
  const progress = useConversionStore((s) => s.progress);
  const activeToolName = useConversionStore((s) => s.activeToolName);
  const status = useConversionStore((s) => s.status);
  const toolCalls = useConversionStore((s) => s.toolCalls);

  const completedTools = new Set(toolCalls.map((tc) => tc.tool));

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 top-16 z-30 w-56 rounded-lg border border-border bg-card p-4 shadow-lg"
    >
      <h3 className="mb-3 text-sm font-semibold">Conversion Progress</h3>
      <div className="space-y-2">
        {STEPS.map((step) => {
          const isActive = activeToolName === step.key;
          const isComplete = completedTools.has(step.key);
          const isPending = !isActive && !isComplete;

          return (
            <div key={step.key} className="flex items-center gap-2">
              {isComplete ? (
                <Check className="h-4 w-4 text-cta shrink-0" />
              ) : isActive ? (
                <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
              )}
              <span
                className={cn(
                  "text-xs",
                  isActive && "font-medium text-foreground",
                  isComplete && "text-muted-foreground",
                  isPending && "text-muted-foreground/50"
                )}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
      {progress && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{progress.label}</span>
            <span>
              {progress.step}/{progress.total}
            </span>
          </div>
          <Progress
            value={progress.step}
            max={progress.total}
            className="h-1.5"
          />
        </div>
      )}
      {status === "done" && (
        <p className="mt-3 text-xs font-medium text-cta">
          Conversion complete
        </p>
      )}
      {status === "error" && (
        <p className="mt-3 text-xs font-medium text-destructive">
          Conversion failed
        </p>
      )}
    </div>
  );
}

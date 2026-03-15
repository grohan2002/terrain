"use client";

import { useState } from "react";
import { Scale, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConversionStore } from "@/lib/store";
import type { PolicyResult, PolicyViolation } from "@/lib/types";

const SEVERITY_COLORS: Record<string, string> = {
  error: "bg-red-500/10 text-red-500 border-red-500/20",
  warning: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  info: "bg-blue-500/10 text-blue-500 border-blue-500/20",
};

export function PolicyPanel() {
  const terraformFiles = useConversionStore((s) => s.terraformFiles);
  const [result, setResult] = useState<PolicyResult | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasFiles = Object.keys(terraformFiles).length > 0;

  async function evaluate() {
    setEvaluating(true);
    setError(null);
    try {
      const res = await fetch("/api/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terraformFiles }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data: PolicyResult = await res.json();
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEvaluating(false);
    }
  }

  if (!hasFiles) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Convert a Bicep file first to evaluate policies.
      </div>
    );
  }

  if (!result && !evaluating) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Scale className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Evaluate encryption, public access, and tagging policies.
        </p>
        <Button size="sm" onClick={evaluate}>
          <Scale className="h-3.5 w-3.5" />
          Evaluate Policies
        </Button>
      </div>
    );
  }

  if (evaluating) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Evaluating policies...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button size="sm" variant="outline" onClick={evaluate}>
          Retry
        </Button>
      </div>
    );
  }

  const { violations, passed } = result!;
  const grouped = groupByPolicy(violations);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          {passed ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-red-500" />
          )}
          <span className="text-xs font-medium">
            {violations.length === 0 ? "All policies passed" : `${violations.length} violation(s)`}
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={evaluate} className="h-6 text-xs">
          Re-evaluate
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-2">
        {Object.entries(grouped).map(([policy, items]) => (
          <div key={policy} className="space-y-1">
            <div className="flex items-center gap-2 px-1">
              <span className="text-xs font-medium capitalize">{policy.replace("_", " ")}</span>
              <span className="text-[10px] text-muted-foreground">{items.length}</span>
            </div>
            {items.map((v, i) => (
              <div key={i} className="flex items-start gap-2 rounded border border-border px-3 py-2 text-xs">
                <Badge variant="secondary" className={SEVERITY_COLORS[v.severity] + " text-[10px] mt-0.5 shrink-0"}>
                  {v.severity}
                </Badge>
                <div className="space-y-0.5">
                  <p>{v.message}</p>
                  {v.resource && (
                    <p className="text-muted-foreground font-mono">{v.resource}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function groupByPolicy(violations: PolicyViolation[]) {
  const grouped: Record<string, PolicyViolation[]> = {};
  for (const v of violations) {
    (grouped[v.policy] ??= []).push(v);
  }
  return grouped;
}

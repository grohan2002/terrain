"use client";

import { useState } from "react";
import { DollarSign, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConversionStore } from "@/lib/store";
import type { CostEstimateResult } from "@/lib/types";

export function CostEstimatePanel() {
  const terraformFiles = useConversionStore((s) => s.terraformFiles);
  const [result, setResult] = useState<CostEstimateResult | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasFiles = Object.keys(terraformFiles).length > 0;

  async function estimate() {
    setEstimating(true);
    setError(null);
    try {
      const res = await fetch("/api/cost-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terraformFiles }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data: CostEstimateResult = await res.json();
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEstimating(false);
    }
  }

  if (!hasFiles) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Convert a Bicep file first to estimate costs.
      </div>
    );
  }

  if (!result && !estimating) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <DollarSign className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Estimate the monthly Azure cost for your Terraform resources.
        </p>
        <Button size="sm" onClick={estimate}>
          <DollarSign className="h-3.5 w-3.5" />
          Estimate Cost
        </Button>
      </div>
    );
  }

  if (estimating) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Estimating costs...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button size="sm" variant="outline" onClick={estimate}>
          Retry
        </Button>
      </div>
    );
  }

  const { resources, totalMonthlyCost, currency, infracostUsed } = result!;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-green-500" />
          <span className="text-xs font-medium">
            Estimated: ${totalMonthlyCost.toFixed(2)}/{currency === "USD" ? "mo" : currency}
          </span>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            {resources.length} resource(s)
          </Badge>
          {infracostUsed ? (
            <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-600 dark:text-green-400">
              Infracost
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600 dark:text-amber-400" title="Infracost not available — showing rough fallback estimate">
              Fallback estimate
            </Badge>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={estimate} className="h-6 text-xs">
          Re-estimate
        </Button>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background border-b border-border">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-1.5 font-medium">Resource</th>
              <th className="px-3 py-1.5 font-medium">Type</th>
              <th className="px-3 py-1.5 font-medium text-right">Monthly</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((r, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                <td className="px-3 py-1.5 font-mono">{r.name}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{r.resourceType.replace("azurerm_", "")}</td>
                <td className="px-3 py-1.5 text-right font-mono">
                  {r.monthlyCost > 0 ? `$${r.monthlyCost.toFixed(2)}` : "Free"}
                </td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className="px-3 py-2" colSpan={2}>Total</td>
              <td className="px-3 py-2 text-right font-mono">${totalMonthlyCost.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

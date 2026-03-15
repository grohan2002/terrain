"use client";

import { useState } from "react";
import { Shield, ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConversionStore } from "@/lib/store";
import type { ScanResult, ScanFinding } from "@/lib/types";

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-500/10 text-red-500 border-red-500/20",
  HIGH: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  MEDIUM: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  LOW: "bg-blue-500/10 text-blue-500 border-blue-500/20",
};

export function SecurityPanel() {
  const terraformFiles = useConversionStore((s) => s.terraformFiles);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasFiles = Object.keys(terraformFiles).length > 0;

  async function runScan() {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terraformFiles }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const result: ScanResult = await res.json();
      setScanResult(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  if (!hasFiles) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Convert a Bicep file first to run security scans.
      </div>
    );
  }

  if (!scanResult && !scanning) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Shield className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Scan your Terraform output for security misconfigurations.
        </p>
        <Button size="sm" onClick={runScan}>
          <Shield className="h-3.5 w-3.5" />
          Run Security Scan
        </Button>
      </div>
    );
  }

  if (scanning) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Scanning...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button size="sm" variant="outline" onClick={runScan}>
          Retry
        </Button>
      </div>
    );
  }

  const { findings, passed, scanner } = scanResult!;
  const grouped = groupBySeverity(findings);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          {passed ? (
            <ShieldCheck className="h-4 w-4 text-green-500" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-red-500" />
          )}
          <span className="text-xs font-medium">
            {findings.length === 0 ? "No issues found" : `${findings.length} finding(s)`}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {scanner}
          </Badge>
        </div>
        <Button size="sm" variant="ghost" onClick={runScan} className="h-6 text-xs">
          Re-scan
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-2">
        {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((severity) => {
          const items = grouped[severity];
          if (!items?.length) return null;
          return (
            <div key={severity} className="space-y-1">
              <div className="flex items-center gap-2 px-1">
                <Badge variant="secondary" className={SEVERITY_COLORS[severity] + " text-[10px]"}>
                  {severity}
                </Badge>
                <span className="text-[10px] text-muted-foreground">{items.length}</span>
              </div>
              {items.map((f, i) => (
                <div key={i} className="rounded border border-border px-3 py-2 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{f.title}</span>
                    <span className="text-muted-foreground font-mono">{f.ruleId}</span>
                  </div>
                  <p className="text-muted-foreground">{f.description}</p>
                  {f.resolution && (
                    <p className="text-green-600 dark:text-green-400">Fix: {f.resolution}</p>
                  )}
                  {f.file && (
                    <p className="text-muted-foreground font-mono">
                      {f.file}
                      {f.lines ? `:${f.lines.start}` : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function groupBySeverity(findings: ScanFinding[]) {
  const grouped: Record<string, ScanFinding[]> = {};
  for (const f of findings) {
    (grouped[f.severity] ??= []).push(f);
  }
  return grouped;
}

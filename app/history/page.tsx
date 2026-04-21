"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { History, FileCode, FolderOpen, Rocket, Coins, Hash, Layers } from "lucide-react";
import { useSession } from "next-auth/react";
import { useConversionStore } from "@/lib/store";
import { hasPermission } from "@/lib/rbac";
import { formatCost, formatTokens } from "@/lib/cost";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";

export default function HistoryPage() {
  const history = useConversionStore((s) => s.history);
  const setBicepContent = useConversionStore((s) => s.setBicepContent);
  const setBicepFiles = useConversionStore((s) => s.setBicepFiles);
  const setTerraformFiles = useConversionStore((s) => s.setTerraformFiles);
  const setStatus = useConversionStore((s) => s.setStatus);
  const { data: session } = useSession();
  const userRole = session?.user?.role ?? "CONVERTER";
  const canDeploy = hasPermission(userRole, "DEPLOYER");
  const router = useRouter();

  // Aggregate usage stats (useMemo to avoid new-ref loops with React 19)
  const stats = useMemo(() => {
    let totalTokens = 0;
    let totalCost = 0;
    for (const entry of history) {
      if (entry.costInfo) {
        totalTokens += entry.costInfo.inputTokens + entry.costInfo.outputTokens;
        totalCost += entry.costInfo.totalCostUsd;
      }
    }
    return { totalConversions: history.length, totalTokens, totalCost };
  }, [history]);

  const handleLoad = (entry: (typeof history)[0]) => {
    // Restore multi-file context if available
    if (entry.isMultiFile && entry.bicepFiles && entry.entryPoint) {
      setBicepFiles(entry.bicepFiles, entry.entryPoint);
    } else {
      setBicepContent(entry.bicepContent, entry.bicepFile);
    }
    setTerraformFiles(entry.terraformFiles);
    // Mark as done so Deploy & Test button appears on /convert
    setStatus("done");
    toast.success("Loaded conversion", {
      description: entry.isMultiFile
        ? `Project (${entry.bicepFileCount ?? Object.keys(entry.bicepFiles ?? {}).length} files)`
        : entry.bicepFile,
    });
    router.push("/convert");
  };

  const handleDeploy = (entry: (typeof history)[0]) => {
    // Load the conversion and navigate to /convert ready for deployment
    if (entry.isMultiFile && entry.bicepFiles && entry.entryPoint) {
      setBicepFiles(entry.bicepFiles, entry.entryPoint);
    } else {
      setBicepContent(entry.bicepContent, entry.bicepFile);
    }
    setTerraformFiles(entry.terraformFiles);
    setStatus("done");
    toast.success("Ready to deploy", {
      description: `Loaded "${entry.isMultiFile ? `Project (${entry.bicepFileCount ?? "?"} files)` : entry.bicepFile}" — click Deploy & Test to proceed`,
    });
    router.push("/convert");
  };

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-cta">History</p>
        <h1 className="text-2xl font-bold tracking-tight">
          Conversion History
        </h1>
        <p className="mt-1 text-muted-foreground">
          View past Bicep and CloudFormation conversions
        </p>
      </div>

      {/* Usage summary cards */}
      {history.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
              <Layers className="h-3.5 w-3.5" />
              Total Conversions
            </div>
            <p className="mt-1 text-2xl font-bold tracking-tight">{stats.totalConversions}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
              <Hash className="h-3.5 w-3.5" />
              Total Tokens
            </div>
            <p className="mt-1 text-2xl font-bold tracking-tight font-mono">
              {stats.totalTokens > 0 ? formatTokens(stats.totalTokens) : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
              <Coins className="h-3.5 w-3.5" />
              Total Spent
            </div>
            <p className="mt-1 text-2xl font-bold tracking-tight font-mono">
              {stats.totalCost > 0 ? formatCost(stats.totalCost) : "—"}
            </p>
          </div>
        </div>
      )}

      {history.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border py-16">
          <div className="rounded-full bg-muted p-4">
            <History className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-medium">No conversion history</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Completed conversions will appear here
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">File</TableHead>
                <TableHead className="px-4">Date</TableHead>
                <TableHead className="px-4">Resources</TableHead>
                <TableHead className="px-4">Tokens</TableHead>
                <TableHead className="px-4">Cost</TableHead>
                <TableHead className="px-4">Validation</TableHead>
                <TableHead className="px-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((entry) => {
                const fmt = entry.sourceFormat ?? "bicep";
                return (
                <TableRow key={entry.id}>
                  <TableCell className="px-4">
                    <div className="flex items-center gap-2">
                      {entry.isMultiFile ? (
                        <FolderOpen className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <FileCode className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="font-medium">
                        {entry.isMultiFile
                          ? `Project (${entry.bicepFileCount ?? "?"} files)`
                          : entry.bicepFile}
                      </span>
                      <Badge
                        variant="outline"
                        className={
                          fmt === "cloudformation"
                            ? "text-[10px] border-orange-500/30 text-orange-600 dark:text-orange-400"
                            : "text-[10px] border-blue-500/30 text-blue-600 dark:text-blue-400"
                        }
                      >
                        {fmt === "cloudformation" ? "CloudFormation" : "Bicep"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="px-4 text-muted-foreground">
                    {entry.resourcesConverted}
                  </TableCell>
                  <TableCell className="px-4 font-mono text-xs text-muted-foreground">
                    {entry.costInfo
                      ? formatTokens(entry.costInfo.inputTokens + entry.costInfo.outputTokens)
                      : "—"}
                  </TableCell>
                  <TableCell className="px-4 font-mono text-xs text-muted-foreground">
                    {entry.costInfo
                      ? formatCost(entry.costInfo.totalCostUsd)
                      : "—"}
                  </TableCell>
                  <TableCell className="px-4">
                    <Badge
                      variant={entry.validationPassed ? "secondary" : "destructive"}
                      className={entry.validationPassed ? "bg-green-500/10 text-green-500 border-green-500/20" : ""}
                    >
                      {entry.validationPassed ? "Passed" : "Failed"}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleLoad(entry)}
                      >
                        Load
                      </Button>
                      {canDeploy && entry.validationPassed && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeploy(entry)}
                          className="border-cta/30 text-cta hover:bg-cta/10"
                        >
                          <Rocket className="h-3.5 w-3.5" />
                          Deploy
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

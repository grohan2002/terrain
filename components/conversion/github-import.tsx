"use client";

import { useCallback, useState, useMemo } from "react";
import {
  Github,
  Loader2,
  File,
  Star,
  AlertTriangle,
  Upload,
  Eye,
  EyeOff,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { useConversionStore } from "@/lib/store";
import { parseModuleReferences } from "@/lib/bicep-modules";
import type { BicepFiles } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScanStats {
  totalFilesInRepo: number;
  bicepFilesFound: number;
  totalBytesLoaded: number;
  branch: string;
  subdirectory: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GitHubImport() {
  const setBicepFiles = useConversionStore((s) => s.setBicepFiles);

  // Input state
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [subdirectory, setSubdirectory] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Scan state
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview state
  const [pendingFiles, setPendingFiles] = useState<BicepFiles | null>(null);
  const [selectedEntryPoint, setSelectedEntryPoint] = useState("");
  const [stats, setStats] = useState<ScanStats | null>(null);
  const [registryModules, setRegistryModules] = useState<string[]>([]);

  // Derived state — useMemo (Zustand v5 + React 19 safe)
  const pendingPaths = useMemo(
    () => (pendingFiles ? Object.keys(pendingFiles).sort() : []),
    [pendingFiles],
  );

  const rootBicepFiles = useMemo(
    () =>
      pendingPaths.filter(
        (p) =>
          !p.includes("/") &&
          p.endsWith(".bicep") &&
          !p.endsWith(".bicepparam"),
      ),
    [pendingPaths],
  );

  // -------------------------------------------------------------------------
  // Scan handler
  // -------------------------------------------------------------------------

  const handleScan = useCallback(async () => {
    if (!repoUrl.trim()) return;

    setScanning(true);
    setError(null);
    setPendingFiles(null);

    try {
      const res = await fetch("/api/github/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: repoUrl.trim(),
          ...(branch.trim() && { branch: branch.trim() }),
          ...(subdirectory.trim() && { subdirectory: subdirectory.trim() }),
          ...(token.trim() && { token: token.trim() }),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Scan failed (${res.status})`);
      }

      // Detect registry modules (same pattern as multi-file-upload)
      const regMods: string[] = [];
      for (const [filePath, content] of Object.entries(data.files as BicepFiles)) {
        const refs = parseModuleReferences(filePath, content);
        for (const ref of refs) {
          if (ref.resolvedPath === null) {
            regMods.push(`${ref.name} (${ref.source})`);
          }
        }
      }
      setRegistryModules(regMods);

      setPendingFiles(data.files as BicepFiles);
      setSelectedEntryPoint(data.entryPoint as string);
      setStats(data.stats as ScanStats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }, [repoUrl, branch, subdirectory, token]);

  // -------------------------------------------------------------------------
  // Confirm handler
  // -------------------------------------------------------------------------

  const confirmImport = useCallback(() => {
    if (!pendingFiles) return;
    setBicepFiles(pendingFiles, selectedEntryPoint);
    toast.success("GitHub project loaded", {
      description: `${Object.keys(pendingFiles).length} file(s) from ${repoUrl}`,
    });
    setPendingFiles(null);
    setRepoUrl("");
  }, [pendingFiles, selectedEntryPoint, setBicepFiles, repoUrl]);

  // -------------------------------------------------------------------------
  // Preview phase
  // -------------------------------------------------------------------------

  if (pendingFiles && stats) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        {/* Stats header */}
        <div className="flex items-center gap-2">
          <Github className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium">
            {stats.bicepFilesFound} Bicep file(s) found
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {stats.branch}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground -mt-2">
          {stats.totalFilesInRepo.toLocaleString()} total files in repo
          {stats.subdirectory && ` · /${stats.subdirectory}`}
          {" · "}
          {(stats.totalBytesLoaded / 1024).toFixed(1)}KB loaded
        </p>

        {/* File list */}
        <div className="w-full max-w-sm rounded-md border border-border p-3 max-h-40 overflow-auto text-xs space-y-0.5">
          {pendingPaths.map((p) => (
            <div key={p} className="flex items-center gap-1.5">
              <File className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="truncate">{p}</span>
              {p === selectedEntryPoint && (
                <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 shrink-0" />
              )}
            </div>
          ))}
        </div>

        {/* Entry point selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Entry point:</span>
          {rootBicepFiles.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent transition-colors">
                {selectedEntryPoint}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {rootBicepFiles.map((f) => (
                  <DropdownMenuItem
                    key={f}
                    onClick={() => setSelectedEntryPoint(f)}
                  >
                    {f}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Badge variant="secondary" className="text-xs">
              {selectedEntryPoint}
            </Badge>
          )}
        </div>

        {/* Registry module warnings */}
        {registryModules.length > 0 && (
          <div className="w-full max-w-sm rounded-md border border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950/30 p-2.5 text-xs space-y-1">
            <div className="flex items-center gap-1.5 text-yellow-700 dark:text-yellow-400 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {registryModules.length} registry module(s) detected
            </div>
            <p className="text-yellow-600 dark:text-yellow-500 pl-5">
              These reference external registries (br:, ts:) and cannot be
              resolved locally. The converter will use its knowledge of
              AVM/registry modules to generate equivalent Terraform.
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPendingFiles(null);
              setStats(null);
            }}
          >
            Cancel
          </Button>
          <Button variant="cta" size="sm" onClick={confirmImport}>
            <Upload className="h-3.5 w-3.5" />
            Load Project
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Input phase
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="rounded-full bg-muted p-4">
        <Github className="h-8 w-8 text-muted-foreground" />
      </div>

      <div className="text-center">
        <p className="font-medium">Import from GitHub</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Scan a repository for Bicep files
        </p>
      </div>

      {/* Repo URL input */}
      <div className="w-full max-w-sm space-y-3">
        <input
          type="text"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo or owner/repo"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cta/50 focus:border-cta"
          onKeyDown={(e) => e.key === "Enter" && handleScan()}
        />

        {/* Advanced options toggle */}
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
          />
          Advanced options
        </button>

        {/* Advanced options */}
        {showAdvanced && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Branch
              </label>
              <input
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="default branch"
                className="mt-0.5 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cta/50 focus:border-cta"
              />
            </div>

            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Subdirectory
              </label>
              <input
                type="text"
                value={subdirectory}
                onChange={(e) => setSubdirectory(e.target.value)}
                placeholder="e.g., infra/bicep"
                className="mt-0.5 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cta/50 focus:border-cta"
              />
            </div>

            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                GitHub Token
              </label>
              <div className="relative mt-0.5">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ghp_... (optional for public repos)"
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 pr-8 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cta/50 focus:border-cta"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? (
                    <EyeOff className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                </button>
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Required for private repos. Never stored.
              </p>
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Scan button */}
        <Button
          variant="cta"
          size="sm"
          className="w-full"
          disabled={!repoUrl.trim() || scanning}
          onClick={handleScan}
        >
          {scanning ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Scanning repository...
            </>
          ) : (
            <>
              <Github className="h-3.5 w-3.5" />
              Scan Repository
            </>
          )}
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Supports .bicep and .bicepparam files (max 50 files, 10MB)
      </p>
    </div>
  );
}

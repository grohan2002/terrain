"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Play,
  Square,
  Download,
  Archive,
  FileCode,
  FolderOpen,
  ChevronDown,
  Key,
  Rocket,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useConversionStore } from "@/lib/store";
import { formatCost, formatTokens, formatModel } from "@/lib/cost";
import { hasPermission } from "@/lib/rbac";
import { useConversion } from "@/hooks/use-conversion";
import { useDeployment } from "@/hooks/use-deployment";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { toast } from "@/components/ui/sonner";
import { downloadTerraformZip, downloadTerraformFiles } from "@/lib/zip-export";
import { FileUpload } from "./file-upload";
import { FileTree } from "./file-tree";
import { ProgressTracker } from "./progress-tracker";
import { ValidationPanel } from "./validation-panel";
import { ChatPanel } from "@/components/chat/chat-panel";
import { DeployChatPanel } from "@/components/deployment/deploy-chat-panel";
import { TestResultsPanel } from "@/components/deployment/test-results-panel";
import { DeployProgressTracker } from "@/components/deployment/deploy-progress-tracker";
import { DestroyDialog } from "@/components/deployment/destroy-dialog";
import { AzureConfigDialog } from "@/components/deployment/azure-config-dialog";
import type { AzureConfig } from "@/lib/types";
import { SecurityPanel } from "./security-panel";
import { PolicyPanel } from "./policy-panel";
import { CostEstimatePanel } from "./cost-estimate-panel";

function EditorSkeleton() {
  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  );
}

const CodeEditor = dynamic(
  () => import("@/components/editor/code-editor").then((m) => m.CodeEditor),
  { ssr: false, loading: () => <EditorSkeleton /> }
);

const DiffViewer = dynamic(
  () => import("@/components/editor/diff-viewer").then((m) => m.DiffViewer),
  { ssr: false, loading: () => <EditorSkeleton /> }
);

const ResourceGraph = dynamic(
  () => import("./resource-graph").then((m) => m.ResourceGraph),
  { ssr: false, loading: () => <EditorSkeleton /> }
);

type BottomTab = "chat" | "validation" | "diff" | "graph" | "security" | "policies" | "cost" | "deploy-chat" | "tests";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  converting: { label: "Converting...", className: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  validating: { label: "Validating...", className: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" },
  done: { label: "Complete", className: "bg-green-500/10 text-green-500 border-green-500/20" },
  error: { label: "Error", className: "" },
};

const DEPLOY_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  deploying: { label: "Deploying...", className: "bg-orange-500/10 text-orange-500 border-orange-500/20" },
  testing: { label: "Testing...", className: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  awaiting_destroy: { label: "Awaiting Decision", className: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" },
  destroying: { label: "Destroying...", className: "bg-red-500/10 text-red-500 border-red-500/20" },
  done: { label: "Deploy Done", className: "bg-green-500/10 text-green-500 border-green-500/20" },
  error: { label: "Deploy Error", className: "" },
};

export function ConversionPanel() {
  const bicepContent = useConversionStore((s) => s.bicepContent);
  const bicepFilename = useConversionStore((s) => s.bicepFilename);
  const terraformFiles = useConversionStore((s) => s.terraformFiles);
  const status = useConversionStore((s) => s.status);
  const deploymentStatus = useConversionStore((s) => s.deploymentStatus);
  const costInfo = useConversionStore((s) => s.costInfo);
  const coverageReport = useConversionStore((s) => s.coverageReport);
  const setBicepContent = useConversionStore((s) => s.setBicepContent);
  const sourceFormat = useConversionStore((s) => s.sourceFormat);
  const setSourceFormat = useConversionStore((s) => s.setSourceFormat);
  const expertMode = useConversionStore((s) => s.expertMode);
  const setExpertMode = useConversionStore((s) => s.setExpertMode);
  const isMultiFile = useConversionStore((s) => s.isMultiFile);
  const bicepFiles = useConversionStore((s) => s.bicepFiles);
  const entryPoint = useConversionStore((s) => s.entryPoint);
  const resetConversion = useConversionStore((s) => s.resetConversion);
  const fullReset = useConversionStore((s) => s.reset);
  const { startConversion, cancelConversion } = useConversion();
  const { startDeployment, destroyResources, keepResources, cancelDeployment } = useDeployment();
  const { data: session } = useSession();
  const userRole = session?.user?.role ?? "CONVERTER";

  const bicepFileCount = useMemo(() => Object.keys(bicepFiles).length, [bicepFiles]);

  const [bottomTab, setBottomTab] = useState<BottomTab>("chat");
  const [selectedFile, setSelectedFile] = useState<string>("all");
  const [selectedBicepFile, setSelectedBicepFile] = useState<string>("");
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  // API key dialog state
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [serverHasKey, setServerHasKey] = useState<boolean | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [rememberForSession, setRememberForSession] = useState(true);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  const API_KEY_STORAGE_KEY = "anthropic-api-key";
  const AZURE_CONFIG_STORAGE_KEY = "azure-deploy-config";

  // Azure config dialog state
  const [showAzureConfigDialog, setShowAzureConfigDialog] = useState(false);
  const [serverHasAzureConfig, setServerHasAzureConfig] = useState<boolean | null>(null);
  const pendingApiKeyRef = useRef<string | undefined>(undefined);

  // Check if server already has an API key and Azure config configured
  useEffect(() => {
    fetch("/api/check-key")
      .then((res) => res.json())
      .then((data) => {
        setServerHasKey(data.hasKey);
        setServerHasAzureConfig(data.hasAzureConfig ?? false);
      })
      .catch(() => {
        setServerHasKey(false);
        setServerHasAzureConfig(false);
      });
  }, []);

  // Focus API key input when dialog opens
  useEffect(() => {
    if (showApiKeyDialog) {
      // Small delay to wait for dialog animation
      const timer = setTimeout(() => apiKeyInputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [showApiKeyDialog]);

  // Attempt to start conversion — prompts for API key if needed
  const handleConvert = useCallback(() => {
    if (!bicepContent) return;

    // 1. Server has env var → no key needed
    if (serverHasKey) {
      startConversion();
      return;
    }

    // 2. Session has cached key → use it
    const cachedKey = sessionStorage.getItem(API_KEY_STORAGE_KEY);
    if (cachedKey) {
      startConversion(undefined, undefined, cachedKey);
      return;
    }

    // 3. Show dialog to ask for key
    pendingActionRef.current = "convert";
    setApiKeyInput("");
    setShowApiKeyDialog(true);
  }, [bicepContent, serverHasKey, startConversion]);

  // Pending action for API key dialog (convert or deploy)
  const pendingActionRef = useRef<"convert" | "deploy">("convert");

  // Helper: resolve Azure config and start deployment
  const resolveAzureAndDeploy = useCallback(
    (resolvedApiKey?: string) => {
      // 1. Server has ARM_* env vars → go directly
      if (serverHasAzureConfig) {
        startDeployment(resolvedApiKey);
        setBottomTab("deploy-chat");
        return;
      }

      // 2. Session has cached Azure config → use it
      try {
        const cachedAzure = sessionStorage.getItem(AZURE_CONFIG_STORAGE_KEY);
        if (cachedAzure) {
          const config = JSON.parse(cachedAzure) as AzureConfig;
          startDeployment(resolvedApiKey, config);
          setBottomTab("deploy-chat");
          return;
        }
      } catch {
        // Ignore parse errors
      }

      // 3. Show Azure config dialog (store API key for use after submit)
      pendingApiKeyRef.current = resolvedApiKey;
      setShowAzureConfigDialog(true);
    },
    [serverHasAzureConfig, startDeployment],
  );

  // Attempt to start deployment — prompts for API key then Azure config
  const handleDeploy = useCallback(() => {
    // Stage A: Resolve Anthropic API key
    if (serverHasKey) {
      // Server has env var → no key needed, proceed to Azure config
      resolveAzureAndDeploy();
      return;
    }

    const cachedKey = sessionStorage.getItem(API_KEY_STORAGE_KEY);
    if (cachedKey) {
      // Session has cached key → proceed to Azure config
      resolveAzureAndDeploy(cachedKey);
      return;
    }

    // Need API key first, then Azure config
    // eslint-disable-next-line react-hooks/immutability -- useRef.current mutation is the intended React pattern for dialog-state pass-through
    pendingActionRef.current = "deploy";
    setApiKeyInput("");
    setShowApiKeyDialog(true);
  }, [serverHasKey, resolveAzureAndDeploy]);

  // Submit the API key from dialog and start conversion or deployment
  const handleApiKeySubmit = useCallback(() => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;

    if (rememberForSession) {
      sessionStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
    }

    setShowApiKeyDialog(false);
    setApiKeyInput("");

    if (pendingActionRef.current === "deploy") {
      // API key resolved — now check Azure config
      resolveAzureAndDeploy(trimmed);
    } else {
      startConversion(undefined, undefined, trimmed);
    }
  }, [apiKeyInput, rememberForSession, startConversion, resolveAzureAndDeploy]);

  // Handle Azure config dialog submission
  const handleAzureConfigSubmit = useCallback(
    (config: AzureConfig) => {
      startDeployment(pendingApiKeyRef.current, config);
      setBottomTab("deploy-chat");
      pendingApiKeyRef.current = undefined;
    },
    [startDeployment],
  );

  const fileNames = useMemo(() => Object.keys(terraformFiles), [terraformFiles]);

  const terraformOutput = useMemo(() => {
    if (selectedFile === "all" || !terraformFiles[selectedFile]) {
      return Object.entries(terraformFiles)
        .map(([name, content]) => `# --- ${name} ---\n${content}`)
        .join("\n\n");
    }
    return terraformFiles[selectedFile];
  }, [terraformFiles, selectedFile]);

  const handleDownload = useCallback(async () => {
    const fileCount = Object.keys(terraformFiles).length;
    const hasNestedPaths = Object.keys(terraformFiles).some((f) => f.includes("/"));

    if (hasNestedPaths || isMultiFile) {
      // Multi-file / nested paths → zip download preserving directory structure
      const zipName = bicepFilename
        ? `${bicepFilename.replace(/\.bicep$/, "")}-terraform.zip`
        : "terraform-output.zip";
      await downloadTerraformZip(terraformFiles, zipName);
      toast.success("Zip downloaded", {
        description: `${fileCount} file(s) archived in ${zipName}`,
      });
    } else {
      // Simple flat files → individual downloads
      downloadTerraformFiles(terraformFiles);
      toast.success("Files downloaded", {
        description: `${fileCount} file(s) saved`,
      });
    }
  }, [terraformFiles, isMultiFile, bicepFilename]);

  const isConverting = status === "converting" || status === "validating";
  const hasOutput = Object.keys(terraformFiles).length > 0;
  const isDeploying =
    deploymentStatus === "deploying" ||
    deploymentStatus === "testing" ||
    deploymentStatus === "destroying";
  // Deploy & Test is currently Azure-only; hide for CloudFormation until AWS
  // deploy support lands.
  const canDeploy =
    status === "done" &&
    hasOutput &&
    !isDeploying &&
    deploymentStatus !== "awaiting_destroy" &&
    hasPermission(userRole, "DEPLOYER") &&
    sourceFormat === "bicep";

  // Keyboard shortcuts: Cmd/Ctrl+Enter to convert, Escape to cancel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!isConverting && bicepContent) handleConvert();
      }
      if (e.key === "Escape" && isConverting) {
        e.preventDefault();
        setShowCancelDialog(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isConverting, bicepContent, handleConvert, cancelConversion]);

  const statusBadge = STATUS_BADGE[status];
  const deployBadge = DEPLOY_STATUS_BADGE[deploymentStatus];

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <div className="flex h-12 items-center justify-between border-b border-border px-4 shrink-0">
        <div className="flex items-center gap-3">
          {/* Source format toggle — switches pipelines (Bicep vs CloudFormation). */}
          <div
            role="group"
            aria-label="Source format"
            className="inline-flex overflow-hidden rounded-md border border-border text-[11px] font-medium"
          >
            <button
              type="button"
              onClick={() => sourceFormat !== "bicep" && setSourceFormat("bicep")}
              disabled={isConverting || isDeploying}
              className={`px-2.5 py-1 transition-colors ${
                sourceFormat === "bicep"
                  ? "bg-cta text-cta-foreground"
                  : "text-muted-foreground hover:bg-accent"
              } disabled:opacity-50`}
              title="Convert Azure Bicep"
            >
              Bicep
            </button>
            <button
              type="button"
              onClick={() => sourceFormat !== "cloudformation" && setSourceFormat("cloudformation")}
              disabled={isConverting || isDeploying}
              className={`border-l border-border px-2.5 py-1 transition-colors ${
                sourceFormat === "cloudformation"
                  ? "bg-cta text-cta-foreground"
                  : "text-muted-foreground hover:bg-accent"
              } disabled:opacity-50`}
              title="Convert AWS CloudFormation"
            >
              CloudFormation
            </button>
          </div>
          {/* Expert Mode pill — opts into Claude Opus 4.7 for the run. */}
          <Tooltip>
            <TooltipTrigger
              onClick={() => setExpertMode(!expertMode)}
              disabled={isConverting || isDeploying}
              className={
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 " +
                (expertMode
                  ? "border-violet-600 bg-violet-600 text-white hover:bg-violet-700"
                  : "border-border text-muted-foreground hover:bg-accent")
              }
              aria-pressed={expertMode}
              aria-label="Toggle Expert Mode"
            >
              <span aria-hidden>\u26a1</span>
              {expertMode ? "Expert" : "Standard"}
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-xs p-3 space-y-1">
              <p className="font-semibold">Expert Mode</p>
              <p className="text-muted-foreground">
                Upgrades this run to <span className="font-mono">Claude Opus 4.7</span> for the
                gnarliest templates. Higher accuracy, <strong>~5\u00d7 the cost</strong> of a standard run.
              </p>
              <p className="text-muted-foreground">
                Default (Standard) routes simple single-resource files to Haiku and everything
                else to Sonnet 4.
              </p>
            </TooltipContent>
          </Tooltip>
          <FileCode className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {isMultiFile
              ? `Project (${bicepFileCount} files)`
              : bicepFilename ||
                (sourceFormat === "cloudformation" ? "Untitled.yaml" : "Untitled.bicep")}
          </span>
          {status !== "idle" && statusBadge && (
            <Badge
              variant={status === "error" ? "destructive" : "secondary"}
              className={statusBadge.className}
            >
              {statusBadge.label}
            </Badge>
          )}
          {deploymentStatus !== "idle" && deployBadge && (
            <Badge
              variant={deploymentStatus === "error" ? "destructive" : "secondary"}
              className={deployBadge.className}
            >
              {deployBadge.label}
            </Badge>
          )}
          {costInfo && (
            <Tooltip>
              <TooltipTrigger className="inline-flex items-center rounded-md border border-border px-2.5 py-0.5 text-[10px] font-mono text-muted-foreground transition-colors hover:bg-accent cursor-default">
                {formatCost(costInfo.totalCostUsd)}
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs space-y-1 p-3">
                <p className="font-semibold">{formatModel(costInfo.model)}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
                  <span>Input tokens</span>
                  <span className="text-right font-mono">{formatTokens(costInfo.inputTokens)}</span>
                  <span>Output tokens</span>
                  <span className="text-right font-mono">{formatTokens(costInfo.outputTokens)}</span>
                  {costInfo.cacheReadTokens > 0 && (
                    <>
                      <span>Cache read</span>
                      <span className="text-right font-mono">{formatTokens(costInfo.cacheReadTokens)}</span>
                    </>
                  )}
                  {costInfo.cacheWriteTokens > 0 && (
                    <>
                      <span>Cache write</span>
                      <span className="text-right font-mono">{formatTokens(costInfo.cacheWriteTokens)}</span>
                    </>
                  )}
                </div>
                <p className="pt-1 border-t border-border font-semibold">
                  Total: {formatCost(costInfo.totalCostUsd)}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
          {coverageReport && (
            <Tooltip>
              <TooltipTrigger
                className={
                  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-[10px] font-mono transition-colors hover:bg-accent cursor-default " +
                  (coverageReport.coverage >= 1
                    ? "border-green-600/40 text-green-700 dark:text-green-400"
                    : coverageReport.coverage > 0
                      ? "border-amber-600/40 text-amber-700 dark:text-amber-400"
                      : "border-red-600/40 text-red-700 dark:text-red-400")
                }
              >
                {coverageReport.coverage >= 1
                  ? `\u2713 ${coverageReport.matched.length}/${coverageReport.matched.length} coverage`
                  : `\u26a0 ${coverageReport.matched.length}/${coverageReport.matched.length + coverageReport.missing.length} coverage`}
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs space-y-1 p-3 max-w-sm">
                <p className="font-semibold">Resource coverage</p>
                <p className="text-muted-foreground">
                  {(coverageReport.coverage * 100).toFixed(0)}% of source resources matched to generated Terraform blocks.
                </p>
                {coverageReport.missing.length > 0 && (
                  <div className="pt-1 border-t border-border">
                    <p className="font-semibold text-amber-700 dark:text-amber-400">
                      Missing ({coverageReport.missing.length}):
                    </p>
                    <ul className="mt-0.5 space-y-0.5">
                      {coverageReport.missing.slice(0, 8).map((m) => (
                        <li key={`${m.logicalName}-${m.sourceType}`} className="font-mono text-[10px]">
                          {m.logicalName} <span className="text-muted-foreground">({m.sourceType})</span>
                        </li>
                      ))}
                      {coverageReport.missing.length > 8 && (
                        <li className="text-muted-foreground">
                          \u2026 and {coverageReport.missing.length - 8} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}
                {coverageReport.unmappedSourceTypes.length > 0 && (
                  <p className="pt-1 border-t border-border text-muted-foreground">
                    {coverageReport.unmappedSourceTypes.length} source type(s) had no built-in mapping — excluded from the score.
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasOutput && fileNames.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors">
                {selectedFile === "all" ? "All files" : selectedFile}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSelectedFile("all")}>
                  All files
                </DropdownMenuItem>
                {fileNames.map((name) => (
                  <DropdownMenuItem
                    key={name}
                    onClick={() => setSelectedFile(name)}
                  >
                    {name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {hasOutput && (
            <Button variant="outline" size="sm" onClick={handleDownload}>
              {isMultiFile || Object.keys(terraformFiles).some((f) => f.includes("/")) ? (
                <Archive className="h-3.5 w-3.5" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {isMultiFile ? "Download Zip" : "Download"}
            </Button>
          )}
          {isConverting ? (
            <Button variant="outline" size="sm" onClick={() => setShowCancelDialog(true)} className="border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Stop Converting
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-cta text-cta-foreground shadow-sm hover:bg-cta/90 h-8 px-3 text-xs [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
                onClick={handleConvert}
                disabled={!bicepContent}
              >
                <Play className="h-3.5 w-3.5" />
                Convert
              </TooltipTrigger>
              <TooltipContent side="bottom" className="flex items-center gap-2">
                <span>
                  {sourceFormat === "cloudformation"
                    ? "Convert CloudFormation to Terraform"
                    : "Convert Bicep to Terraform"}
                </span>
                <Kbd>Cmd+Enter</Kbd>
              </TooltipContent>
            </Tooltip>
          )}
          {canDeploy && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeploy}
              className="border-cta/30 text-cta hover:bg-cta/10"
            >
              <Rocket className="h-3.5 w-3.5" />
              Deploy &amp; Test
            </Button>
          )}
          {isDeploying && (
            <Button variant="outline" size="sm" onClick={cancelDeployment} className="border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400">
              <Square className="h-3.5 w-3.5" />
              Cancel Deploy
            </Button>
          )}
          {(status === "done" || status === "error") && !isDeploying && (
            <Button variant="outline" size="sm" onClick={fullReset}>
              <RotateCcw className="h-3.5 w-3.5" />
              New Conversion
            </Button>
          )}
        </div>
      </div>

      {expertMode && (
        <div className="border-b border-violet-600/30 bg-violet-600/5 px-4 py-1.5 text-[11px] text-violet-700 dark:text-violet-300 shrink-0">
          <span aria-hidden className="mr-1.5">\u26a1</span>
          Expert Mode is on — this run will use{" "}
          <span className="font-mono">Claude Opus 4.7</span> (~5\u00d7 the cost of Standard).
        </div>
      )}

      {/* Main editor area */}
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex flex-1 min-h-0">
            {/* Bicep editor (with optional file tree sidebar) */}
            <div className="flex flex-1 min-w-0 border-r border-border">
              {/* File tree sidebar for multi-file mode */}
              {isMultiFile && bicepFileCount > 0 && (
                <div className="flex w-[200px] shrink-0 flex-col border-r border-border">
                  <div className="flex h-8 items-center gap-1.5 border-b border-border bg-muted/30 px-3">
                    <FolderOpen className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">Files</span>
                  </div>
                  <div className="flex-1 min-h-0">
                    <FileTree
                      files={bicepFiles}
                      entryPoint={entryPoint}
                      selectedFile={selectedBicepFile || entryPoint}
                      onSelectFile={(path) => {
                        setSelectedBicepFile(path);
                        // Update editor content to show selected file (read-only in multi-file)
                        const content = bicepFiles[path];
                        if (content !== undefined) {
                          setBicepContent(content, path);
                        }
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Editor area */}
              <div className="flex flex-1 flex-col min-w-0">
                <div className="flex h-8 items-center border-b border-border bg-muted/30 px-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    {isMultiFile
                      ? `Bicep — ${bicepFilename || entryPoint}`
                      : sourceFormat === "cloudformation"
                      ? "CloudFormation (Input)"
                      : "Bicep (Input)"}
                  </span>
                </div>
                <div className="flex-1 min-h-0">
                  {bicepContent ? (
                    <CodeEditor
                      value={bicepContent}
                      onChange={isMultiFile ? undefined : setBicepContent}
                      language={
                        sourceFormat === "cloudformation"
                          ? (bicepContent.trim().startsWith("{") ? "json" : "yaml")
                          : "bicep"
                      }
                      readOnly={isConverting || isMultiFile}
                    />
                  ) : (
                    <FileUpload />
                  )}
                </div>
              </div>
            </div>

            {/* Terraform editor */}
            <div className="flex flex-1 flex-col min-w-0">
              <div className="flex h-8 items-center border-b border-border bg-muted/30 px-3">
                <span className="text-xs font-medium text-muted-foreground">
                  Terraform (Output)
                </span>
              </div>
              <div className="flex-1 min-h-0">
                <CodeEditor
                  value={terraformOutput}
                  language="hcl"
                  readOnly
                />
              </div>
            </div>
          </div>

          {/* Bottom panel with Tabs */}
          <Tabs
            value={bottomTab}
            onValueChange={(v) => setBottomTab(v as BottomTab)}
            className="flex h-64 flex-col border-t border-border shrink-0"
          >
            <TabsList className="h-9 w-full justify-start rounded-none border-b border-border bg-muted/30 p-0">
              {(
                [
                  { value: "chat", label: "Chat" },
                  { value: "validation", label: "Validation" },
                  { value: "diff", label: "Diff" },
                  { value: "graph", label: "Graph" },
                  { value: "security", label: "Security" },
                  { value: "policies", label: "Policies" },
                  { value: "cost", label: "Cost" },
                  { value: "deploy-chat", label: "Deployment" },
                  { value: "tests", label: "Tests" },
                ] as const
              ).map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="h-full rounded-none border-b-2 border-transparent px-4 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="chat" className="flex-1 min-h-0 mt-0 overflow-hidden">
              <ChatPanel />
            </TabsContent>
            <TabsContent value="validation" className="flex-1 min-h-0 mt-0 overflow-hidden">
              <ValidationPanel />
            </TabsContent>
            <TabsContent value="diff" className="flex-1 min-h-0 mt-0 overflow-hidden">
              <DiffViewer original={bicepContent} modified={terraformOutput} />
            </TabsContent>
            <TabsContent value="graph" className="flex-1 min-h-0 mt-0 overflow-hidden">
              <ResourceGraph />
            </TabsContent>
            <TabsContent value="security" className="flex-1 min-h-0 mt-0 overflow-hidden">
              <SecurityPanel />
            </TabsContent>
            <TabsContent value="policies" className="flex-1 min-h-0 mt-0 overflow-hidden">
              <PolicyPanel />
            </TabsContent>
            <TabsContent value="cost" className="flex-1 min-h-0 mt-0 overflow-hidden">
              <CostEstimatePanel />
            </TabsContent>
            <TabsContent value="deploy-chat" className="flex-1 min-h-0 mt-0 overflow-hidden">
              <DeployChatPanel />
            </TabsContent>
            <TabsContent value="tests" className="flex-1 min-h-0 mt-0 overflow-hidden">
              <TestResultsPanel />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Progress tracker overlays */}
      {isConverting && <ProgressTracker />}
      {isDeploying && <DeployProgressTracker />}

      {/* Destroy dialog */}
      <DestroyDialog
        open={deploymentStatus === "awaiting_destroy"}
        onDestroy={destroyResources}
        onKeep={keepResources}
      />

      {/* Cancel confirmation dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Conversion?</DialogTitle>
            <DialogDescription>
              The conversion is still in progress. Are you sure you want to cancel?
              Any partial output will be preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelDialog(false)}>
              Continue
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowCancelDialog(false);
                cancelConversion();
              }}
            >
              Cancel Conversion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* API Key dialog */}
      <Dialog open={showApiKeyDialog} onOpenChange={setShowApiKeyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              Anthropic API Key Required
            </DialogTitle>
            <DialogDescription>
              Enter your API key to run the conversion. It will only be stored
              for this browser session and is never saved to disk.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleApiKeySubmit();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label
                htmlFor="api-key-input"
                className="text-sm font-medium leading-none"
              >
                API Key
              </label>
              <input
                ref={apiKeyInputRef}
                id="api-key-input"
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="sk-ant-..."
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="remember-session"
                checked={rememberForSession}
                onChange={(e) => setRememberForSession(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <label
                htmlFor="remember-session"
                className="text-sm text-muted-foreground"
              >
                Remember for this session
              </label>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowApiKeyDialog(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!apiKeyInput.trim()}
              >
                <Play className="h-3.5 w-3.5" />
                Start Conversion
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Azure config dialog */}
      <AzureConfigDialog
        open={showAzureConfigDialog}
        onOpenChange={setShowAzureConfigDialog}
        onSubmit={handleAzureConfigSubmit}
      />
    </div>
  );
}

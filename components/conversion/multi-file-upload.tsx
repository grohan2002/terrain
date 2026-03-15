"use client";

// Augment React's input HTML attributes for the non-standard webkitdirectory prop
declare module "react" {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
  }
}

import { useCallback, useRef, useState, useMemo } from "react";
import { FolderUp, Upload, File, Star, AlertTriangle } from "lucide-react";
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
import { detectEntryPoint, parseModuleReferences } from "@/lib/bicep-modules";
import type { BicepFiles } from "@/lib/types";

const MAX_TOTAL_SIZE = 10 * 1024 * 1024; // 10MB aggregate
const MAX_FILE_COUNT = 50; // Max files per project

export function MultiFileUpload() {
  const setBicepFiles = useConversionStore((s) => s.setBicepFiles);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<BicepFiles | null>(null);
  const [selectedEntryPoint, setSelectedEntryPoint] = useState<string>("");
  const [registryModules, setRegistryModules] = useState<string[]>([]);

  const pendingPaths = useMemo(
    () => (pendingFiles ? Object.keys(pendingFiles).sort() : []),
    [pendingFiles],
  );

  const rootBicepFiles = useMemo(
    () => pendingPaths.filter((p) => !p.includes("/") && p.endsWith(".bicep") && !p.endsWith(".bicepparam")),
    [pendingPaths],
  );

  const processFileList = useCallback(
    (fileList: FileList) => {
      const files: BicepFiles = {};
      let totalSize = 0;

      for (const file of Array.from(fileList)) {
        const name = file.name;
        if (!name.endsWith(".bicep") && !name.endsWith(".bicepparam")) continue;

        totalSize += file.size;
        if (totalSize > MAX_TOTAL_SIZE) {
          toast.error("Project too large", {
            description: "Total size exceeds 10MB limit",
          });
          return;
        }

        // Preserve relative path from directory upload or use filename
        const relativePath =
          file.webkitRelativePath
            ? file.webkitRelativePath.split("/").slice(1).join("/")
            : name;

        // Read file synchronously via FileReaderSync not available in main thread,
        // so we collect promises
        files[relativePath] = ""; // placeholder
      }

      // Read all files
      const readPromises = Array.from(fileList)
        .filter(
          (f) => f.name.endsWith(".bicep") || f.name.endsWith(".bicepparam"),
        )
        .map(async (file) => {
          const relativePath = file.webkitRelativePath
            ? file.webkitRelativePath.split("/").slice(1).join("/")
            : file.name;
          const content = await file.text();
          return [relativePath, content] as [string, string];
        });

      Promise.all(readPromises).then((entries) => {
        const result: BicepFiles = {};
        for (const [path, content] of entries) {
          result[path] = content;
        }

        if (Object.keys(result).length === 0) {
          toast.error("No Bicep files found", {
            description: "The selection contains no .bicep or .bicepparam files",
          });
          return;
        }

        if (Object.keys(result).length > MAX_FILE_COUNT) {
          toast.error("Too many files", {
            description: `Project contains ${Object.keys(result).length} files (max ${MAX_FILE_COUNT}). Try converting modules individually.`,
          });
          return;
        }

        const ep = detectEntryPoint(result);

        // Detect registry module references for user warning
        const regMods: string[] = [];
        for (const [filePath, content] of Object.entries(result)) {
          const refs = parseModuleReferences(filePath, content);
          for (const ref of refs) {
            if (ref.resolvedPath === null) {
              regMods.push(`${ref.name} (${ref.source})`);
            }
          }
        }
        setRegistryModules(regMods);

        setPendingFiles(result);
        setSelectedEntryPoint(ep);
      });
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (e.dataTransfer.files.length > 0) {
        processFileList(e.dataTransfer.files);
      }
    },
    [processFileList],
  );

  const confirmUpload = useCallback(() => {
    if (!pendingFiles) return;
    setBicepFiles(pendingFiles, selectedEntryPoint);
    toast.success("Project loaded", {
      description: `${Object.keys(pendingFiles).length} file(s), entry: ${selectedEntryPoint}`,
    });
    setPendingFiles(null);
  }, [pendingFiles, selectedEntryPoint, setBicepFiles]);

  // Preview state — show file list before confirming
  if (pendingFiles) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <div className="flex items-center gap-2">
          <FolderUp className="h-6 w-6 text-muted-foreground" />
          <span className="text-sm font-medium">{pendingPaths.length} file(s) detected</span>
        </div>

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

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Entry point:</span>
          {rootBicepFiles.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent transition-colors">
                {selectedEntryPoint}
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {rootBicepFiles.map((f) => (
                  <DropdownMenuItem key={f} onClick={() => setSelectedEntryPoint(f)}>
                    {f}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Badge variant="secondary" className="text-xs">{selectedEntryPoint}</Badge>
          )}
        </div>

        {registryModules.length > 0 && (
          <div className="w-full max-w-sm rounded-md border border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950/30 p-2.5 text-xs space-y-1">
            <div className="flex items-center gap-1.5 text-yellow-700 dark:text-yellow-400 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {registryModules.length} registry module(s) detected
            </div>
            <p className="text-yellow-600 dark:text-yellow-500 pl-5">
              These reference external registries (br:, ts:) and cannot be resolved locally.
              The converter will use its knowledge of AVM/registry modules to generate equivalent Terraform.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPendingFiles(null)}>
            Cancel
          </Button>
          <Button size="sm" onClick={confirmUpload}>
            <Upload className="h-3.5 w-3.5" />
            Load Project
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full flex-col items-center justify-center gap-4 p-6 rounded-lg border-2 border-dashed transition-colors ${
        dragActive ? "border-primary bg-primary/5" : "border-muted"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      <FolderUp className="h-10 w-10 text-muted-foreground" />
      <div className="text-center space-y-1">
        <p className="text-sm font-medium">Drop a Bicep project folder here</p>
        <p className="text-xs text-muted-foreground">or browse for files</p>
      </div>

      <div className="flex gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={() => dirInputRef.current?.click()}
        >
          <FolderUp className="h-3.5 w-3.5" />
          Browse Folder
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          Select Files
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Accepts .bicep and .bicepparam files (max 10MB total)
      </p>

      {/* Hidden inputs */}
      <input
        ref={dirInputRef}
        type="file"
        webkitdirectory=""
        className="hidden"
        onChange={(e) => e.target.files && processFileList(e.target.files)}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".bicep,.bicepparam"
        className="hidden"
        onChange={(e) => e.target.files && processFileList(e.target.files)}
      />
    </div>
  );
}

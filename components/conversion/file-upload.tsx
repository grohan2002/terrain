"use client";

import { useCallback, useState } from "react";
import { Upload, FileCode, FolderUp, Github } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConversionStore } from "@/lib/store";
import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { MultiFileUpload } from "./multi-file-upload";
import { GitHubImport } from "./github-import";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

type UploadMode = "single" | "project" | "github";

const CF_EXTENSIONS = [".yaml", ".yml", ".json", ".template"];

export function FileUpload() {
  const [dragOver, setDragOver] = useState(false);
  const [mode, setMode] = useState<UploadMode>("single");
  const setBicepContent = useConversionStore((s) => s.setBicepContent);
  const sourceFormat = useConversionStore((s) => s.sourceFormat);

  const isCf = sourceFormat === "cloudformation";
  const acceptedExts = isCf ? CF_EXTENSIONS : [".bicep"];
  const acceptAttr = acceptedExts.join(",");
  const formatLabel = isCf ? "CloudFormation template" : ".bicep file";
  const pasteHint = isCf
    ? "Or paste YAML/JSON CloudFormation directly in the editor"
    : "Or paste Bicep code directly in the editor";

  const handleFile = useCallback(
    (file: File) => {
      const name = file.name.toLowerCase();
      const allowed = acceptedExts.some((ext) => name.endsWith(ext));
      if (!allowed) {
        toast.error("Invalid file type", {
          description: `Please upload a ${formatLabel}`,
        });
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error("File too large", {
          description: "Maximum file size is 5MB",
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setBicepContent(content, file.name);
        toast.success("File loaded", { description: file.name });
      };
      reader.onerror = () => {
        toast.error("Failed to read file", {
          description: "An error occurred while reading the file",
        });
      };
      reader.readAsText(file);
    },
    [setBicepContent, acceptedExts, formatLabel]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Mode toggle */}
      <div className="flex items-center justify-center gap-1 border-b border-border bg-muted/30 px-3 py-1.5">
        <Button
          variant={mode === "single" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => setMode("single")}
        >
          <FileCode className="h-3 w-3" />
          Single File
        </Button>
        <Button
          variant={mode === "project" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => setMode("project")}
          disabled={isCf}
          title={isCf ? "Multi-file projects are Bicep-only for now" : undefined}
        >
          <FolderUp className="h-3 w-3" />
          Project
        </Button>
        <Button
          variant={mode === "github" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => setMode("github")}
        >
          <Github className="h-3 w-3" />
          GitHub
        </Button>
      </div>

      {/* Upload area */}
      <div className="flex-1 min-h-0">
        {mode === "project" ? (
          <MultiFileUpload />
        ) : mode === "github" ? (
          <GitHubImport />
        ) : (
          <div
            role="region"
            aria-label="File upload"
            className={cn(
              "flex h-full flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-8 transition-colors",
              dragOver
                ? "border-cta bg-cta/5"
                : "border-border hover:border-muted-foreground/50"
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="rounded-full bg-muted p-4">
              {dragOver ? (
                <FileCode className="h-8 w-8 text-cta" />
              ) : (
                <Upload className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="text-center">
              <p className="font-medium">Drop a {formatLabel} here</p>
              <p className="mt-1 text-sm text-muted-foreground">
                or click to browse
                {isCf ? " (.yaml, .yml, .json, .template)" : ""}
              </p>
            </div>
            <label className={cn(buttonVariants(), "cursor-pointer")}>
              Browse Files
              <input
                type="file"
                accept={acceptAttr}
                className="hidden"
                onChange={handleChange}
              />
            </label>
            <p className="text-xs text-muted-foreground">{pasteHint}</p>
          </div>
        )}
      </div>
    </div>
  );
}

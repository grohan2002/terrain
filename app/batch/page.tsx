"use client";

import { useState, useCallback } from "react";
import {
  Layers,
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  FileCode,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

interface BatchFile {
  name: string;
  content: string;
  status: "pending" | "converting" | "done" | "error";
  error?: string;
}

export default function BatchPage() {
  const [files, setFiles] = useState<BatchFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files ?? []);
      const bicepFiles = selectedFiles.filter((f) => f.name.endsWith(".bicep"));

      if (bicepFiles.length === 0) {
        toast.error("No .bicep files found");
        return;
      }

      Promise.all(
        bicepFiles.map(
          (file) =>
            new Promise<BatchFile>((resolve) => {
              const reader = new FileReader();
              reader.onload = (ev) => {
                resolve({
                  name: file.name,
                  content: ev.target?.result as string,
                  status: "pending",
                });
              };
              reader.readAsText(file);
            })
        )
      ).then((batchFiles) => {
        setFiles((prev) => [...prev, ...batchFiles]);
        toast.success(`${batchFiles.length} file(s) added`);
      });
    },
    []
  );

  const handleBatchConvert = useCallback(async () => {
    setShowConfirm(false);
    setIsProcessing(true);

    for (let i = 0; i < files.length; i++) {
      if (files[i].status !== "pending") continue;

      setFiles((prev) =>
        prev.map((f, idx) =>
          idx === i ? { ...f, status: "converting" } : f
        )
      );

      try {
        const response = await fetch("/api/convert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bicepContent: files[i].content }),
        });

        if (response.ok) {
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, status: "done" } : f
            )
          );
        } else {
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i
                ? { ...f, status: "error", error: `HTTP ${response.status}` }
                : f
            )
          );
        }
      } catch (err) {
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? { ...f, status: "error", error: String(err) }
              : f
          )
        );
      }
    }

    setIsProcessing(false);
    toast.success("Batch conversion complete");
  }, [files]);

  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "done").length;
  const errorCount = files.filter((f) => f.status === "error").length;

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-cta">Batch Processing</p>
        <h1 className="text-2xl font-bold tracking-tight">Batch Convert</h1>
        <p className="mt-1 text-muted-foreground">
          Convert multiple Bicep files to Terraform at once
        </p>
      </div>

      {/* Upload area */}
      <div className="flex items-center gap-4">
        <label className={cn(buttonVariants(), "cursor-pointer")}>
          <Upload className="h-4 w-4" />
          Add Files
          <input
            type="file"
            accept=".bicep"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </label>

        {files.length > 0 && (
          <Button
            variant="outline"
            onClick={() => setShowConfirm(true)}
            disabled={isProcessing || pendingCount === 0}
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Layers className="h-4 w-4" />
            )}
            Convert All ({pendingCount} pending)
          </Button>
        )}
      </div>

      {/* Summary */}
      {files.length > 0 && (
        <div className="flex gap-3">
          <Badge variant="secondary">Total: {files.length}</Badge>
          {doneCount > 0 && (
            <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-green-500/20">
              {doneCount} done
            </Badge>
          )}
          {errorCount > 0 && (
            <Badge variant="destructive">{errorCount} failed</Badge>
          )}
        </div>
      )}

      {/* File list */}
      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border py-16">
          <div className="rounded-full bg-muted p-4">
            <Layers className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-medium">No files added</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Select .bicep files to begin batch conversion
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">File</TableHead>
                <TableHead className="px-4">Size</TableHead>
                <TableHead className="px-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file, i) => (
                <TableRow key={i}>
                  <TableCell className="px-4">
                    <div className="flex items-center gap-2">
                      <FileCode className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{file.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-4 text-muted-foreground">
                    {(file.content.length / 1024).toFixed(1)} KB
                  </TableCell>
                  <TableCell className="px-4">
                    {file.status === "pending" && (
                      <Badge variant="outline">Pending</Badge>
                    )}
                    {file.status === "converting" && (
                      <Badge variant="secondary" className="bg-blue-500/10 text-blue-500 border-blue-500/20">
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        Converting
                      </Badge>
                    )}
                    {file.status === "done" && (
                      <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-green-500/20">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Done
                      </Badge>
                    )}
                    {file.status === "error" && (
                      <Badge variant="destructive" title={file.error}>
                        <XCircle className="h-3 w-3 mr-1" />
                        Error
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start Batch Conversion</DialogTitle>
            <DialogDescription>
              This will convert {pendingCount} pending file(s) to Terraform.
              This may take several minutes depending on file complexity.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={handleBatchConvert}>
              Convert {pendingCount} File(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

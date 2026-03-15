"use client";

import { useRouter } from "next/navigation";
import { History, FileCode, FolderOpen } from "lucide-react";
import { useConversionStore } from "@/lib/store";
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
  const router = useRouter();

  const handleLoad = (entry: (typeof history)[0]) => {
    // Restore multi-file context if available
    if (entry.isMultiFile && entry.bicepFiles && entry.entryPoint) {
      setBicepFiles(entry.bicepFiles, entry.entryPoint);
    } else {
      setBicepContent(entry.bicepContent, entry.bicepFile);
    }
    setTerraformFiles(entry.terraformFiles);
    toast.success("Loaded conversion", {
      description: entry.isMultiFile
        ? `Project (${entry.bicepFileCount ?? Object.keys(entry.bicepFiles ?? {}).length} files)`
        : entry.bicepFile,
    });
    router.push("/convert");
  };

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Conversion History
        </h1>
        <p className="mt-1 text-muted-foreground">
          View past Bicep to Terraform conversions
        </p>
      </div>

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
                <TableHead className="px-4">Validation</TableHead>
                <TableHead className="px-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((entry) => (
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
                    </div>
                  </TableCell>
                  <TableCell className="px-4 text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="px-4 text-muted-foreground">
                    {entry.resourcesConverted}
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleLoad(entry)}
                    >
                      Load
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

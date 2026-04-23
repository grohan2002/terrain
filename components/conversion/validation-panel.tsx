"use client";

import { useCallback } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Copy } from "lucide-react";
import { useConversionStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/components/ui/sonner";

export function ValidationPanel() {
  const validationResult = useConversionStore((s) => s.validationResult);
  const status = useConversionStore((s) => s.status);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- React Compiler can't verify this useCallback's memoization but it's still correct
  const handleCopy = useCallback(() => {
    if (!validationResult?.output) return;
    navigator.clipboard.writeText(validationResult.output).then(() => {
      toast.success("Copied to clipboard");
    });
  }, [validationResult?.output]);

  if (!validationResult && status === "idle") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Run a conversion to see validation results
      </div>
    );
  }

  if (!validationResult && status === "converting") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Waiting for validation...
      </div>
    );
  }

  if (!validationResult) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Status header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          {validationResult.passed ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-green-500/20">
                Passed
              </Badge>
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-destructive" />
              <Badge variant="destructive">Failed</Badge>
            </>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={handleCopy}>
          <Copy className="h-3.5 w-3.5" />
          Copy
        </Button>
      </div>

      {/* Output */}
      <ScrollArea className="flex-1 p-4">
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/80">
          {validationResult.output}
        </pre>

        {validationResult.errors && validationResult.errors.length > 0 && (
          <div className="mt-4 space-y-2">
            <h4 className="text-sm font-medium">Errors</h4>
            {validationResult.errors.map((err, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2"
              >
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div>
                  {err.line && (
                    <span className="text-xs text-muted-foreground">
                      Line {err.line}:{" "}
                    </span>
                  )}
                  <span className="text-xs">{err.message}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

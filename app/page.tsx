"use client";

import Link from "next/link";
import {
  ArrowRight,
  FileCode,
  History,
  Layers,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useConversionStore } from "@/lib/store";

export default function DashboardPage() {
  const history = useConversionStore((s) => s.history);
  const recentHistory = history.slice(0, 5);

  return (
    <div className="flex flex-col gap-8 p-8">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-cta">Dashboard</p>
        <h1 className="text-2xl font-bold tracking-tight">
          Bicep to Terraform Converter
        </h1>
        <p className="mt-1 text-muted-foreground">
          Enterprise-grade Azure Bicep to OpenTofu/Terraform modernization
        </p>
      </div>

      {/* Quick actions */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/convert" className="group">
          <Card className="h-full border-l-4 border-l-cta transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="rounded-md bg-cta/10 p-2">
                  <FileCode className="h-5 w-5 text-cta" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-cta" />
              </div>
              <CardTitle className="text-base">Convert File</CardTitle>
              <CardDescription>
                Upload a .bicep file or paste code to convert
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/batch" className="group">
          <Card className="h-full border-l-4 border-l-cta transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="rounded-md bg-cta/10 p-2">
                  <Layers className="h-5 w-5 text-cta" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-cta" />
              </div>
              <CardTitle className="text-base">Batch Convert</CardTitle>
              <CardDescription>
                Process multiple .bicep files at once
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/mappings" className="group">
          <Card className="h-full border-l-4 border-l-cta transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="rounded-md bg-cta/10 p-2">
                  <Zap className="h-5 w-5 text-cta" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-cta" />
              </div>
              <CardTitle className="text-base">Resource Mappings</CardTitle>
              <CardDescription>
                Browse all Bicep to Terraform type mappings
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {/* Features */}
      <Card>
        <CardHeader>
          <CardTitle>Features</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              "AI-powered conversion using Claude",
              "110+ resource type mappings",
              "Property name & SKU decomposition",
              "OpenTofu/Terraform validation",
              "Side-by-side diff viewer",
              "Resource dependency graph",
              "Conversion history",
              "Batch processing",
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-2 text-sm">
                <div className="h-1.5 w-1.5 rounded-full bg-cta" />
                {feature}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent history */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Recent Conversions</CardTitle>
          <Link
            href="/history"
            className="flex items-center gap-1 text-sm text-cta hover:underline"
          >
            <History className="h-4 w-4" />
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {recentHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No conversions yet. Start by converting a Bicep file.
            </p>
          ) : (
            <div className="space-y-3">
              {recentHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <FileCode className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{entry.bicepFile}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleDateString()} &middot; {entry.resourcesConverted} file(s)
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={entry.validationPassed ? "secondary" : "destructive"}
                    className={entry.validationPassed ? "bg-green-500/10 text-green-500 border-green-500/20" : ""}
                  >
                    {entry.validationPassed ? "Passed" : "Failed"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

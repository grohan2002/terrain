"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { RESOURCE_TYPE_MAP } from "@/lib/mappings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export default function MappingsPage() {
  const [filter, setFilter] = useState("");

  const entries = useMemo(() => {
    const all = Object.entries(RESOURCE_TYPE_MAP).map(
      ([bicepType, tfType]) => ({
        bicepType,
        tfType: tfType ?? "(merged into parent)",
        category: bicepType.split("/")[0].replace("Microsoft.", ""),
      })
    );

    if (!filter) return all;

    const lowerFilter = filter.toLowerCase();
    return all.filter(
      (e) =>
        e.bicepType.toLowerCase().includes(lowerFilter) ||
        e.tfType.toLowerCase().includes(lowerFilter) ||
        e.category.toLowerCase().includes(lowerFilter)
    );
  }, [filter]);

  const categories = useMemo(() => {
    const cats = new Set(
      Object.entries(RESOURCE_TYPE_MAP).map(
        ([bicepType]) => bicepType.split("/")[0].replace("Microsoft.", "")
      )
    );
    return Array.from(cats).sort();
  }, []);

  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-cta">Reference</p>
        <h1 className="text-2xl font-bold tracking-tight">
          Resource Mappings
        </h1>
        <p className="mt-1 text-muted-foreground">
          Browse all {Object.keys(RESOURCE_TYPE_MAP).length} Bicep to Terraform
          resource type mappings
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Filter by resource type..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded-md border border-border bg-background pl-10 pr-10 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        {filter && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
            onClick={() => setFilter("")}
            aria-label="Clear filter"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Category tags */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => {
          const isActive = filter.toLowerCase() === cat.toLowerCase();
          return (
            <Badge
              key={cat}
              variant={isActive ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setFilter(isActive ? "" : cat)}
            >
              {cat}
              <span className="ml-1.5 opacity-60">
                ({Object.entries(RESOURCE_TYPE_MAP).filter(
                  ([k]) => k.split("/")[0].replace("Microsoft.", "") === cat
                ).length})
              </span>
            </Badge>
          );
        })}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Category</TableHead>
              <TableHead className="px-4">Bicep Type</TableHead>
              <TableHead className="px-4">Terraform Type</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.bicepType}>
                <TableCell className="px-4">
                  <Badge variant="secondary">{entry.category}</Badge>
                </TableCell>
                <TableCell className="px-4 font-mono text-xs">
                  {entry.bicepType}
                </TableCell>
                <TableCell className="px-4 font-mono text-xs">
                  {entry.tfType}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {entries.length} of {Object.keys(RESOURCE_TYPE_MAP).length}{" "}
        mappings
      </p>
    </div>
  );
}

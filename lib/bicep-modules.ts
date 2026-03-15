// ---------------------------------------------------------------------------
// Bicep multi-file module resolution — parsing, dependency graph, context.
// ---------------------------------------------------------------------------

import type {
  BicepFiles,
  BicepModuleRef,
  BicepDependencyGraph,
  InputContextSummary,
} from "./types";

// ---------------------------------------------------------------------------
// Module reference parsing
// ---------------------------------------------------------------------------

/**
 * Parse all `module <name> '<path>'` declarations in a single Bicep file.
 * Returns an array of BicepModuleRef with resolved paths.
 */
export function parseModuleReferences(
  filePath: string,
  content: string,
): BicepModuleRef[] {
  const regex = /module\s+(\w+)\s+'([^']+)'/g;
  const refs: BicepModuleRef[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    const [, name, source] = match;

    // Registry module references (br:..., br/...) — cannot resolve locally
    if (source.startsWith("br:") || source.startsWith("br/")) {
      refs.push({ name, source, declaredIn: filePath, resolvedPath: null });
      continue;
    }

    // Template spec references (ts:..., ts/...) — cannot resolve locally
    if (source.startsWith("ts:") || source.startsWith("ts/")) {
      refs.push({ name, source, declaredIn: filePath, resolvedPath: null });
      continue;
    }

    const dir = dirname(filePath);
    const resolvedPath = normalizePath(join(dir, source));
    refs.push({ name, source, declaredIn: filePath, resolvedPath });
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Entry point detection
// ---------------------------------------------------------------------------

/**
 * Detect which file is the project entry point.
 * Priority: main.bicep > sole root .bicep > file with most module refs > alphabetical.
 */
export function detectEntryPoint(files: BicepFiles): string {
  const paths = Object.keys(files);
  if (paths.length === 0) return "";

  // 1. Explicit main.bicep at root
  if (paths.includes("main.bicep")) return "main.bicep";

  // 2. Root-level .bicep files (not in subdirectories, not .bicepparam)
  const rootBicep = paths.filter(
    (p) => !p.includes("/") && p.endsWith(".bicep") && !p.endsWith(".bicepparam"),
  );
  if (rootBicep.length === 1) return rootBicep[0];

  // 3. File with most module references
  if (rootBicep.length > 1) {
    let best = rootBicep[0];
    let bestCount = 0;
    for (const p of rootBicep) {
      const refs = parseModuleReferences(p, files[p]);
      if (refs.length > bestCount) {
        bestCount = refs.length;
        best = p;
      }
    }
    if (bestCount > 0) return best;
  }

  // 4. Fallback: first root file alphabetically, or first file overall
  return rootBicep.sort()[0] ?? paths.sort()[0];
}

// ---------------------------------------------------------------------------
// Dependency graph
// ---------------------------------------------------------------------------

/**
 * Build a dependency graph from all files, with topological ordering (leaves first).
 * Uses Kahn's algorithm. Detects unresolved modules but does NOT throw on cycles
 * — cycles result in those files being appended at the end of processingOrder.
 */
export function buildDependencyGraph(files: BicepFiles): BicepDependencyGraph {
  const allFiles = Object.keys(files);
  const allModules: BicepModuleRef[] = [];
  const unresolved: BicepModuleRef[] = [];

  // Parse references from all files
  for (const filePath of allFiles) {
    const refs = parseModuleReferences(filePath, files[filePath]);
    for (const ref of refs) {
      if (ref.resolvedPath && ref.resolvedPath in files) {
        allModules.push(ref);
      } else {
        unresolved.push(ref);
      }
    }
  }

  // Build adjacency: edge from declaredIn → resolvedPath (dependency direction)
  const inDegree: Record<string, number> = {};
  const dependents: Record<string, string[]> = {};
  for (const f of allFiles) {
    inDegree[f] = 0;
    dependents[f] = [];
  }
  for (const mod of allModules) {
    const target = mod.resolvedPath!;
    inDegree[mod.declaredIn] = (inDegree[mod.declaredIn] ?? 0) + 1;
    (dependents[target] ??= []).push(mod.declaredIn);
  }

  // Kahn's algorithm — leaves first
  const queue: string[] = [];
  for (const f of allFiles) {
    if (inDegree[f] === 0) queue.push(f);
  }

  const processingOrder: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    processingOrder.push(node);
    for (const dep of dependents[node] ?? []) {
      inDegree[dep]--;
      if (inDegree[dep] === 0) queue.push(dep);
    }
  }

  // Any files not in order have cyclic dependencies — append them
  for (const f of allFiles) {
    if (!processingOrder.includes(f)) {
      processingOrder.push(f);
    }
  }

  return {
    files: allFiles,
    modules: allModules,
    processingOrder,
    unresolvedModules: unresolved,
  };
}

// ---------------------------------------------------------------------------
// Context summarization (for large codebases)
// ---------------------------------------------------------------------------

/** Estimate token count from character count (code averages ~3.5 chars/token). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** Summarize input context for budget decisions. */
export function summarizeContext(
  files: BicepFiles,
  entryPoint: string,
): InputContextSummary {
  const entries = Object.entries(files);
  const totalBytes = entries.reduce((sum, [, c]) => sum + c.length, 0);
  const totalLines = entries.reduce((sum, [, c]) => sum + c.split("\n").length, 0);
  const estimatedTokens = estimateTokens(
    entries.map(([, c]) => c).join("\n"),
  );

  return {
    totalFiles: entries.length,
    totalLines,
    totalBytes,
    entryPoint,
    exceedsTokenBudget: estimatedTokens > 80_000,
  };
}

/**
 * Summarize a Bicep file down to its "interface" — parameters, resources, outputs.
 * Used when the full codebase exceeds the token budget.
 */
export function summarizeBicepFile(filePath: string, content: string): string {
  const lines = content.split("\n");
  const params: string[] = [];
  const resources: string[] = [];
  const outputs: string[] = [];
  const modules: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("param ")) params.push(trimmed);
    if (trimmed.startsWith("resource ")) resources.push(trimmed.replace(/\s*=\s*\{?\s*$/, ""));
    if (trimmed.startsWith("output ")) outputs.push(trimmed.replace(/\s*=\s*.*$/, ""));
    if (trimmed.startsWith("module ")) modules.push(trimmed.replace(/\s*=\s*\{?\s*$/, ""));
  }

  const parts = [`// Summary of ${filePath} (${lines.length} lines)`];
  if (params.length) parts.push(`// Parameters: ${params.join("; ")}`);
  if (resources.length) parts.push(`// Resources: ${resources.join("; ")}`);
  if (modules.length) parts.push(`// Modules: ${modules.join("; ")}`);
  if (outputs.length) parts.push(`// Outputs: ${outputs.join("; ")}`);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// User message construction for multi-file conversion
// ---------------------------------------------------------------------------

/**
 * Build the user message for the multi-file conversion agent.
 * Includes all files in dependency order with the dependency graph.
 */
export function buildMultiFileUserMessage(
  files: BicepFiles,
  entryPoint: string,
  graph: BicepDependencyGraph,
  summary?: InputContextSummary,
): string {
  const parts: string[] = [];

  parts.push(
    "Convert the following multi-file Azure Bicep project to Terraform/OpenTofu HCL.",
  );
  parts.push(`Entry point: ${entryPoint}`);
  parts.push(`Total files: ${Object.keys(files).length}`);
  parts.push("");

  // Dependency graph
  if (graph.modules.length > 0) {
    parts.push("## Module dependency graph");
    for (const mod of graph.modules) {
      parts.push(
        `  ${mod.declaredIn} --module '${mod.name}'--> ${mod.resolvedPath}`,
      );
    }
    parts.push("");
  }

  if (graph.unresolvedModules.length > 0) {
    parts.push("## Unresolved module references (missing files)");
    for (const mod of graph.unresolvedModules) {
      parts.push(`  ${mod.declaredIn}: module '${mod.name}' -> '${mod.source}' (NOT FOUND)`);
    }
    parts.push("");
  }

  // Include files in processing order
  const useSummary = summary?.exceedsTokenBudget ?? false;

  parts.push("## Files (in dependency order, leaves first)");
  for (const filePath of graph.processingOrder) {
    const content = files[filePath];
    if (!content) continue;

    if (useSummary && filePath !== entryPoint) {
      // For large codebases, summarize non-entry files
      parts.push(`\n### File: ${filePath} (SUMMARIZED — use read_bicep_file_content for full content)`);
      parts.push(summarizeBicepFile(filePath, content));
    } else {
      parts.push(`\n### File: ${filePath}`);
      parts.push("```bicep");
      parts.push(content);
      parts.push("```");
    }
  }

  // Include any .bicepparam files
  const paramFiles = Object.keys(files).filter((p) => p.endsWith(".bicepparam"));
  if (paramFiles.length > 0) {
    parts.push("\n## Parameter files");
    for (const pf of paramFiles) {
      parts.push(`\n### ${pf}`);
      parts.push("```");
      parts.push(files[pf]);
      parts.push("```");
    }
  }

  parts.push("");
  parts.push("IMPORTANT: All files are provided inline above. Do NOT call read_bicep_file or list_bicep_files.");
  if (useSummary) {
    parts.push("Some files are summarized. Use read_bicep_file_content to get full content when needed.");
  }
  parts.push("Use parse_bicep for each file, then proceed with the conversion workflow.");
  parts.push("Generate Terraform modules that mirror the Bicep module structure:");
  parts.push("- Root: providers.tf, variables.tf, main.tf (with module calls), outputs.tf");
  parts.push("- Each Bicep module -> modules/<name>/ with main.tf, variables.tf, outputs.tf");

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Path utilities (no Node.js dependency for client-side compatibility)
// ---------------------------------------------------------------------------

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function join(base: string, rel: string): string {
  if (!base) return rel;
  return base + "/" + rel;
}

function normalizePath(p: string): string {
  const parts = p.split("/");
  const result: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      result.pop();
    } else {
      result.push(part);
    }
  }
  return result.join("/");
}

import { describe, it, expect } from "vitest";
import {
  parseModuleReferences,
  detectEntryPoint,
  buildDependencyGraph,
  summarizeBicepFile,
  summarizeContext,
  buildMultiFileUserMessage,
} from "@/lib/bicep-modules";
import type { BicepFiles } from "@/lib/types";

// ---------------------------------------------------------------------------
// parseModuleReferences
// ---------------------------------------------------------------------------

describe("parseModuleReferences", () => {
  it("parses a single module reference", () => {
    const content = `module storage './modules/storage.bicep' = {\n  name: 'storageDeploy'\n}`;
    const refs = parseModuleReferences("main.bicep", content);
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe("storage");
    expect(refs[0].source).toBe("./modules/storage.bicep");
    expect(refs[0].declaredIn).toBe("main.bicep");
    expect(refs[0].resolvedPath).toBe("modules/storage.bicep");
  });

  it("parses multiple module references", () => {
    const content = [
      "module storage './modules/storage.bicep' = { name: 'a' }",
      "module network './modules/network.bicep' = { name: 'b' }",
    ].join("\n");
    const refs = parseModuleReferences("main.bicep", content);
    expect(refs).toHaveLength(2);
    expect(refs[0].name).toBe("storage");
    expect(refs[1].name).toBe("network");
  });

  it("returns empty array for no module references", () => {
    const content = "param location string = 'eastus'\nresource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {}";
    expect(parseModuleReferences("main.bicep", content)).toHaveLength(0);
  });

  it("resolves nested paths correctly", () => {
    const content = "module sub '../shared/sub.bicep' = {}";
    const refs = parseModuleReferences("modules/main.bicep", content);
    expect(refs[0].resolvedPath).toBe("shared/sub.bicep");
  });

  it("resolves same-directory references", () => {
    const content = "module helper './helper.bicep' = {}";
    const refs = parseModuleReferences("modules/main.bicep", content);
    expect(refs[0].resolvedPath).toBe("modules/helper.bicep");
  });

  it("detects br: registry module references with null resolvedPath", () => {
    const content = "module appGw 'br:mcr.microsoft.com/bicep/avm/res/network/application-gateway:0.5.0' = {}";
    const refs = parseModuleReferences("main.bicep", content);
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe("appGw");
    expect(refs[0].source).toContain("br:mcr.microsoft.com");
    expect(refs[0].resolvedPath).toBeNull();
  });

  it("detects br/ public module alias references with null resolvedPath", () => {
    const content = "module storage 'br/public:avm/res/storage/storage-account:0.14.1' = {}";
    const refs = parseModuleReferences("main.bicep", content);
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe("storage");
    expect(refs[0].resolvedPath).toBeNull();
  });

  it("detects ts: template spec references with null resolvedPath", () => {
    const content = "module shared 'ts:12345/rg-shared/networkSpec:1.0' = {}";
    const refs = parseModuleReferences("main.bicep", content);
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe("shared");
    expect(refs[0].source).toContain("ts:");
    expect(refs[0].resolvedPath).toBeNull();
  });

  it("handles mixed local and registry references", () => {
    const content = [
      "module local './modules/storage.bicep' = {}",
      "module registry 'br:mcr.microsoft.com/bicep/avm/res/storage/storage-account:0.14.1' = {}",
      "module spec 'ts:sub123/rg/mySpec:2.0' = {}",
    ].join("\n");
    const refs = parseModuleReferences("main.bicep", content);
    expect(refs).toHaveLength(3);
    expect(refs[0].resolvedPath).toBe("modules/storage.bicep");
    expect(refs[1].resolvedPath).toBeNull();
    expect(refs[2].resolvedPath).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectEntryPoint
// ---------------------------------------------------------------------------

describe("detectEntryPoint", () => {
  it("returns main.bicep when present", () => {
    const files: BicepFiles = {
      "main.bicep": "param location string",
      "modules/storage.bicep": "resource sa ...",
    };
    expect(detectEntryPoint(files)).toBe("main.bicep");
  });

  it("returns sole root .bicep file", () => {
    const files: BicepFiles = {
      "infra.bicep": "param location string",
      "modules/storage.bicep": "resource sa ...",
    };
    expect(detectEntryPoint(files)).toBe("infra.bicep");
  });

  it("prefers file with most module references when multiple roots", () => {
    const files: BicepFiles = {
      "a.bicep": "param x string",
      "b.bicep": "module storage './modules/storage.bicep' = {}\nmodule network './modules/network.bicep' = {}",
      "modules/storage.bicep": "",
      "modules/network.bicep": "",
    };
    expect(detectEntryPoint(files)).toBe("b.bicep");
  });

  it("returns empty string for empty files map", () => {
    expect(detectEntryPoint({})).toBe("");
  });

  it("ignores .bicepparam files", () => {
    const files: BicepFiles = {
      "dev.bicepparam": "using './main.bicep'",
      "main.bicep": "param location string",
    };
    expect(detectEntryPoint(files)).toBe("main.bicep");
  });
});

// ---------------------------------------------------------------------------
// buildDependencyGraph
// ---------------------------------------------------------------------------

describe("buildDependencyGraph", () => {
  it("builds a linear chain (A → B → C)", () => {
    const files: BicepFiles = {
      "main.bicep": "module b './b.bicep' = {}",
      "b.bicep": "module c './c.bicep' = {}",
      "c.bicep": "resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {}",
    };
    const graph = buildDependencyGraph(files);
    expect(graph.files).toHaveLength(3);
    expect(graph.modules).toHaveLength(2);
    expect(graph.unresolvedModules).toHaveLength(0);
    // Processing order: leaves first → c, b, main
    expect(graph.processingOrder[0]).toBe("c.bicep");
    expect(graph.processingOrder[graph.processingOrder.length - 1]).toBe("main.bicep");
  });

  it("handles diamond dependency (A→B, A→C, B→D, C→D)", () => {
    const files: BicepFiles = {
      "a.bicep": "module b './b.bicep' = {}\nmodule c './c.bicep' = {}",
      "b.bicep": "module d './d.bicep' = {}",
      "c.bicep": "module d './d.bicep' = {}",
      "d.bicep": "resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {}",
    };
    const graph = buildDependencyGraph(files);
    expect(graph.processingOrder[0]).toBe("d.bicep");
    expect(graph.processingOrder[graph.processingOrder.length - 1]).toBe("a.bicep");
  });

  it("reports unresolved modules", () => {
    const files: BicepFiles = {
      "main.bicep": "module missing './missing.bicep' = {}",
    };
    const graph = buildDependencyGraph(files);
    expect(graph.unresolvedModules).toHaveLength(1);
    expect(graph.unresolvedModules[0].source).toBe("./missing.bicep");
  });

  it("handles files with no modules", () => {
    const files: BicepFiles = {
      "standalone.bicep": "param x string\nresource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {}",
    };
    const graph = buildDependencyGraph(files);
    expect(graph.processingOrder).toEqual(["standalone.bicep"]);
    expect(graph.modules).toHaveLength(0);
  });

  it("handles cycles gracefully", () => {
    const files: BicepFiles = {
      "a.bicep": "module b './b.bicep' = {}",
      "b.bicep": "module a './a.bicep' = {}",
    };
    const graph = buildDependencyGraph(files);
    // Both files should appear in processingOrder (cycles appended at end)
    expect(graph.processingOrder).toHaveLength(2);
    expect(graph.processingOrder).toContain("a.bicep");
    expect(graph.processingOrder).toContain("b.bicep");
  });

  it("places registry module references in unresolvedModules", () => {
    const files: BicepFiles = {
      "main.bicep": [
        "module storage './modules/storage.bicep' = {}",
        "module appGw 'br:mcr.microsoft.com/bicep/avm/res/network/application-gateway:0.5.0' = {}",
      ].join("\n"),
      "modules/storage.bicep": "resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {}",
    };
    const graph = buildDependencyGraph(files);
    // Local ref should be resolved
    expect(graph.modules).toHaveLength(1);
    expect(graph.modules[0].name).toBe("storage");
    // Registry ref should be unresolved
    expect(graph.unresolvedModules).toHaveLength(1);
    expect(graph.unresolvedModules[0].name).toBe("appGw");
    expect(graph.unresolvedModules[0].source).toContain("br:");
  });
});

// ---------------------------------------------------------------------------
// summarizeBicepFile
// ---------------------------------------------------------------------------

describe("summarizeBicepFile", () => {
  it("extracts params, resources, and outputs", () => {
    const content = [
      "param location string = 'eastus'",
      "param skuName string",
      "",
      "resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {",
      "  name: 'test'",
      "}",
      "",
      "output storageId string = storageAccount.id",
    ].join("\n");

    const summary = summarizeBicepFile("modules/storage.bicep", content);
    expect(summary).toContain("Summary of modules/storage.bicep");
    expect(summary).toContain("8 lines");
    expect(summary).toContain("param location");
    expect(summary).toContain("storageAccount");
    expect(summary).toContain("output storageId");
  });
});

// ---------------------------------------------------------------------------
// summarizeContext
// ---------------------------------------------------------------------------

describe("summarizeContext", () => {
  it("marks small projects as within budget", () => {
    const files: BicepFiles = {
      "main.bicep": "param x string\n".repeat(10),
    };
    const ctx = summarizeContext(files, "main.bicep");
    expect(ctx.totalFiles).toBe(1);
    expect(ctx.exceedsTokenBudget).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildMultiFileUserMessage
// ---------------------------------------------------------------------------

describe("buildMultiFileUserMessage", () => {
  it("includes all files and dependency graph", () => {
    const files: BicepFiles = {
      "main.bicep": "module storage './modules/storage.bicep' = {}",
      "modules/storage.bicep": "resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {}",
    };
    const graph = buildDependencyGraph(files);
    const msg = buildMultiFileUserMessage(files, "main.bicep", graph);

    expect(msg).toContain("multi-file Azure Bicep project");
    expect(msg).toContain("Entry point: main.bicep");
    expect(msg).toContain("Module dependency graph");
    expect(msg).toContain("modules/storage.bicep");
    expect(msg).toContain("Do NOT call read_bicep_file");
  });
});

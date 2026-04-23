import { describe, it, expect } from "vitest";
import {
  computeCoverage,
  computeCoverageFromContent,
} from "@/lib/coverage";

describe("computeCoverage", () => {
  it("returns 1.0 when every mapped source resource appears in the output", () => {
    const r = computeCoverage({
      sourceResources: [
        { sourceType: "Microsoft.Storage/storageAccounts", logicalName: "sa" },
        { sourceType: "Microsoft.Network/virtualNetworks", logicalName: "v" },
      ],
      generatedResources: [
        { tfType: "azurerm_storage_account", tfName: "sa", file: "main.tf" },
        { tfType: "azurerm_virtual_network", tfName: "v", file: "main.tf" },
      ],
      sourceFormat: "bicep",
    });
    expect(r.coverage).toBe(1);
    expect(r.missing).toEqual([]);
    expect(r.matched).toHaveLength(2);
    expect(r.expected).toHaveLength(2);
    expect(r.expected[0].expectedTfType).toBe("azurerm_storage_account");
  });

  it("flags missing resources and drops coverage", () => {
    const r = computeCoverage({
      sourceResources: [
        { sourceType: "Microsoft.Storage/storageAccounts", logicalName: "sa" },
        { sourceType: "Microsoft.Network/virtualNetworks", logicalName: "v" },
      ],
      generatedResources: [
        { tfType: "azurerm_storage_account", tfName: "sa", file: "main.tf" },
      ],
      sourceFormat: "bicep",
    });
    expect(r.coverage).toBe(0.5);
    expect(r.missing).toEqual([
      { sourceType: "Microsoft.Network/virtualNetworks", logicalName: "v" },
    ]);
  });

  it("records unmapped source types without dinging coverage", () => {
    const r = computeCoverage({
      sourceResources: [
        { sourceType: "Microsoft.Unknown/x", logicalName: "x" },
        { sourceType: "Microsoft.Storage/storageAccounts", logicalName: "sa" },
      ],
      generatedResources: [
        { tfType: "azurerm_storage_account", tfName: "sa", file: "main.tf" },
      ],
      sourceFormat: "bicep",
    });
    expect(r.coverage).toBe(1);
    expect(r.unmappedSourceTypes).toEqual(["Microsoft.Unknown/x"]);
    // Unmapped types still appear in `expected` (with expectedTfType=undefined)
    // so the UI can show them as "unknown".
    const x = r.expected.find((e) => e.logicalName === "x");
    expect(x?.expectedTfType).toBeUndefined();
  });

  it("works for CF sources", () => {
    const r = computeCoverage({
      sourceResources: [
        { sourceType: "AWS::S3::Bucket", logicalName: "b" },
        { sourceType: "AWS::EC2::VPC", logicalName: "v" },
      ],
      generatedResources: [
        { tfType: "aws_s3_bucket", tfName: "b", file: "main.tf" },
        { tfType: "aws_vpc", tfName: "v", file: "main.tf" },
      ],
      sourceFormat: "cloudformation",
    });
    expect(r.coverage).toBe(1);
  });
});

describe("computeCoverageFromContent", () => {
  it("composes extraction + computation for a Bicep input", () => {
    const r = computeCoverageFromContent({
      sourceContent:
        "resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {}\n" +
        "resource vnet 'Microsoft.Network/virtualNetworks@2022-11-01' = {}",
      sourceFormat: "bicep",
      terraformFiles: {
        "main.tf":
          'resource "azurerm_storage_account" "sa" {}\n' +
          'resource "azurerm_virtual_network" "vnet" {}',
      },
    });
    expect(r.coverage).toBe(1);
    expect(r.expected).toHaveLength(2);
  });
});

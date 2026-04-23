import { describe, it, expect } from "vitest";
import {
  extractBicepResources,
  extractCfResources,
  extractSourceResourceInventory,
  extractSourceResourceInventoryMultiFile,
  mappedTfTypes,
  unmappedSourceTypes,
} from "@/lib/source-resource-inventory";

describe("extractBicepResources", () => {
  it("strips @version and returns ordered declarations", () => {
    const src = `
resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = { name: 'sa1' }
resource vnet 'Microsoft.Network/virtualNetworks@2022-11-01' = { name: 'v1' }
    `;
    expect(extractBicepResources(src)).toEqual([
      { sourceType: "Microsoft.Storage/storageAccounts", logicalName: "sa" },
      { sourceType: "Microsoft.Network/virtualNetworks", logicalName: "vnet" },
    ]);
  });

  it("ignores module declarations and string literals mentioning `resource`", () => {
    const src = `
var note = 'resource misleading'
module mod './mod.bicep' = { name: 'm' }
resource real 'Microsoft.Web/sites@2022-09-01' = { name: 'w' }
    `;
    const out = extractBicepResources(src);
    expect(out).toHaveLength(1);
    expect(out[0].logicalName).toBe("real");
  });
});

describe("extractCfResources", () => {
  it("parses YAML under Resources:", () => {
    const src = `
Resources:
  Bucket:
    Type: AWS::S3::Bucket
  Role:
    Type: 'AWS::IAM::Role'
    `;
    expect(extractCfResources(src)).toEqual([
      { sourceType: "AWS::S3::Bucket", logicalName: "Bucket" },
      { sourceType: "AWS::IAM::Role", logicalName: "Role" },
    ]);
  });

  it("parses JSON templates", () => {
    const src = JSON.stringify({
      Resources: {
        C: { Type: "AWS::ECS::Cluster" },
        S: { Type: "AWS::ECS::Service" },
      },
    });
    expect(extractCfResources(src)).toEqual([
      { sourceType: "AWS::ECS::Cluster", logicalName: "C" },
      { sourceType: "AWS::ECS::Service", logicalName: "S" },
    ]);
  });

  it("does not trip on nested `Type:` keys inside Properties", () => {
    const src = `
Resources:
  B:
    Type: AWS::S3::Bucket
    Properties:
      NotificationConfiguration:
        TopicConfigurations:
          - Type: s3:ObjectCreated:*
    `;
    const out = extractCfResources(src);
    expect(out).toHaveLength(1);
    expect(out[0].sourceType).toBe("AWS::S3::Bucket");
  });
});

describe("extractSourceResourceInventory", () => {
  it("dispatches on sourceFormat", () => {
    const bicepOut = extractSourceResourceInventory(
      "resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {}",
      "bicep",
    );
    expect(bicepOut[0].sourceType).toBe("Microsoft.Storage/storageAccounts");

    const cfOut = extractSourceResourceInventory(
      "Resources:\n  B:\n    Type: AWS::S3::Bucket",
      "cloudformation",
    );
    expect(cfOut[0].sourceType).toBe("AWS::S3::Bucket");
  });
});

describe("extractSourceResourceInventoryMultiFile", () => {
  it("prefixes logical names with file path to avoid collisions", () => {
    const files = {
      "main.bicep": "resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {}",
      "modules/net.bicep": "resource vnet 'Microsoft.Network/virtualNetworks@2022-11-01' = {}",
    };
    const out = extractSourceResourceInventoryMultiFile(files, "bicep");
    expect(out).toEqual([
      {
        sourceType: "Microsoft.Storage/storageAccounts",
        logicalName: "main.bicep:sa",
      },
      {
        sourceType: "Microsoft.Network/virtualNetworks",
        logicalName: "modules/net.bicep:vnet",
      },
    ]);
  });
});

describe("mappedTfTypes", () => {
  it("returns the sorted set of mapped TF types, excluding nulls", () => {
    const src = [
      { sourceType: "Microsoft.Storage/storageAccounts", logicalName: "a" },
      { sourceType: "Microsoft.Storage/storageAccounts", logicalName: "b" }, // dup
      { sourceType: "Microsoft.Network/virtualNetworks", logicalName: "c" },
      { sourceType: "Microsoft.Unknown/x", logicalName: "d" }, // unmapped
    ];
    expect(mappedTfTypes(src, "bicep")).toEqual([
      "azurerm_storage_account",
      "azurerm_virtual_network",
    ]);
  });
});

describe("unmappedSourceTypes", () => {
  it("returns only types with no entry in the map", () => {
    const src = [
      { sourceType: "Microsoft.Storage/storageAccounts", logicalName: "a" },
      { sourceType: "Microsoft.Future/mysteryResource", logicalName: "b" },
    ];
    expect(unmappedSourceTypes(src, "bicep")).toEqual([
      "Microsoft.Future/mysteryResource",
    ]);
  });
});

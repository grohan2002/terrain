import { describe, it, expect } from "vitest";
import { selectModel } from "@/lib/model-router";

const SONNET = "claude-sonnet-4-20250514";
const HAIKU = "claude-haiku-4-5-20251001";

describe("selectModel", () => {
  it("selects Haiku for simple single-resource files", () => {
    const bicep = `param location string = resourceGroup().location

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'mystorageaccount'
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
}`;
    expect(selectModel(bicep)).toBe(HAIKU);
  });

  it("selects Sonnet for multi-resource files", () => {
    const bicep = `resource vnet 'Microsoft.Network/virtualNetworks@2023-01-01' = {
  name: 'myvnet'
}

resource subnet 'Microsoft.Network/virtualNetworks/subnets@2023-01-01' = {
  name: 'mysubnet'
}`;
    expect(selectModel(bicep)).toBe(SONNET);
  });

  it("selects Sonnet for files with modules", () => {
    const bicep = `module storage './storage.bicep' = {
  name: 'storageModule'
}`;
    expect(selectModel(bicep)).toBe(SONNET);
  });

  it("selects Sonnet for files with loops", () => {
    const bicep = `resource nsg 'Microsoft.Network/networkSecurityGroups@2023-01-01' = {
  name: 'mynsg'
  properties: {
    securityRules: [for rule in rules: {
      name: rule.name
    }]
  }
}`;
    expect(selectModel(bicep)).toBe(SONNET);
  });

  it("selects Sonnet for files with conditions", () => {
    const bicep = `resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = if (deployStorage) {
  name: 'mystorage'
}`;
    expect(selectModel(bicep)).toBe(SONNET);
  });

  it("selects Sonnet for files over 50 lines", () => {
    const lines = Array(51).fill("// comment").join("\n");
    const bicep = lines + "\nresource x 'Microsoft.X/y@2023-01-01' = {}";
    expect(selectModel(bicep)).toBe(SONNET);
  });

  it("selects Haiku for empty content", () => {
    expect(selectModel("")).toBe(HAIKU);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  selectModel,
  selectModelMultiFile,
  selectModelWithExpertMode,
  selectModelMultiFileWithExpertMode,
  opusModelId,
} from "@/lib/model-router";

const SONNET = "claude-sonnet-4-20250514";
const HAIKU = "claude-haiku-4-5-20251001";
const OPUS = "claude-opus-4-7";

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

// ---------------------------------------------------------------------------
// Expert Mode
// ---------------------------------------------------------------------------

describe("opusModelId", () => {
  const original = process.env.OPUS_MODEL_ID;
  afterEach(() => {
    if (original === undefined) delete process.env.OPUS_MODEL_ID;
    else process.env.OPUS_MODEL_ID = original;
  });

  it("defaults to claude-opus-4-7 when the env var is unset", () => {
    delete process.env.OPUS_MODEL_ID;
    expect(opusModelId()).toBe(OPUS);
  });

  it("respects the OPUS_MODEL_ID env override", () => {
    process.env.OPUS_MODEL_ID = "claude-opus-4-7-20260115";
    expect(opusModelId()).toBe("claude-opus-4-7-20260115");
  });
});

describe("selectModelWithExpertMode", () => {
  beforeEach(() => {
    delete process.env.OPUS_MODEL_ID;
  });

  it("returns Opus for any input when expertMode is true", () => {
    expect(selectModelWithExpertMode("resource x 'A/B@1' = {}", { expertMode: true })).toBe(OPUS);
    expect(
      selectModelWithExpertMode("large complex template with modules and loops", {
        expertMode: true,
      }),
    ).toBe(OPUS);
  });

  it("falls back to the normal router when expertMode is false/undefined", () => {
    const simple = "resource x 'Microsoft.Storage/storageAccounts@2023-01-01' = {}";
    expect(selectModelWithExpertMode(simple)).toBe(HAIKU);
    expect(selectModelWithExpertMode(simple, { expertMode: false })).toBe(HAIKU);
  });

  it("never downgrades when expertMode is on, even for trivial input", () => {
    expect(selectModelWithExpertMode("", { expertMode: true })).toBe(OPUS);
  });
});

describe("selectModelMultiFileWithExpertMode", () => {
  beforeEach(() => {
    delete process.env.OPUS_MODEL_ID;
  });

  it("defaults to Sonnet for multi-file projects", () => {
    expect(selectModelMultiFileWithExpertMode()).toBe(SONNET);
    expect(selectModelMultiFileWithExpertMode({ expertMode: false })).toBe(SONNET);
    expect(selectModelMultiFile()).toBe(SONNET);
  });

  it("promotes to Opus when expertMode is on", () => {
    expect(selectModelMultiFileWithExpertMode({ expertMode: true })).toBe(OPUS);
  });
});

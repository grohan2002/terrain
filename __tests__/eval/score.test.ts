import { describe, it, expect } from "vitest";
import {
  extractBicepResources,
  extractCfResources,
  extractGeneratedResources,
  resourceCoverage,
  structuralMatch,
  summariseEvents,
  scoreFixture,
  type FixtureMeta,
} from "../../eval/score";
import type { StreamEvent } from "@/lib/types";

// ---------------------------------------------------------------------------
// extractBicepResources
// ---------------------------------------------------------------------------

describe("extractBicepResources", () => {
  it("pulls name + type from `resource foo 'Namespace/Type@ver' = {` declarations", () => {
    const src = `
resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'sa1'
}

resource vnet 'Microsoft.Network/virtualNetworks@2022-11-01' = {
  name: 'vnet1'
}
    `;
    expect(extractBicepResources(src)).toEqual([
      {
        sourceType: "Microsoft.Storage/storageAccounts",
        logicalName: "storage",
      },
      { sourceType: "Microsoft.Network/virtualNetworks", logicalName: "vnet" },
    ]);
  });

  it("ignores quoted 'resource' in strings and inline module declarations", () => {
    const src = `
var x = 'resource notReal'

module mod './mod.bicep' = {
  name: 'mod1'
}

resource real 'Microsoft.Web/sites@2022-09-01' = {
  name: 'web1'
}
    `;
    const out = extractBicepResources(src);
    expect(out).toHaveLength(1);
    expect(out[0].sourceType).toBe("Microsoft.Web/sites");
  });
});

// ---------------------------------------------------------------------------
// extractCfResources
// ---------------------------------------------------------------------------

describe("extractCfResources", () => {
  it("parses YAML resources under the Resources: block", () => {
    const src = `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  Bucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: test
  Role:
    Type: 'AWS::IAM::Role'
    Properties:
      AssumeRolePolicyDocument: {}
    `;
    expect(extractCfResources(src)).toEqual([
      { sourceType: "AWS::S3::Bucket", logicalName: "Bucket" },
      { sourceType: "AWS::IAM::Role", logicalName: "Role" },
    ]);
  });

  it("parses JSON templates", () => {
    const src = JSON.stringify({
      Resources: {
        Cluster: { Type: "AWS::ECS::Cluster", Properties: {} },
        Svc: { Type: "AWS::ECS::Service", Properties: {} },
      },
    });
    expect(extractCfResources(src)).toEqual([
      { sourceType: "AWS::ECS::Cluster", logicalName: "Cluster" },
      { sourceType: "AWS::ECS::Service", logicalName: "Svc" },
    ]);
  });

  it("ignores nested property blocks that reuse `Type:`", () => {
    const src = `
Resources:
  Bucket:
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

// ---------------------------------------------------------------------------
// extractGeneratedResources
// ---------------------------------------------------------------------------

describe("extractGeneratedResources", () => {
  it("extracts `resource \"type\" \"name\" {` across multiple files", () => {
    const files = {
      "main.tf": `
resource "azurerm_storage_account" "sa" {
  name = "sa1"
}
      `,
      "network.tf": `
resource "azurerm_virtual_network" "vnet" {
  name = "vnet1"
}
resource "azurerm_subnet" "web" {
  name = "web"
}
      `,
    };
    expect(extractGeneratedResources(files)).toEqual([
      { tfType: "azurerm_storage_account", tfName: "sa", file: "main.tf" },
      { tfType: "azurerm_virtual_network", tfName: "vnet", file: "network.tf" },
      { tfType: "azurerm_subnet", tfName: "web", file: "network.tf" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// resourceCoverage
// ---------------------------------------------------------------------------

describe("resourceCoverage", () => {
  it("returns 1.0 when every mapped source resource has a matching TF type", () => {
    const cov = resourceCoverage(
      [
        {
          sourceType: "Microsoft.Storage/storageAccounts",
          logicalName: "sa",
        },
        {
          sourceType: "Microsoft.Network/virtualNetworks",
          logicalName: "vnet",
        },
      ],
      [
        { tfType: "azurerm_storage_account", tfName: "sa", file: "main.tf" },
        { tfType: "azurerm_virtual_network", tfName: "vnet", file: "main.tf" },
      ],
      "bicep",
    );
    expect(cov.coverage).toBe(1);
    expect(cov.missing).toHaveLength(0);
    expect(cov.matched).toHaveLength(2);
  });

  it("flags missing resources and drops coverage below 1.0", () => {
    const cov = resourceCoverage(
      [
        {
          sourceType: "Microsoft.Storage/storageAccounts",
          logicalName: "sa",
        },
        {
          sourceType: "Microsoft.Network/virtualNetworks",
          logicalName: "vnet",
        },
      ],
      [{ tfType: "azurerm_storage_account", tfName: "sa", file: "main.tf" }],
      "bicep",
    );
    expect(cov.coverage).toBe(0.5);
    expect(cov.missing).toEqual([
      {
        sourceType: "Microsoft.Network/virtualNetworks",
        logicalName: "vnet",
      },
    ]);
  });

  it("records unmapped source types without dinging coverage", () => {
    const cov = resourceCoverage(
      [
        {
          sourceType: "Microsoft.Unknown/mysteryResource",
          logicalName: "x",
        },
        {
          sourceType: "Microsoft.Storage/storageAccounts",
          logicalName: "sa",
        },
      ],
      [{ tfType: "azurerm_storage_account", tfName: "sa", file: "main.tf" }],
      "bicep",
    );
    expect(cov.coverage).toBe(1);
    expect(cov.unmappedSourceTypes).toEqual([
      "Microsoft.Unknown/mysteryResource",
    ]);
  });

  it("works for CF resources via CF_RESOURCE_TYPE_MAP", () => {
    const cov = resourceCoverage(
      [
        { sourceType: "AWS::S3::Bucket", logicalName: "b1" },
        { sourceType: "AWS::EC2::VPC", logicalName: "vpc" },
      ],
      [
        { tfType: "aws_s3_bucket", tfName: "b1", file: "main.tf" },
        { tfType: "aws_vpc", tfName: "vpc", file: "main.tf" },
      ],
      "cloudformation",
    );
    expect(cov.coverage).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// structuralMatch
// ---------------------------------------------------------------------------

describe("structuralMatch", () => {
  it("returns 1 when generated and reference expose the same resource tuples", () => {
    const tf = {
      "main.tf": 'resource "azurerm_storage_account" "sa" {}\nresource "azurerm_virtual_network" "vnet" {}',
    };
    expect(structuralMatch(tf, tf)).toBe(1);
  });

  it("returns Jaccard similarity when the sets partially overlap", () => {
    const gen = {
      "main.tf":
        'resource "azurerm_storage_account" "sa" {}\nresource "azurerm_virtual_network" "vnet" {}\nresource "azurerm_subnet" "web" {}',
    };
    const ref = {
      "main.tf":
        'resource "azurerm_storage_account" "sa" {}\nresource "azurerm_virtual_network" "vnet" {}',
    };
    // intersection=2, union=3 => 2/3 ≈ 0.667
    expect(structuralMatch(gen, ref)).toBeCloseTo(2 / 3, 3);
  });
});

// ---------------------------------------------------------------------------
// summariseEvents
// ---------------------------------------------------------------------------

describe("summariseEvents", () => {
  it("aggregates tool_start counts, validation, cost, and terraform output", () => {
    const events: StreamEvent[] = [
      { type: "tool_start", toolName: "lookup_resource_mapping", toolInput: {} },
      { type: "tool_start", toolName: "lookup_resource_mapping", toolInput: {} },
      { type: "tool_start", toolName: "generate_terraform", toolInput: {} },
      {
        type: "terraform_output",
        files: { "main.tf": 'resource "azurerm_storage_account" "sa" {}' },
      },
      { type: "validation", passed: true, output: "OK" },
      {
        type: "done",
        fullReply: "done",
        toolCalls: [],
        costInfo: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCostUsd: 0.001,
          model: "claude-sonnet-4-20250514",
        },
        model: "claude-sonnet-4-20250514",
      },
    ];
    const s = summariseEvents(events);
    expect(s.totalRounds).toBe(3);
    expect(s.toolCallCounts).toEqual({
      lookup_resource_mapping: 2,
      generate_terraform: 1,
    });
    expect(s.validationPassed).toBe(true);
    expect(s.costInfo?.totalCostUsd).toBe(0.001);
    expect(s.model).toBe("claude-sonnet-4-20250514");
    expect(Object.keys(s.terraformFiles)).toEqual(["main.tf"]);
    expect(s.errored).toBe(false);
  });

  it("captures error events", () => {
    const s = summariseEvents([
      { type: "error", message: "boom" },
    ]);
    expect(s.errored).toBe(true);
    expect(s.errorMessage).toBe("boom");
  });
});

// ---------------------------------------------------------------------------
// scoreFixture end-to-end
// ---------------------------------------------------------------------------

describe("scoreFixture", () => {
  const meta: FixtureMeta = {
    name: "bicep/test",
    sourceFormat: "bicep",
    inputFile: "input.bicep",
    description: "test",
    expectedResourceCount: 1,
    maxCostUsd: 0.05,
    maxRounds: 10,
    expectValidationPass: true,
  };

  it("passes when coverage is 1.0, validation ok, and budget respected", () => {
    const events: StreamEvent[] = [
      { type: "tool_start", toolName: "generate_terraform", toolInput: {} },
      {
        type: "terraform_output",
        files: { "main.tf": 'resource "azurerm_storage_account" "sa" {}' },
      },
      { type: "validation", passed: true, output: "OK" },
      {
        type: "done",
        fullReply: "done",
        toolCalls: [],
        costInfo: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCostUsd: 0.001,
          model: "claude-sonnet-4-20250514",
        },
      },
    ];
    const score = scoreFixture({
      meta,
      sourceContent:
        "resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {}",
      events,
      reference: null,
    });
    expect(score.passed).toBe(true);
    expect(score.coverage.coverage).toBe(1);
    expect(score.structuralMatch).toBeNull();
  });

  it("fails with a fail reason when coverage is below 1.0", () => {
    const events: StreamEvent[] = [
      {
        type: "terraform_output",
        files: { "main.tf": 'resource "azurerm_storage_account" "sa" {}' },
      },
      { type: "validation", passed: true, output: "OK" },
      {
        type: "done",
        fullReply: "done",
        toolCalls: [],
        costInfo: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCostUsd: 0.001,
          model: "claude-sonnet-4-20250514",
        },
      },
    ];
    const score = scoreFixture({
      meta,
      sourceContent: `
resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {}
resource vnet 'Microsoft.Network/virtualNetworks@2022-11-01' = {}
      `,
      events,
      reference: null,
    });
    expect(score.passed).toBe(false);
    expect(score.coverage.coverage).toBe(0.5);
    expect(score.failReasons.some((r) => r.includes("coverage 50%"))).toBe(true);
  });

  it("fails when cost exceeds the budget", () => {
    const events: StreamEvent[] = [
      {
        type: "terraform_output",
        files: { "main.tf": 'resource "azurerm_storage_account" "sa" {}' },
      },
      { type: "validation", passed: true, output: "OK" },
      {
        type: "done",
        fullReply: "done",
        toolCalls: [],
        costInfo: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCostUsd: 0.5,
          model: "claude-sonnet-4-20250514",
        },
      },
    ];
    const score = scoreFixture({
      meta,
      sourceContent:
        "resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {}",
      events,
      reference: null,
    });
    expect(score.budgetExceeded.cost).toBe(true);
    expect(score.passed).toBe(false);
    expect(score.failReasons.some((r) => r.includes("cost"))).toBe(true);
  });

  it("reports a structural match score when a reference is provided", () => {
    const events: StreamEvent[] = [
      {
        type: "terraform_output",
        files: { "main.tf": 'resource "azurerm_storage_account" "sa" {}' },
      },
      { type: "validation", passed: true, output: "OK" },
      {
        type: "done",
        fullReply: "done",
        toolCalls: [],
        costInfo: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCostUsd: 0.001,
          model: "claude-sonnet-4-20250514",
        },
      },
    ];
    const score = scoreFixture({
      meta,
      sourceContent:
        "resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {}",
      events,
      reference: { "main.tf": 'resource "azurerm_storage_account" "sa" {}' },
    });
    expect(score.structuralMatch).toBe(1);
    expect(score.hasReference).toBe(true);
  });
});

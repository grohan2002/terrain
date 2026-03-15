import { describe, it, expect } from "vitest";
import { deployTools } from "@/lib/deploy-agent/tools";

// ---------------------------------------------------------------------------
// deployTools — tool definitions completeness & schema correctness
// ---------------------------------------------------------------------------

describe("deployTools", () => {
  it("defines exactly 7 tools", () => {
    expect(deployTools).toHaveLength(7);
  });

  const expectedTools = [
    "terraform_plan",
    "terraform_apply",
    "get_terraform_outputs",
    "check_azure_resource",
    "run_connectivity_test",
    "check_resource_config",
    "terraform_destroy",
  ];

  it("has all expected tool names", () => {
    const toolNames = deployTools.map((t) => t.name);
    for (const name of expectedTools) {
      expect(toolNames, `Missing tool: ${name}`).toContain(name);
    }
  });

  it("every tool has a non-empty description", () => {
    for (const tool of deployTools) {
      expect(tool.description.length, `${tool.name} description`).toBeGreaterThan(10);
    }
  });

  it("every tool has an input_schema with type object", () => {
    for (const tool of deployTools) {
      expect(tool.input_schema.type, `${tool.name} schema type`).toBe("object");
    }
  });

  it("every tool with required fields has those fields in properties", () => {
    for (const tool of deployTools) {
      const schema = tool.input_schema as {
        properties: Record<string, unknown>;
        required?: string[];
      };
      if (schema.required && schema.required.length > 0) {
        for (const field of schema.required) {
          expect(
            schema.properties[field],
            `${tool.name} missing property: ${field}`,
          ).toBeDefined();
        }
      }
    }
  });

  it("run_connectivity_test has enum for test_type", () => {
    const tool = deployTools.find((t) => t.name === "run_connectivity_test")!;
    const schema = tool.input_schema as {
      properties: { test_type: { enum?: string[] } };
    };
    expect(schema.properties.test_type.enum).toBeDefined();
    expect(schema.properties.test_type.enum).toContain("http");
    expect(schema.properties.test_type.enum).toContain("dns");
    expect(schema.properties.test_type.enum).toContain("tcp");
  });

  it("check_azure_resource has no required fields (flexible input)", () => {
    const tool = deployTools.find((t) => t.name === "check_azure_resource")!;
    const schema = tool.input_schema as { required?: string[] };
    expect(schema.required ?? []).toHaveLength(0);
  });

  it("check_resource_config requires resource_id and expected_properties", () => {
    const tool = deployTools.find((t) => t.name === "check_resource_config")!;
    const schema = tool.input_schema as { required?: string[] };
    expect(schema.required).toContain("resource_id");
    expect(schema.required).toContain("expected_properties");
  });

  it("terraform_destroy description warns about explicit user confirmation", () => {
    const tool = deployTools.find((t) => t.name === "terraform_destroy")!;
    expect(tool.description.toLowerCase()).toContain("explicit");
  });

  it("terraform_plan/apply/destroy/outputs all require working_dir", () => {
    const workDirTools = [
      "terraform_plan",
      "terraform_apply",
      "get_terraform_outputs",
      "terraform_destroy",
    ];
    for (const name of workDirTools) {
      const tool = deployTools.find((t) => t.name === name)!;
      const schema = tool.input_schema as { required?: string[] };
      expect(schema.required, `${name} should require working_dir`).toContain(
        "working_dir",
      );
    }
  });
});

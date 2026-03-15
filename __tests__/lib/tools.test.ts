import { describe, it, expect } from "vitest";
import { bicepTools } from "@/lib/agent/tools";

// ---------------------------------------------------------------------------
// bicepTools — tool definitions completeness & schema correctness
// ---------------------------------------------------------------------------

describe("bicepTools", () => {
  it("defines exactly 9 tools", () => {
    expect(bicepTools).toHaveLength(9);
  });

  const expectedTools = [
    "read_bicep_file",
    "parse_bicep",
    "lookup_resource_mapping",
    "generate_terraform",
    "write_terraform_files",
    "validate_terraform",
    "list_bicep_files",
    "format_terraform",
    "read_bicep_file_content",
  ];

  it("has all expected tool names", () => {
    const toolNames = bicepTools.map((t) => t.name);
    for (const name of expectedTools) {
      expect(toolNames, `Missing tool: ${name}`).toContain(name);
    }
  });

  it("every tool has a non-empty description", () => {
    for (const tool of bicepTools) {
      expect(tool.description.length, `${tool.name} description`).toBeGreaterThan(10);
    }
  });

  it("every tool has an input_schema with type object", () => {
    for (const tool of bicepTools) {
      expect(tool.input_schema.type, `${tool.name} schema type`).toBe("object");
    }
  });

  it("every tool with required fields has those fields in properties", () => {
    for (const tool of bicepTools) {
      const schema = tool.input_schema as {
        properties: Record<string, unknown>;
        required?: string[];
      };
      if (schema.required) {
        for (const field of schema.required) {
          expect(
            schema.properties[field],
            `${tool.name} missing property: ${field}`,
          ).toBeDefined();
        }
      }
    }
  });

  it("generate_terraform has enum for block_type", () => {
    const tool = bicepTools.find((t) => t.name === "generate_terraform")!;
    const schema = tool.input_schema as {
      properties: {
        block_type: { enum?: string[] };
      };
    };
    expect(schema.properties.block_type.enum).toBeDefined();
    const validTypes = schema.properties.block_type.enum!;
    expect(validTypes).toContain("resource");
    expect(validTypes).toContain("variable");
    expect(validTypes).toContain("locals");
    expect(validTypes).toContain("output");
    expect(validTypes).toContain("provider");
    expect(validTypes).toContain("module");
    expect(validTypes).toContain("data");
    expect(validTypes).toContain("terraform");
  });

  it("write_terraform_files description mentions .tfvars and nested paths", () => {
    const tool = bicepTools.find((t) => t.name === "write_terraform_files")!;
    expect(tool.description).toContain(".tfvars");
    expect(tool.description).toContain("Nested paths");
  });

  it("read_bicep_file_content is for multi-file mode only", () => {
    const tool = bicepTools.find((t) => t.name === "read_bicep_file_content")!;
    expect(tool.description).toContain("multi-file");
    expect(tool.description).toContain("in-memory");
  });
});

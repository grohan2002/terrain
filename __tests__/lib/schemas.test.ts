import { describe, it, expect } from "vitest";
import {
  ConvertRequestSchema,
  DeployRequestSchema,
  DeploySetupSchema,
  DeployDestroySchema,
} from "@/lib/schemas";

describe("ConvertRequestSchema", () => {
  it("accepts valid input", () => {
    const result = ConvertRequestSchema.safeParse({
      bicepContent: "resource storageAccount ...",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional apiKey", () => {
    const result = ConvertRequestSchema.safeParse({
      bicepContent: "resource ...",
      apiKey: "sk-ant-xxx",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty bicepContent", () => {
    const result = ConvertRequestSchema.safeParse({ bicepContent: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing bicepContent", () => {
    const result = ConvertRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("DeployRequestSchema", () => {
  it("accepts valid input", () => {
    const result = DeployRequestSchema.safeParse({
      terraformFiles: { "main.tf": "resource ..." },
      workingDir: "/tmp/deploy",
      resourceGroupName: "my-rg",
    });
    expect(result.success).toBe(true);
  });

  it("defaults bicepContent to empty string", () => {
    const result = DeployRequestSchema.safeParse({
      terraformFiles: { "main.tf": "resource ..." },
      workingDir: "/tmp/deploy",
      resourceGroupName: "my-rg",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bicepContent).toBe("");
    }
  });

  it("rejects empty terraformFiles", () => {
    const result = DeployRequestSchema.safeParse({
      terraformFiles: {},
      workingDir: "/tmp/deploy",
      resourceGroupName: "my-rg",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing workingDir", () => {
    const result = DeployRequestSchema.safeParse({
      terraformFiles: { "main.tf": "x" },
      resourceGroupName: "my-rg",
    });
    expect(result.success).toBe(false);
  });
});

describe("DeploySetupSchema", () => {
  it("accepts valid input with defaults", () => {
    const result = DeploySetupSchema.safeParse({
      terraformFiles: { "main.tf": "resource ..." },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.location).toBe("eastus");
    }
  });

  it("rejects empty terraformFiles", () => {
    const result = DeploySetupSchema.safeParse({ terraformFiles: {} });
    expect(result.success).toBe(false);
  });
});

describe("DeployDestroySchema", () => {
  it("accepts valid input", () => {
    const result = DeployDestroySchema.safeParse({
      workingDir: "/tmp/deploy",
      resourceGroupName: "my-rg",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty workingDir", () => {
    const result = DeployDestroySchema.safeParse({
      workingDir: "",
      resourceGroupName: "my-rg",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing resourceGroupName", () => {
    const result = DeployDestroySchema.safeParse({
      workingDir: "/tmp",
    });
    expect(result.success).toBe(false);
  });
});

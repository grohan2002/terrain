import { describe, it, expect } from "vitest";
import {
  ConvertRequestSchema,
  AzureConfigSchema,
  DeployRequestSchema,
  DeploySetupSchema,
  DeployDestroySchema,
  GitHubScanRequestSchema,
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

describe("AzureConfigSchema", () => {
  const validConfig = {
    subscriptionId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    tenantId: "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
    clientId: "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
    clientSecret: "my-secret-value",
  };

  it("accepts valid Azure config", () => {
    const result = AzureConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("rejects empty subscriptionId", () => {
    const result = AzureConfigSchema.safeParse({ ...validConfig, subscriptionId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty tenantId", () => {
    const result = AzureConfigSchema.safeParse({ ...validConfig, tenantId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty clientId", () => {
    const result = AzureConfigSchema.safeParse({ ...validConfig, clientId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty clientSecret", () => {
    const result = AzureConfigSchema.safeParse({ ...validConfig, clientSecret: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing subscriptionId", () => {
    const { subscriptionId, ...rest } = validConfig;
    const result = AzureConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing tenantId", () => {
    const { tenantId, ...rest } = validConfig;
    const result = AzureConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects empty object", () => {
    const result = AzureConfigSchema.safeParse({});
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

  it("accepts optional azureConfig", () => {
    const result = DeployRequestSchema.safeParse({
      terraformFiles: { "main.tf": "resource ..." },
      workingDir: "/tmp/deploy",
      resourceGroupName: "my-rg",
      azureConfig: {
        subscriptionId: "sub-id",
        tenantId: "tenant-id",
        clientId: "client-id",
        clientSecret: "secret",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts without azureConfig", () => {
    const result = DeployRequestSchema.safeParse({
      terraformFiles: { "main.tf": "resource ..." },
      workingDir: "/tmp/deploy",
      resourceGroupName: "my-rg",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.azureConfig).toBeUndefined();
    }
  });

  it("rejects invalid azureConfig (empty clientSecret)", () => {
    const result = DeployRequestSchema.safeParse({
      terraformFiles: { "main.tf": "resource ..." },
      workingDir: "/tmp/deploy",
      resourceGroupName: "my-rg",
      azureConfig: {
        subscriptionId: "sub-id",
        tenantId: "tenant-id",
        clientId: "client-id",
        clientSecret: "",
      },
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

  it("accepts optional azureConfig", () => {
    const result = DeploySetupSchema.safeParse({
      terraformFiles: { "main.tf": "resource ..." },
      azureConfig: {
        subscriptionId: "sub-id",
        tenantId: "tenant-id",
        clientId: "client-id",
        clientSecret: "secret",
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.azureConfig?.subscriptionId).toBe("sub-id");
    }
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

  it("accepts optional azureConfig", () => {
    const result = DeployDestroySchema.safeParse({
      workingDir: "/tmp/deploy",
      resourceGroupName: "my-rg",
      azureConfig: {
        subscriptionId: "sub-id",
        tenantId: "tenant-id",
        clientId: "client-id",
        clientSecret: "secret",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid azureConfig in destroy schema", () => {
    const result = DeployDestroySchema.safeParse({
      workingDir: "/tmp/deploy",
      resourceGroupName: "my-rg",
      azureConfig: {
        subscriptionId: "sub-id",
        // missing tenantId, clientId, clientSecret
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("GitHubScanRequestSchema", () => {
  it("accepts shorthand repo URL", () => {
    const result = GitHubScanRequestSchema.safeParse({ repoUrl: "Azure/bicep" });
    expect(result.success).toBe(true);
  });

  it("accepts full URL with optional fields", () => {
    const result = GitHubScanRequestSchema.safeParse({
      repoUrl: "https://github.com/Azure/bicep",
      branch: "main",
      subdirectory: "infra",
      token: "ghp_abc123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty repoUrl", () => {
    const result = GitHubScanRequestSchema.safeParse({ repoUrl: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing repoUrl", () => {
    const result = GitHubScanRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

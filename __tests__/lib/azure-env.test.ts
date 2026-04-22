import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildAzureEnv } from "@/lib/azure-env";
import type { AzureConfig } from "@/lib/types";

// Save and restore process.env
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("buildAzureEnv", () => {
  const mockConfig: AzureConfig = {
    subscriptionId: "sub-1234",
    tenantId: "tenant-5678",
    clientId: "client-abcd",
    clientSecret: "secret-efgh",
  };

  it("returns process.env spread when azureConfig is undefined", () => {
    const result = buildAzureEnv();
    expect(result).toEqual({ ...process.env });
  });

  it("returns process.env spread when azureConfig is explicitly undefined", () => {
    const result = buildAzureEnv(undefined);
    expect(result).toEqual({ ...process.env });
  });

  it("sets ARM_SUBSCRIPTION_ID from azureConfig", () => {
    const result = buildAzureEnv(mockConfig);
    expect(result.ARM_SUBSCRIPTION_ID).toBe("sub-1234");
  });

  it("sets ARM_TENANT_ID from azureConfig", () => {
    const result = buildAzureEnv(mockConfig);
    expect(result.ARM_TENANT_ID).toBe("tenant-5678");
  });

  it("sets ARM_CLIENT_ID from azureConfig", () => {
    const result = buildAzureEnv(mockConfig);
    expect(result.ARM_CLIENT_ID).toBe("client-abcd");
  });

  it("sets ARM_CLIENT_SECRET from azureConfig", () => {
    const result = buildAzureEnv(mockConfig);
    expect(result.ARM_CLIENT_SECRET).toBe("secret-efgh");
  });

  it("preserves PATH from process.env", () => {
    process.env.PATH = "/usr/bin:/usr/local/bin";
    const result = buildAzureEnv(mockConfig);
    expect(result.PATH).toBe("/usr/bin:/usr/local/bin");
  });

  it("preserves other env vars when azureConfig is provided", () => {
    process.env.HOME = "/home/testuser";
    // NODE_ENV is typed readonly by @types/node; assign via a writable cast.
    (process.env as { NODE_ENV: string }).NODE_ENV = "test";
    const result = buildAzureEnv(mockConfig);
    expect(result.HOME).toBe("/home/testuser");
    expect(result.NODE_ENV).toBe("test");
  });

  it("overrides existing ARM_* env vars with azureConfig values", () => {
    process.env.ARM_SUBSCRIPTION_ID = "old-sub";
    process.env.ARM_TENANT_ID = "old-tenant";
    process.env.ARM_CLIENT_ID = "old-client";
    process.env.ARM_CLIENT_SECRET = "old-secret";

    const result = buildAzureEnv(mockConfig);
    expect(result.ARM_SUBSCRIPTION_ID).toBe("sub-1234");
    expect(result.ARM_TENANT_ID).toBe("tenant-5678");
    expect(result.ARM_CLIENT_ID).toBe("client-abcd");
    expect(result.ARM_CLIENT_SECRET).toBe("secret-efgh");
  });

  it("preserves existing ARM_* env vars when azureConfig is undefined", () => {
    process.env.ARM_SUBSCRIPTION_ID = "env-sub";
    process.env.ARM_CLIENT_ID = "env-client";

    const result = buildAzureEnv();
    expect(result.ARM_SUBSCRIPTION_ID).toBe("env-sub");
    expect(result.ARM_CLIENT_ID).toBe("env-client");
  });

  it("returns a new object (not a direct reference to process.env)", () => {
    const result = buildAzureEnv();
    expect(result).not.toBe(process.env);
  });

  it("returns a new object when azureConfig is provided", () => {
    const result = buildAzureEnv(mockConfig);
    expect(result).not.toBe(process.env);
  });
});

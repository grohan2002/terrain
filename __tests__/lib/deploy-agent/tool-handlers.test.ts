import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// Type-only — `typeof execSync` narrows the mock cast below. The actual module
// is replaced by vi.mock("node:child_process", ...) further down.
import type { execSync } from "node:child_process";
import {
  createDeployToolHandlers,
  type DeployToolCallbacks,
} from "@/lib/deploy-agent/tool-handlers";

// ---------------------------------------------------------------------------
// Mock child_process — every execSync call is intercepted
// ---------------------------------------------------------------------------

const { mockExecSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: mockExecSync,
    default: { ...actual, execSync: mockExecSync },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deploy-tool-test-"));
}

/**
 * Set up mock so findCli() detects the chosen CLI.
 * Additional command patterns can be provided for actual tool commands.
 */
function setupMock(
  cli: "tofu" | "terraform" | "none",
  commandOutputs: Record<string, string> = {},
) {
  mockExecSync.mockImplementation(((cmd: string) => {
    const cmdStr = String(cmd);

    // CLI detection
    if (cmdStr === "which tofu") {
      if (cli === "tofu") return "/usr/local/bin/tofu";
      throw new Error("not found");
    }
    if (cmdStr === "which terraform") {
      if (cli === "tofu" || cli === "terraform") return "/usr/local/bin/terraform";
      throw new Error("not found");
    }

    // Match against provided command patterns
    for (const [pattern, output] of Object.entries(commandOutputs)) {
      if (cmdStr.includes(pattern)) return output;
    }

    // Default: throw for unexpected commands
    throw Object.assign(new Error(`Unexpected command: ${cmdStr}`), {
      stderr: "command not found",
      stdout: "",
      status: 127,
    });
  }) as typeof execSync);
}

let testDir: string;

beforeEach(() => {
  testDir = tmpDir();
  mockExecSync.mockReset();
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// handler map
// ---------------------------------------------------------------------------

describe("handler map", () => {
  it("createDeployToolHandlers returns exactly 7 handlers", () => {
    setupMock("tofu");
    const handlers = createDeployToolHandlers();
    expect(Object.keys(handlers)).toHaveLength(7);
  });

  it("handler names match expected tool names", () => {
    setupMock("tofu");
    const handlers = createDeployToolHandlers();
    const names = Object.keys(handlers);
    expect(names).toContain("terraform_plan");
    expect(names).toContain("terraform_apply");
    expect(names).toContain("get_terraform_outputs");
    expect(names).toContain("check_azure_resource");
    expect(names).toContain("run_connectivity_test");
    expect(names).toContain("check_resource_config");
    expect(names).toContain("terraform_destroy");
  });

  it("accepts optional azureConfig parameter", () => {
    setupMock("tofu");
    const handlers = createDeployToolHandlers(undefined, {
      subscriptionId: "sub-123",
      tenantId: "tenant-456",
      clientId: "client-789",
      clientSecret: "secret-abc",
    });
    expect(Object.keys(handlers)).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// azureConfig env variable threading
// ---------------------------------------------------------------------------

describe("azureConfig environment threading", () => {
  const azureConfig = {
    subscriptionId: "test-sub-id",
    tenantId: "test-tenant-id",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
  };

  it("passes ARM_* env vars to terraform_plan execSync when azureConfig is provided", async () => {
    setupMock("tofu", { "tofu plan": "Plan: 0 to add." });
    const handlers = createDeployToolHandlers(undefined, azureConfig);
    await handlers.terraform_plan({ working_dir: testDir });

    const planCall = mockExecSync.mock.calls.find(
      ([cmd]) => String(cmd).includes("plan"),
    );
    expect(planCall).toBeDefined();
    const opts = planCall![1] as Record<string, unknown>;
    const env = opts.env as Record<string, string>;
    expect(env.ARM_SUBSCRIPTION_ID).toBe("test-sub-id");
    expect(env.ARM_TENANT_ID).toBe("test-tenant-id");
    expect(env.ARM_CLIENT_ID).toBe("test-client-id");
    expect(env.ARM_CLIENT_SECRET).toBe("test-client-secret");
  });

  it("passes ARM_* env vars to terraform_apply execSync when azureConfig is provided", async () => {
    setupMock("tofu", { "tofu apply": "Apply complete!" });
    const handlers = createDeployToolHandlers(undefined, azureConfig);
    await handlers.terraform_apply({ working_dir: testDir });

    const applyCall = mockExecSync.mock.calls.find(
      ([cmd]) => String(cmd).includes("apply"),
    );
    expect(applyCall).toBeDefined();
    const opts = applyCall![1] as Record<string, unknown>;
    const env = opts.env as Record<string, string>;
    expect(env.ARM_SUBSCRIPTION_ID).toBe("test-sub-id");
    expect(env.ARM_CLIENT_SECRET).toBe("test-client-secret");
  });

  it("passes ARM_* env vars to get_terraform_outputs execSync", async () => {
    const mockOutputs = JSON.stringify({ name: { value: "test" } });
    setupMock("tofu", { "tofu output": mockOutputs });
    const handlers = createDeployToolHandlers(undefined, azureConfig);
    await handlers.get_terraform_outputs({ working_dir: testDir });

    const outputCall = mockExecSync.mock.calls.find(
      ([cmd]) => String(cmd).includes("output -json"),
    );
    expect(outputCall).toBeDefined();
    const opts = outputCall![1] as Record<string, unknown>;
    const env = opts.env as Record<string, string>;
    expect(env.ARM_SUBSCRIPTION_ID).toBe("test-sub-id");
  });

  it("passes ARM_* env vars to check_azure_resource execSync", async () => {
    const resource = JSON.stringify({ properties: { provisioningState: "Succeeded" } });
    setupMock("tofu", { "az resource show": resource });
    const handlers = createDeployToolHandlers(undefined, azureConfig);
    await handlers.check_azure_resource({
      resource_id: "/subscriptions/abc/storageAccounts/sa1",
    });

    const azCall = mockExecSync.mock.calls.find(
      ([cmd]) => String(cmd).includes("az resource show"),
    );
    expect(azCall).toBeDefined();
    const opts = azCall![1] as Record<string, unknown>;
    const env = opts.env as Record<string, string>;
    expect(env.ARM_CLIENT_ID).toBe("test-client-id");
  });

  it("passes ARM_* env vars to run_connectivity_test (http) execSync", async () => {
    setupMock("tofu", { curl: "200" });
    const handlers = createDeployToolHandlers(undefined, azureConfig);
    await handlers.run_connectivity_test({
      test_type: "http",
      target: "https://example.com",
    });

    const curlCall = mockExecSync.mock.calls.find(
      ([cmd]) => String(cmd).includes("curl"),
    );
    expect(curlCall).toBeDefined();
    const opts = curlCall![1] as Record<string, unknown>;
    const env = opts.env as Record<string, string>;
    expect(env.ARM_TENANT_ID).toBe("test-tenant-id");
  });

  it("passes ARM_* env vars to terraform_destroy execSync", async () => {
    setupMock("tofu", { "tofu destroy": "Destroy complete!" });
    const handlers = createDeployToolHandlers(undefined, azureConfig);
    await handlers.terraform_destroy({ working_dir: testDir });

    const destroyCall = mockExecSync.mock.calls.find(
      ([cmd]) => String(cmd).includes("destroy"),
    );
    expect(destroyCall).toBeDefined();
    const opts = destroyCall![1] as Record<string, unknown>;
    const env = opts.env as Record<string, string>;
    expect(env.ARM_SUBSCRIPTION_ID).toBe("test-sub-id");
    expect(env.ARM_CLIENT_SECRET).toBe("test-client-secret");
  });

  it("does not set ARM_* env vars when azureConfig is undefined", async () => {
    // Clear any ARM_* vars from process.env
    delete process.env.ARM_SUBSCRIPTION_ID;
    delete process.env.ARM_TENANT_ID;
    delete process.env.ARM_CLIENT_ID;
    delete process.env.ARM_CLIENT_SECRET;

    setupMock("tofu", { "tofu plan": "Plan: 0 to add." });
    const handlers = createDeployToolHandlers();
    await handlers.terraform_plan({ working_dir: testDir });

    const planCall = mockExecSync.mock.calls.find(
      ([cmd]) => String(cmd).includes("plan"),
    );
    expect(planCall).toBeDefined();
    const opts = planCall![1] as Record<string, unknown>;
    const env = opts.env as Record<string, string>;
    expect(env.ARM_SUBSCRIPTION_ID).toBeUndefined();
    expect(env.ARM_CLIENT_SECRET).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findCli detection (tested indirectly through terraform_plan)
// ---------------------------------------------------------------------------

describe("findCli detection", () => {
  it("prefers tofu over terraform when both are available", async () => {
    setupMock("tofu", { "tofu plan": "Plan: 0 to add, 0 to change, 0 to destroy." });
    const handlers = createDeployToolHandlers();
    const result = await handlers.terraform_plan({ working_dir: testDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("tofu plan output");
    }
  });

  it("falls back to terraform when tofu is not found", async () => {
    setupMock("terraform", { "terraform plan": "Plan: 1 to add." });
    const handlers = createDeployToolHandlers();
    const result = await handlers.terraform_plan({ working_dir: testDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("terraform plan output");
    }
  });

  it("returns error when neither CLI is found", async () => {
    setupMock("none");
    const handlers = createDeployToolHandlers();
    const result = await handlers.terraform_plan({ working_dir: testDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Neither 'tofu' nor 'terraform' found in PATH");
    }
  });
});

// ---------------------------------------------------------------------------
// terraform_plan
// ---------------------------------------------------------------------------

describe("terraform_plan", () => {
  it("returns plan output on success", async () => {
    setupMock("tofu", { "tofu plan": "Plan: 2 to add, 0 to change, 0 to destroy." });
    const handlers = createDeployToolHandlers();
    const result = await handlers.terraform_plan({ working_dir: testDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("Plan: 2 to add");
    }
  });

  it("returns error when working_dir does not exist", async () => {
    setupMock("tofu");
    const handlers = createDeployToolHandlers();
    const result = await handlers.terraform_plan({
      working_dir: "/nonexistent/deploy/path",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Directory not found");
    }
  });

  it("returns error with combined stdout+stderr on CLI failure", async () => {
    mockExecSync.mockImplementation(((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr === "which tofu") return "/usr/local/bin/tofu";
      if (cmdStr === "which terraform") return "/usr/local/bin/terraform";
      if (cmdStr.includes("tofu plan")) {
        throw Object.assign(new Error("plan failed"), {
          stdout: "partial output",
          stderr: "Error: missing provider",
          status: 1,
        });
      }
      throw new Error(`Unexpected: ${cmdStr}`);
    }) as typeof execSync);

    const handlers = createDeployToolHandlers();
    const result = await handlers.terraform_plan({ working_dir: testDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("partial output");
      expect(result.error).toContain("Error: missing provider");
    }
  });

  it("calls onDeployProgress callback with 'planning' phase", async () => {
    setupMock("tofu", { "tofu plan": "Plan: 0 to add." });
    const onDeployProgress = vi.fn();
    const handlers = createDeployToolHandlers({ onDeployProgress });
    await handlers.terraform_plan({ working_dir: testDir });
    expect(onDeployProgress).toHaveBeenCalledWith(
      "planning",
      "Running terraform plan...",
    );
  });

  it("passes correct timeout option to execSync", async () => {
    setupMock("tofu", { "tofu plan": "Plan output" });
    const handlers = createDeployToolHandlers();
    await handlers.terraform_plan({ working_dir: testDir });

    // Find the call that was the actual plan command
    const planCall = mockExecSync.mock.calls.find(
      ([cmd]) => String(cmd).includes("plan"),
    );
    expect(planCall).toBeDefined();
    const opts = planCall![1] as Record<string, unknown>;
    expect(opts.timeout).toBe(120_000);
  });

  it("resolves working_dir via path.resolve", async () => {
    setupMock("tofu", { "tofu plan": "Plan output" });
    const handlers = createDeployToolHandlers();
    await handlers.terraform_plan({ working_dir: testDir });

    const planCall = mockExecSync.mock.calls.find(
      ([cmd]) => String(cmd).includes("plan"),
    );
    expect(planCall).toBeDefined();
    const opts = planCall![1] as Record<string, unknown>;
    expect(opts.cwd).toBe(path.resolve(testDir));
  });

  it("CLI not found returns error", async () => {
    setupMock("none");
    const handlers = createDeployToolHandlers();
    const result = await handlers.terraform_plan({ working_dir: testDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Neither 'tofu' nor 'terraform'");
    }
  });
});

// ---------------------------------------------------------------------------
// terraform_apply
// ---------------------------------------------------------------------------

describe("terraform_apply", () => {
  it("returns apply output on success", async () => {
    setupMock("tofu", { "tofu apply": "Apply complete! Resources: 3 added, 0 changed, 0 destroyed." });
    const handlers = createDeployToolHandlers();
    const result = await handlers.terraform_apply({ working_dir: testDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("Apply complete!");
    }
  });

  it("returns error with combined output on failure", async () => {
    mockExecSync.mockImplementation(((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr === "which tofu") return "/usr/local/bin/tofu";
      if (cmdStr === "which terraform") return "/usr/local/bin/terraform";
      if (cmdStr.includes("tofu apply")) {
        throw Object.assign(new Error("apply failed"), {
          stdout: "Creating...",
          stderr: "Error: resource quota exceeded",
          status: 1,
        });
      }
      throw new Error(`Unexpected: ${cmdStr}`);
    }) as typeof execSync);

    const handlers = createDeployToolHandlers();
    const result = await handlers.terraform_apply({ working_dir: testDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Error: resource quota exceeded");
    }
  });

  it("calls onDeployProgress with 'applying' phase", async () => {
    setupMock("tofu", { "tofu apply": "Apply complete!" });
    const onDeployProgress = vi.fn();
    const handlers = createDeployToolHandlers({ onDeployProgress });
    await handlers.terraform_apply({ working_dir: testDir });
    expect(onDeployProgress).toHaveBeenCalledWith(
      "applying",
      "Running terraform apply...",
    );
  });

  it("uses 300_000ms timeout", async () => {
    setupMock("tofu", { "tofu apply": "Apply complete!" });
    const handlers = createDeployToolHandlers();
    await handlers.terraform_apply({ working_dir: testDir });

    const applyCall = mockExecSync.mock.calls.find(
      ([cmd]) => String(cmd).includes("apply"),
    );
    expect(applyCall).toBeDefined();
    const opts = applyCall![1] as Record<string, unknown>;
    expect(opts.timeout).toBe(300_000);
  });

  it("uses -auto-approve flag", async () => {
    setupMock("tofu", { "tofu apply": "Apply complete!" });
    const handlers = createDeployToolHandlers();
    await handlers.terraform_apply({ working_dir: testDir });

    const applyCall = mockExecSync.mock.calls.find(
      ([cmd]) => String(cmd).includes("apply"),
    );
    expect(applyCall).toBeDefined();
    expect(String(applyCall![0])).toContain("-auto-approve");
  });

  it("returns CLI-not-found error", async () => {
    setupMock("none");
    const handlers = createDeployToolHandlers();
    const result = await handlers.terraform_apply({ working_dir: testDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Neither 'tofu' nor 'terraform'");
    }
  });
});

// ---------------------------------------------------------------------------
// get_terraform_outputs
// ---------------------------------------------------------------------------

describe("get_terraform_outputs", () => {
  const mockOutputs = JSON.stringify({
    resource_id: { value: "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa1" },
    name: { value: "sa1" },
  });

  it("returns outputs on success", async () => {
    setupMock("tofu", { "tofu output": mockOutputs });
    const handlers = createDeployToolHandlers();
    const result = await handlers.get_terraform_outputs({ working_dir: testDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("Terraform outputs");
    }
  });

  it("calls onOutputs callback with flattened outputs", async () => {
    setupMock("tofu", { "tofu output": mockOutputs });
    const onOutputs = vi.fn();
    const handlers = createDeployToolHandlers({ onOutputs });
    await handlers.get_terraform_outputs({ working_dir: testDir });
    expect(onOutputs).toHaveBeenCalledWith({
      resource_id: "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa1",
      name: "sa1",
    });
  });

  it("flattens non-string values via JSON.stringify", async () => {
    const complexOutputs = JSON.stringify({
      tags: { value: { env: "dev", team: "infra" } },
    });
    setupMock("tofu", { "tofu output": complexOutputs });
    const onOutputs = vi.fn();
    const handlers = createDeployToolHandlers({ onOutputs });
    await handlers.get_terraform_outputs({ working_dir: testDir });
    expect(onOutputs).toHaveBeenCalledWith({
      tags: JSON.stringify({ env: "dev", team: "infra" }),
    });
  });

  it("returns raw output even when JSON parsing fails", async () => {
    setupMock("tofu", { "tofu output": "not valid json" });
    const handlers = createDeployToolHandlers();
    const result = await handlers.get_terraform_outputs({ working_dir: testDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("not valid json");
    }
  });

  it("does not call onOutputs when JSON parsing fails", async () => {
    setupMock("tofu", { "tofu output": "not valid json" });
    const onOutputs = vi.fn();
    const handlers = createDeployToolHandlers({ onOutputs });
    await handlers.get_terraform_outputs({ working_dir: testDir });
    expect(onOutputs).not.toHaveBeenCalled();
  });

  it("returns error on CLI failure", async () => {
    mockExecSync.mockImplementation(((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr === "which tofu") return "/usr/local/bin/tofu";
      if (cmdStr === "which terraform") return "/usr/local/bin/terraform";
      if (cmdStr.includes("tofu output")) {
        throw Object.assign(new Error("output failed"), {
          stderr: "No outputs found",
          status: 1,
        });
      }
      throw new Error(`Unexpected: ${cmdStr}`);
    }) as typeof execSync);

    const handlers = createDeployToolHandlers();
    const result = await handlers.get_terraform_outputs({ working_dir: testDir });
    expect(result.ok).toBe(false);
  });

  it("uses 30_000ms timeout", async () => {
    setupMock("tofu", { "tofu output": mockOutputs });
    const handlers = createDeployToolHandlers();
    await handlers.get_terraform_outputs({ working_dir: testDir });

    const outputCall = mockExecSync.mock.calls.find(
      ([cmd]) => String(cmd).includes("output -json"),
    );
    expect(outputCall).toBeDefined();
    const opts = outputCall![1] as Record<string, unknown>;
    expect(opts.timeout).toBe(30_000);
  });

  it("returns CLI-not-found error", async () => {
    setupMock("none");
    const handlers = createDeployToolHandlers();
    const result = await handlers.get_terraform_outputs({ working_dir: testDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Neither 'tofu' nor 'terraform'");
    }
  });
});

// ---------------------------------------------------------------------------
// check_azure_resource
// ---------------------------------------------------------------------------

describe("check_azure_resource", () => {
  const succeededResource = JSON.stringify({
    id: "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa1",
    name: "sa1",
    properties: { provisioningState: "Succeeded" },
  });

  it("succeeds with resource_id path", async () => {
    setupMock("tofu", { "az resource show": succeededResource });
    const handlers = createDeployToolHandlers();
    const result = await handlers.check_azure_resource({
      resource_id: "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("Provisioning state: Succeeded");
    }
  });

  it("succeeds with resource_group + resource_type + resource_name", async () => {
    setupMock("tofu", { "az resource show": succeededResource });
    const handlers = createDeployToolHandlers();
    const result = await handlers.check_azure_resource({
      resource_group: "rg",
      resource_type: "Microsoft.Storage/storageAccounts",
      resource_name: "sa1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("Provisioning state: Succeeded");
    }
  });

  it("returns error when neither resource_id nor triplet is provided", async () => {
    setupMock("tofu");
    const handlers = createDeployToolHandlers();
    const result = await handlers.check_azure_resource({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Provide either resource_id");
    }
  });

  it("calls onTestResult with passed=true when provisioningState is 'Succeeded'", async () => {
    setupMock("tofu", { "az resource show": succeededResource });
    const onTestResult = vi.fn();
    const handlers = createDeployToolHandlers({ onTestResult });
    await handlers.check_azure_resource({
      resource_id: "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa1",
    });
    expect(onTestResult).toHaveBeenCalledWith(
      "existence:sa1",
      true,
      "Resource exists. Provisioning state: Succeeded",
    );
  });

  it("calls onTestResult with passed=false when provisioningState is not 'Succeeded'", async () => {
    const creatingResource = JSON.stringify({
      properties: { provisioningState: "Creating" },
    });
    setupMock("tofu", { "az resource show": creatingResource });
    const onTestResult = vi.fn();
    const handlers = createDeployToolHandlers({ onTestResult });
    await handlers.check_azure_resource({
      resource_id: "/subscriptions/abc/storageAccounts/sa1",
    });
    expect(onTestResult).toHaveBeenCalledWith(
      "existence:sa1",
      false,
      "Resource exists. Provisioning state: Creating",
    );
  });

  it("calls onTestResult with passed=false on CLI error", async () => {
    mockExecSync.mockImplementation(((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr === "which tofu") return "/usr/local/bin/tofu";
      if (cmdStr === "which terraform") return "/usr/local/bin/terraform";
      if (cmdStr.includes("az resource show")) {
        throw Object.assign(new Error("not found"), {
          stderr: "ResourceNotFound",
          status: 3,
        });
      }
      throw new Error(`Unexpected: ${cmdStr}`);
    }) as typeof execSync);

    const onTestResult = vi.fn();
    const handlers = createDeployToolHandlers({ onTestResult });
    await handlers.check_azure_resource({
      resource_id: "/subscriptions/abc/storageAccounts/sa1",
    });
    expect(onTestResult).toHaveBeenCalledWith(
      "existence:sa1",
      false,
      expect.stringContaining("ResourceNotFound"),
    );
  });

  it("calls onDeployProgress with 'testing' phase", async () => {
    setupMock("tofu", { "az resource show": succeededResource });
    const onDeployProgress = vi.fn();
    const handlers = createDeployToolHandlers({ onDeployProgress });
    await handlers.check_azure_resource({
      resource_id: "/subscriptions/abc/storageAccounts/sa1",
    });
    expect(onDeployProgress).toHaveBeenCalledWith(
      "testing",
      expect.stringContaining("Checking resource"),
    );
  });

  it("extracts testName from last segment of resource_id", async () => {
    setupMock("tofu", { "az resource show": succeededResource });
    const onTestResult = vi.fn();
    const handlers = createDeployToolHandlers({ onTestResult });
    await handlers.check_azure_resource({
      resource_id: "/subscriptions/abc/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/myStorage",
    });
    expect(onTestResult).toHaveBeenCalledWith(
      "existence:myStorage",
      true,
      expect.any(String),
    );
  });

  it("handles provisioningState missing (defaults to 'Unknown')", async () => {
    const noStateResource = JSON.stringify({
      properties: { someOtherProp: true },
    });
    setupMock("tofu", { "az resource show": noStateResource });
    const handlers = createDeployToolHandlers();
    const result = await handlers.check_azure_resource({
      resource_id: "/subscriptions/abc/sa1",
    });
    // provisioningState is not "Succeeded" so it should be false
    if (result.ok) {
      expect(result.data).toContain("Unknown");
    }
  });
});

// ---------------------------------------------------------------------------
// run_connectivity_test
// ---------------------------------------------------------------------------

describe("run_connectivity_test", () => {
  // --- HTTP mode ---
  describe("http", () => {
    it("returns PASS when status matches expected", async () => {
      setupMock("tofu", { curl: "200" });
      const handlers = createDeployToolHandlers();
      const result = await handlers.run_connectivity_test({
        test_type: "http",
        target: "https://example.com",
        expected_status: 200,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toContain("PASS");
      }
    });

    it("returns FAIL when status does not match", async () => {
      setupMock("tofu", { curl: "404" });
      const handlers = createDeployToolHandlers();
      const result = await handlers.run_connectivity_test({
        test_type: "http",
        target: "https://example.com",
        expected_status: 200,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("FAIL");
      }
    });

    it("defaults expected_status to 200", async () => {
      setupMock("tofu", { curl: "200" });
      const handlers = createDeployToolHandlers();
      const result = await handlers.run_connectivity_test({
        test_type: "http",
        target: "https://example.com",
        // no expected_status
      });
      expect(result.ok).toBe(true);
    });

    it("calls onTestResult with correct test name", async () => {
      setupMock("tofu", { curl: "200" });
      const onTestResult = vi.fn();
      const handlers = createDeployToolHandlers({ onTestResult });
      await handlers.run_connectivity_test({
        test_type: "http",
        target: "https://example.com",
      });
      expect(onTestResult).toHaveBeenCalledWith(
        "connectivity:http:https://example.com",
        true,
        expect.stringContaining("HTTP 200"),
      );
    });
  });

  // --- DNS mode ---
  describe("dns", () => {
    it("returns ok with PASS when dig returns output", async () => {
      setupMock("tofu", { dig: "93.184.216.34" });
      const handlers = createDeployToolHandlers();
      const result = await handlers.run_connectivity_test({
        test_type: "dns",
        target: "example.com",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toContain("PASS");
      }
    });

    it("returns ok with FAIL text when dig returns empty", async () => {
      setupMock("tofu", { dig: "" });
      const handlers = createDeployToolHandlers();
      const result = await handlers.run_connectivity_test({
        test_type: "dns",
        target: "nonexistent.example.com",
      });
      // DNS always returns ok() but includes PASS/FAIL text
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toContain("FAIL");
      }
    });

    it("calls onTestResult with passed=false when resolution is empty", async () => {
      setupMock("tofu", { dig: "" });
      const onTestResult = vi.fn();
      const handlers = createDeployToolHandlers({ onTestResult });
      await handlers.run_connectivity_test({
        test_type: "dns",
        target: "nonexistent.example.com",
      });
      expect(onTestResult).toHaveBeenCalledWith(
        "connectivity:dns:nonexistent.example.com",
        false,
        expect.stringContaining("DNS resolution failed"),
      );
    });
  });

  // --- TCP mode ---
  describe("tcp", () => {
    it("returns PASS when nc succeeds", async () => {
      setupMock("tofu", { "nc -z": "" });
      const handlers = createDeployToolHandlers();
      const result = await handlers.run_connectivity_test({
        test_type: "tcp",
        target: "example.com:443",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toContain("PASS");
      }
    });

    it("returns FAIL when nc throws", async () => {
      mockExecSync.mockImplementation(((cmd: string) => {
        const cmdStr = String(cmd);
        if (cmdStr === "which tofu") return "/usr/local/bin/tofu";
        if (cmdStr === "which terraform") return "/usr/local/bin/terraform";
        if (cmdStr.includes("nc -z")) {
          throw new Error("Connection refused");
        }
        throw new Error(`Unexpected: ${cmdStr}`);
      }) as typeof execSync);

      const handlers = createDeployToolHandlers();
      const result = await handlers.run_connectivity_test({
        test_type: "tcp",
        target: "example.com:443",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("FAIL");
      }
    });

    it("splits target on ':' for host and port", async () => {
      setupMock("tofu", { "nc -z": "" });
      const handlers = createDeployToolHandlers();
      await handlers.run_connectivity_test({
        test_type: "tcp",
        target: "myhost:8080",
      });

      const ncCall = mockExecSync.mock.calls.find(
        ([cmd]) => String(cmd).includes("nc -z"),
      );
      expect(ncCall).toBeDefined();
      const cmdStr = String(ncCall![0]);
      expect(cmdStr).toContain('"myhost"');
      expect(cmdStr).toContain("8080");
    });
  });

  // --- Shared ---
  it("returns error for empty target", async () => {
    setupMock("tofu");
    const handlers = createDeployToolHandlers();
    const result = await handlers.run_connectivity_test({
      test_type: "http",
      target: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("'target' is required");
    }
  });

  it("returns error for unknown test_type", async () => {
    setupMock("tofu");
    const handlers = createDeployToolHandlers();
    const result = await handlers.run_connectivity_test({
      test_type: "udp",
      target: "example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Unknown test_type");
    }
  });
});

// ---------------------------------------------------------------------------
// check_resource_config
// ---------------------------------------------------------------------------

describe("check_resource_config", () => {
  const mockResource = JSON.stringify({
    id: "/subscriptions/abc/storageAccounts/sa1",
    properties: {
      supportsHttpsTrafficOnly: true,
      minimumTlsVersion: "TLS1_2",
    },
    sku: { name: "Standard_LRS", tier: "Standard" },
  });

  it("returns PASS when all properties match", async () => {
    setupMock("tofu", { "az resource show": mockResource });
    const handlers = createDeployToolHandlers();
    const result = await handlers.check_resource_config({
      resource_id: "/subscriptions/abc/storageAccounts/sa1",
      expected_properties: JSON.stringify({
        "properties.supportsHttpsTrafficOnly": true,
        "sku.name": "Standard_LRS",
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("PASS");
    }
  });

  it("returns FAIL when a property does not match", async () => {
    setupMock("tofu", { "az resource show": mockResource });
    const handlers = createDeployToolHandlers();
    const result = await handlers.check_resource_config({
      resource_id: "/subscriptions/abc/storageAccounts/sa1",
      expected_properties: JSON.stringify({
        "sku.name": "Premium_LRS",
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("FAIL");
      expect(result.error).toContain("Premium_LRS");
    }
  });

  it("calls onTestResult per property with correct path", async () => {
    setupMock("tofu", { "az resource show": mockResource });
    const onTestResult = vi.fn();
    const handlers = createDeployToolHandlers({ onTestResult });
    await handlers.check_resource_config({
      resource_id: "/subscriptions/abc/storageAccounts/sa1",
      expected_properties: JSON.stringify({
        "properties.supportsHttpsTrafficOnly": true,
        "sku.name": "Standard_LRS",
      }),
    });
    expect(onTestResult).toHaveBeenCalledTimes(2);
    expect(onTestResult).toHaveBeenCalledWith(
      "config:sa1:properties.supportsHttpsTrafficOnly",
      true,
      expect.stringContaining("matches"),
    );
    expect(onTestResult).toHaveBeenCalledWith(
      "config:sa1:sku.name",
      true,
      expect.stringContaining("matches"),
    );
  });

  it("walks nested dot-notation paths correctly", async () => {
    const deepResource = JSON.stringify({
      properties: {
        network: {
          settings: {
            enabled: true,
          },
        },
      },
    });
    setupMock("tofu", { "az resource show": deepResource });
    const onTestResult = vi.fn();
    const handlers = createDeployToolHandlers({ onTestResult });
    await handlers.check_resource_config({
      resource_id: "/subscriptions/abc/sa1",
      expected_properties: JSON.stringify({
        "properties.network.settings.enabled": true,
      }),
    });
    expect(onTestResult).toHaveBeenCalledWith(
      "config:sa1:properties.network.settings.enabled",
      true,
      expect.stringContaining("matches"),
    );
  });

  it("returns FAIL for missing nested paths", async () => {
    setupMock("tofu", { "az resource show": mockResource });
    const handlers = createDeployToolHandlers();
    const result = await handlers.check_resource_config({
      resource_id: "/subscriptions/abc/storageAccounts/sa1",
      expected_properties: JSON.stringify({
        "properties.nonexistent.deep.path": "value",
      }),
    });
    expect(result.ok).toBe(false);
  });

  it("returns error when resource_id is empty", async () => {
    setupMock("tofu");
    const handlers = createDeployToolHandlers();
    const result = await handlers.check_resource_config({
      resource_id: "",
      expected_properties: "{}",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("'resource_id' is required");
    }
  });

  it("returns error when expected_properties is invalid JSON", async () => {
    setupMock("tofu");
    const handlers = createDeployToolHandlers();
    const result = await handlers.check_resource_config({
      resource_id: "/subscriptions/abc/sa1",
      expected_properties: "not json",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("'expected_properties' must be valid JSON");
    }
  });

  it("returns error on az resource show failure", async () => {
    mockExecSync.mockImplementation(((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr === "which tofu") return "/usr/local/bin/tofu";
      if (cmdStr === "which terraform") return "/usr/local/bin/terraform";
      if (cmdStr.includes("az resource show")) {
        throw new Error("Failed to fetch");
      }
      throw new Error(`Unexpected: ${cmdStr}`);
    }) as typeof execSync);

    const onTestResult = vi.fn();
    const handlers = createDeployToolHandlers({ onTestResult });
    const result = await handlers.check_resource_config({
      resource_id: "/subscriptions/abc/sa1",
      expected_properties: JSON.stringify({ "sku.name": "Standard_LRS" }),
    });
    expect(result.ok).toBe(false);
    expect(onTestResult).toHaveBeenCalledWith(
      "config:sa1",
      false,
      expect.stringContaining("Failed"),
    );
  });

  it("calls onDeployProgress with 'testing' phase", async () => {
    setupMock("tofu", { "az resource show": mockResource });
    const onDeployProgress = vi.fn();
    const handlers = createDeployToolHandlers({ onDeployProgress });
    await handlers.check_resource_config({
      resource_id: "/subscriptions/abc/storageAccounts/sa1",
      expected_properties: JSON.stringify({ "sku.name": "Standard_LRS" }),
    });
    expect(onDeployProgress).toHaveBeenCalledWith(
      "testing",
      expect.stringContaining("Validating config"),
    );
  });
});

// ---------------------------------------------------------------------------
// terraform_destroy
// ---------------------------------------------------------------------------

describe("terraform_destroy", () => {
  it("returns destroy output on success", async () => {
    setupMock("tofu", { "tofu destroy": "Destroy complete! Resources: 3 destroyed." });
    const handlers = createDeployToolHandlers();
    const result = await handlers.terraform_destroy({ working_dir: testDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("Destroy complete!");
    }
  });

  it("returns error on failure", async () => {
    mockExecSync.mockImplementation(((cmd: string) => {
      const cmdStr = String(cmd);
      if (cmdStr === "which tofu") return "/usr/local/bin/tofu";
      if (cmdStr === "which terraform") return "/usr/local/bin/terraform";
      if (cmdStr.includes("tofu destroy")) {
        throw Object.assign(new Error("destroy failed"), {
          stdout: "Destroying...",
          stderr: "Error: resource still in use",
          status: 1,
        });
      }
      throw new Error(`Unexpected: ${cmdStr}`);
    }) as typeof execSync);

    const handlers = createDeployToolHandlers();
    const result = await handlers.terraform_destroy({ working_dir: testDir });
    expect(result.ok).toBe(false);
  });

  it("calls onDeployProgress with 'destroying' phase", async () => {
    setupMock("tofu", { "tofu destroy": "Destroy complete!" });
    const onDeployProgress = vi.fn();
    const handlers = createDeployToolHandlers({ onDeployProgress });
    await handlers.terraform_destroy({ working_dir: testDir });
    expect(onDeployProgress).toHaveBeenCalledWith(
      "destroying",
      "Running terraform destroy...",
    );
  });

  it("uses 300_000ms timeout", async () => {
    setupMock("tofu", { "tofu destroy": "Destroy complete!" });
    const handlers = createDeployToolHandlers();
    await handlers.terraform_destroy({ working_dir: testDir });

    const destroyCall = mockExecSync.mock.calls.find(
      ([cmd]) => String(cmd).includes("destroy"),
    );
    expect(destroyCall).toBeDefined();
    const opts = destroyCall![1] as Record<string, unknown>;
    expect(opts.timeout).toBe(300_000);
  });

  it("returns CLI-not-found error", async () => {
    setupMock("none");
    const handlers = createDeployToolHandlers();
    const result = await handlers.terraform_destroy({ working_dir: testDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Neither 'tofu' nor 'terraform'");
    }
  });
});

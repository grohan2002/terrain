import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createToolHandlers, type ToolHandlerCallbacks } from "@/lib/agent/tool-handlers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tool-test-"));
}

function createHandlers(
  callbacks?: ToolHandlerCallbacks,
  bicepFilesContext?: Record<string, string>,
) {
  return createToolHandlers({ ...callbacks, bicepFilesContext });
}

// ---------------------------------------------------------------------------
// parse_bicep
// ---------------------------------------------------------------------------

describe("parse_bicep", () => {
  it("returns section-annotated output for a valid Bicep file", async () => {
    const handlers = createHandlers();
    const content = [
      "param location string = 'eastus'",
      "",
      "var storageName = 'sa${uniqueString(resourceGroup().id)}'",
      "",
      "resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {",
      "  name: storageName",
      "  location: location",
      "}",
      "",
      "output storageId string = storageAccount.id",
    ].join("\n");

    const result = await handlers.parse_bicep({ content });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("--- PARAMETERS ---");
      expect(result.data).toContain("--- VARIABLES ---");
      expect(result.data).toContain("--- RESOURCES ---");
      expect(result.data).toContain("--- OUTPUTS ---");
      expect(result.data).toContain("param location");
      expect(result.data).toContain("resource storageAccount");
    }
  });

  it("returns error for empty content", async () => {
    const handlers = createHandlers();
    const result = await handlers.parse_bicep({ content: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Empty content");
    }
  });

  it("handles content with only parameters (no resources)", async () => {
    const handlers = createHandlers();
    const result = await handlers.parse_bicep({
      content: "param location string = 'eastus'\nparam name string",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("--- PARAMETERS ---");
      expect(result.data).not.toContain("--- RESOURCES ---");
    }
  });

  it("detects module sections", async () => {
    const handlers = createHandlers();
    const result = await handlers.parse_bicep({
      content: "module storage './modules/storage.bicep' = {\n  name: 'storage'\n}",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("--- MODULES ---");
    }
  });
});

// ---------------------------------------------------------------------------
// lookup_resource_mapping
// ---------------------------------------------------------------------------

describe("lookup_resource_mapping", () => {
  it("maps Microsoft.Storage/storageAccounts to azurerm_storage_account", async () => {
    const handlers = createHandlers();
    const result = await handlers.lookup_resource_mapping({
      bicep_resource_type: "Microsoft.Storage/storageAccounts",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("azurerm_storage_account");
      expect(result.data).toContain("Property decompositions");
      expect(result.data).toContain("account_tier");
      expect(result.data).toContain("account_replication_type");
    }
  });

  it("strips API version suffix", async () => {
    const handlers = createHandlers();
    const result = await handlers.lookup_resource_mapping({
      bicep_resource_type: "Microsoft.Storage/storageAccounts@2023-05-01",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("azurerm_storage_account");
    }
  });

  it("returns null-mapping message for merged resources", async () => {
    const handlers = createHandlers();
    const result = await handlers.lookup_resource_mapping({
      bicep_resource_type: "Microsoft.Web/sites/config",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("NONE");
      expect(result.data).toContain("merged into");
    }
  });

  it("returns fallback message for unmapped resources", async () => {
    const handlers = createHandlers();
    const result = await handlers.lookup_resource_mapping({
      bicep_resource_type: "Microsoft.SomeNew/fancyResource@2024-01-01",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("No mapping found");
      expect(result.data).toContain("AzureRM Terraform provider");
    }
  });

  it("adds OS-type routing notes for VMs", async () => {
    const handlers = createHandlers();
    const result = await handlers.lookup_resource_mapping({
      bicep_resource_type: "Microsoft.Compute/virtualMachines",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("azurerm_linux_virtual_machine");
      expect(result.data).toContain("IMPORTANT");
      expect(result.data).toContain("osProfile");
      expect(result.data).toContain("azurerm_windows_virtual_machine");
    }
  });

  it("adds OS-type routing notes for VMSS", async () => {
    const handlers = createHandlers();
    const result = await handlers.lookup_resource_mapping({
      bicep_resource_type: "Microsoft.Compute/virtualMachineScaleSets",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("azurerm_linux_virtual_machine_scale_set");
      expect(result.data).toContain("azurerm_windows_virtual_machine_scale_set");
    }
  });

  it("maps all major resource types correctly", async () => {
    const handlers = createHandlers();
    const testCases: Array<[string, string]> = [
      ["Microsoft.Network/virtualNetworks", "azurerm_virtual_network"],
      ["Microsoft.ContainerService/managedClusters", "azurerm_kubernetes_cluster"],
      ["Microsoft.KeyVault/vaults", "azurerm_key_vault"],
      ["Microsoft.Sql/servers", "azurerm_mssql_server"],
      ["Microsoft.Web/serverfarms", "azurerm_service_plan"],
      ["Microsoft.ContainerRegistry/registries", "azurerm_container_registry"],
      ["Microsoft.Insights/components", "azurerm_application_insights"],
      ["Microsoft.App/containerApps", "azurerm_container_app"],
      ["Microsoft.Resources/resourceGroups", "azurerm_resource_group"],
    ];

    for (const [bicep, tf] of testCases) {
      const result = await handlers.lookup_resource_mapping({
        bicep_resource_type: bicep,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toContain(tf);
      }
    }
  });

  it("includes property name overrides in output", async () => {
    const handlers = createHandlers();
    const result = await handlers.lookup_resource_mapping({
      bicep_resource_type: "Microsoft.Storage/storageAccounts",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("Common property name overrides");
      expect(result.data).toContain("storageAccountType");
    }
  });
});

// ---------------------------------------------------------------------------
// generate_terraform
// ---------------------------------------------------------------------------

describe("generate_terraform", () => {
  it("generates a resource block with label split", async () => {
    const handlers = createHandlers();
    const result = await handlers.generate_terraform({
      block_type: "resource",
      block_name: "azurerm_storage_account.main",
      hcl_body: 'name                     = "test"\nlocation                 = var.location',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('resource "azurerm_storage_account" "main"');
      expect(result.data).toContain('name                     = "test"');
    }
  });

  it("generates a variable block", async () => {
    const handlers = createHandlers();
    const result = await handlers.generate_terraform({
      block_type: "variable",
      block_name: "location",
      hcl_body: 'type        = string\ndefault     = "eastus"\ndescription = "Azure region"',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('variable "location"');
    }
  });

  it("generates a locals block without name label", async () => {
    const handlers = createHandlers();
    const result = await handlers.generate_terraform({
      block_type: "locals",
      block_name: "",
      hcl_body: "storage_name = \"sa${random_id.main.hex}\"",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatch("locals {");
    }
  });

  it("generates a terraform block", async () => {
    const handlers = createHandlers();
    const result = await handlers.generate_terraform({
      block_type: "terraform",
      block_name: "",
      hcl_body: 'required_providers {\n  azurerm = {\n    source  = "hashicorp/azurerm"\n    version = "~> 4.0"\n  }\n}',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatch("terraform {");
    }
  });

  it("generates data source blocks", async () => {
    const handlers = createHandlers();
    const result = await handlers.generate_terraform({
      block_type: "data",
      block_name: "azurerm_client_config.current",
      hcl_body: "",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain('data "azurerm_client_config" "current"');
    }
  });

  it("rejects invalid block types", async () => {
    const handlers = createHandlers();
    const result = await handlers.generate_terraform({
      block_type: "invalid_type",
      block_name: "test",
      hcl_body: "x = 1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid block_type");
    }
  });

  it("supports moved block type", async () => {
    const handlers = createHandlers();
    const result = await handlers.generate_terraform({
      block_type: "moved",
      block_name: "azurerm_storage_account.old",
      hcl_body: "to = azurerm_storage_account.new",
    });
    expect(result.ok).toBe(true);
  });

  it("supports import block type", async () => {
    const handlers = createHandlers();
    const result = await handlers.generate_terraform({
      block_type: "import",
      block_name: "azurerm_storage_account.main",
      hcl_body: 'id = "/subscriptions/.../storageAccounts/test"',
    });
    expect(result.ok).toBe(true);
  });

  it("supports check block type", async () => {
    const handlers = createHandlers();
    const result = await handlers.generate_terraform({
      block_type: "check",
      block_name: "health",
      hcl_body: 'data "http" "example" {\n  url = "https://example.com"\n}',
    });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// write_terraform_files
// ---------------------------------------------------------------------------

describe("write_terraform_files", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("writes flat .tf files", async () => {
    const files = {
      "main.tf": 'resource "azurerm_resource_group" "main" {\n  name     = "test-rg"\n  location = "eastus"\n}',
      "variables.tf": 'variable "location" {\n  type = string\n}',
    };
    const callbacks: ToolHandlerCallbacks = {};
    let emittedFiles: Record<string, string> | null = null;
    callbacks.onTerraformOutput = (f) => { emittedFiles = f; };

    const handlers = createHandlers(callbacks);
    const result = await handlers.write_terraform_files({
      output_dir: testDir,
      files: JSON.stringify(files),
    });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(testDir, "main.tf"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, "variables.tf"))).toBe(true);
    expect(emittedFiles).not.toBeNull();
    expect(emittedFiles!["main.tf"]).toContain("azurerm_resource_group");
  });

  it("creates nested module directories", async () => {
    const files = {
      "main.tf": 'module "storage" {\n  source = "./modules/storage"\n}',
      "modules/storage/main.tf": 'resource "azurerm_storage_account" "main" {}',
      "modules/storage/variables.tf": 'variable "name" {}',
    };
    const handlers = createHandlers();
    const result = await handlers.write_terraform_files({
      output_dir: testDir,
      files: JSON.stringify(files),
    });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(testDir, "modules/storage/main.tf"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, "modules/storage/variables.tf"))).toBe(true);
  });

  it("accepts .tfvars files", async () => {
    const files = {
      "main.tf": 'variable "name" {}',
      "terraform.tfvars": 'name = "test"',
    };
    const handlers = createHandlers();
    const result = await handlers.write_terraform_files({
      output_dir: testDir,
      files: JSON.stringify(files),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).not.toContain("Warning");
    }
  });

  it("accepts .hcl files", async () => {
    const files = {
      ".terraformrc": 'plugin_cache_dir = "$HOME/.terraform.d/plugin-cache"',
    };
    const handlers = createHandlers();
    const result = await handlers.write_terraform_files({
      output_dir: testDir,
      files: JSON.stringify(files),
    });

    // .terraformrc is not a valid extension, should warn
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("Warning");
    }
  });

  it("blocks path traversal with ../", async () => {
    const files = {
      "../../../etc/evil.tf": "# malicious content",
    };
    const handlers = createHandlers();
    const result = await handlers.write_terraform_files({
      output_dir: testDir,
      files: JSON.stringify(files),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Path traversal");
    }
    // File must NOT exist outside the output dir
    expect(fs.existsSync(path.resolve(testDir, "../../../etc/evil.tf"))).toBe(false);
  });

  it("rejects invalid JSON in files param", async () => {
    const handlers = createHandlers();
    const result = await handlers.write_terraform_files({
      output_dir: testDir,
      files: "not valid json",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid JSON");
    }
  });

  it("fires onTerraformOutput callback", async () => {
    let emittedFiles: Record<string, string> | null = null;
    const handlers = createHandlers({
      onTerraformOutput: (f) => { emittedFiles = f; },
    });
    await handlers.write_terraform_files({
      output_dir: testDir,
      files: JSON.stringify({ "main.tf": "# test" }),
    });
    expect(emittedFiles).toEqual({ "main.tf": "# test" });
  });
});

// ---------------------------------------------------------------------------
// read_bicep_file (path traversal protection)
// ---------------------------------------------------------------------------

describe("read_bicep_file", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("reads a .bicep file within the temp directory", async () => {
    const bicepPath = path.join(testDir, "test.bicep");
    fs.writeFileSync(bicepPath, "param location string = 'eastus'");

    const handlers = createHandlers();
    const result = await handlers.read_bicep_file({ file_path: bicepPath });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("param location");
    }
  });

  it("returns error for non-existent file", async () => {
    const handlers = createHandlers();
    const result = await handlers.read_bicep_file({
      file_path: path.join(testDir, "nonexistent.bicep"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
    }
  });

  it("warns when file extension is not .bicep", async () => {
    const txtPath = path.join(testDir, "config.json");
    fs.writeFileSync(txtPath, '{"key": "value"}');

    const handlers = createHandlers();
    const result = await handlers.read_bicep_file({ file_path: txtPath });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("Warning");
      expect(result.data).toContain(".json");
    }
  });
});

// ---------------------------------------------------------------------------
// read_bicep_file_content (multi-file in-memory mode)
// ---------------------------------------------------------------------------

describe("read_bicep_file_content", () => {
  it("reads from in-memory context", async () => {
    const context = {
      "main.bicep": "param location string",
      "modules/storage.bicep": "resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = {}",
    };
    const handlers = createHandlers({}, context);
    const result = await handlers.read_bicep_file_content({
      file_path: "modules/storage.bicep",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("Microsoft.Storage/storageAccounts");
    }
  });

  it("returns error for missing file path", async () => {
    const context = {
      "main.bicep": "param x string",
    };
    const handlers = createHandlers({}, context);
    const result = await handlers.read_bicep_file_content({
      file_path: "missing.bicep",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found in project");
      expect(result.error).toContain("main.bicep");
    }
  });

  it("is not available without bicepFilesContext", async () => {
    const handlers = createHandlers();
    expect(handlers.read_bicep_file_content).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validate_terraform JSON parsing
// ---------------------------------------------------------------------------

describe("validate_terraform", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("returns error for non-existent directory", async () => {
    const handlers = createHandlers();
    const result = await handlers.validate_terraform({
      working_dir: "/nonexistent/path/xyz123",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
    }
  });

  it("fires onValidation callback or reports CLI missing", async () => {
    // Create a minimal TF file that doesn't need provider download
    fs.writeFileSync(
      path.join(testDir, "main.tf"),
      '# Empty config\n',
    );

    let validationPassed: boolean | null = null;
    let validationOutput: string | null = null;
    const handlers = createHandlers({
      onValidation: (passed, output) => {
        validationPassed = passed;
        validationOutput = output;
      },
    });

    const result = await handlers.validate_terraform({ working_dir: testDir });
    // If tofu/terraform is not installed, result is an error about CLI not found
    if (!result.ok && result.error.includes("not found in PATH")) {
      // Expected when CLI is not installed — test passes
      expect(result.error).toContain("tofu");
    } else {
      // CLI is installed — callback should fire
      expect(validationPassed).not.toBeNull();
      expect(validationOutput).not.toBeNull();
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// format_terraform
// ---------------------------------------------------------------------------

describe("format_terraform", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("returns error for non-existent directory", async () => {
    const handlers = createHandlers();
    const result = await handlers.format_terraform({
      working_dir: "/nonexistent/path/xyz123",
    });
    expect(result.ok).toBe(false);
  });

  it("re-emits formatted files via onTerraformOutput callback", async () => {
    // Create a badly-formatted TF file
    fs.writeFileSync(
      path.join(testDir, "main.tf"),
      'resource "azurerm_resource_group" "main" {\nname="test"\nlocation="eastus"\n}\n',
    );

    let emittedFiles: Record<string, string> | null = null;
    const handlers = createHandlers({
      onTerraformOutput: (f) => { emittedFiles = f; },
    });

    const result = await handlers.format_terraform({ working_dir: testDir });
    // If tofu/terraform is installed, it will format and re-emit
    if (result.ok) {
      expect(emittedFiles).not.toBeNull();
      if (emittedFiles) {
        expect(emittedFiles["main.tf"]).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// list_bicep_files
// ---------------------------------------------------------------------------

describe("list_bicep_files", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("lists .bicep files in a directory", async () => {
    fs.writeFileSync(path.join(testDir, "main.bicep"), "param x string");
    fs.writeFileSync(path.join(testDir, "other.txt"), "not a bicep file");

    const handlers = createHandlers();
    const result = await handlers.list_bicep_files({ directory: testDir });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("main.bicep");
      expect(result.data).not.toContain("other.txt");
      expect(result.data).toContain("Total: 1");
    }
  });

  it("lists recursively when requested", async () => {
    const subDir = path.join(testDir, "modules");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, "main.bicep"), "param x string");
    fs.writeFileSync(path.join(subDir, "storage.bicep"), "resource sa ...");

    const handlers = createHandlers();
    const result = await handlers.list_bicep_files({
      directory: testDir,
      recursive: "true",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("main.bicep");
      expect(result.data).toContain("storage.bicep");
      expect(result.data).toContain("Total: 2");
    }
  });

  it("returns message when no .bicep files found", async () => {
    const handlers = createHandlers();
    const result = await handlers.list_bicep_files({ directory: testDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("No .bicep files found");
    }
  });
});

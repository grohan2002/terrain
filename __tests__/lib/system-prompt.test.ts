import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_MULTI_FILE } from "@/lib/agent/system-prompt";

// ---------------------------------------------------------------------------
// SYSTEM_PROMPT — core conversion prompt coverage
// ---------------------------------------------------------------------------

describe("SYSTEM_PROMPT", () => {
  it("lists all required tools", () => {
    expect(SYSTEM_PROMPT).toContain("read_bicep_file");
    expect(SYSTEM_PROMPT).toContain("parse_bicep");
    expect(SYSTEM_PROMPT).toContain("lookup_resource_mapping");
    expect(SYSTEM_PROMPT).toContain("generate_terraform");
    expect(SYSTEM_PROMPT).toContain("write_terraform_files");
    expect(SYSTEM_PROMPT).toContain("validate_terraform");
    expect(SYSTEM_PROMPT).toContain("format_terraform");
    expect(SYSTEM_PROMPT).toContain("list_bicep_files");
  });

  it("describes the 10-step conversion workflow", () => {
    expect(SYSTEM_PROMPT).toContain("1. PARSE");
    expect(SYSTEM_PROMPT).toContain("2. ANALYZE");
    expect(SYSTEM_PROMPT).toContain("3. MAP");
    expect(SYSTEM_PROMPT).toContain("4. CONVERT");
    expect(SYSTEM_PROMPT).toContain("5. GENERATE");
    expect(SYSTEM_PROMPT).toContain("6. ORGANIZE");
    expect(SYSTEM_PROMPT).toContain("7. WRITE");
    expect(SYSTEM_PROMPT).toContain("8. FORMAT");
    expect(SYSTEM_PROMPT).toContain("9. VALIDATE");
    expect(SYSTEM_PROMPT).toContain("10. If validation fails");
  });

  it("covers Bicep decorator conversions", () => {
    expect(SYSTEM_PROMPT).toContain("@description");
    expect(SYSTEM_PROMPT).toContain("@allowed");
    expect(SYSTEM_PROMPT).toContain("@secure");
    expect(SYSTEM_PROMPT).toContain("@minLength");
    expect(SYSTEM_PROMPT).toContain("@minValue");
    expect(SYSTEM_PROMPT).toContain("@batchSize");
    expect(SYSTEM_PROMPT).toContain("@export");
    expect(SYSTEM_PROMPT).toContain("@metadata");
  });

  it("covers user-defined types and functions", () => {
    expect(SYSTEM_PROMPT).toContain("User-defined types");
    expect(SYSTEM_PROMPT).toContain("User-defined functions");
    expect(SYSTEM_PROMPT).toContain("union types");
  });

  it("covers lambda expressions", () => {
    expect(SYSTEM_PROMPT).toContain("Lambda expressions");
    expect(SYSTEM_PROMPT).toContain("map(arr");
    expect(SYSTEM_PROMPT).toContain("filter(arr");
    expect(SYSTEM_PROMPT).toContain("sort(arr");
    expect(SYSTEM_PROMPT).toContain("reduce(arr");
    expect(SYSTEM_PROMPT).toContain("toObject(arr");
  });

  it("covers the existing keyword", () => {
    expect(SYSTEM_PROMPT).toContain("existing keyword");
    expect(SYSTEM_PROMPT).toContain("data source");
  });

  it("covers nullable types", () => {
    expect(SYSTEM_PROMPT).toContain("Nullable types");
    expect(SYSTEM_PROMPT).toContain("default = null");
  });

  it("covers scope functions", () => {
    expect(SYSTEM_PROMPT).toContain("resourceGroup().location");
    expect(SYSTEM_PROMPT).toContain("subscription().subscriptionId");
    expect(SYSTEM_PROMPT).toContain("tenant().tenantId");
    expect(SYSTEM_PROMPT).toContain("managementGroup().id");
    expect(SYSTEM_PROMPT).toContain("targetScope");
  });

  it("covers parent property", () => {
    expect(SYSTEM_PROMPT).toContain("Resource parent property");
    expect(SYSTEM_PROMPT).toContain("parent: parentResource");
  });

  it("covers extension resources (scope property)", () => {
    expect(SYSTEM_PROMPT).toContain("Extension resources");
    expect(SYSTEM_PROMPT).toContain("scope: storageAccount");
    expect(SYSTEM_PROMPT).toContain("azurerm_management_lock");
    expect(SYSTEM_PROMPT).toContain("azurerm_monitor_diagnostic_setting");
  });

  it("covers module scope (cross-resource-group)", () => {
    expect(SYSTEM_PROMPT).toContain("Module scope");
    expect(SYSTEM_PROMPT).toContain("resourceGroup('other-rg')");
    expect(SYSTEM_PROMPT).toContain("provider alias");
  });

  it("covers file-loading functions", () => {
    expect(SYSTEM_PROMPT).toContain("loadTextContent");
    expect(SYSTEM_PROMPT).toContain("loadFileAsBase64");
    expect(SYSTEM_PROMPT).toContain("loadJsonContent");
    expect(SYSTEM_PROMPT).toContain("loadYamlContent");
    expect(SYSTEM_PROMPT).toContain("filebase64");
    expect(SYSTEM_PROMPT).toContain("yamldecode");
  });

  it("covers null-forgiving and spread operators", () => {
    expect(SYSTEM_PROMPT).toContain("null-forgiving");
    expect(SYSTEM_PROMPT).toContain("spread");
    expect(SYSTEM_PROMPT).toContain("merge(obj");
  });

  it("covers conditions and loops", () => {
    expect(SYSTEM_PROMPT).toContain("### Conditions");
    expect(SYSTEM_PROMPT).toContain("count = var.condition ? 1 : 0");
    expect(SYSTEM_PROMPT).toContain("### Loops");
    expect(SYSTEM_PROMPT).toContain("for_each = toset");
    expect(SYSTEM_PROMPT).toContain("flatten()");
  });

  it("covers dynamic blocks (HIGH priority fix)", () => {
    expect(SYSTEM_PROMPT).toContain("### Dynamic blocks");
    expect(SYSTEM_PROMPT).toContain("INLINE ARRAY PROPERTY");
    expect(SYSTEM_PROMPT).toContain("dynamic \"security_rule\"");
    expect(SYSTEM_PROMPT).toContain("dynamic \"frontend_ip_configuration\"");
    expect(SYSTEM_PROMPT).toContain("ALWAYS use dynamic blocks");
    expect(SYSTEM_PROMPT).toContain("iterator name");
  });

  it("covers lifecycle blocks (MEDIUM priority fix)", () => {
    expect(SYSTEM_PROMPT).toContain("### Lifecycle blocks");
    expect(SYSTEM_PROMPT).toContain("prevent_destroy");
    expect(SYSTEM_PROMPT).toContain("ignore_changes");
    expect(SYSTEM_PROMPT).toContain("create_before_destroy");
    expect(SYSTEM_PROMPT).toContain("Recommended for production");
  });

  it("covers backend configuration (MEDIUM priority fix)", () => {
    expect(SYSTEM_PROMPT).toContain("### Backend configuration");
    expect(SYSTEM_PROMPT).toContain('backend "azurerm"');
    expect(SYSTEM_PROMPT).toContain("remote state");
    expect(SYSTEM_PROMPT).toContain("state locking");
  });

  it("covers azapi provider fallback", () => {
    expect(SYSTEM_PROMPT).toContain("azapi provider fallback");
    expect(SYSTEM_PROMPT).toContain("azapi_resource");
    expect(SYSTEM_PROMPT).toContain('source = "Azure/azapi"');
    expect(SYSTEM_PROMPT).toContain("last resort");
  });

  it("covers SKU decomposition", () => {
    expect(SYSTEM_PROMPT).toContain("SKU decomposition");
    expect(SYSTEM_PROMPT).toContain("Standard_LRS");
    expect(SYSTEM_PROMPT).toContain("account_tier");
    expect(SYSTEM_PROMPT).toContain("account_replication_type");
  });

  it("covers .bicepparam file conversion", () => {
    expect(SYSTEM_PROMPT).toContain(".bicepparam file conversion");
    expect(SYSTEM_PROMPT).toContain("terraform.tfvars");
  });

  it("covers Microsoft.Web/sites mapping rules", () => {
    expect(SYSTEM_PROMPT).toContain("Microsoft.Web/sites mapping rules");
    expect(SYSTEM_PROMPT).toContain("azurerm_linux_web_app");
    expect(SYSTEM_PROMPT).toContain("azurerm_windows_web_app");
    expect(SYSTEM_PROMPT).toContain("azurerm_linux_function_app");
    expect(SYSTEM_PROMPT).toContain("azurerm_windows_function_app");
    expect(SYSTEM_PROMPT).toContain("kind");
  });

  it("covers registry module references", () => {
    expect(SYSTEM_PROMPT).toContain("Registry module references");
    expect(SYSTEM_PROMPT).toContain("br:mcr.microsoft.com");
    expect(SYSTEM_PROMPT).toContain("ts:");
    expect(SYSTEM_PROMPT).toContain("Template spec");
  });

  it("covers security best practices", () => {
    expect(SYSTEM_PROMPT).toContain("Security best practices");
    expect(SYSTEM_PROMPT).toContain("NEVER hardcode secrets");
    expect(SYSTEM_PROMPT).toContain("sensitive = true");
    expect(SYSTEM_PROMPT).toContain("azurerm_key_vault_secret");
    expect(SYSTEM_PROMPT).toContain("TF_VAR_");
  });

  it("covers error recovery", () => {
    expect(SYSTEM_PROMPT).toContain("Error recovery");
    expect(SYSTEM_PROMPT).toContain("Missing required attributes");
    expect(SYSTEM_PROMPT).toContain("Invalid attribute names");
    expect(SYSTEM_PROMPT).toContain("Repeat up to 3 times");
  });

  it("covers provider configuration", () => {
    expect(SYSTEM_PROMPT).toContain("Provider configuration");
    expect(SYSTEM_PROMPT).toContain("features {}");
    expect(SYSTEM_PROMPT).toContain("required_providers");
    expect(SYSTEM_PROMPT).toContain("~> 4.0");
  });

  it("emphasizes batching for efficiency", () => {
    expect(SYSTEM_PROMPT).toContain("Efficiency — CRITICAL");
    expect(SYSTEM_PROMPT).toContain("Batch tool calls aggressively");
    expect(SYSTEM_PROMPT).toContain("5-8 tool rounds");
  });
});

// ---------------------------------------------------------------------------
// SYSTEM_PROMPT_MULTI_FILE — multi-file specific guidance
// ---------------------------------------------------------------------------

describe("SYSTEM_PROMPT_MULTI_FILE", () => {
  it("extends the base SYSTEM_PROMPT", () => {
    // The multi-file prompt should contain everything from the base prompt
    expect(SYSTEM_PROMPT_MULTI_FILE).toContain("Infrastructure-as-Code");
    expect(SYSTEM_PROMPT_MULTI_FILE).toContain("parse_bicep");
  });

  it("includes multi-file workflow instructions", () => {
    expect(SYSTEM_PROMPT_MULTI_FILE).toContain("Multi-file project conversion");
    expect(SYSTEM_PROMPT_MULTI_FILE).toContain("Do NOT call read_bicep_file");
    expect(SYSTEM_PROMPT_MULTI_FILE).toContain("read_bicep_file_content");
    expect(SYSTEM_PROMPT_MULTI_FILE).toContain("dependency graph");
  });

  it("describes module directory structure", () => {
    expect(SYSTEM_PROMPT_MULTI_FILE).toContain("modules/<module_name>/");
    expect(SYSTEM_PROMPT_MULTI_FILE).toContain("storage/");
    expect(SYSTEM_PROMPT_MULTI_FILE).toContain("network/");
    expect(SYSTEM_PROMPT_MULTI_FILE).toContain("variables.tf");
    expect(SYSTEM_PROMPT_MULTI_FILE).toContain("outputs.tf");
  });

  it("describes .bicepparam handling", () => {
    expect(SYSTEM_PROMPT_MULTI_FILE).toContain("using '<path>'");
    expect(SYSTEM_PROMPT_MULTI_FILE).toContain("terraform.tfvars");
  });

  it("sets efficiency targets for multi-file", () => {
    expect(SYSTEM_PROMPT_MULTI_FILE).toContain("8-12 tool rounds");
    expect(SYSTEM_PROMPT_MULTI_FILE).toContain("batch tool calls");
  });
});

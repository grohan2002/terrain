import { describe, it, expect } from "vitest";
import { DEPLOY_SYSTEM_PROMPT } from "@/lib/deploy-agent/system-prompt";

// ---------------------------------------------------------------------------
// DEPLOY_SYSTEM_PROMPT — deployment testing agent prompt coverage
// ---------------------------------------------------------------------------

describe("DEPLOY_SYSTEM_PROMPT", () => {
  it("lists all 7 deploy tools", () => {
    expect(DEPLOY_SYSTEM_PROMPT).toContain("terraform_plan");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("terraform_apply");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("get_terraform_outputs");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("check_azure_resource");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("run_connectivity_test");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("check_resource_config");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("terraform_destroy");
  });

  it("describes the 8-step deployment and testing workflow", () => {
    expect(DEPLOY_SYSTEM_PROMPT).toContain("1. PLAN");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("2. APPLY");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("3. OUTPUTS");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("4. TEST - Resource Existence");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("5. TEST - Connectivity");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("6. TEST - Configuration");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("7. REPORT");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("8. STOP");
  });

  it("contains the NEVER destroy rule", () => {
    expect(DEPLOY_SYSTEM_PROMPT).toContain("NEVER call terraform_destroy");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("explicitly instruct");
  });

  it("contains batching guidance", () => {
    expect(DEPLOY_SYSTEM_PROMPT).toContain("Batch tool calls");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("ONE response");
  });

  it("contains efficiency guidance with tool round targets", () => {
    expect(DEPLOY_SYSTEM_PROMPT).toContain("Efficiency");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("CRITICAL");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("8-12 tool rounds");
  });

  it("mentions Terraform/OpenTofu specialization", () => {
    expect(DEPLOY_SYSTEM_PROMPT).toContain("Terraform/OpenTofu");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("Azure");
  });

  it("mentions provisioningState check", () => {
    expect(DEPLOY_SYSTEM_PROMPT).toContain("Succeeded");
  });

  it("covers connectivity test types", () => {
    expect(DEPLOY_SYSTEM_PROMPT).toContain("HTTP");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("DNS");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("TCP");
  });

  it("covers configuration validation topics", () => {
    expect(DEPLOY_SYSTEM_PROMPT).toContain("SKU");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("HTTPS");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("TLS");
  });

  it("instructs to use -no-color for clean output", () => {
    expect(DEPLOY_SYSTEM_PROMPT).toContain("-no-color");
  });

  it("instructs to report errors and stop on apply failure", () => {
    expect(DEPLOY_SYSTEM_PROMPT).toContain("apply fails");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("STOP");
  });

  it("mentions using original Bicep content for config validation", () => {
    expect(DEPLOY_SYSTEM_PROMPT).toContain("original Bicep");
  });

  it("covers resource types for connectivity testing", () => {
    expect(DEPLOY_SYSTEM_PROMPT).toContain("Storage accounts");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("Web apps");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("Key Vault");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("Databases");
  });

  it("has limited tool rounds mentioned", () => {
    expect(DEPLOY_SYSTEM_PROMPT).toContain("LIMITED");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("Minimize rounds");
  });

  it("specifies the working directory and resource group are provided", () => {
    expect(DEPLOY_SYSTEM_PROMPT).toContain("working directory");
    expect(DEPLOY_SYSTEM_PROMPT).toContain("resource group");
  });
});

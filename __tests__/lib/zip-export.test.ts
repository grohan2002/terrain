import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { createTerraformZip } from "@/lib/zip-export";
import type { TerraformFiles } from "@/lib/types";

describe("createTerraformZip", () => {
  it("creates a zip with flat files", async () => {
    const files: TerraformFiles = {
      "main.tf": 'resource "azurerm_resource_group" "main" {}',
      "variables.tf": 'variable "location" { type = string }',
    };

    const blob = await createTerraformZip(files);
    expect(blob.size).toBeGreaterThan(0);

    // Verify zip contents
    const zip = await JSZip.loadAsync(blob);
    const mainTf = await zip.file("terraform/main.tf")?.async("string");
    const variablesTf = await zip.file("terraform/variables.tf")?.async("string");
    expect(mainTf).toContain("azurerm_resource_group");
    expect(variablesTf).toContain("variable");
  });

  it("preserves nested module directory structure", async () => {
    const files: TerraformFiles = {
      "main.tf": 'module "storage" { source = "./modules/storage" }',
      "modules/storage/main.tf": 'resource "azurerm_storage_account" "main" {}',
      "modules/storage/variables.tf": 'variable "name" {}',
      "modules/network/main.tf": 'resource "azurerm_virtual_network" "main" {}',
    };

    const blob = await createTerraformZip(files);
    const zip = await JSZip.loadAsync(blob);

    expect(zip.file("terraform/main.tf")).not.toBeNull();
    expect(zip.file("terraform/modules/storage/main.tf")).not.toBeNull();
    expect(zip.file("terraform/modules/storage/variables.tf")).not.toBeNull();
    expect(zip.file("terraform/modules/network/main.tf")).not.toBeNull();

    const storageTf = await zip.file("terraform/modules/storage/main.tf")?.async("string");
    expect(storageTf).toContain("azurerm_storage_account");
  });

  it("uses custom root directory name", async () => {
    const files: TerraformFiles = {
      "main.tf": "# root",
    };

    const blob = await createTerraformZip(files, "my-infra");
    const zip = await JSZip.loadAsync(blob);
    expect(zip.file("my-infra/main.tf")).not.toBeNull();
  });

  it("handles empty file content", async () => {
    const files: TerraformFiles = {
      "empty.tf": "",
    };

    const blob = await createTerraformZip(files);
    const zip = await JSZip.loadAsync(blob);
    const content = await zip.file("terraform/empty.tf")?.async("string");
    expect(content).toBe("");
  });
});

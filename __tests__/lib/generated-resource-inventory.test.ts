import { describe, it, expect } from "vitest";
import {
  extractGeneratedResources,
  generatedTfTypes,
} from "@/lib/generated-resource-inventory";

describe("extractGeneratedResources", () => {
  it("emits one row per `resource \"type\" \"name\"` header, with its file", () => {
    const files = {
      "main.tf": 'resource "azurerm_storage_account" "sa" {\n  name = "a"\n}',
      "net.tf": `
resource "azurerm_virtual_network" "vnet" {}
resource "azurerm_subnet" "web" {}
      `,
    };
    expect(extractGeneratedResources(files)).toEqual([
      { tfType: "azurerm_storage_account", tfName: "sa", file: "main.tf" },
      { tfType: "azurerm_virtual_network", tfName: "vnet", file: "net.tf" },
      { tfType: "azurerm_subnet", tfName: "web", file: "net.tf" },
    ]);
  });

  it("skips non-.tf files like tfvars.example", () => {
    const files = {
      "main.tf": 'resource "aws_s3_bucket" "b" {}',
      "terraform.tfvars.example":
        'resource "must_not_match" "ignored" {}', // example vars should be skipped
    };
    expect(extractGeneratedResources(files)).toHaveLength(1);
  });

  it("handles hyphenated names", () => {
    const files = {
      "main.tf": 'resource "aws_s3_bucket" "my-bucket" {}',
    };
    expect(extractGeneratedResources(files)[0].tfName).toBe("my-bucket");
  });
});

describe("generatedTfTypes", () => {
  it("returns a sorted, deduplicated type list", () => {
    const files = {
      "main.tf": `
resource "aws_s3_bucket" "a" {}
resource "aws_s3_bucket" "b" {}
resource "aws_iam_role" "r" {}
      `,
    };
    expect(generatedTfTypes(files)).toEqual(["aws_iam_role", "aws_s3_bucket"]);
  });
});

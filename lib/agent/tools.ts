// ---------------------------------------------------------------------------
// Anthropic SDK tool definitions for the Bicep-to-Terraform conversion agent.
// Ported from bicep_converter/tools.py @tool decorators.
// ---------------------------------------------------------------------------

import type Anthropic from "@anthropic-ai/sdk";

type Tool = Anthropic.Tool;

export const bicepTools: Tool[] = [
  // Tool 1: Read a .bicep file from disk
  {
    name: "read_bicep_file",
    description:
      "Read a .bicep file from disk and return its contents. " +
      "Accepts an absolute or relative file path.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "Path to the .bicep file to read.",
        },
      },
      required: ["file_path"],
    },
  },

  // Tool 2: Parse Bicep content
  {
    name: "parse_bicep",
    description:
      "Parse Bicep content into a structured representation. " +
      "Returns the raw Bicep text annotated with section markers for " +
      "LLM-native parsing. Pass the raw Bicep content string (not a file path).",
    input_schema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "Raw Bicep file content to parse.",
        },
      },
      required: ["content"],
    },
  },

  // Tool 3: Look up Terraform equivalent of a Bicep resource type
  {
    name: "lookup_resource_mapping",
    description:
      "Look up the Terraform/OpenTofu equivalent of a Bicep resource type. " +
      "Pass the Bicep resource type (e.g., 'Microsoft.Storage/storageAccounts'). " +
      "The API version suffix (e.g., '@2023-01-01') is automatically stripped.",
    input_schema: {
      type: "object" as const,
      properties: {
        bicep_resource_type: {
          type: "string",
          description:
            "Bicep resource type, e.g. 'Microsoft.Storage/storageAccounts@2023-01-01'.",
        },
      },
      required: ["bicep_resource_type"],
    },
  },

  // Tool 4: Generate formatted Terraform HCL block
  {
    name: "generate_terraform",
    description:
      "Generate a Terraform/OpenTofu HCL block. Pass the block_type " +
      "(resource, variable, locals, output, provider, module, data, terraform), " +
      "the block_name (e.g., 'azurerm_storage_account.main' for resources), and " +
      "the hcl_body containing the HCL attribute assignments.",
    input_schema: {
      type: "object" as const,
      properties: {
        block_type: {
          type: "string",
          description:
            "HCL block type: resource, variable, locals, output, provider, module, data, or terraform.",
          enum: [
            "resource",
            "variable",
            "locals",
            "output",
            "provider",
            "module",
            "data",
            "terraform",
          ],
        },
        block_name: {
          type: "string",
          description:
            "Block label, e.g. 'azurerm_storage_account.main' for resources, " +
            "'location' for variables, 'azurerm' for providers.",
        },
        hcl_body: {
          type: "string",
          description:
            "The HCL attribute assignments that form the block body (without outer braces).",
        },
      },
      required: ["block_type", "block_name", "hcl_body"],
    },
  },

  // Tool 5: Write Terraform files to output directory
  {
    name: "write_terraform_files",
    description:
      "Write generated Terraform/OpenTofu HCL content to files in the output directory. " +
      "Pass output_dir (the directory path) and files (a JSON string mapping filenames " +
      "like 'main.tf', 'variables.tf', 'terraform.tfvars' to their HCL content). " +
      "Supports .tf, .tfvars, .tfvars.json, and .hcl extensions. " +
      "Nested paths (e.g. 'modules/storage/main.tf') are supported. " +
      "The output_dir will be created if it does not exist.",
    input_schema: {
      type: "object" as const,
      properties: {
        output_dir: {
          type: "string",
          description: "Directory path to write files into.",
        },
        files: {
          type: "string",
          description:
            'JSON string mapping filename to HCL content, e.g. \'{"main.tf": "resource ..."}\'.',
        },
      },
      required: ["output_dir", "files"],
    },
  },

  // Tool 6: Validate Terraform files
  {
    name: "validate_terraform",
    description:
      "Validate generated Terraform/OpenTofu files by running 'tofu init' and " +
      "'tofu validate' in the specified directory. Returns validation results " +
      "including any errors or warnings. Requires OpenTofu or Terraform CLI.",
    input_schema: {
      type: "object" as const,
      properties: {
        working_dir: {
          type: "string",
          description:
            "Directory containing the .tf files to validate.",
        },
      },
      required: ["working_dir"],
    },
  },

  // Tool 7: List .bicep files in a directory
  {
    name: "list_bicep_files",
    description:
      "List all .bicep files in a directory. Set recursive to 'true' to search " +
      "subdirectories. Returns file paths, sizes, and a count summary.",
    input_schema: {
      type: "object" as const,
      properties: {
        directory: {
          type: "string",
          description: "Directory to search for .bicep files.",
        },
        recursive: {
          type: "string",
          description:
            "Set to 'true' to search subdirectories recursively. Defaults to 'false'.",
          enum: ["true", "false"],
        },
      },
      required: ["directory"],
    },
  },

  // Tool 8: Format Terraform files
  {
    name: "format_terraform",
    description:
      "Format Terraform/OpenTofu HCL files using 'tofu fmt' or 'terraform fmt'. " +
      "Runs the formatter on the specified directory to ensure consistent code style. " +
      "Returns the list of files that were modified.",
    input_schema: {
      type: "object" as const,
      properties: {
        working_dir: {
          type: "string",
          description:
            "Directory containing the .tf files to format.",
        },
      },
      required: ["working_dir"],
    },
  },

  // Tool 9: Read Bicep file content from in-memory project (multi-file mode)
  {
    name: "read_bicep_file_content",
    description:
      "Read the full content of a Bicep file from the in-memory project context. " +
      "Use this when a file was summarized in the user message and you need its full content. " +
      "Only available in multi-file conversion mode. " +
      "Pass the relative file path as it appears in the project file listing.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description:
            "Relative file path within the project (e.g., 'modules/storage.bicep').",
        },
      },
      required: ["file_path"],
    },
  },
];

// ---------------------------------------------------------------------------
// OpenAPI 3.0 specification for the Terrain API.
// ---------------------------------------------------------------------------

export function getOpenApiSpec() {
  return {
    openapi: "3.0.3",
    info: {
      title: "Terrain API",
      version: "1.0.0",
      description:
        "REST API for converting Azure Bicep and AWS CloudFormation templates to Terraform/OpenTofu, deploying infrastructure, running security scans, evaluating policies, and estimating costs.",
    },
    servers: [{ url: "/", description: "Current server" }],
    paths: {
      "/api/convert": {
        post: {
          summary: "Convert Bicep or CloudFormation to Terraform",
          description:
            "Streams the conversion process as Server-Sent Events. Set `sourceFormat` to \"bicep\" (default) or \"cloudformation\" to dispatch to the corresponding pipeline. " +
            "Accepts either a single-file payload (bicepContent) or a multi-file Bicep project payload (bicepFiles + entryPoint). " +
            "The AI agent parses the source, maps resources, and generates equivalent Terraform files.",
          tags: ["Conversion"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    {
                      type: "object",
                      required: ["bicepContent"],
                      properties: {
                        bicepContent: {
                          type: "string",
                          description: "The Bicep template content to convert (single-file mode)",
                        },
                        apiKey: {
                          type: "string",
                          description: "Optional Anthropic API key (uses server key if omitted)",
                        },
                      },
                    },
                    {
                      type: "object",
                      required: ["bicepFiles"],
                      properties: {
                        bicepFiles: {
                          type: "object",
                          additionalProperties: { type: "string" },
                          description: "Map of relative file paths to Bicep content (multi-file mode)",
                        },
                        entryPoint: {
                          type: "string",
                          description: "Entry point file path within the project (defaults to main.bicep)",
                          default: "main.bicep",
                        },
                        apiKey: {
                          type: "string",
                          description: "Optional Anthropic API key (uses server key if omitted)",
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "SSE stream of conversion events",
              content: { "text/event-stream": { schema: { type: "string" } } },
            },
            "400": { description: "Invalid request body" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden — insufficient role" },
            "429": { description: "Rate limited" },
          },
        },
      },
      "/api/deploy": {
        post: {
          summary: "Deploy Terraform and run tests",
          description:
            "Streams the deployment process as SSE. Deploys Terraform files to Azure and runs smoke tests.",
          tags: ["Deployment"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["terraformFiles", "workingDir", "resourceGroupName"],
                  properties: {
                    terraformFiles: {
                      type: "object",
                      additionalProperties: { type: "string" },
                      description: "Map of filename to Terraform content",
                    },
                    workingDir: { type: "string" },
                    resourceGroupName: { type: "string" },
                    bicepContent: { type: "string", default: "" },
                    apiKey: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "SSE stream of deployment events",
              content: { "text/event-stream": { schema: { type: "string" } } },
            },
            "400": { description: "Invalid request body" },
            "401": { description: "Unauthorized" },
            "403": { description: "Forbidden — requires DEPLOYER role" },
            "429": { description: "Rate limited" },
          },
        },
      },
      "/api/deploy/setup": {
        post: {
          summary: "Set up deployment workspace",
          description: "Creates a temp directory with Terraform files, initializes Terraform, and creates a resource group.",
          tags: ["Deployment"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["terraformFiles"],
                  properties: {
                    terraformFiles: {
                      type: "object",
                      additionalProperties: { type: "string" },
                    },
                    location: { type: "string", default: "eastus" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Setup result",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      workingDir: { type: "string" },
                      resourceGroupName: { type: "string" },
                      initOutput: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/deploy/destroy": {
        post: {
          summary: "Destroy deployed resources",
          description: "Runs terraform destroy and deletes the Azure resource group.",
          tags: ["Deployment"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["workingDir", "resourceGroupName"],
                  properties: {
                    workingDir: { type: "string" },
                    resourceGroupName: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Destroy result",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      output: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/scan": {
        post: {
          summary: "Run security scan",
          description: "Scans Terraform files for security misconfigurations using Trivy or built-in rules.",
          tags: ["Security"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["terraformFiles"],
                  properties: {
                    terraformFiles: {
                      type: "object",
                      additionalProperties: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Scan results",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ScanResult" },
                },
              },
            },
          },
        },
      },
      "/api/policy": {
        post: {
          summary: "Evaluate OPA policies",
          description: "Evaluates encryption, public access, and tagging policies against Terraform files.",
          tags: ["Security"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["terraformFiles"],
                  properties: {
                    terraformFiles: {
                      type: "object",
                      additionalProperties: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Policy evaluation results",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PolicyResult" },
                },
              },
            },
          },
        },
      },
      "/api/cost-estimate": {
        post: {
          summary: "Estimate infrastructure cost",
          description: "Estimates monthly Azure cost using Infracost or built-in resource pricing.",
          tags: ["Cost"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["terraformFiles"],
                  properties: {
                    terraformFiles: {
                      type: "object",
                      additionalProperties: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Cost estimate",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CostEstimateResult" },
                },
              },
            },
          },
        },
      },
      "/api/history": {
        get: {
          summary: "List conversion history",
          tags: ["History"],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          ],
          responses: {
            "200": {
              description: "Paginated list of conversions",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: { type: "array", items: { type: "object" } },
                      total: { type: "integer" },
                      page: { type: "integer" },
                      limit: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: "Save conversion to history",
          tags: ["History"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["bicepFilename", "bicepContent", "terraformFiles"],
                  properties: {
                    bicepFilename: { type: "string" },
                    bicepContent: { type: "string" },
                    terraformFiles: { type: "object", additionalProperties: { type: "string" } },
                    validationPassed: { type: "boolean" },
                    model: { type: "string" },
                    inputTokens: { type: "integer" },
                    outputTokens: { type: "integer" },
                    totalCostUsd: { type: "number" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Conversion saved" },
          },
        },
      },
      "/api/admin/audit": {
        get: {
          summary: "List audit logs (admin only)",
          tags: ["Admin"],
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
            { name: "action", in: "query", schema: { type: "string" } },
            { name: "userId", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "Paginated audit logs",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: { type: "array", items: { type: "object" } },
                      total: { type: "integer" },
                      page: { type: "integer" },
                      limit: { type: "integer" },
                    },
                  },
                },
              },
            },
            "403": { description: "Forbidden — requires ADMIN role" },
          },
        },
      },
    },
    components: {
      schemas: {
        ScanResult: {
          type: "object",
          properties: {
            passed: { type: "boolean" },
            findings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  ruleId: { type: "string" },
                  severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
                  title: { type: "string" },
                  description: { type: "string" },
                  resource: { type: "string" },
                  file: { type: "string" },
                  resolution: { type: "string" },
                },
              },
            },
            scannedAt: { type: "string", format: "date-time" },
            scanner: { type: "string" },
          },
        },
        PolicyResult: {
          type: "object",
          properties: {
            passed: { type: "boolean" },
            violations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  policy: { type: "string" },
                  rule: { type: "string" },
                  severity: { type: "string", enum: ["error", "warning", "info"] },
                  message: { type: "string" },
                  resource: { type: "string" },
                },
              },
            },
            evaluatedAt: { type: "string", format: "date-time" },
          },
        },
        CostEstimateResult: {
          type: "object",
          properties: {
            totalMonthlyCost: { type: "number" },
            totalHourlyCost: { type: "number" },
            resources: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  resourceType: { type: "string" },
                  monthlyCost: { type: "number" },
                  hourlyCost: { type: "number" },
                },
              },
            },
            currency: { type: "string" },
            estimatedAt: { type: "string", format: "date-time" },
          },
        },
      },
      securitySchemes: {
        session: {
          type: "apiKey",
          in: "cookie",
          name: "authjs.session-token",
          description: "NextAuth.js session cookie",
        },
      },
    },
    security: [{ session: [] }],
    tags: [
      { name: "Conversion", description: "Bicep and CloudFormation to Terraform conversion" },
      { name: "Deployment", description: "Infrastructure deployment and testing" },
      { name: "Security", description: "Security scanning and policy evaluation" },
      { name: "Cost", description: "Infrastructure cost estimation" },
      { name: "History", description: "Conversion history management" },
      { name: "Admin", description: "Administrative operations" },
    ],
  };
}

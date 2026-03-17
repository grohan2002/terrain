// ---------------------------------------------------------------------------
// Zod schemas for API request validation.
// ---------------------------------------------------------------------------

import { z } from "zod";

/** POST /api/convert — single-file */
export const ConvertRequestSchema = z.object({
  bicepContent: z.string().min(1, "bicepContent must be a non-empty string"),
  apiKey: z.string().optional(),
});

/** POST /api/convert — multi-file */
export const ConvertMultiFileRequestSchema = z.object({
  bicepFiles: z.record(z.string(), z.string()).refine(
    (obj) => Object.keys(obj).length > 0,
    "bicepFiles must contain at least one file",
  ),
  entryPoint: z.string().default("main.bicep"),
  apiKey: z.string().optional(),
});

/** Azure Service Principal credentials for deployment. */
export const AzureConfigSchema = z.object({
  subscriptionId: z.string().min(1, "subscriptionId is required"),
  tenantId: z.string().min(1, "tenantId is required"),
  clientId: z.string().min(1, "clientId is required"),
  clientSecret: z.string().min(1, "clientSecret is required"),
});

/** POST /api/deploy */
export const DeployRequestSchema = z.object({
  terraformFiles: z.record(z.string(), z.string()).refine(
    (obj) => Object.keys(obj).length > 0,
    "terraformFiles must contain at least one file",
  ),
  workingDir: z.string().min(1, "workingDir is required"),
  resourceGroupName: z.string().min(1, "resourceGroupName is required"),
  bicepContent: z.string().default(""),
  apiKey: z.string().optional(),
  azureConfig: AzureConfigSchema.optional(),
});

/** POST /api/deploy/setup */
export const DeploySetupSchema = z.object({
  terraformFiles: z.record(z.string(), z.string()).refine(
    (obj) => Object.keys(obj).length > 0,
    "terraformFiles must contain at least one file",
  ),
  location: z.string().default("eastus"),
  azureConfig: AzureConfigSchema.optional(),
});

/** POST /api/deploy/destroy */
export const DeployDestroySchema = z.object({
  workingDir: z.string().min(1, "workingDir is required"),
  resourceGroupName: z.string().min(1, "resourceGroupName is required"),
  azureConfig: AzureConfigSchema.optional(),
});

/** POST /api/github/scan — scan a GitHub repo for Bicep files */
export const GitHubScanRequestSchema = z.object({
  repoUrl: z.string().min(1, "repoUrl is required"),
  branch: z.string().optional(),
  subdirectory: z.string().optional(),
  token: z.string().optional(),
});

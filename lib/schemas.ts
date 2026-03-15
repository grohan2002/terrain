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
});

/** POST /api/deploy/setup */
export const DeploySetupSchema = z.object({
  terraformFiles: z.record(z.string(), z.string()).refine(
    (obj) => Object.keys(obj).length > 0,
    "terraformFiles must contain at least one file",
  ),
  location: z.string().default("eastus"),
});

/** POST /api/deploy/destroy */
export const DeployDestroySchema = z.object({
  workingDir: z.string().min(1, "workingDir is required"),
  resourceGroupName: z.string().min(1, "resourceGroupName is required"),
});

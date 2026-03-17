// ---------------------------------------------------------------------------
// Azure ARM environment variable builder.
//
// Constructs a process.env-compatible object with ARM_* credentials set.
// Used by deploy setup, deploy stream, and destroy routes to pass Azure
// Service Principal credentials to execSync calls (tofu, az CLI).
// ---------------------------------------------------------------------------

import type { AzureConfig } from "./types";

/**
 * Build environment variables for Azure CLI and OpenTofu azurerm provider.
 * Merges with process.env so that PATH and other system vars are preserved.
 *
 * If azureConfig is undefined, falls back to whatever ARM_* vars are
 * already in process.env (the "server has env vars" case).
 */
export function buildAzureEnv(azureConfig?: AzureConfig): NodeJS.ProcessEnv {
  if (!azureConfig) return { ...process.env };

  return {
    ...process.env,
    ARM_SUBSCRIPTION_ID: azureConfig.subscriptionId,
    ARM_TENANT_ID: azureConfig.tenantId,
    ARM_CLIENT_ID: azureConfig.clientId,
    ARM_CLIENT_SECRET: azureConfig.clientSecret,
  };
}

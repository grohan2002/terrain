// ---------------------------------------------------------------------------
// Environment variable validation and typed access.
// Uses Zod for runtime schema validation at startup.
// ---------------------------------------------------------------------------

import { z } from "zod";

const envSchema = z.object({
  // Anthropic
  ANTHROPIC_API_KEY: z.string().optional(),

  // NextAuth
  AUTH_SECRET: z.string().optional(),
  AUTH_GITHUB_ID: z.string().optional(),
  AUTH_GITHUB_SECRET: z.string().optional(),

  // Azure Deployment (optional, for Deploy & Test)
  ARM_SUBSCRIPTION_ID: z.string().optional(),
  ARM_TENANT_ID: z.string().optional(),
  ARM_CLIENT_ID: z.string().optional(),
  ARM_CLIENT_SECRET: z.string().optional(),

  // Redis (rate limiting in production)
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // Database
  DATABASE_URL: z.string().optional(),

  // Redis (caching)
  REDIS_URL: z.string().optional(),

  // Infracost (optional — unlocks real-time Azure pricing)
  INFRACOST_API_KEY: z.string().optional(),

  // MCP (Model Context Protocol) — kill switches for official MCP integrations
  ENABLE_TERRAFORM_MCP: z.string().optional(),
  ENABLE_AZURE_MCP: z.string().optional(),
  TERRAFORM_MCP_URL: z.string().url().optional(),

  // Logging
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // Node
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment variables:", result.error.format());
    throw new Error("Invalid environment variables");
  }
  return result.data;
}

/** Validated environment — lazily initialised on first access. */
let _env: Env | undefined;

export function env(): Env {
  if (!_env) {
    _env = validateEnv();
  }
  return _env;
}

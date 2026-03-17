// ---------------------------------------------------------------------------
// GET /api/check-key — checks whether the server has an Anthropic API key
// configured via environment variable. Returns { hasKey: boolean }.
// ---------------------------------------------------------------------------

export async function GET() {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const hasAzureConfig = !!(
    process.env.ARM_SUBSCRIPTION_ID &&
    process.env.ARM_TENANT_ID &&
    process.env.ARM_CLIENT_ID &&
    process.env.ARM_CLIENT_SECRET
  );
  return Response.json({ hasKey, hasAzureConfig });
}

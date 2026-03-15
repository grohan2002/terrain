// ---------------------------------------------------------------------------
// GET /api/docs — Serve the OpenAPI specification as JSON.
// ---------------------------------------------------------------------------

import { getOpenApiSpec } from "@/lib/openapi";

export function GET() {
  return Response.json(getOpenApiSpec());
}

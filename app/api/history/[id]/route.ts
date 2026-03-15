// ---------------------------------------------------------------------------
// GET    /api/history/:id — Fetch a single conversion with full details
// DELETE /api/history/:id — Remove a conversion record
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const conversion = await prisma.conversion.findUnique({
      where: { id },
    });

    if (!conversion) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return Response.json(conversion);
  } catch (e) {
    logger.error({ error: (e as Error).message, id }, "Failed to fetch conversion");
    return Response.json({ error: "Failed to fetch conversion" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    await prisma.conversion.delete({ where: { id } });
    return Response.json({ success: true });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("Record to delete does not exist")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    logger.error({ error: msg, id }, "Failed to delete conversion");
    return Response.json({ error: "Failed to delete conversion" }, { status: 500 });
  }
}

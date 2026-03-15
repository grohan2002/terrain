// ---------------------------------------------------------------------------
// GET  /api/history — Paginated list of conversions
// POST /api/history — Create a conversion record
// ---------------------------------------------------------------------------

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  const skip = (page - 1) * limit;

  try {
    const [conversions, total] = await Promise.all([
      prisma.conversion.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          bicepFilename: true,
          validationPassed: true,
          model: true,
          totalCostUsd: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.conversion.count(),
    ]);

    return Response.json({
      conversions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (e) {
    logger.error({ error: (e as Error).message }, "Failed to fetch history");
    return Response.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data = body as Record<string, unknown>;

  if (!data.bicepContent || typeof data.bicepContent !== "string") {
    return Response.json({ error: "bicepContent is required" }, { status: 400 });
  }

  try {
    const conversion = await prisma.conversion.create({
      data: {
        bicepFilename: (data.bicepFilename as string) ?? "untitled.bicep",
        bicepContent: data.bicepContent as string,
        terraformFiles: (data.terraformFiles as Record<string, string>) ?? {},
        validationPassed: (data.validationPassed as boolean) ?? false,
        model: (data.model as string) ?? null,
        inputTokens: (data.inputTokens as number) ?? 0,
        outputTokens: (data.outputTokens as number) ?? 0,
        totalCostUsd: (data.totalCostUsd as number) ?? 0,
        status: "completed",
      },
    });

    return Response.json({ id: conversion.id }, { status: 201 });
  } catch (e) {
    logger.error({ error: (e as Error).message }, "Failed to save conversion");
    return Response.json({ error: "Failed to save conversion" }, { status: 500 });
  }
}

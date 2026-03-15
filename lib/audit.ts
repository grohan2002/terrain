// ---------------------------------------------------------------------------
// Audit logging — writes to the AuditLog table when database is available.
// Falls back to pino logging when database is not configured.
// ---------------------------------------------------------------------------

import { logger } from "./logger";

type AuditAction =
  | "conversion.started"
  | "conversion.completed"
  | "conversion.failed"
  | "conversion.multi_started"
  | "conversion.multi_completed"
  | "conversion.multi_failed"
  | "deployment.started"
  | "deployment.completed"
  | "deployment.failed"
  | "destroy.started"
  | "destroy.completed"
  | "destroy.failed";

export async function auditLog(
  action: AuditAction,
  details?: Record<string, unknown>,
  userId?: string,
  ip?: string,
): Promise<void> {
  // Always log via pino
  logger.info({ audit: true, action, userId, ip, ...details }, `Audit: ${action}`);

  // Attempt database write (non-blocking, best-effort)
  try {
    if (!process.env.DATABASE_URL) return;

    const { prisma } = await import("./db");
    const { Prisma } = await import("@prisma/client");
    await prisma.auditLog.create({
      data: {
        action,
        details: details
          ? (JSON.parse(JSON.stringify(details)) as typeof Prisma.JsonNull | undefined)
          : Prisma.JsonNull,
        userId: userId ?? null,
        ip: ip ?? null,
      },
    });
  } catch (e) {
    logger.warn({ error: (e as Error).message, action }, "Audit log DB write failed");
  }
}

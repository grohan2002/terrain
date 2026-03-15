// ---------------------------------------------------------------------------
// Structured logging with Pino.
// Uses pino-pretty in development for human-readable output.
// ---------------------------------------------------------------------------

import pino from "pino";
import { env } from "./env";

const isDev = env().NODE_ENV === "development";

export const logger = pino({
  level: env().LOG_LEVEL,
  ...(isDev
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

/** Create a child logger scoped to a request (with request ID). */
export function createRequestLogger(requestId: string) {
  return logger.child({ requestId });
}

import type http from "http";
import { logError, logInfo } from "./serverHttp.ts";

export function installServerLifecycle(server: http.Server): void {
  let shuttingDown = false;

  const shutdown = (signal: string, error?: unknown) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (error) {
      logError("process", "fatal runtime error", {
        signal,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    } else {
      logInfo("process", "graceful shutdown requested", { signal });
    }
    server.close(() => process.exit(error ? 1 : 0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(error ? 1 : 0), 8_000).unref();
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("uncaughtException", (error) => shutdown("uncaughtException", error));
  process.on("unhandledRejection", (error) => logError("process", "unhandled rejection", {
    error: error instanceof Error ? error.message : String(error),
  }));
  server.on("error", (error) => shutdown("serverError", error));
}

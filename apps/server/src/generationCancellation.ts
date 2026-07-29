import type http from "node:http";

export function bindGenerationCancellation(res: http.ServerResponse): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const abort = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.once("close", abort);

  return {
    signal: controller.signal,
    cleanup: () => res.removeListener("close", abort),
  };
}

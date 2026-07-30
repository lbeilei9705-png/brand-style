export function mergeAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const aborted = signals.find((signal) => signal.aborted);

  if (aborted) {
    return AbortSignal.abort(aborted.reason);
  }

  const controller = new AbortController();
  for (const signal of signals) {
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

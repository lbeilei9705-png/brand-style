import assert from "node:assert/strict";
import test from "node:test";
import { mergeAbortSignals } from "./abortSignal.ts";

test("merged abort signal follows either source without AbortSignal.any", () => {
  const request = new AbortController();
  const timeout = new AbortController();
  const merged = mergeAbortSignals(request.signal, timeout.signal);

  request.abort("cancelled");
  assert.equal(merged.aborted, true);
  assert.equal(merged.reason, "cancelled");
});

test("merged abort signal preserves an already aborted source", () => {
  const request = new AbortController();
  request.abort("already-cancelled");

  const merged = mergeAbortSignals(request.signal, new AbortController().signal);
  assert.equal(merged.aborted, true);
  assert.equal(merged.reason, "already-cancelled");
});

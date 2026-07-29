import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { bindGenerationCancellation } from "./generationCancellation.ts";

test("generation cancellation follows an unfinished response closing", () => {
  const response = new EventEmitter() as EventEmitter & { writableEnded: boolean };
  response.writableEnded = false;
  const cancellation = bindGenerationCancellation(response as never);

  response.emit("close");
  assert.equal(cancellation.signal.aborted, true);
});

test("completed responses do not cancel generation", () => {
  const response = new EventEmitter() as EventEmitter & { writableEnded: boolean };
  response.writableEnded = true;
  const cancellation = bindGenerationCancellation(response as never);

  response.emit("close");
  assert.equal(cancellation.signal.aborted, false);
  cancellation.cleanup();
});

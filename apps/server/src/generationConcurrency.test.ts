import assert from "node:assert/strict";
import test from "node:test";
import { GenerationConcurrencyLimiter } from "./generationConcurrency.ts";

test("generation concurrency is isolated by member session", () => {
  const limiter = new GenerationConcurrencyLimiter(3);

  assert.equal(limiter.tryAcquire("member-a"), true);
  assert.equal(limiter.tryAcquire("member-a"), true);
  assert.equal(limiter.tryAcquire("member-a"), true);
  assert.equal(limiter.tryAcquire("member-a"), false);
  assert.equal(limiter.tryAcquire("member-b"), true);
  assert.equal(limiter.active("member-a"), 3);

  limiter.release("member-a");
  assert.equal(limiter.active("member-a"), 2);
  assert.equal(limiter.tryAcquire("member-a"), true);
});

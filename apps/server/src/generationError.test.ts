import assert from "node:assert/strict";
import test from "node:test";
import { classifyGenerationError } from "./generationError.ts";

test("generation errors expose actionable model failure categories", () => {
  assert.deepEqual(classifyGenerationError(new Error("HTTP 429 rate limit exceeded")), {
    statusCode: 429,
    code: "MODEL_RATE_LIMITED",
    message: "当前模型请求过多或负载较高，请稍后重试或切换模型。",
    retryAfter: 30,
  });
  assert.equal(classifyGenerationError(new Error("insufficient balance")).code, "MODEL_QUOTA_EXHAUSTED");
  assert.equal(classifyGenerationError(new Error("HTTP 401 unauthorized")).code, "MODEL_AUTH_FAILED");
  assert.equal(classifyGenerationError(new Error("请求超过 90 秒仍未返回")).code, "MODEL_TIMEOUT");
  assert.equal(classifyGenerationError(new Error("HTTP 503 service unavailable")).code, "MODEL_UPSTREAM_UNAVAILABLE");
  assert.equal(classifyGenerationError(new Error("HTTP 400 invalid argument")).code, "MODEL_REQUEST_REJECTED");
});

test("unknown generation failures keep a safe generic message", () => {
  const result = classifyGenerationError(new Error("unexpected provider payload"));

  assert.equal(result.statusCode, 500);
  assert.equal(result.code, "GENERATION_FAILED");
  assert.equal(result.message.includes("诊断包"), true);
  assert.equal(result.message.includes("unexpected provider payload"), false);
});

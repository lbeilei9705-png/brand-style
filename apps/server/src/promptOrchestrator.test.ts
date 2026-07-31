import assert from "node:assert/strict";
import test from "node:test";
import type { ModelConfig } from "../../../packages/shared/src/index.ts";
import { lockedStyleRenderingPrompt } from "./pipeline/promptBuilder.ts";
import { PromptOrchestrator } from "./pipeline/promptOrchestrator.ts";

const languageModel: ModelConfig = {
  id: "language-test",
  name: "Language Test",
  provider: "fintopia",
  model: "language-test",
  apiUrl: "https://example.test",
  apiKey: "secret",
  apiStyle: "openai",
  purpose: "language",
  quality: "auto",
  enabled: true,
  createdAt: "",
  updatedAt: "",
};

test("prompt orchestration preserves locked rendering text and configured negatives", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          positive: `${lockedStyleRenderingPrompt} 钱包主体，硬币沿箭头落入钱包。`,
          negative: "不要出现美元符号",
        }),
      },
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const result = await new PromptOrchestrator(languageModel).optimize({
      prompt: {
        positive: `${lockedStyleRenderingPrompt} 用户本轮要求：到账成功`,
        negative: "不要重复 Rs",
        template: "flat_to_3d",
        referencePack: { inputAssetId: "text-only", stylePresetId: "", styleAnchors: [] },
      },
      constraints: {
        preserveStructure: true,
        styleLock: true,
        transparentBackground: false,
        fidelityLevel: "balanced",
        variationStrength: "medium",
        batchSize: 1,
        aspectRatio: "1:1",
        resolution: "1k",
      },
      inputAsset: {
        id: "text-only",
        type: "flat_icon",
        source: "figma_selection",
        filename: "text-prompt.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        dominantColors: [],
        hasBackground: false,
      },
    });

    assert.equal(result.positive.split(lockedStyleRenderingPrompt).length - 1, 1);
    assert.match(result.negative, /不要重复 Rs/);
    assert.match(result.negative, /不要出现美元符号/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

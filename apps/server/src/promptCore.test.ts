import assert from "node:assert/strict";
import test from "node:test";
import type { CreateTaskRequest, GenerateImageRequest, InputAsset, PreprocessResult } from "../../../packages/shared/src/index.ts";
import { importAgentFromMarkdown } from "./agentMarkdownImporter.ts";
import { defaultConfig, hydrateConfig } from "./configDefaults.ts";
import {
  applyPriorityDedupeToStylePrompt,
  getHighestReferencedImageIndex,
  parseRequestedImageCount,
  stripFixedPositiveFromScenarioPrompt,
  titleFromMessage,
} from "./conversationUtils.ts";
import { parseInputAsset, parseReferenceAssets } from "./pipeline/inputParser.ts";
import { buildOperationScenarioPromptBundle, buildPromptBundle, lockedStyleRenderingPrompt } from "./pipeline/promptBuilder.ts";
import { buildHeaders, buildImagePayload, buildOutputSize, getActualImageSize } from "./providers/fintopiaPayload.ts";

const constraints = {
  preserveStructure: true,
  styleLock: true,
  transparentBackground: true,
  fidelityLevel: "balanced" as const,
  variationStrength: "medium" as const,
  batchSize: 2,
  aspectRatio: "16:9" as const,
  resolution: "2k" as const,
};

const imageAsset: InputAsset = {
  id: "asset_1",
  referenceLabel: "图1",
  type: "flat_icon",
  source: "figma_selection",
  filename: "wallet.png",
  mimeType: "image/png",
  sizeBytes: 10,
  dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAAD",
  width: 2,
  height: 3,
  dominantColors: [],
  hasBackground: true,
};

const preprocess: PreprocessResult = {
  detectedType: "flat_icon",
  mode: "flat_to_3d",
  steps: [],
  warnings: [],
  normalizedAsset: {
    format: "png",
    preserveStructure: true,
    transparentBackground: true,
  },
};

test("conversation helpers parse counts, references and prompt labels", () => {
  assert.equal(titleFromMessage("  1234567890123456789  "), "123456789012345678...");
  assert.equal(parseRequestedImageCount("请给我两张图片"), 2);
  assert.equal(parseRequestedImageCount("生成4张图"), 4);
  assert.equal(parseRequestedImageCount("生成五张图"), undefined);
  assert.equal(getHighestReferencedImageIndex("保持图 2 结构，参考图3颜色"), 3);
  assert.equal(
    stripFixedPositiveFromScenarioPrompt("prompt_main：固定世界规则\n【场景模块】红包庭院", "固定世界规则"),
    "【场景模块】红包庭院",
  );
});

test("priority dedupe removes only manually overridden style sections", () => {
  const result = applyPriorityDedupeToStylePrompt([
    "渲染：",
    "柔和棚拍",
    "材质：",
    "默认树脂",
    "品牌色：",
    "#00FF00",
    "形状：",
    "圆润体块",
    "负面词：",
    "不要模糊",
  ].join("\n"), {
    hasManualPalette: true,
    hasManualMaterials: true,
    hasManualShape: false,
  });

  assert.equal(result.prompt, "渲染：\n柔和棚拍\n形状：\n圆润体块\n负面词：\n不要模糊");
  assert.deepEqual(
    result.removedLowPrioritySegments.map((item) => item.reason),
    ["manualMaterials", "manualColorPalette"],
  );
});

test("input parser detects file types and preserves reference order", () => {
  const request: CreateTaskRequest = {
    inputType: "auto",
    source: "figma_selection",
    filename: "outline.svg",
    mimeType: "image/svg+xml",
    sizeBytes: 12,
    referenceAssets: [
      {
        id: "first",
        name: "结构",
        filename: "hero-3d.png",
        mimeType: "image/png",
        sizeBytes: 10,
      },
      {
        id: "second",
        referenceLabel: "材质图",
        name: "材质",
        filename: "illustration.webp",
        mimeType: "image/webp",
        sizeBytes: 20,
      },
    ],
    constraints,
    target: "figma",
  };
  const fallback = parseInputAsset(request);
  const references = parseReferenceAssets(request, fallback);

  assert.equal(fallback.type, "line_sketch");
  assert.equal(fallback.hasBackground, false);
  assert.deepEqual(references.map((item) => [item.id, item.referenceLabel, item.type]), [
    ["first", "图1", "3d_other"],
    ["second", "材质图", "illustration"],
  ]);
});

test("prompt builder honors cross-image material transfer and dedupes negatives", () => {
  const bundle = buildPromptBundle(imageAsset, preprocess, {}, constraints, {
    userMessage: "保持图1结构和颜色，把图2材质用到图1上，颜色不变",
    materialPrompt: "材质球「磨砂」：细腻磨砂；轻微高光",
    extraNegativeRules: ["负面提示词：不要模糊，不要水印", "不要水印。"],
  });

  assert.match(bundle.positive, /跨图参考规则/);
  assert.match(bundle.positive, /材质要求：细腻磨砂；轻微高光/);
  assert.match(bundle.positive, /材质来源图只提供材质和质感，不覆盖颜色/);
  assert.equal(bundle.negative.split("；").filter((item) => item === "不要模糊").length, 1);
  assert.match(bundle.negative, /不要迁移材质来源图的颜色/);
});

test("semantic planning adds the locked rendering baseline without choosing material or color", () => {
  const bundle = buildPromptBundle(imageAsset, preprocess, {}, constraints, {
    userMessage: "钱包主体，硬币沿箭头落入钱包，右上角显示到账确认勾",
    semanticPlanning: true,
  });

  assert.equal(bundle.positive.includes(lockedStyleRenderingPrompt), true);
  assert.equal(bundle.positive.includes("钱包主体"), true);
});

test("default config includes the finance icon semantic planner", () => {
  const planner = defaultConfig().scenarioAgents?.find((agent) => agent.id === "finance-app-icon-planner");

  assert.equal(planner?.trigger, "/金融图标");
  assert.equal(planner?.mergeWithStyleConfig, true);
  assert.equal(planner?.outputMode, "prompt_sections");
});

test("config hydration restores the built-in finance planner", () => {
  const config = defaultConfig();
  config.scenarioAgents = [];

  assert.equal(
    hydrateConfig(config).scenarioAgents?.some((agent) => agent.id === "finance-app-icon-planner"),
    true,
  );
});

test("a newer seed version upgrades a stored built-in planner but keeps its enabled state", () => {
  const config = defaultConfig();
  const seedPlanner = config.scenarioAgents.find((agent) => agent.id === "finance-app-icon-planner");
  assert.ok(seedPlanner);
  config.scenarioAgents = config.scenarioAgents.map((agent) => (
    agent.id === "finance-app-icon-planner"
      ? { ...agent, version: "v1.0", coreRules: ["过时规则"], enabled: false }
      : agent
  ));

  const upgraded = hydrateConfig(config).scenarioAgents.find((agent) => agent.id === "finance-app-icon-planner");
  assert.equal(upgraded?.version, seedPlanner.version);
  assert.equal(upgraded?.coreRules.includes("过时规则"), false);
  assert.equal(upgraded?.coreRules.some((rule) => rule.includes("3/4 等轴微俯视")), true);
  assert.equal(upgraded?.enabled, false);
});

test("matching versions keep admin tweaks to a built-in planner", () => {
  const config = defaultConfig();
  config.scenarioAgents = config.scenarioAgents.map((agent) => (
    agent.id === "finance-app-icon-planner"
      ? { ...agent, name: "管理员改过的名字" }
      : agent
  ));

  const merged = hydrateConfig(config).scenarioAgents.find((agent) => agent.id === "finance-app-icon-planner");
  assert.equal(merged?.name, "管理员改过的名字");
});

test("operation scenario prompt keeps fixed and variable sections separate", () => {
  const bundle = buildOperationScenarioPromptBundle(imageAsset, preprocess, {}, {
    name: "春节",
    fixedPrompt: "固定世界规则",
    variablePrompt: "红包庭院",
    negativeRules: ["不要模糊；不要文字", "不要文字"],
  });

  assert.equal(bundle.positive, "固定世界规则\n\n红包庭院");
  assert.equal(bundle.negative, "不要模糊；不要文字；不要糊边；不要低分辨率");
});

test("Markdown importer supports bilingual headings and safe defaults", () => {
  const imported = importAgentFromMarkdown([
    "# ignored title",
    "## Name",
    "Clean 3D",
    "## Description",
    "A restrained style.",
    "## System Prompt",
    "Keep the silhouette.",
    "## Negative Rules",
    "- blur",
    "* watermark",
  ].join("\n"), {
    id: "mock",
    name: "Mock",
    provider: "mock",
    model: "mock",
    purpose: "image",
    quality: "auto",
    enabled: true,
    createdAt: "",
    updatedAt: "",
  });

  assert.deepEqual(imported, {
    name: "Clean 3D",
    description: "A restrained style.",
    systemPrompt: "Keep the silhouette.",
    defaultStylePresetId: "",
    defaultNegativeRules: ["blur", "watermark"],
    driverModelId: "mock",
    enabled: true,
    parseMode: "rule_fallback",
  });
});

function imageRequest(): GenerateImageRequest {
  return {
    taskId: "task_1",
    inputAsset: imageAsset,
    referenceAssets: [
      imageAsset,
      { ...imageAsset, id: "asset_2", referenceLabel: "图2", filename: "material.png" },
    ],
    prompt: {
      positive: "保持图1结构和颜色，把图2材质用到图1上",
      negative: "不要模糊",
      template: "flat_to_3d",
      referencePack: {
        inputAssetId: "asset_1",
        stylePresetId: "",
        styleAnchors: [],
      },
    },
    constraints,
  };
}

test("Fintopia payloads preserve image order, dimensions and auth conventions", () => {
  const request = imageRequest();
  const config = {
    apiUrl: "https://example.test",
    apiKey: "secret",
    model: "image-model",
    version: "",
  };
  const gemini = buildImagePayload(request, config, "gemini-generate-content", 1, 2, {
    modelId: "gemini-image",
    googleProxy: true,
  }) as {
    model: string;
    contents: Array<{ parts: Array<Record<string, unknown>> }>;
    generationConfig: { imageConfig: { aspectRatio: string; imageSize: string } };
  };
  const chat = buildImagePayload(request, config, "chat-completions") as {
    messages: Array<{ content: Array<Record<string, unknown>> }>;
    size: string;
  };

  assert.deepEqual(buildOutputSize(request), { width: 2048, height: 1152, size: "2048x1152" });
  assert.equal(gemini.model, "gemini-image");
  assert.deepEqual(gemini.generationConfig.imageConfig, { aspectRatio: "16:9", imageSize: "2K" });
  assert.deepEqual(
    gemini.contents[0].parts.filter((part) => "inlineData" in part).map((part) => part.inlineData),
    [
      { mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAAD" },
      { mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAAD" },
    ],
  );
  assert.equal(chat.size, "2048x1152");
  assert.equal(chat.messages[1].content.filter((part) => part.type === "image_url").length, 2);
  assert.deepEqual(buildHeaders("secret", "azure-images"), {
    "Content-Type": "application/json",
    "api-key": "secret",
  });
  assert.deepEqual(buildHeaders("secret", "openai-images"), {
    "Content-Type": "application/json",
    Authorization: "Bearer secret",
  });
});

test("text-only generation does not send a synthetic reference image", () => {
  const request = imageRequest();
  request.inputAsset = {
    ...request.inputAsset,
    id: "text-only",
    filename: "text-prompt.txt",
    mimeType: "text/plain",
    dataUrl: undefined,
  };
  request.referenceAssets = [];
  const payload = buildImagePayload(request, {
    apiUrl: "https://example.test",
    apiKey: "secret",
    model: "image-model",
    version: "",
  }, "gemini-generate-content", 0, 1, { googleProxy: true });
  const serialized = JSON.stringify(payload);

  assert.equal(serialized.includes("text-prompt.txt"), false);
  assert.equal(serialized.includes("参考图编号"), false);
});

test("Fintopia image metadata parser reads a PNG data URL without network", async () => {
  const pngHeader = Buffer.alloc(24);
  pngHeader.set([0x89, 0x50, 0x4E, 0x47], 0);
  pngHeader.writeUInt32BE(321, 16);
  pngHeader.writeUInt32BE(654, 20);

  assert.deepEqual(
    await getActualImageSize(`data:image/png;base64,${pngHeader.toString("base64")}`),
    { width: 321, height: 654 },
  );
});

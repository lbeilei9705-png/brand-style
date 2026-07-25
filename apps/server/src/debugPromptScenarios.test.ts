import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scenarios } from "../../web/public/debug-prompt-scenarios.js";
import { ConfigStore } from "./configStore.ts";
import { ConversationService } from "./conversationService.ts";
import { ConversationStore } from "./conversationStore.ts";
import { TaskStore } from "./taskStore.ts";

const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

type DebugScenario = {
  id: string;
  name: string;
  content: string;
  referenceCount: number;
  pickPalette?: "firstManual" | "original";
  pickMaterial?: boolean;
  pickShape?: boolean;
  pickOperation?: boolean;
  pickMockModel?: boolean;
  skipDefaultAgent?: boolean;
  expect: Array<Record<string, unknown> & { label: string }>;
};

function selectionAssets(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `fixture_asset_${index + 1}`,
    referenceLabel: `图${index + 1}`,
    name: `测试参考图${index + 1}`,
    filename: index === 1 ? "material-reference.png" : "structure-reference.png",
    mimeType: "image/png",
    sizeBytes: 68,
    width: 1024,
    height: 1024,
    assetDataUrl: tinyPng,
  }));
}

function getByPath(value: Record<string, unknown>, pathValue: string): unknown {
  return pathValue.split(".").reduce<unknown>((current, key) => (
    current && typeof current === "object"
      ? (current as Record<string, unknown>)[key]
      : undefined
  ), value);
}

function assertExpectation(
  result: Awaited<ReturnType<ConversationService["previewPrompt"]>>,
  expectation: DebugScenario["expect"][number],
): void {
  const combinedPrompt = `${result.positivePrompt}\n${result.negativePrompt}`;
  const scenarioAgent = result.scenarioAgent || { isScenarioAgentApplied: false };
  const scenarioCombined = [
    scenarioAgent.rawOutput,
    JSON.stringify(scenarioAgent.parsedOutput || {}),
    scenarioAgent.promptMain,
    scenarioAgent.promptNegative,
    scenarioAgent.skillSystemPrompt,
    scenarioAgent.memoryContext,
  ].join("\n");
  const label = String(expectation.label);

  if (expectation.includes) {
    assert.ok(combinedPrompt.includes(String(expectation.includes)), label);
  }
  if (expectation.notIncludes) {
    assert.ok(!combinedPrompt.includes(String(expectation.notIncludes)), label);
  }
  if (expectation.negativeIncludes) {
    assert.ok(result.negativePrompt.includes(String(expectation.negativeIncludes)), label);
  }
  if (expectation.removedReason) {
    assert.ok(
      result.removedLowPrioritySegments.some((segment) => segment.reason === expectation.removedReason),
      label,
    );
  }
  if (expectation.resolvedPath) {
    assert.ok(getByPath(result.resolvedConfig, String(expectation.resolvedPath)), label);
  }
  if (expectation.resolvedProvider) {
    const model = result.resolvedConfig.model as { provider?: string } | undefined;
    assert.equal(model?.provider, expectation.resolvedProvider, label);
  }
  if (expectation.scenarioAgentApplied !== undefined) {
    assert.equal(
      scenarioAgent.isScenarioAgentApplied,
      expectation.scenarioAgentApplied,
      label,
    );
  }
  if (expectation.scenarioAgentId) {
    assert.equal(scenarioAgent.agentId, expectation.scenarioAgentId, label);
  }
  if (expectation.scenarioPromptMain) {
    assert.ok(scenarioAgent.promptMain, label);
  }
  if (expectation.scenarioPromptNegative) {
    assert.ok(scenarioAgent.promptNegative, label);
  }
  if (expectation.scenarioIncludes) {
    assert.ok(scenarioCombined.includes(String(expectation.scenarioIncludes)), label);
  }
  if (expectation.scenarioNegativeIncludes) {
    assert.ok(
      String(scenarioAgent.promptNegative || "").includes(String(expectation.scenarioNegativeIncludes)),
      label,
    );
  }
  if (expectation.scenarioSkillIncludes) {
    assert.ok(
      String(scenarioAgent.skillSystemPrompt || "").includes(String(expectation.scenarioSkillIncludes)),
      label,
    );
  }
}

test("shared debug prompt fixture covers all 16 scenarios without browser or online LLM", async (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "icon-style-debug-prompts-"));
  const originalFetch = globalThis.fetch;
  const originalYunwuKey = process.env.YUNWU_LANGUAGE_API_KEY;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalYunwuKey === undefined) {
      delete process.env.YUNWU_LANGUAGE_API_KEY;
    } else {
      process.env.YUNWU_LANGUAGE_API_KEY = originalYunwuKey;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  process.env.YUNWU_LANGUAGE_API_KEY = "fixture-key";
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    const content = serialized.includes("单体式舞台场景智能体")
      ? "## prompt_main\n正视圆形舞台，IP 抱着红包，左右金币道具，纯白背景。\n## prompt_negative\n禁止俯视，禁止舞台裁切。"
      : '{"finalPrompt":"红包庭院作为微缩世界主体，IP 居民挂灯笼，金币环绕。"}';
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const configStore = new ConfigStore(dataDir);
  const config = configStore.read();
  config.agents[0] = {
    ...config.agents[0],
    systemPrompt: `${config.agents[0].systemPrompt}\n\n形状：\n默认圆润体块`,
  };
  configStore.write(config);
  const service = new ConversationService(
    new ConversationStore(dataDir, 30),
    configStore,
    new TaskStore(),
  );
  const enabledModels = config.models.filter((item) => item.enabled && (item.purpose || "image") === "image");
  const imageModel = enabledModels[0];
  const mockModel = enabledModels.find((item) => item.provider === "mock");
  const defaultAgent = config.agents.find((item) => item.enabled);
  const manualPalette = config.colorPalettes.find((item) => item.enabled && !item.name.includes("原图色彩"));
  const originalPalette = config.colorPalettes.find((item) => item.enabled && item.name.includes("原图色彩"));
  const material = config.materials.find((item) => item.enabled);
  const shape = config.shapeArchitectures.find((item) => item.enabled);
  const operation = config.operationScenarios.find((item) => item.enabled);

  assert.equal((scenarios as DebugScenario[]).length, 16);
  assert.ok(imageModel && mockModel && defaultAgent && manualPalette && originalPalette && material && shape && operation);

  for (const scenario of scenarios as DebugScenario[]) {
    await context.test(scenario.name, async () => {
      const isScenarioAgent = scenario.content.trim().startsWith("/");
      const result = await service.previewPrompt({
        content: scenario.content,
        modelId: (scenario.pickMockModel ? mockModel : imageModel).id,
        agentId: isScenarioAgent || scenario.skipDefaultAgent ? "" : defaultAgent.id,
        inputType: "auto",
        selectionAssets: selectionAssets(scenario.referenceCount),
        batchSize: 4,
        aspectRatio: "1:1",
        resolution: "2k",
        materialPresetIds: scenario.pickMaterial ? [material.id] : [],
        colorPaletteId: scenario.pickPalette === "original"
          ? originalPalette.id
          : scenario.pickPalette === "firstManual"
            ? manualPalette.id
            : undefined,
        shapeArchitectureId: scenario.pickShape ? shape.id : undefined,
        operationScenarioId: scenario.pickOperation ? operation.id : undefined,
        usePromptOrchestrator: false,
      });

      for (const expectation of scenario.expect) {
        assertExpectation(result, expectation);
      }
    });
  }
});

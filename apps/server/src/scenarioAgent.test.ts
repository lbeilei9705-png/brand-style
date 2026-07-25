import assert from "node:assert/strict";
import test from "node:test";
import type { ModelConfig, ScenarioAgentCaseConfig, ScenarioAgentConfig } from "../../../packages/shared/src/index.ts";
import {
  buildMiniatureWorldPrompt,
  extractJsonObject,
  extractLanguageText,
  extractMarkdownSection,
} from "./pipeline/scenarioAgentModelClient.ts";
import { parseScenarioAgentTrigger, runScenarioAgent } from "./pipeline/scenarioAgentService.ts";

const timestamp = "2026-01-01T00:00:00.000Z";

function agent(overrides: Partial<ScenarioAgentConfig> = {}): ScenarioAgentConfig {
  return {
    id: "miniature-world",
    name: "微缩世界",
    trigger: "/微缩世界",
    description: "生成微缩场景",
    systemPrompt: "legacy",
    skillRole: "将主题转为微缩玩具世界。",
    coreRules: ["超级符号体量大于 IP", "保持参考 IP 形象"],
    outputContract: '只返回 JSON：{"finalPrompt":"..."}',
    positiveTemplate: "主体、空间、道具、灯光",
    forbiddenRules: ["禁止真人"],
    memoryPolicy: "只使用相关记忆",
    caseReferencePolicy: "借鉴结构，不照抄",
    outputMode: "json_final_prompt",
    driverModelId: "language",
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

const model: ModelConfig = {
  id: "language",
  name: "Stub Language",
  provider: "fintopia",
  model: "stub-language",
  apiUrl: "https://stub.invalid",
  apiKey: "stub-key",
  apiStyle: "openai",
  purpose: "language",
  quality: "auto",
  enabled: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};

function scenarioCase(
  id: string,
  title: string,
  tags: string[],
  updatedAt: string,
  overrides: Partial<ScenarioAgentCaseConfig> = {},
): ScenarioAgentCaseConfig {
  return {
    id,
    scenarioAgentId: "miniature-world",
    title,
    userInput: `${title}活动`,
    positivePrompt: `${title}微缩玩具场景，红包与金币围绕主体。`,
    tags,
    rating: "excellent",
    enabled: true,
    createdAt: timestamp,
    updatedAt,
    ...overrides,
  };
}

test("scenario trigger requires an enabled exact slash command prefix", () => {
  const agents = [
    agent(),
    agent({ id: "disabled", trigger: "/禁用", enabled: false }),
  ];

  assert.equal(parseScenarioAgentTrigger("普通需求", agents), undefined);
  assert.equal(parseScenarioAgentTrigger("/微缩世界观 春节", agents), undefined);
  assert.equal(parseScenarioAgentTrigger("/禁用 春节", agents), undefined);
  assert.deepEqual(parseScenarioAgentTrigger("  /微缩世界 春节红包  ", agents), {
    agent: agents[0],
    userTheme: "春节红包",
  });
});

test("scenario retrieval ranks only enabled excellent cases and passes memory to stub", async (context) => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"finalPrompt":"春节红包庭院，金币环绕，微缩玩具世界。"}' } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const cases = [
    scenarioCase("best", "春节红包", ["春节", "红包"], "2026-02-03T00:00:00.000Z"),
    scenarioCase("second", "新春金币", ["春节", "金币"], "2026-02-02T00:00:00.000Z"),
    scenarioCase("neutral", "春节", ["春节"], "2026-02-04T00:00:00.000Z", { rating: "neutral" }),
    scenarioCase("disabled", "春节", ["春节"], "2026-02-05T00:00:00.000Z", { enabled: false }),
    scenarioCase("other", "春节", ["春节"], "2026-02-06T00:00:00.000Z", { scenarioAgentId: "other" }),
  ];
  const result = await runScenarioAgent({
    content: "/微缩世界 春节红包活动",
    selectionAssets: [{
      id: "image",
      referenceLabel: "图1",
      name: "参考 IP",
      filename: "ip.png",
      mimeType: "image/png",
      sizeBytes: 1,
      width: 800,
      height: 600,
    }],
    model,
    scenarioAgents: [agent()],
    scenarioAgentCases: cases,
  });

  assert.equal(result.promptMain, "春节红包庭院，金币环绕，微缩玩具世界。");
  assert.deepEqual(result.retrievedCases?.map((item) => item.id), ["best", "second"]);
  assert.match(result.skillSystemPrompt || "", /结构化视觉生成 Skill/);
  assert.match(result.skillSystemPrompt || "", /最终返回必须使用中文/);
  assert.match(result.memoryContext || "", /记忆1：春节红包/);
  assert.match(JSON.stringify(capturedBody), /参考图信息/);
  assert.match(JSON.stringify(capturedBody), /上下文记忆摘要/);
});

test("scenario response parsers accept JSON fences, Gemini parts and Markdown sections", () => {
  assert.deepEqual(extractJsonObject("说明\n```json\n{\"finalPrompt\":\"红包庭院\"}\n```"), {
    finalPrompt: "红包庭院",
  });
  assert.equal(extractJsonObject("not json"), undefined);
  assert.equal(extractLanguageText({
    candidates: [{ content: { parts: [{ text: "第一段" }, { text: "第二段" }] } }],
  }), "第一段\n第二段");
  const markdown = [
    "## prompt_main",
    "正视舞台与红包",
    "## prompt_negative",
    "禁止俯视",
  ].join("\n");
  assert.equal(extractMarkdownSection(markdown, "prompt_main"), "正视舞台与红包");
  assert.equal(extractMarkdownSection(markdown, "prompt_negative"), "禁止俯视");
  assert.equal(
    buildMiniatureWorldPrompt({
      topicAnalysis: "春节",
      layoutDescription: ["红包作为容器", "IP 位于庭院"],
      sceneModules: ["金币", "灯笼"],
    }, ""),
    "春节\n红包作为容器\nIP 位于庭院\n金币\n灯笼",
  );
});

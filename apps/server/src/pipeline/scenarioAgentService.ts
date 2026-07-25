import type { ModelConfig, ScenarioAgentCaseConfig, ScenarioAgentConfig, SelectionAsset } from "../../../../packages/shared/src/index.ts";
import type { FintopiaConfig } from "../config.ts";
import { defaultScenarioAgents } from "./scenarioAgentDefaults.ts";
import { buildEndpoint, buildHeaders, buildLanguagePayload, buildMiniatureWorldPrompt, extractJsonObject, extractLanguageText, extractMarkdownSection, getReadableLanguageModelError, getStringField } from "./scenarioAgentModelClient.ts";

export { defaultScenarioAgents } from "./scenarioAgentDefaults.ts";

export interface ScenarioAgentDebugResult {
  isScenarioAgentApplied: boolean;
  trigger?: string;
  agentId?: string;
  agentName?: string;
  userTheme?: string;
  referenceCount?: number;
  retrievedCases?: ScenarioAgentRetrievedCase[];
  skillSystemPrompt?: string;
  memoryContext?: string;
  rawOutput?: string;
  parsedOutput?: Record<string, unknown>;
  promptMain?: string;
  promptNegative?: string;
  error?: string;
}

export interface ScenarioAgentRetrievedCase {
  id: string;
  title: string;
  userInput: string;
  positivePrompt: string;
  tags: string[];
  score: number;
}

export function parseScenarioAgentTrigger(content: string, agents: ScenarioAgentConfig[] = defaultScenarioAgents): { agent: ScenarioAgentConfig; userTheme: string } | undefined {
  const trimmed = content.trim();
  const agent = agents.find((item) => item.enabled && (trimmed === item.trigger || trimmed.startsWith(`${item.trigger} `)));

  if (!agent) {
    return undefined;
  }

  return {
    agent,
    userTheme: trimmed.slice(agent.trigger.length).trim(),
  };
}

function formatReferenceText(selectionAssets: SelectionAsset[]): string {
  if (!selectionAssets.length) {
    return "未提供参考图。";
  }

  return selectionAssets.map((asset, index) => (
    `${asset.referenceLabel || `图${index + 1}`}：${asset.filename}，类型：${asset.mimeType}，尺寸：${asset.width || "未知"}x${asset.height || "未知"}`
  )).join("\n");
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();

  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function normalizeTextForSearch(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function tokenizeForSearch(value: string): string[] {
  const normalized = normalizeTextForSearch(value);
  const asciiTokens = normalized.match(/[a-z0-9]{2,}/g) || [];
  const cjkTokens = normalized.match(/[\p{Script=Han}]{2,}/gu) || [];
  const compactCjkText = cjkTokens.join("");
  const cjkBigrams = compactCjkText.length >= 2
    ? Array.from({ length: compactCjkText.length - 1 }, (_, index) => compactCjkText.slice(index, index + 2))
    : [];

  return [...new Set([...asciiTokens, ...cjkTokens, ...cjkBigrams])].filter((token) => token.length >= 2);
}

function scoreScenarioCase(caseItem: ScenarioAgentCaseConfig, userTheme: string): number {
  const themeTokens = tokenizeForSearch(userTheme);
  const tagTokens = caseItem.tags.flatMap(tokenizeForSearch);
  const searchableText = normalizeTextForSearch([
    caseItem.title,
    caseItem.userInput,
    caseItem.positivePrompt,
    caseItem.notes || "",
    caseItem.tags.join(" "),
  ].join(" "));
  let score = 0;

  for (const token of themeTokens) {
    if (searchableText.includes(token)) {
      score += token.length >= 3 ? 2 : 1;
    }
  }

  for (const token of tagTokens) {
    if (normalizeTextForSearch(userTheme).includes(token)) {
      score += 3;
    }
  }

  if (caseItem.title && normalizeTextForSearch(userTheme).includes(normalizeTextForSearch(caseItem.title))) {
    score += 4;
  }

  return score;
}

function retrieveScenarioCases(input: {
  agentId: string;
  userTheme: string;
  scenarioAgentCases?: ScenarioAgentCaseConfig[];
}): ScenarioAgentRetrievedCase[] {
  return (input.scenarioAgentCases || [])
    .filter((caseItem) => caseItem.enabled && caseItem.rating === "excellent" && caseItem.scenarioAgentId === input.agentId)
    .map((caseItem) => ({
      id: caseItem.id,
      title: caseItem.title,
      userInput: caseItem.userInput,
      positivePrompt: caseItem.positivePrompt,
      tags: caseItem.tags,
      score: scoreScenarioCase(caseItem, input.userTheme),
      updatedAt: caseItem.updatedAt,
    }))
    .filter((caseItem) => caseItem.score > 0)
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3)
    .map(({ updatedAt: _updatedAt, ...caseItem }) => caseItem);
}

function formatRetrievedCases(cases: ScenarioAgentRetrievedCase[]): string {
  if (!cases.length) {
    return "未命中可参考案例记忆。";
  }

  return cases.map((caseItem, index) => [
    `记忆${index + 1}：${caseItem.title}`,
    `历史需求：${truncateText(caseItem.userInput, 120)}`,
    `可复用经验：参考其场景结构、主体关系、道具组织和画面约束，不要照抄完整 Prompt。`,
    `成功结构摘要：${truncateText(caseItem.positivePrompt, 260)}`,
    caseItem.tags.length ? `标签：${caseItem.tags.join("、")}` : undefined,
  ].filter(Boolean).join("\n")).join("\n\n");
}

function getOutputContract(agent: ScenarioAgentConfig): string {
  if (agent.outputContract?.trim()) {
    return agent.outputContract.trim();
  }

  if (agent.outputMode === "json_final_prompt") {
    return [
      "只返回 JSON，不要 Markdown，不要解释，不要分析过程。",
      'JSON 字段固定为：{"finalPrompt":"..."}。',
      "finalPrompt 只写本次场景 Prompt，不要包含 Base Prompt、固定正向规则、prompt_negative、负向规则或自检过程。",
    ].join("\n");
  }

  return [
    "只返回两个 Markdown 小节，不要解释，不要分析过程。",
    "## prompt_main",
    "（本次场景 Prompt）",
    "## prompt_negative",
    "（如果后台固定负向规则已覆盖，可保持简短；不得输出分析过程）",
  ].join("\n");
}

function hasStructuredSkillConfig(agent: ScenarioAgentConfig): boolean {
  return Boolean(
    agent.skillRole?.trim()
    || agent.coreRules?.length
    || agent.outputContract?.trim()
    || agent.positiveTemplate?.trim()
    || agent.forbiddenRules?.length
    || agent.memoryPolicy?.trim()
    || agent.caseReferencePolicy?.trim()
  );
}

function buildConfiguredSkillCard(agent: ScenarioAgentConfig): string {
  return [
    `【Skill 名称】${agent.name}`,
    `【Skill 目标】${agent.skillRole || agent.description}`,
    agent.coreRules?.length ? ["【核心硬规则】", ...agent.coreRules.map((rule, index) => `${index + 1}. ${rule}`)].join("\n") : undefined,
    agent.positiveTemplate ? `【正向 Prompt 组织模板】\n${agent.positiveTemplate}` : undefined,
    agent.forbiddenRules?.length ? ["【禁止项】", ...agent.forbiddenRules.map((rule, index) => `${index + 1}. ${rule}`)].join("\n") : undefined,
    agent.memoryPolicy ? `【上下文记忆策略】\n${agent.memoryPolicy}` : undefined,
    agent.caseReferencePolicy ? `【案例参考策略】\n${agent.caseReferencePolicy}` : undefined,
    "【固定规则边界】",
    "固定正向规则 / Base Prompt 由后端在最终生图前拼接；不要把它输出给用户。",
    "固定负向规则由后端在最终生图前拼接；除非输出契约要求，否则不要额外生成负向规则。",
    "【输出契约】",
    getOutputContract(agent),
  ].filter(Boolean).join("\n");
}

function buildLegacyMiniatureWorldSkillCard(agent: ScenarioAgentConfig): string {
  return [
    `【Skill 名称】${agent.name}`,
    `【Skill 目标】${agent.description || "生成微缩世界场景 Prompt"}`,
    "【核心硬规则】",
    "1. 这是微缩模型世界，不是单一角色特写。",
    "2. 超级符号必须作为世界本体、地形、舞台或容器，体量明显大于 IP。",
    "3. IP 是微缩居民，只做小动作和换装，不能改变头部造型、物种和核心识别特征。",
    "4. IP 形象来自用户参考图；不要描述、推断或重写 IP 的具体外观，只说明保持 IP 形象不变，保持原有头身比例、原有五官比例、原有轮廓特征。",
    "5. 画面关注整体空间结构，镜头为微缩沙盘视角，构图稳定，主体整体居中或偏下。",
    "6. 材质统一为工业级玩具 3D 渲染、注塑塑料、软胶、半哑光、干净无噪点。",
    "7. 可选空间母型只能是桌面承载型、水面漂浮型或立体容器型之一。",
    "8. 禁止真人、写实摄影、可识别文字 Logo、复杂剧情、真实自然尺度。",
    "9. 禁止改变物种、改变头型、改变身体结构；不要编写 IP 的颜色、五官、表情、物种、头型、身体结构等外观细节。",
    "【本次只生成场景增量】",
    "后台固定正向 Base Prompt 会在生图前由系统拼接；你不要把 Base Prompt 原文输出给用户。",
    "后台固定负向规则会在生图前由系统拼接；你不要生成 prompt_negative。",
    "【输出契约】",
    getOutputContract(agent),
  ].join("\n");
}

function buildLegacySingleStageSkillCard(agent: ScenarioAgentConfig): string {
  return [
    `【Skill 名称】${agent.name}`,
    `【Skill 目标】${agent.description || "生成单体式圆形舞台场景 Prompt"}`,
    "【核心硬规则】",
    "1. 所有场景统一为正视视角 Eye-level，摄影机在角色正前方。",
    "2. 所有场景统一为 4:3，圆形舞台必须完整显示，不能裁切。",
    "3. 舞台始终是视觉中心，IP 位于舞台中央，角色高度约为舞台直径三分之二。",
    "4. IP 形象来自用户参考图；不要描述、推断或重写 IP 的具体外观，只说明保持 IP 形象不变，保持原有头身比例、原有五官比例、原有轮廓特征。",
    "5. 必须有一个主道具，左侧 1-2 件辅助道具，右侧 1-2 件辅助道具，前景 1 件辅助道具。",
    "6. 道具风格统一、比例可爱夸张，禁止随机散落或遮挡主体。",
    "7. 服饰只能改变装饰层，不得改变角色轮廓、物种、头型和身体结构。",
    "8. 材质统一为设计师潮玩、Vinyl Toy、软胶玩具、商业级 3D 插画渲染。",
    "9. 背景纯白，可点缀 2-4 个白描边扁平贴纸，禁止复杂背景。",
    "10. 禁止改变物种、改变头型、改变身体结构；不要编写 IP 的颜色、五官、表情、物种、头型、身体结构等外观细节。",
    "【输出契约】",
    getOutputContract(agent),
  ].join("\n");
}

function buildFallbackSkillCard(agent: ScenarioAgentConfig): string {
  return [
    `【Skill 名称】${agent.name}`,
    `【Skill 目标】${agent.description}`,
    "【压缩后的后台规则】",
    truncateText(agent.systemPrompt, 1600),
    "【输出契约】",
    getOutputContract(agent),
    "【硬性要求】只输出最终可用 Prompt，不要输出思考过程、推理过程、多个方案或额外说明。",
  ].join("\n");
}

function buildStructuredSkillPrompt(agent: ScenarioAgentConfig): string {
  const skillCard = hasStructuredSkillConfig(agent)
    ? buildConfiguredSkillCard(agent)
    : agent.id === "miniature-world" || agent.trigger.includes("微缩世界")
      ? buildLegacyMiniatureWorldSkillCard(agent)
    : agent.id === "single-stage" || agent.trigger.includes("单体舞台")
      ? buildLegacySingleStageSkillCard(agent)
      : buildFallbackSkillCard(agent);

  return withChineseOutputInstruction([
    "你正在执行一个结构化视觉生成 Skill。",
    "你的任务是根据用户需求、参考图信息和上下文记忆，生成稳定、可直接用于生图的中文 Prompt。",
    "不要展示思考过程，不要复述规则，不要把后台固定规则原文吐给用户。",
    "",
    skillCard,
  ].join("\n"));
}

function withChineseOutputInstruction(systemPrompt: string): string {
  const instruction = "【输出语言硬规则】最终返回必须使用中文。prompt_main、prompt_negative、finalPrompt、自检和所有解释性字段都必须用中文表达；不要输出英文 Prompt，除非是必须保留的专有名词。";

  return systemPrompt.includes("输出语言硬规则")
    ? systemPrompt
    : `${systemPrompt}\n\n${instruction}`;
}

export async function runScenarioAgent(
  input: {
    content: string;
    selectionAssets: SelectionAsset[];
    model?: ModelConfig;
    fallbackConfig?: FintopiaConfig;
    scenarioAgents?: ScenarioAgentConfig[];
    scenarioAgentCases?: ScenarioAgentCaseConfig[];
  },
): Promise<ScenarioAgentDebugResult> {
  const parsed = parseScenarioAgentTrigger(input.content, input.scenarioAgents);

  if (!parsed) {
    return { isScenarioAgentApplied: false };
  }

  if (!input.model) {
    return {
      isScenarioAgentApplied: true,
      trigger: parsed.agent.trigger,
      agentId: parsed.agent.id,
      agentName: parsed.agent.name,
      userTheme: parsed.userTheme,
      referenceCount: input.selectionAssets.length,
      error: "没有可用的语言模型，无法运行场景智能体。",
    };
  }

  const retrievedCases = retrieveScenarioCases({
    agentId: parsed.agent.id,
    userTheme: parsed.userTheme,
    scenarioAgentCases: input.scenarioAgentCases,
  });
  const skillSystemPrompt = buildStructuredSkillPrompt(parsed.agent);
  const memoryContext = formatRetrievedCases(retrievedCases);
  const userContent = [
    `用户主题：${parsed.userTheme || "未填写"}`,
    "",
    `参考图信息：\n${formatReferenceText(input.selectionAssets)}`,
    "",
    `上下文记忆摘要：\n${memoryContext}`,
    "",
    "请基于以上信息生成本次最终 Prompt。只输出输出契约要求的内容。",
  ].join("\n");
  const apiKey = input.model.apiKey || (input.model.apiUrl ? "" : input.fallbackConfig?.apiKey);

  if (!apiKey) {
    return {
      isScenarioAgentApplied: true,
      trigger: parsed.agent.trigger,
      agentId: parsed.agent.id,
      agentName: parsed.agent.name,
      userTheme: parsed.userTheme,
      referenceCount: input.selectionAssets.length,
      error: `当前语言模型「${input.model.name}」缺少 API Key，请检查 Render 环境变量或后台模型配置。`,
    };
  }

  try {
    let response: Response;
    try {
      response = await fetch(buildEndpoint(input.model, input.fallbackConfig), {
        method: "POST",
        headers: buildHeaders(input.model, input.fallbackConfig),
        body: JSON.stringify(buildLanguagePayload(input.model, skillSystemPrompt, userContent)),
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      throw new Error(getReadableLanguageModelError(error, input.model));
    }
    const payload = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      const error = payload.error as { message?: string } | string | undefined;
      throw new Error((typeof error === "string" ? error : error?.message) || "场景智能体调用失败。");
    }

    const rawOutput = extractLanguageText(payload);
    const shouldParseFinalPrompt = parsed.agent.outputMode === "json_final_prompt";
    const parsedOutput = shouldParseFinalPrompt ? extractJsonObject(rawOutput) : undefined;
    const stageOutput = parsed.agent.outputMode === "prompt_sections" ? extractJsonObject(rawOutput) : undefined;
    const promptMain = shouldParseFinalPrompt
      ? buildMiniatureWorldPrompt(parsedOutput, rawOutput)
      : getStringField(stageOutput, ["prompt_main", "promptMain", "mainPrompt"]) || extractMarkdownSection(rawOutput, "prompt_main");
    const promptNegative = parsed.agent.outputMode === "prompt_sections"
      ? getStringField(stageOutput, ["prompt_negative", "promptNegative", "negativePrompt"]) || extractMarkdownSection(rawOutput, "prompt_negative")
      : undefined;

    return {
      isScenarioAgentApplied: true,
      trigger: parsed.agent.trigger,
      agentId: parsed.agent.id,
      agentName: parsed.agent.name,
      userTheme: parsed.userTheme,
      referenceCount: input.selectionAssets.length,
      retrievedCases,
      skillSystemPrompt,
      memoryContext,
      rawOutput,
      parsedOutput,
      promptMain,
      promptNegative,
    };
  } catch (error) {
    return {
      isScenarioAgentApplied: true,
      trigger: parsed.agent.trigger,
      agentId: parsed.agent.id,
      agentName: parsed.agent.name,
      userTheme: parsed.userTheme,
      referenceCount: input.selectionAssets.length,
      error: getReadableLanguageModelError(error),
    };
  }
}

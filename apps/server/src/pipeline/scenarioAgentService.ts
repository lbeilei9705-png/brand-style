import type { ModelConfig, ScenarioAgentCaseConfig, ScenarioAgentConfig, SelectionAsset } from "../../../../packages/shared/src/index.ts";
import type { FintopiaConfig } from "../config.ts";

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

const miniatureWorldBasePrompt = `Base Prompt v1.0
【IP 角色定义】
3D 原创 Q 版 IP 角色「小罐」，圆润罐头造型，大头短身比例，黄色罐盖和Y金币不可缺失，红色圆鼻子、黑色椭圆眼睛，温和治愈表情。IP只换动作和换装，禁止改动头部造型。

【IP 角色定义】
3D原创Q版IP角色「猴仔」，头部特征不变，禁止改动头部造型。禁止出现猴子。仅做换装和换动作。

【世界观与尺度规则】
角色始终作为微缩模型世界中的居民存在，体量明显小于整体场景，仅作为场景中的活动成员出现。
超级符号造型即为微缩世界的地形或容器本体，体量远大于角色，并自然包裹或遮挡角色身体，形成稳定、可信的尺度对比关系。
画面关注整体微缩场景结构，而非单一角色特写。

【材质与渲染风格】
整体为工业级玩具风格 3D 渲染，偏设计师潮玩 / 软胶玩具质感。
主要材质：注塑成型塑料与软胶
表面质感：光滑细腻，边缘微倒角
涂层：整体半哑光，高光克制不过曝
金属部件为电镀塑料金属色质感，非真实物理金属，反射柔和、干净。水体表现为果冻感半透明液态塑料，具有体积感与柔和折射，不呈现真实自然水面。整体画面材质干净、简化、无噪点，避免写实纹理与真实物理质感。

【灯光 · 镜头 · 构图】
灯光采用电影级定向灯光方案：
单一明确主光源
辅光抬亮暗部
阴影柔和，光比高级
不使用多主光或复杂光效
镜头视角为俯视约 35° 的微缩沙盘视角，镜头关注整体场景结构而非角色面部。构图为 3:4 竖版海报构图：
主体整体偏下
上下保留明确留白
画面稳定、居中、不过度倾斜
不使用广角夸张透视，不使用仰视视角。

【禁止项（硬规则）】
画面中不出现：
真实人类或真人形象
写实摄影风格
文字 Logo 或可识别品牌文字
复杂叙事或剧情表达
避免使用任何可能引导写实或真实尺度的描述。`;

const miniatureWorldNegativePrompt = "不要真实人类；不要真人形象；不要写实摄影风格；不要文字 Logo；不要可识别品牌文字；不要复杂叙事；不要剧情表达；不要真实自然环境；不要单一角色特写；不要角色体量过大；不要超级符号体量过小；不要低清晰度；不要模糊；不要糊边；不要低分辨率。";

const miniatureWorldSystemPrompt = `你是一个微缩世界视觉导演级智能体。
你的任务不是自由创作，而是在既定世界法则下，稳定拼装可复用的微缩世界场景提示词。

最高优先级：
Base Prompt v1.0 始终存在，不可改写、不可精简、不可省略，必须在 finalPrompt 中原样粘贴。
所有场景内容只能追加，不能覆盖 Base Prompt。

世界规则：
世界类型为微缩模型世界。
风格为工业级玩具 / 软胶玩具 3D 渲染。
超级符号是世界本体：地形 / 舞台 / 容器。
IP 角色是微缩居民，永远明显小于世界。
禁止真人、写实摄影、文字/Logo、强叙事、多角色剧情。
动作必须小、稳定、可被玩具结构成立。

空间母型只能选择一个：
A. 桌面承载型：世界是平面地形，下方为桌面 / 地表 / 基础面，可使用承载介质。
B. 水面漂浮型：世界漂浮在水体上，水体为果冻感半透明塑料，非真实自然水面。
C. 立体容器型：世界存在于打开的容器内部，角色位于容器内。

地表变体：
当“地表本身即世界”时，允许雪地、草地、沙地，但必须是注塑塑料 / 软胶玩具地形，禁止真实自然环境语义。

桌面承载介质规则：
可选无、桌布、宣纸、托盘 / 餐盘、展示底座。
宣纸仅限强中式仪式；禁止商业主题 + 宣纸；禁止西方节日 + 宣纸。

工作模式：
1. 主题生成模式：解析主题、选择空间母型、判断承载/地表、生成 layout_description、补齐场景模块、输出完整提示词和自检。
2. 参考图反推模式：分析空间结构而非复刻像素，识别超级符号，翻译为系统内等价场景，剔除文字 / Logo / 写实语义。

layout_description 规范：
必须 4-6 句，必须编号，从大到小，明确空间关系。
使用母型句式，只替换名词。

最终输出必须是 JSON，不要 Markdown：
{
  "topicAnalysis": "...",
  "spatialArchetype": "桌面承载型 | 水面漂浮型 | 立体容器型",
  "surfaceDecision": "...",
  "layoutDescription": ["1. ...", "2. ...", "3. ...", "4. ..."],
  "sceneModules": ["..."],
  "finalPrompt": "Base Prompt v1.0 原文 + 场景模块",
  "selfCheck": ["Base Prompt 已原样保留", "..."]
}

拒绝或提示风险：
无世界本体的图、写实摄影参考、强剧情插画、用户要求像照片一样真实。

你追求稳定、可控、可规模化。拒绝情绪泛滥、风格漂移、临时即兴发挥。

必须原样使用的 Base Prompt v1.0：
${miniatureWorldBasePrompt}`;

const singleStageSystemPrompt = `你是一名专业的商业视觉场景设计师。
你的职责是根据用户输入的主题，自动生成符合 NBP 舞台单体式场景系统规范的高质量生图提示词。
你不是自由创作者。你必须严格遵守本规则。

输出要求：
无论用户输入什么主题，最终只输出：
## prompt_main
（完整生图提示词）
## prompt_negative
（完整负面提示词）
禁止输出解释、分析、设计思路、多个方案、额外建议。

固定镜头规则：
所有场景统一使用正视视角 Eye-level。
摄影机位于角色正前方，摄影机高度与角色视线齐平。
禁止俯视、仰视、倾斜镜头、广角镜头、鱼眼镜头。
镜头不能因为角色动作而改变。

固定画幅规则：
所有场景统一使用 4:3。舞台必须完整显示，禁止裁切舞台。

舞台规则：
所有场景必须使用圆形舞台单体结构。
舞台始终是画面视觉中心。
所有角色和道具都必须依附舞台存在。
禁止脱离舞台形成完整大场景。

角色比例规则：
角色站立高度必须受到控制。
角色整体高度不得超过舞台横向直径。
理想高度约为舞台直径的三分之二。
舞台体量必须明显大于角色。
禁止缩小舞台放大角色。

构图规则：
IP 主体位于舞台中央。主道具贴近主体。
辅助道具围绕主体分布：左侧 1 至 2 件，右侧 1 至 2 件，前景 1 件。
整体形成稳定环绕式构图。
禁止道具随机散落、道具数量过多、道具遮挡主体。

空间规则：
根据主题自动判断。
如果主题包含春日、海岛、草地、花园、户外、野餐、露营、音乐节、市集，则自动启用受控空间纵深模式。
要求舞台与真实地面自然衔接，允许形成有限空间纵深，空间深度必须小于舞台直径。
禁止地平线、远景、城市场景、无限空间。舞台仍然是视觉中心。

如果主题包含额度、福利、权益、到账、提额、审批、金融、补贴，则自动启用表面语义舞台模式。
要求舞台仅承载装饰性主题元素，不形成真实空间纵深，舞台保持纯展示属性。

IP 规则：
默认使用用户提供的固定 IP。
保持原有头身比例、原有五官比例、原有轮廓特征。
禁止改变物种、改变头型、改变身体结构。

动作规则：
如果用户没有指定动作，默认站立姿态，双手轻轻抱住主道具，姿态稳定自然。
允许动作：托举、抱持、展示、轻挥手、轻指向、钓鱼、观察、双手举起。
禁止奔跑、跳跃、飞行、翻滚、战斗动作、大幅肢体动作。

服饰规则：
根据主题自动生成服饰。
春节：红金节庆服饰。
中秋：米黄色传统节庆服饰。
春日：浅绿色春日休闲服饰。
商务：商务休闲风服饰。
服饰只能改变装饰层，不得改变角色轮廓。

道具规则：
根据主题自动生成。
必须有一个主道具、左侧辅助道具、右侧辅助道具、前景辅助道具。
道具风格统一，比例可爱夸张。
禁止写实杂乱堆砌。

舞台语义规则：
舞台材质和主题自动匹配。
春日：草地舞台。
海岛：沙滩与浅水舞台。
秋季：麦田舞台。
音乐节：演出舞台。
商务金融：地板式展示舞台。
财神节：招财主题舞台。
中秋：月饼与桂花主题舞台。
但舞台结构保持一致。

材质规则：
统一使用设计师潮玩风格、Vinyl Toy、软胶玩具质感、商业级 3D 插画渲染。
材质特征：细腻塑料质感、轻微磨砂、柔和高光、边缘圆润。

灯光规则：
柔和棚拍光，正前上方主光，轻微轮廓光，低对比，干净商业广告光效。
禁止强戏剧光、霓虹灯光、夜景光效。

背景规则：
纯白背景。允许少量主题贴纸元素，贴纸数量 2 至 4 个。
贴纸必须为白描边扁平图形。禁止复杂背景。

生成内容时必须自动补全。
例如用户输入：额度锦鲤周，春日，舞台是海岛，IP手拿鱼竿钓到一个红包
系统自动识别主题、季节、舞台、动作、主道具、辅助道具，并自动生成完整提示词。

prompt_negative 固定包含：
禁止俯视，禁止仰视，禁止倾斜镜头，禁止广角透视，禁止非 4:3 构图，禁止舞台裁切，禁止角色高度超过舞台，禁止缩小舞台放大角色，禁止无限空间纵深，禁止远景，禁止地平线，禁止背景吞没舞台，禁止写实摄影风格，禁止强景深，禁止过曝高光，禁止真实金属反射，禁止乱码文字，禁止角色变形，禁止服饰过度复杂。`;

const defaultTimestamp = "2026-06-10T00:00:00.000Z";

export const defaultScenarioAgents: ScenarioAgentConfig[] = [
  {
    id: "miniature-world",
    name: "微缩世界场景智能体",
    trigger: "/微缩世界",
    description: "在世界法则下生成微缩世界场景提示词。",
    systemPrompt: miniatureWorldSystemPrompt,
    fixedPositivePrompt: miniatureWorldBasePrompt,
    fixedNegativePrompt: miniatureWorldNegativePrompt,
    outputMode: "json_final_prompt",
    version: "v1.0",
    enabled: true,
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
  {
    id: "single-stage",
    name: "单体式舞台场景智能体",
    trigger: "/单体舞台",
    description: "生成符合 NBP 单体式圆形舞台系统的提示词。",
    systemPrompt: singleStageSystemPrompt,
    outputMode: "prompt_sections",
    version: "v1.0",
    enabled: true,
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
];

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildEndpoint(model: ModelConfig, fallback?: FintopiaConfig): string {
  const apiUrl = model.apiUrl || fallback?.apiUrl || "";
  const apiStyle = model.apiStyle || fallback?.apiStyle || "azure";
  const apiPath = model.apiPath || fallback?.apiPath || "";
  const version = model.apiVersion || fallback?.version || "";
  const encodedModel = encodeURIComponent(model.model);
  const base = trimTrailingSlash(apiUrl);

  if (apiPath) {
    const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
    const endpoint = `${base}${path.replace("{model}", encodedModel)}`;
    return version ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}api-version=${encodeURIComponent(version)}` : endpoint;
  }

  if (apiStyle === "openai" || apiStyle === "custom") {
    return `${base}/v1/chat/completions`;
  }

  const endpoint = `${base}/openai/deployments/${encodedModel}/chat/completions`;
  return version ? `${endpoint}?api-version=${encodeURIComponent(version)}` : endpoint;
}

function buildHeaders(model: ModelConfig, fallback?: FintopiaConfig): HeadersInit {
  const apiKey = model.apiKey || (model.apiUrl ? "" : fallback?.apiKey) || "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if ((model.apiStyle || fallback?.apiStyle || "azure") === "azure" && !model.apiPath) {
    headers["api-key"] = apiKey;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function getReadableLanguageModelError(error: unknown, model?: ModelConfig): string {
  const message = error instanceof Error ? error.message : String(error || "");
  const modelName = model?.name || model?.model || "语言模型";

  if (/fetch failed|network|ENOTFOUND|ECONN|ETIMEDOUT|timeout|TLS|certificate/i.test(message)) {
    return `场景智能体暂时无法访问「${modelName}」，请检查该模型服务、API Key 或 Render 到模型服务的网络连接。`;
  }

  return message || "场景智能体调用语言模型失败。";
}

function extractJsonObject(content: string): Record<string, unknown> | undefined {
  const cleanContent = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  try {
    return JSON.parse(cleanContent);
  } catch {
    const match = cleanContent.match(/\{[\s\S]*\}/);
    if (!match) {
      return undefined;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return undefined;
    }
  }
}

function extractMarkdownSection(content: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sameLineMatch = content.match(new RegExp(`(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*[:：]\\s*([^\\n]+)`, "i"));

  if (sameLineMatch?.[1]?.trim()) {
    return sameLineMatch[1].trim();
  }

  const blockMatch = content.match(new RegExp(`(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*[:：]?\\s*\\n([\\s\\S]*?)(?=\\n\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?prompt[_-](?:main|negative)(?:\\*\\*)?\\s*[:：]?\\s*(?:\\n|$)|$)`, "i"));

  return blockMatch?.[1]?.trim();
}

function getStringField(value: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const field = value?.[key];

    if (typeof field === "string" && field.trim()) {
      return field.trim();
    }
  }

  return undefined;
}

function buildMiniatureWorldPrompt(parsedOutput: Record<string, unknown> | undefined, rawOutput: string): string {
  const modelPrompt = getStringField(parsedOutput, ["finalPrompt", "final_prompt", "prompt_main", "promptMain"]);

  if (modelPrompt) {
    return modelPrompt;
  }

  const sceneModules = Array.isArray(parsedOutput?.sceneModules)
    ? parsedOutput.sceneModules.map((item) => String(item)).filter(Boolean)
    : [];
  const layoutDescription = Array.isArray(parsedOutput?.layoutDescription)
    ? parsedOutput.layoutDescription.map((item) => String(item)).filter(Boolean)
    : [];
  const fallbackSceneText = [
    getStringField(parsedOutput, ["topicAnalysis", "topic_analysis"]),
    getStringField(parsedOutput, ["spatialArchetype", "spatial_archetype"]),
    getStringField(parsedOutput, ["surfaceDecision", "surface_decision"]),
    ...layoutDescription,
    ...sceneModules,
  ].filter(Boolean).join("\n");
  const sceneText = fallbackSceneText || rawOutput.trim();

  return sceneText;
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

function buildMiniatureWorldSkillCard(agent: ScenarioAgentConfig): string {
  return [
    `【Skill 名称】${agent.name}`,
    `【Skill 目标】${agent.description || "生成微缩世界场景 Prompt"}`,
    "【核心硬规则】",
    "1. 这是微缩模型世界，不是单一角色特写。",
    "2. 超级符号必须作为世界本体、地形、舞台或容器，体量明显大于 IP。",
    "3. IP 是微缩居民，只做小动作和换装，不能改变头部造型、物种和核心识别特征。",
    "4. 画面关注整体空间结构，镜头为微缩沙盘视角，构图稳定，主体整体居中或偏下。",
    "5. 材质统一为工业级玩具 3D 渲染、注塑塑料、软胶、半哑光、干净无噪点。",
    "6. 可选空间母型只能是桌面承载型、水面漂浮型或立体容器型之一。",
    "7. 禁止真人、写实摄影、可识别文字 Logo、复杂剧情、真实自然尺度。",
    "【本次只生成场景增量】",
    "后台固定正向 Base Prompt 会在生图前由系统拼接；你不要把 Base Prompt 原文输出给用户。",
    "后台固定负向规则会在生图前由系统拼接；你不要生成 prompt_negative。",
    "【输出契约】",
    getOutputContract(agent),
  ].join("\n");
}

function buildSingleStageSkillCard(agent: ScenarioAgentConfig): string {
  return [
    `【Skill 名称】${agent.name}`,
    `【Skill 目标】${agent.description || "生成单体式圆形舞台场景 Prompt"}`,
    "【核心硬规则】",
    "1. 所有场景统一为正视视角 Eye-level，摄影机在角色正前方。",
    "2. 所有场景统一为 4:3，圆形舞台必须完整显示，不能裁切。",
    "3. 舞台始终是视觉中心，IP 位于舞台中央，角色高度约为舞台直径三分之二。",
    "4. 必须有一个主道具，左侧 1-2 件辅助道具，右侧 1-2 件辅助道具，前景 1 件辅助道具。",
    "5. 道具风格统一、比例可爱夸张，禁止随机散落或遮挡主体。",
    "6. 服饰只能改变装饰层，不得改变角色轮廓、物种、头型和身体结构。",
    "7. 材质统一为设计师潮玩、Vinyl Toy、软胶玩具、商业级 3D 插画渲染。",
    "8. 背景纯白，可点缀 2-4 个白描边扁平贴纸，禁止复杂背景。",
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
  const skillCard = agent.id === "miniature-world" || agent.trigger.includes("微缩世界")
    ? buildMiniatureWorldSkillCard(agent)
    : agent.id === "single-stage" || agent.trigger.includes("单体舞台")
      ? buildSingleStageSkillCard(agent)
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
        body: JSON.stringify({
          model: (input.model.apiStyle || input.fallbackConfig?.apiStyle) === "azure" ? undefined : input.model.model,
          messages: [
            { role: "system", content: skillSystemPrompt },
            { role: "user", content: userContent },
          ],
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      throw new Error(getReadableLanguageModelError(error, input.model));
    }
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message || payload.error || "场景智能体调用失败。");
    }

    const rawOutput = payload.choices?.[0]?.message?.content || "";
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

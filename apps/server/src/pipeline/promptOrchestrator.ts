import type { ModelConfig, PromptBundle } from "../../../../packages/shared/src/index.ts";
import type { FintopiaConfig } from "../config.ts";
import { buildEndpoint, buildHeaders, buildLanguagePayload, extractJsonObject, extractLanguageText, getReadableLanguageModelError } from "./promptLanguageClient.ts";
import { buildReferenceRolePlanContent, buildUserContent, cleanPositivePrompt, dedupeNegativePrompt, formatReferenceRoleNegativeRule, formatReferenceRoleRule, shouldAnalyzeReferenceRoles, validateReferenceRolePlan } from "./promptOrchestrationSupport.ts";
import type { OptimizePromptRequest, ReferenceRolePlan, ValidatedReferenceRolePlan } from "./promptOrchestratorTypes.ts";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string } | string;
}

export class PromptOrchestrator {
  private readonly model: ModelConfig;
  private readonly fallbackConfig?: FintopiaConfig;

  constructor(model: ModelConfig, fallbackConfig?: FintopiaConfig) {
    this.model = model;
    this.fallbackConfig = fallbackConfig;
  }

  private async analyzeReferenceRolePlan(request: OptimizePromptRequest): Promise<ValidatedReferenceRolePlan | undefined> {
    if (!shouldAnalyzeReferenceRoles(request)) {
      return undefined;
    }

    try {
      const endpoint = buildEndpoint(this.model, this.fallbackConfig);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: buildHeaders(this.model, this.fallbackConfig),
        body: JSON.stringify(buildLanguagePayload(
          this.model,
          "你是设计任务 Agent 的意图拆解器。你只负责判断多张参考图的职责关系，并输出严格 JSON。不要生成生图提示词，不要输出解释。",
          buildReferenceRolePlanContent(request),
          0,
        )),
        signal: AbortSignal.timeout(12000),
      });
      const payload = await response.json() as ChatCompletionResponse;

      if (!response.ok) {
        return undefined;
      }

      const content = extractLanguageText(payload);
      const parsed = extractJsonObject<ReferenceRolePlan>(content);

      return validateReferenceRolePlan(parsed, request.referenceAssets || []);
    } catch {
      return undefined;
    }
  }

  async optimize(request: OptimizePromptRequest): Promise<PromptBundle> {
    const referenceRolePlan = await this.analyzeReferenceRolePlan(request);
    const referenceRoleRule = formatReferenceRoleRule(referenceRolePlan);
    const referenceRoleNegativeRule = formatReferenceRoleNegativeRule(referenceRolePlan);
    const requestForOptimization: OptimizePromptRequest = referenceRoleRule
      ? {
        ...request,
        prompt: {
          ...request.prompt,
          positive: `${request.prompt.positive} ${referenceRoleRule}`,
          negative: [request.prompt.negative, referenceRoleNegativeRule].filter(Boolean).join("；"),
        },
      }
      : request;
    const endpoint = buildEndpoint(this.model, this.fallbackConfig);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: buildHeaders(this.model, this.fallbackConfig),
        body: JSON.stringify(buildLanguagePayload(
          this.model,
          "你是一个多模态 3D 视觉生图 Prompt 编排器。你需要阅读用户选中的参考图，结合用户本轮输入、风格套装、材质、形状和配色配置，生成最终可直接用于生图模型的提示词。不要引用历史对话上下文。如果有多张参考图，必须严格按“图1、图2、图3...”区分它们，用户提到某张图时不得混淆。你必须保持用户核心意图；优先级为：用户输入 > 自由搭配（形状/配色/材质）> 风格套装 > 默认高清规则。颜色优先级为：用户输入的颜色/色值最高，当前启用配色第二，风格套装中未作为默认配色启用的颜色描述最低；用户手动选择配色时，优先参考当前配色进行色彩转译，不要让配色规则压过参考图结构、图标数量、元素位置和色块关系；用户未手动选择配色时，可启用风格套装默认配色。未选择任何配色方案时，按照原图色彩执行；清晰度只保留一条简短描述，不要在 positive 堆叠高清、4K、锐利、细节清晰等同义词，禁止项合并到 negative 且去重。只输出 JSON，字段为 positive 和 negative，不要输出 Markdown。",
          buildUserContent(requestForOptimization),
          0.2,
        )),
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      throw new Error(getReadableLanguageModelError(error));
    }
    const payload = await response.json() as ChatCompletionResponse;

    if (!response.ok) {
      const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
      throw new Error(message || `语言模型请求失败，HTTP ${response.status}`);
    }

    const content = extractLanguageText(payload);
    const parsed = extractJsonObject<{ positive?: string; negative?: string }>(content);

    if (!parsed?.positive) {
      throw new Error("语言模型未返回可用的 positive prompt。");
    }

    const positive = cleanPositivePrompt(parsed.positive);

    return {
      ...requestForOptimization.prompt,
      positive: referenceRoleRule && !positive.includes(referenceRoleRule)
        ? `${positive} ${referenceRoleRule}`
        : positive,
      negative: dedupeNegativePrompt([parsed.negative || requestForOptimization.prompt.negative, referenceRoleNegativeRule].filter(Boolean).join("；")),
    };
  }
}

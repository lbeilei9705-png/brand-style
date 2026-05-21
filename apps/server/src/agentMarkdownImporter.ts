import type { AgentConfig, ModelConfig } from "../../../packages/shared/src/index.ts";

interface AgentDraft {
  name: string;
  description: string;
  systemPrompt: string;
  defaultStylePresetId: string;
  defaultNegativeRules: string[];
  driverModelId: string;
  enabled: boolean;
  parseMode: "rule_fallback" | "llm_placeholder";
}

function extractSection(markdown: string, names: string[]): string {
  const lines = markdown.split(/\r?\n/);
  const normalizedNames = names.map((name) => name.toLowerCase());
  const start = lines.findIndex((line) => {
    const heading = line.replace(/^#+\s*/, "").trim().toLowerCase();
    return normalizedNames.includes(heading);
  });

  if (start === -1) {
    return "";
  }

  const body: string[] = [];

  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,6}\s+/.test(lines[index])) {
      break;
    }

    body.push(lines[index]);
  }

  return body.join("\n").trim();
}

function extractTitle(markdown: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
    || markdown.match(/^##\s+(.+)$/m)?.[1]?.trim()
    || "未命名 Agent";
}

function extractList(section: string): string[] {
  return section
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

export function importAgentFromMarkdown(markdown: string, driverModel: ModelConfig | undefined): AgentDraft {
  const name = extractSection(markdown, ["名称", "Name"]) || extractTitle(markdown);
  const description = extractSection(markdown, ["描述", "Description"]) || "从 Markdown 导入的风格智能体。";
  const systemPrompt = extractSection(markdown, ["系统提示词", "System Prompt", "Prompt"])
    || markdown.trim()
    || "你是 3D 图标风格智能体，请保持结构、统一材质、倒角、光影和配色。";
  const stylePreset = extractSection(markdown, ["默认风格模板", "Style Preset"]);
  const negativeRules = extractList(extractSection(markdown, ["负向规则", "Negative Rules", "禁忌规则"]));

  return {
    name,
    description,
    systemPrompt,
    defaultStylePresetId: stylePreset,
    defaultNegativeRules: negativeRules.length ? negativeRules : [
      "不要改变图形语义",
      "不要添加输入图之外的物体",
      "不要复杂背景",
    ],
    driverModelId: driverModel?.id,
    enabled: true,
    parseMode: driverModel?.provider === "mock" ? "rule_fallback" : "llm_placeholder",
  };
}

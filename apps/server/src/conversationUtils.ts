import { randomUUID } from "node:crypto";

export function now(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function titleFromMessage(content: string): string {
  const trimmed = content.trim();

  if (!trimmed) {
    return "新对话";
  }

  return trimmed.length > 18 ? `${trimmed.slice(0, 18)}...` : trimmed;
}

export function stripPromptLabel(value: string): string {
  return value
    .replace(/^\s*(?:prompt_main|prompt_negative|finalPrompt|final_prompt)\s*[:：]\s*/i, "")
    .trim();
}

export function stripFixedPositiveFromScenarioPrompt(prompt: string, fixedPositive: string): string {
  const cleanPrompt = stripPromptLabel(prompt)
    .replace(/\n?\s*(?:prompt_negative|负面提示词)\s*[:：][\s\S]*$/i, "")
    .trim();
  const cleanFixed = stripPromptLabel(fixedPositive);

  if (!cleanPrompt || !cleanFixed) {
    return cleanPrompt;
  }

  if (cleanPrompt.startsWith(cleanFixed)) {
    return cleanPrompt.slice(cleanFixed.length).trim();
  }

  const sceneModuleIndex = cleanPrompt.indexOf("【场景模块】");

  if (sceneModuleIndex >= 0) {
    return cleanPrompt.slice(sceneModuleIndex + "【场景模块】".length).trim();
  }

  return cleanPrompt;
}

export function getHighestReferencedImageIndex(content: string): number {
  const matches = [...content.matchAll(/图\s*(\d+)/g)];

  return matches.reduce((max, match) => Math.max(max, Number(match[1]) || 0), 0);
}

export function parseRequestedImageCount(content: string): number | undefined {
  const numericMatch = content.match(/(?:生成|生|出|做|给我)?\s*([1-4])\s*张(?:图|图片)?/);

  if (numericMatch) {
    return Number(numericMatch[1]);
  }

  const chineseNumbers: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
  };
  const chineseMatch = content.match(/(?:生成|生|出|做|给我)?\s*([一二两三四])\s*张(?:图|图片)?/);

  return chineseMatch ? chineseNumbers[chineseMatch[1]] : undefined;
}

function isPromptSectionHeading(line: string, headings: string[]): boolean {
  const normalized = line.trim().replace(/\s+/g, "");

  return headings.some((heading) => {
    const normalizedHeading = heading.replace(/\s+/g, "");

    return normalized === normalizedHeading
      || normalized.startsWith(`${normalizedHeading}:`)
      || normalized.startsWith(`${normalizedHeading}：`);
  });
}

export type RemovedLowPrioritySegment = {
  source: "styleSkill";
  reason: "manualColorPalette" | "manualMaterials" | "manualShape";
  heading: string;
  content: string;
};

type PromptSectionTarget = {
  heading: string;
  reason: RemovedLowPrioritySegment["reason"];
};

function matchPromptSectionTarget(line: string, targets: PromptSectionTarget[]): PromptSectionTarget | undefined {
  const normalized = line.trim().replace(/\s+/g, "");

  return targets.find((target) => {
    const normalizedHeading = target.heading.replace(/\s+/g, "");

    return normalized === normalizedHeading
      || normalized.startsWith(`${normalizedHeading}:`)
      || normalized.startsWith(`${normalizedHeading}：`);
  });
}

function removePromptSections(systemPrompt: string, targets: PromptSectionTarget[]): {
  prompt: string;
  removedLowPrioritySegments: RemovedLowPrioritySegment[];
} {
  const targetHeadings = targets.map((target) => target.heading);

  if (!targetHeadings.length) {
    return { prompt: systemPrompt, removedLowPrioritySegments: [] };
  }

  const sectionHeadings = [
    "渲染",
    "渲染方式",
    "材质",
    "材质库",
    "品牌色",
    "默认配色",
    "配色",
    "形状",
    "造型",
    "负面词",
    "负面提示词",
  ];
  const lines = systemPrompt.split("\n");
  const result: string[] = [];
  const removedLowPrioritySegments: RemovedLowPrioritySegment[] = [];
  let isRemoving = false;
  let removingTarget: PromptSectionTarget | undefined;
  let removedLines: string[] = [];

  const flushRemovedSegment = () => {
    if (!removingTarget || !removedLines.length) {
      return;
    }

    removedLowPrioritySegments.push({
      source: "styleSkill",
      reason: removingTarget.reason,
      heading: removingTarget.heading,
      content: removedLines.join("\n").trim(),
    });
    removingTarget = undefined;
    removedLines = [];
  };

  for (const line of lines) {
    const nextTarget = matchPromptSectionTarget(line, targets);

    if (!isRemoving && nextTarget) {
      isRemoving = true;
      removingTarget = nextTarget;
      removedLines = [line];
      continue;
    }

    if (isRemoving) {
      if (line.trim() && isPromptSectionHeading(line, sectionHeadings)) {
        flushRemovedSegment();

        if (nextTarget) {
          removingTarget = nextTarget;
          removedLines = [line];
          continue;
        }

        isRemoving = false;
      } else {
        removedLines.push(line);
        continue;
      }
    }

    result.push(line);
  }

  flushRemovedSegment();

  return {
    prompt: result.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    removedLowPrioritySegments,
  };
}

export function applyPriorityDedupeToStylePrompt(
  systemPrompt: string,
  options: { hasManualPalette: boolean; hasManualMaterials: boolean; hasManualShape: boolean },
): {
  prompt: string;
  removedLowPrioritySegments: RemovedLowPrioritySegment[];
} {
  return removePromptSections(systemPrompt, [
    ...(options.hasManualPalette ? [
      { heading: "品牌色", reason: "manualColorPalette" as const },
      { heading: "默认配色", reason: "manualColorPalette" as const },
      { heading: "配色", reason: "manualColorPalette" as const },
    ] : []),
    ...(options.hasManualMaterials ? [
      { heading: "材质", reason: "manualMaterials" as const },
      { heading: "材质库", reason: "manualMaterials" as const },
    ] : []),
    ...(options.hasManualShape ? [
      { heading: "形状", reason: "manualShape" as const },
      { heading: "造型", reason: "manualShape" as const },
    ] : []),
  ]);
}

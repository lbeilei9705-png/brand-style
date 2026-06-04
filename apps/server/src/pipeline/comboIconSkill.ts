export type ComboIconTriggerMode = "explicit" | "implicit" | "none";

export interface ComboIconPlan {
  scene: "combo_icon";
  subject: string;
  mainElement: string;
  supportingElements: string[];
  statusSymbol: string;
}

export interface ComboIconSkillResult {
  isComboIconSkillApplied: boolean;
  triggerMode: ComboIconTriggerMode;
  matchedSubject?: string;
  matchedAlias?: string;
  businessIntent?: string;
  visualDirection?: string;
  candidateElements?: string[];
  comboIconPlan?: ComboIconPlan;
  comboIconPrompt?: string;
}

interface ComboIconSemanticEntry {
  subject: string;
  aliases: string[];
  businessIntent: string;
  visualDirection: string;
  candidateElements: string[];
  mainElement: string;
  supportingElements: string[];
  statusSymbol: string;
}

export const comboIconSemanticMap: ComboIconSemanticEntry[] = [
  {
    subject: "提额",
    aliases: ["额度提升", "提升额度", "涨额度", "额度增长"],
    businessIntent: "额度增长",
    visualDirection: "增长表达",
    candidateElements: ["银行卡", "箭头", "金币", "增长曲线", "额度数字", "能量环"],
    mainElement: "额度卡片",
    supportingElements: ["上升箭头", "金币"],
    statusSymbol: "+",
  },
  {
    subject: "放款",
    aliases: ["到账", "放款成功", "资金到账"],
    businessIntent: "资金到账",
    visualDirection: "到账成功表达",
    candidateElements: ["钱包", "银行卡", "金币", "现金流", "到账通知", "对勾"],
    mainElement: "到账钱包",
    supportingElements: ["银行卡", "金币"],
    statusSymbol: "对勾",
  },
  {
    subject: "安全",
    aliases: ["安全保障", "支付安全", "账户安全"],
    businessIntent: "安全保障",
    visualDirection: "可信保护表达",
    candidateElements: ["盾牌", "锁", "安全环", "星光", "账户卡片", "对勾"],
    mainElement: "安全盾牌",
    supportingElements: ["锁", "星光"],
    statusSymbol: "对勾",
  },
  {
    subject: "审批通过",
    aliases: ["审核通过", "认证通过", "通过审批"],
    businessIntent: "审批通过",
    visualDirection: "确认完成表达",
    candidateElements: ["审批单据", "印章", "对勾", "进度节点", "证件卡片", "高亮标记"],
    mainElement: "审批单据",
    supportingElements: ["印章", "对勾"],
    statusSymbol: "对勾",
  },
  {
    subject: "邀请好友",
    aliases: ["邀请", "拉新", "好友奖励"],
    businessIntent: "邀请增长",
    visualDirection: "社交裂变表达",
    candidateElements: ["好友头像", "邀请卡", "礼盒", "金币", "连接线", "加号"],
    mainElement: "好友头像",
    supportingElements: ["礼盒", "金币"],
    statusSymbol: "+",
  },
  {
    subject: "还款提醒",
    aliases: ["还款", "账单提醒", "到期提醒"],
    businessIntent: "还款提醒",
    visualDirection: "时间提醒表达",
    candidateElements: ["账单", "日历", "时钟", "银行卡", "提醒铃", "日期标记"],
    mainElement: "账单日历",
    supportingElements: ["时钟", "银行卡"],
    statusSymbol: "提醒标记",
  },
];

function includesTerm(text: string, term: string): boolean {
  return text.includes(term);
}

function findSemanticEntry(text: string): { entry: ComboIconSemanticEntry; matchedAlias?: string } | undefined {
  for (const entry of comboIconSemanticMap) {
    if (includesTerm(text, entry.subject)) {
      return { entry };
    }

    const matchedAlias = [...entry.aliases]
      .sort((a, b) => b.length - a.length)
      .find((alias) => includesTerm(text, alias));

    if (matchedAlias) {
      return { entry, matchedAlias };
    }
  }

  return undefined;
}

function isNegated(text: string, value: string): boolean {
  if (!value) {
    return false;
  }

  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(不要出现|不要|去掉)\\s*${escaped}`).test(text);
}

function applyUserNegations(text: string, entry: ComboIconSemanticEntry): ComboIconPlan {
  const supportingElements = entry.supportingElements.filter((element) => !isNegated(text, element));
  const statusSymbol = isNegated(text, entry.statusSymbol) ? "" : entry.statusSymbol;

  return {
    scene: "combo_icon",
    subject: entry.subject,
    mainElement: entry.mainElement,
    supportingElements,
    statusSymbol,
  };
}

function resolveCandidateElements(text: string, entry: ComboIconSemanticEntry): string[] {
  return entry.candidateElements.filter((element) => !isNegated(text, element));
}

export function formatComboIconPrompt(plan: ComboIconPlan): string {
  return [
    "组合图标方案：",
    `主题：${plan.subject}`,
    `主元素：${plan.mainElement}，占画面约70%`,
    plan.supportingElements.length ? `辅助元素：${plan.supportingElements.join("、")}，占画面约20%` : "辅助元素：无，保持画面克制",
    plan.statusSymbol ? `状态符号：${plan.statusSymbol}，占画面约10%` : "状态符号：无",
    "构图规则：主次清晰、元素数量克制、留白充足，不要堆满画面。",
  ].join("\n");
}

export function resolveComboIconSkill(
  text: string,
  options: { explicit?: boolean } = {},
): ComboIconSkillResult {
  const match = findSemanticEntry(text);

  if (!match) {
    return {
      isComboIconSkillApplied: false,
      triggerMode: options.explicit ? "explicit" : "none",
    };
  }

  const comboIconPlan = applyUserNegations(text, match.entry);
  const candidateElements = resolveCandidateElements(text, match.entry);

  return {
    isComboIconSkillApplied: true,
    triggerMode: options.explicit ? "explicit" : "implicit",
    matchedSubject: match.entry.subject,
    matchedAlias: match.matchedAlias,
    businessIntent: match.entry.businessIntent,
    visualDirection: match.entry.visualDirection,
    candidateElements,
    comboIconPlan,
    comboIconPrompt: formatComboIconPrompt(comboIconPlan),
  };
}

export function sanitizeComboIconUserMessage(text: string): string {
  return text
    .replace(/(不要出现|不要|去掉)\s*[^，。；,;、\s]+/g, "")
    .replace(/(但|但是)$/g, "")
    .replace(/[，。；,;、\s]+$/g, "")
    .trim();
}

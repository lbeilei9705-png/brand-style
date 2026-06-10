import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { AgentConfig, ColorPaletteConfig, MaterialPresetConfig, ModelConfig, OperationScenarioConfig, ScenarioAgentConfig, ShapeArchitectureConfig, StyleSkillConfig } from "../../../packages/shared/src/index.ts";
import { defaultScenarioAgents } from "./pipeline/scenarioAgentService.ts";

interface StoredConfig {
  models: ModelConfig[];
  agents: AgentConfig[];
  materials: MaterialPresetConfig[];
  colorPalettes: ColorPaletteConfig[];
  shapeArchitectures: ShapeArchitectureConfig[];
  operationScenarios: OperationScenarioConfig[];
  scenarioAgents?: ScenarioAgentConfig[];
}

function now(): string {
  return new Date().toISOString();
}

function getLeadingNameNumber(name: string): number | undefined {
  const match = name.trim().match(/^(\d+)\s*[-_、.．]/);

  return match ? Number(match[1]) : undefined;
}

function sortByLeadingNameNumber<T extends { name: string }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftNumber = getLeadingNameNumber(left.item.name);
      const rightNumber = getLeadingNameNumber(right.item.name);

      if (leftNumber !== undefined && rightNumber !== undefined && leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }

      if (leftNumber !== undefined && rightNumber === undefined) {
        return -1;
      }

      if (leftNumber === undefined && rightNumber !== undefined) {
        return 1;
      }

      return left.index - right.index;
    })
    .map(({ item }) => item);
}

const seedConfigPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "defaultConfig.seed.json");

const modelApiKeyEnvNames: Record<string, string[]> = {
  "fintopia-gpt-image-2": ["FINTOPIA_API_KEY"],
  "fintopia-gpt-5-5": ["FINTOPIA_API_KEY"],
  "model_1778388177536": ["YUNWU_IMAGE_API_KEY", "FINTOPIA_CUSTOM_API_KEY", "FINTOPIA_API_KEY"],
  "nano-banana-pro": ["YUNWU_IMAGE_API_KEY", "FINTOPIA_CUSTOM_API_KEY", "FINTOPIA_API_KEY"],
};

const mockPreviewModel: ModelConfig = {
  id: "mock-preview",
  name: "Mock Preview",
  provider: "mock",
  model: "mock-preview",
  purpose: "image",
  quality: "auto",
  enabled: true,
  createdAt: "2026-05-08T16:27:18.677Z",
  updatedAt: "2026-05-28T08:00:00.000Z",
};

function withBuiltInModels(models: ModelConfig[]): ModelConfig[] {
  const hasMockPreview = models.some((model) => model.id === mockPreviewModel.id);

  return hasMockPreview
    ? models.map((model) => (model.id === mockPreviewModel.id ? { ...mockPreviewModel, ...model } : model))
    : [...models, mockPreviewModel];
}

function readSeedConfig(): StoredConfig | undefined {
  if (!fs.existsSync(seedConfigPath)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(seedConfigPath, "utf8")) as StoredConfig;
}

function getModelApiKey(model: ModelConfig): string | undefined {
  if (model.apiKey || model.provider === "mock") {
    return model.apiKey;
  }

  const normalizedId = model.id.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  const isYunwuModel = (model.apiUrl || "").includes("yunwu.site");
  const yunwuPurposeEnvNames = isYunwuModel
    ? model.purpose === "language"
      ? ["YUNWU_LANGUAGE_API_KEY"]
      : ["YUNWU_IMAGE_API_KEY"]
    : [];
  const envNames = [
    `MODEL_API_KEY_${normalizedId}`,
    ...yunwuPurposeEnvNames,
    ...(modelApiKeyEnvNames[model.id] || []),
  ];

  for (const envName of envNames) {
    const value = process.env[envName];

    if (value) {
      return value;
    }
  }

  return undefined;
}

function hydrateConfig(config: StoredConfig): StoredConfig {
  return {
    models: withBuiltInModels(config.models).map((model) => ({
      ...model,
      apiKey: getModelApiKey(model),
    })),
    agents: config.agents.map((agent) => ({ ...agent })),
    materials: config.materials.map((material) => ({ ...material })),
    colorPalettes: config.colorPalettes.map((palette) => ({ ...palette })),
    shapeArchitectures: config.shapeArchitectures.map((architecture) => ({ ...architecture })),
    operationScenarios: config.operationScenarios.map((scenario) => ({ ...scenario })),
    scenarioAgents: (config.scenarioAgents?.length ? config.scenarioAgents : defaultScenarioAgents).map((agent) => ({ ...agent })),
  };
}

function defaultConfig(): StoredConfig {
  const seedConfig = readSeedConfig();

  if (seedConfig) {
    return hydrateConfig(seedConfig);
  }

  const timestamp = now();

  return {
    models: [
      {
        id: "fintopia-gpt-image-2",
        name: "Fintopia GPT Image 2",
        provider: "fintopia",
        model: process.env.FINTOPIA_IMAGE_MODEL || "gpt-image-2",
        apiUrl: process.env.FINTOPIA_API_URL || "https://all-in-one-ai.fintopia.tech/",
        apiKey: process.env.FINTOPIA_API_KEY,
        apiVersion: process.env.FINTOPIA_API_VERSION || "2024-02-01",
        apiStyle: "azure",
        apiPath: "",
        purpose: "image",
        quality: "auto",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    agents: [
      {
        id: "brand-3d-director",
        name: "品牌 3D 风格 Skill",
        description: "默认风格 Skill：保持结构、统一倒角、材质、光影和配色。",
        systemPrompt: "你是品牌 3D 图标风格 Skill。你需要优先保持输入图形的主轮廓和语义，统一为圆润、低细节、商业化的 3D 图标风格。输出必须遵循固定材质、倒角、光影和配色比例，不允许添加多余元素。",
        defaultStylePresetId: "",
        defaultNegativeRules: [
          "不要改变图形语义",
          "不要添加输入图之外的物体",
          "不要复杂背景",
          "不要脏污纹理",
        ],
        driverModelId: "fintopia-gpt-image-2",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "finance-soft-agent",
        name: "金融软质 3D 风格 Skill",
        description: "偏金融产品的干净、可信、柔和 3D 图标风格 Skill。",
        systemPrompt: "你是金融产品 3D 图标设计风格 Skill。输出需要稳定、干净、可信，使用柔和塑料和轻微玻璃质感，避免夸张材质、复杂背景和过曝高光。",
        defaultStylePresetId: "finance_soft_3d",
        defaultNegativeRules: [
          "不要复杂背景",
          "不要厚重纹理",
          "不要夸张透视",
          "不要过曝高光",
        ],
        driverModelId: "fintopia-gpt-image-2",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "style-skill-2",
        name: "风格2",
        description: "3D 品牌图标化渲染风格：柔光棚拍、半透明树脂/亚克力、水磨石、喷砂塑料与缎面金属材质。",
        systemPrompt: "你是 3D 品牌图标化渲染风格 Skill。渲染规则：3D品牌图标化渲染，柔光棚拍主光，大面积软箱照明，反射受控，不过曝高光，阴影柔和，AO极轻；三分之四视角（3/4），构图简洁克制，主体突出，留白充足；统一倒角与厚度，轮廓干净利落；高分辨率，细节清晰，画面超干净，无噪点，极简白色背景。材质候选：1. 半透明树脂/亚克力，厚边、轻折射、细密闪点；2. 白色水磨石/人造石，哑光平整表面，少量微speckle颗粒；3. 细腻哑光喷砂塑料，中性白灰结构体块，反射柔和；4. 缎面拉丝金属，银灰色，柔亮边缘高光，受控反射。生成时优先保持输入图形的结构语义，将其转译为统一、高级、干净的商业品牌 3D 图标。",
        defaultStylePresetId: "",
        defaultNegativeRules: [
          "不要低清晰度",
          "不要模糊",
          "不要糊边",
          "不要柔焦",
          "不要景深虚化",
          "不要运动模糊",
          "不要低模",
          "不要粗糙大纹理",
          "不要杂乱构图",
          "不要复杂背景",
          "不要多余元素",
          "不要脏污划痕",
          "不要噪点",
          "不要颗粒过重",
          "不要廉价塑料感",
          "不要过度卡通玩具风",
          "不要镜面电镀铬",
          "不要过曝高光",
          "不要死黑阴影",
          "不要长段文字",
          "不要水印",
          "不要logo错误",
          "不要人物",
          "不要手",
          "不要脸",
        ],
        driverModelId: "fintopia-gpt-image-2",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    materials: [
      {
        id: "translucent-resin-acrylic",
        name: "半透明树脂 / 亚克力",
        description: "厚边、轻折射、细密闪点，适合高级透明质感图标。",
        prompt: "半透明树脂/亚克力，厚边、轻折射、柔和透光，内部有细密闪点，边缘厚度明确，反射受控。",
        previewColor: "#DFF7FF",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "white-terrazzo-stone",
        name: "白色水磨石 / 人造石",
        description: "哑光平整表面，少量微 speckle 颗粒。",
        prompt: "白色水磨石/人造石，哑光平整表面，少量微speckle颗粒，质感干净克制，不粗糙。",
        previewColor: "#F4F1EA",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "matte-sandblasted-plastic",
        name: "哑光喷砂塑料",
        description: "中性白灰结构体块，反射柔和。",
        prompt: "细腻哑光喷砂塑料，中性白灰结构体块，表面细腻，反射柔和，低噪点。",
        previewColor: "#D9DEE7",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "satin-brushed-metal",
        name: "缎面拉丝金属",
        description: "银灰色，柔亮边缘高光，受控反射。",
        prompt: "缎面拉丝金属，银灰色，细腻拉丝纹理，柔亮边缘高光，反射受控，不要镜面电镀铬。",
        previewColor: "#C9D0D8",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    colorPalettes: [
      {
        id: "brand-blue-violet",
        name: "品牌蓝紫",
        description: "蓝紫主色，适合科技感和品牌主视觉。",
        colors: ["#2563EB", "#7C3AED", "#38BDF8"],
        prompt: "品牌蓝、紫色为主色，清透天蓝为辅助色。",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "fresh-finance",
        name: "清新金融",
        description: "蓝、绿、白灰组合，干净可信。",
        colors: ["#2563EB", "#22C55E", "#F8FAFC"],
        prompt: "可信蓝、清新绿为主色，极浅白灰为辅助色。",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "warm-candy",
        name: "暖盒彩糖",
        description: "柠檬黄、浅粉、橙黄的柔和渐变倾向。",
        colors: ["#FDE68A", "#F9A8D4", "#FDBA74"],
        prompt: "柠檬黄、浅粉、橙黄为主色，浅色为辅助色。",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    shapeArchitectures: [
      {
        id: "preserve-original-form",
        name: "1-原图结构",
        description: "严格保留参考图主体轮廓、元素位置和视觉层级。",
        prompt: "形状以原图为准，严格保留主体轮廓、元素相对位置、图形数量、视觉层级和整体构图，只做材质、体积、光影或风格转译。",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "rounded-volume-blocks",
        name: "2-圆润体块",
        description: "将图形概括为圆润、厚实、可触摸的体块结构。",
        prompt: "形状采用圆润体块结构，把平面图形转译为厚实、饱满、边缘圆滑的 3D 块面，保持识别特征清楚，不增加无关元素。",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "layered-patch",
        name: "3-层叠贴片",
        description: "以多层贴片、叠片和卡片化结构组织图形。",
        prompt: "形状采用层叠贴片结构，将元素拆分为清晰的多层贴片、叠片或卡片化部件，边缘有厚度，层级关系明确，整体仍保持原图语义。",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "soft-inflated-form",
        name: "4-软体鼓包",
        description: "强调柔软鼓胀、轻微挤压和自然压痕的软体结构。",
        prompt: "形状采用软体鼓包结构，主体具有柔软膨胀感、自然圆角、轻微挤压、压痕和回弹体积，适合软包、充气、泡棉或织物材质。",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "modular-geometric",
        name: "5-模块几何",
        description: "用清晰几何模块和秩序化部件重组图形。",
        prompt: "形状采用模块化几何结构，用清晰的几何部件、秩序化分块和稳定比例重组图形，轮廓干净，结构理性，不改变核心识别语义。",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    operationScenarios: [
      {
        id: "new-user-growth",
        name: "新客增长",
        description: "面向新用户注册、首单、领取权益等增长场景。",
        fixedPrompt: "生成一个可用于运营活动入口或运营 banner 的 3D 图标。主体清晰，构图聚焦，画面需要有明确转化引导感，适合在产品界面中作为运营视觉资产使用。",
        variablePrompt: "围绕新用户增长场景，表达注册、领取新人权益或完成首单转化。画面需要表达欢迎感、信任感和轻量激励。",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "member-benefit",
        name: "会员权益",
        description: "面向会员权益、等级、积分、专属福利等场景。",
        fixedPrompt: "生成一个可用于会员中心、权益卡片或营销弹窗的 3D 图标。视觉需要高级、明确、有奖励感，并保持商业产品界面的可用性。",
        variablePrompt: "围绕会员权益场景，体现专属福利、等级成长或积分奖励。",
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    scenarioAgents: defaultScenarioAgents,
  };
}

export class ConfigStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "config.json");
    fs.mkdirSync(dataDir, { recursive: true });
  }

  read(): StoredConfig {
    if (!fs.existsSync(this.filePath)) {
      const initial = defaultConfig();
      this.write(initial);
      return initial;
    }

    const config = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<StoredConfig>;
    const defaults = defaultConfig();
    return hydrateConfig({
      models: (config.models || defaults.models).map((model) => ({
        apiStyle: "azure",
        ...model,
        purpose: model.purpose || (model.model.includes("image") || model.provider === "mock" ? "image" : "language"),
        quality: model.quality || "auto",
        enabled: model.enabled ?? true,
      })),
      agents: (config.agents || defaults.agents).map((agent) => ({
        driverModelId: "fintopia-gpt-image-2",
        ...agent,
        enabled: agent.enabled ?? true,
      })),
      materials: (config.materials || defaults.materials).map((material) => ({
        ...material,
        enabled: material.enabled ?? true,
      })),
      colorPalettes: (config.colorPalettes || defaults.colorPalettes).map((palette) => ({
        ...palette,
        enabled: palette.enabled ?? true,
      })),
      shapeArchitectures: (config.shapeArchitectures || defaults.shapeArchitectures).map((architecture) => ({
        ...architecture,
        enabled: architecture.enabled ?? true,
      })),
      operationScenarios: (config.operationScenarios || defaults.operationScenarios).map((scenario) => ({
        ...scenario,
        fixedPrompt: scenario.fixedPrompt || scenario.content || "",
        variablePrompt: scenario.variablePrompt || "",
        enabled: scenario.enabled ?? true,
      })),
      scenarioAgents: (config.scenarioAgents || defaults.scenarioAgents).map((agent) => ({
        ...agent,
        outputMode: agent.outputMode || (agent.id === "miniature-world" ? "json_final_prompt" : "prompt_sections"),
        version: agent.version || "v1.0",
        enabled: agent.enabled ?? true,
      })),
    });
  }

  write(config: StoredConfig): void {
    fs.writeFileSync(this.filePath, `${JSON.stringify(config, null, 2)}\n`);
  }

  listModels(): ModelConfig[] {
    return this.read().models;
  }

  upsertModel(model: Partial<ModelConfig> & Pick<ModelConfig, "name" | "provider" | "model">): ModelConfig {
    const config = this.read();
    const timestamp = now();
    const id = model.id || `model_${Date.now()}`;
    const existing = config.models.find((item) => item.id === id);
    const next: ModelConfig = {
      id,
      name: model.name,
      provider: model.provider,
      model: model.model,
      apiUrl: model.apiUrl,
      apiKey: model.apiKey ?? existing?.apiKey,
      apiVersion: model.apiVersion,
      apiStyle: model.apiStyle || existing?.apiStyle || "azure",
      apiPath: model.apiPath,
      purpose: model.purpose || existing?.purpose || (model.model.includes("image") || model.provider === "mock" ? "image" : "language"),
      quality: model.quality || "auto",
      enabled: model.enabled ?? true,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    config.models = existing
      ? config.models.map((item) => (item.id === id ? next : item))
      : [...config.models, next];
    this.write(config);
    return next;
  }

  deleteModel(modelId: string): boolean {
    const config = this.read();
    const before = config.models.length;
    config.models = config.models.filter((model) => model.id !== modelId);
    this.write(config);
    return config.models.length !== before;
  }

  listAgents(): AgentConfig[] {
    return this.read().agents;
  }

  listStyleSkills(): StyleSkillConfig[] {
    return sortByLeadingNameNumber(this.listAgents());
  }

  upsertAgent(agent: Partial<AgentConfig> & Pick<AgentConfig, "name" | "description" | "systemPrompt" | "defaultStylePresetId">): AgentConfig {
    const config = this.read();
    const timestamp = now();
    const id = agent.id || `agent_${Date.now()}`;
    const existing = config.agents.find((item) => item.id === id);
    const next: AgentConfig = {
      id,
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      defaultStylePresetId: agent.defaultStylePresetId,
      defaultNegativeRules: agent.defaultNegativeRules || [],
      driverModelId: agent.driverModelId || existing?.driverModelId || "fintopia-gpt-image-2",
      enabled: agent.enabled ?? true,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    config.agents = existing
      ? config.agents.map((item) => (item.id === id ? next : item))
      : [...config.agents, next];
    this.write(config);
    return next;
  }

  upsertStyleSkill(skill: Partial<StyleSkillConfig> & Pick<StyleSkillConfig, "name" | "description" | "systemPrompt" | "defaultStylePresetId">): StyleSkillConfig {
    return this.upsertAgent(skill);
  }

  deleteAgent(agentId: string): boolean {
    const config = this.read();
    const before = config.agents.length;
    config.agents = config.agents.filter((agent) => agent.id !== agentId);
    this.write(config);
    return config.agents.length !== before;
  }

  deleteStyleSkill(skillId: string): boolean {
    return this.deleteAgent(skillId);
  }

  listMaterials(): MaterialPresetConfig[] {
    return this.read().materials;
  }

  upsertMaterial(material: Partial<MaterialPresetConfig> & Pick<MaterialPresetConfig, "name" | "description" | "prompt">): MaterialPresetConfig {
    const config = this.read();
    const timestamp = now();
    const id = material.id || `material_${Date.now()}`;
    const existing = config.materials.find((item) => item.id === id);
    const next: MaterialPresetConfig = {
      id,
      name: material.name,
      description: material.description,
      prompt: material.prompt,
      previewColor: material.previewColor || existing?.previewColor,
      enabled: material.enabled ?? true,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    config.materials = existing
      ? config.materials.map((item) => (item.id === id ? next : item))
      : [...config.materials, next];
    this.write(config);
    return next;
  }

  deleteMaterial(materialId: string): boolean {
    const config = this.read();
    const before = config.materials.length;
    config.materials = config.materials.filter((material) => material.id !== materialId);
    this.write(config);
    return config.materials.length !== before;
  }

  listColorPalettes(): ColorPaletteConfig[] {
    return this.read().colorPalettes;
  }

  upsertColorPalette(palette: Partial<ColorPaletteConfig> & Pick<ColorPaletteConfig, "name" | "description" | "colors" | "prompt">): ColorPaletteConfig {
    const config = this.read();
    const timestamp = now();
    const id = palette.id || `palette_${Date.now()}`;
    const existing = config.colorPalettes.find((item) => item.id === id);
    const next: ColorPaletteConfig = {
      id,
      name: palette.name,
      description: palette.description,
      colors: palette.colors,
      prompt: palette.prompt,
      enabled: palette.enabled ?? true,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    config.colorPalettes = existing
      ? config.colorPalettes.map((item) => (item.id === id ? next : item))
      : [...config.colorPalettes, next];
    this.write(config);
    return next;
  }

  deleteColorPalette(paletteId: string): boolean {
    const config = this.read();
    const before = config.colorPalettes.length;
    config.colorPalettes = config.colorPalettes.filter((palette) => palette.id !== paletteId);
    this.write(config);
    return config.colorPalettes.length !== before;
  }

  listShapeArchitectures(): ShapeArchitectureConfig[] {
    return sortByLeadingNameNumber(this.read().shapeArchitectures);
  }

  upsertShapeArchitecture(architecture: Partial<ShapeArchitectureConfig> & Pick<ShapeArchitectureConfig, "name" | "description" | "prompt">): ShapeArchitectureConfig {
    const config = this.read();
    const timestamp = now();
    const id = architecture.id || `shape_architecture_${Date.now()}`;
    const existing = config.shapeArchitectures.find((item) => item.id === id);
    const next: ShapeArchitectureConfig = {
      id,
      name: architecture.name,
      description: architecture.description,
      prompt: architecture.prompt,
      enabled: architecture.enabled ?? true,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    config.shapeArchitectures = existing
      ? config.shapeArchitectures.map((item) => (item.id === id ? next : item))
      : [...config.shapeArchitectures, next];
    this.write(config);
    return next;
  }

  deleteShapeArchitecture(architectureId: string): boolean {
    const config = this.read();
    const before = config.shapeArchitectures.length;
    config.shapeArchitectures = config.shapeArchitectures.filter((architecture) => architecture.id !== architectureId);
    this.write(config);
    return config.shapeArchitectures.length !== before;
  }

  listOperationScenarios(): OperationScenarioConfig[] {
    return this.read().operationScenarios;
  }

  upsertOperationScenario(scenario: Partial<OperationScenarioConfig> & Pick<OperationScenarioConfig, "name" | "description">): OperationScenarioConfig {
    const config = this.read();
    const timestamp = now();
    const id = scenario.id || `scenario_${Date.now()}`;
    const existing = config.operationScenarios.find((item) => item.id === id);
    const fixedPrompt = scenario.fixedPrompt || scenario.content || existing?.fixedPrompt || existing?.content || "";
    const variablePrompt = scenario.variablePrompt || existing?.variablePrompt || "";
    const next: OperationScenarioConfig = {
      id,
      name: scenario.name,
      description: scenario.description,
      fixedPrompt,
      variablePrompt,
      enabled: scenario.enabled ?? true,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    config.operationScenarios = existing
      ? config.operationScenarios.map((item) => (item.id === id ? next : item))
      : [...config.operationScenarios, next];
    this.write(config);
    return next;
  }

  deleteOperationScenario(scenarioId: string): boolean {
    const config = this.read();
    const before = config.operationScenarios.length;
    config.operationScenarios = config.operationScenarios.filter((scenario) => scenario.id !== scenarioId);
    this.write(config);
    return config.operationScenarios.length !== before;
  }

  listScenarioAgents(): ScenarioAgentConfig[] {
    return this.read().scenarioAgents || defaultScenarioAgents;
  }

  upsertScenarioAgent(agent: Partial<ScenarioAgentConfig> & Pick<ScenarioAgentConfig, "name" | "trigger" | "description" | "systemPrompt">): ScenarioAgentConfig {
    const config = this.read();
    const timestamp = now();
    const id = agent.id || `scenario_agent_${Date.now()}`;
    const scenarioAgents = config.scenarioAgents || [];
    const existing = scenarioAgents.find((item) => item.id === id);
    const next: ScenarioAgentConfig = {
      id,
      name: agent.name,
      trigger: agent.trigger.startsWith("/") ? agent.trigger : `/${agent.trigger}`,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      outputMode: agent.outputMode || existing?.outputMode || "prompt_sections",
      driverModelId: agent.driverModelId || existing?.driverModelId,
      version: agent.version || existing?.version || "v1.0",
      enabled: agent.enabled ?? true,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    config.scenarioAgents = existing
      ? scenarioAgents.map((item) => (item.id === id ? next : item))
      : [...scenarioAgents, next];
    this.write(config);
    return next;
  }

  deleteScenarioAgent(agentId: string): boolean {
    const config = this.read();
    const scenarioAgents = config.scenarioAgents || [];
    const before = scenarioAgents.length;
    config.scenarioAgents = scenarioAgents.filter((agent) => agent.id !== agentId);
    this.write(config);
    return config.scenarioAgents.length !== before;
  }
}

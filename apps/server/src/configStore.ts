import fs from "fs";
import path from "path";
import type { AgentConfig, ColorPaletteConfig, MaterialPresetConfig, ModelConfig, OperationScenarioConfig, ScenarioAgentCaseConfig, ScenarioAgentConfig, ShapeArchitectureConfig, StyleSkillConfig } from "../../../packages/shared/src/index.ts";
import { defaultConfig, hydrateConfig, now, sortByLeadingNameNumber } from "./configDefaults.ts";
import { defaultScenarioAgents } from "./pipeline/scenarioAgentDefaults.ts";
import type { RemoteConfigStore } from "./storage/supabaseConfigStore.ts";

export interface StoredConfig {
  models: ModelConfig[];
  agents: AgentConfig[];
  materials: MaterialPresetConfig[];
  colorPalettes: ColorPaletteConfig[];
  shapeArchitectures: ShapeArchitectureConfig[];
  operationScenarios: OperationScenarioConfig[];
  scenarioAgents?: ScenarioAgentConfig[];
  scenarioAgentCases?: ScenarioAgentCaseConfig[];
}

export class ConfigStore {
  private readonly filePath: string;
  private readonly remoteStore?: RemoteConfigStore<StoredConfig>;
  private remoteWriteQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string, remoteStore?: RemoteConfigStore<StoredConfig>) {
    this.filePath = path.join(dataDir, "config.json");
    this.remoteStore = remoteStore;
    fs.mkdirSync(dataDir, { recursive: true });
  }

  async syncFromRemote(): Promise<void> {
    if (!this.remoteStore?.enabled) {
      return;
    }

    const remoteConfig = await this.remoteStore.read();

    if (remoteConfig) {
      this.writeLocal(hydrateConfig(remoteConfig));
      return;
    }

    await this.remoteStore.write(this.read());
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
      scenarioAgents: (config.scenarioAgents || defaults.scenarioAgents || []).map((agent) => {
        const defaultAgent = (defaults.scenarioAgents || []).find((item) => item.id === agent.id);

        return {
          ...agent,
          skillRole: agent.skillRole ?? defaultAgent?.skillRole ?? "",
          coreRules: agent.coreRules || defaultAgent?.coreRules || [],
          outputContract: agent.outputContract ?? defaultAgent?.outputContract ?? "",
          positiveTemplate: agent.positiveTemplate ?? defaultAgent?.positiveTemplate ?? "",
          forbiddenRules: agent.forbiddenRules || defaultAgent?.forbiddenRules || [],
          memoryPolicy: agent.memoryPolicy ?? defaultAgent?.memoryPolicy ?? "",
          caseReferencePolicy: agent.caseReferencePolicy ?? defaultAgent?.caseReferencePolicy ?? "",
          outputMode: agent.outputMode || (agent.id === "miniature-world" ? "json_final_prompt" : "prompt_sections"),
          version: agent.version || "v1.0",
          enabled: agent.enabled ?? true,
        };
      }),
      scenarioAgentCases: (config.scenarioAgentCases || defaults.scenarioAgentCases || []).map((item) => ({
        ...item,
        imageUrl: item.imageUrl || "",
        thumbnailUrl: item.thumbnailUrl || item.imageUrl || "",
        tags: item.tags || [],
        rating: item.rating || "excellent",
        enabled: item.enabled ?? true,
      })),
    });
  }

  write(config: StoredConfig): void {
    this.writeLocal(config);
    if (this.remoteStore?.enabled) {
      this.remoteWriteQueue = this.remoteWriteQueue
        .then(() => this.remoteStore?.write(config))
        .then(() => undefined)
        .catch((error) => {
          console.error(error instanceof Error ? error.message : error);
        });
    }
  }

  private writeLocal(config: StoredConfig): void {
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

  upsertMaterial(material: Partial<MaterialPresetConfig> & Pick<MaterialPresetConfig, "name" | "prompt">): MaterialPresetConfig {
    const config = this.read();
    const timestamp = now();
    const id = material.id || `material_${Date.now()}`;
    const existing = config.materials.find((item) => item.id === id);
    const next: MaterialPresetConfig = {
      id,
      name: material.name,
      description: material.description ?? existing?.description ?? material.name,
      prompt: material.prompt,
      previewColor: material.previewColor || existing?.previewColor,
      previewImageUrl: material.previewImageUrl !== undefined ? material.previewImageUrl : existing?.previewImageUrl,
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
      skillRole: agent.skillRole ?? existing?.skillRole ?? "",
      coreRules: agent.coreRules ?? existing?.coreRules ?? [],
      outputContract: agent.outputContract ?? existing?.outputContract ?? "",
      positiveTemplate: agent.positiveTemplate ?? existing?.positiveTemplate ?? "",
      forbiddenRules: agent.forbiddenRules ?? existing?.forbiddenRules ?? [],
      memoryPolicy: agent.memoryPolicy ?? existing?.memoryPolicy ?? "",
      caseReferencePolicy: agent.caseReferencePolicy ?? existing?.caseReferencePolicy ?? "",
      fixedPositivePrompt: agent.fixedPositivePrompt ?? existing?.fixedPositivePrompt ?? "",
      fixedNegativePrompt: agent.fixedNegativePrompt ?? existing?.fixedNegativePrompt ?? "",
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

  listScenarioAgentCases(): ScenarioAgentCaseConfig[] {
    return this.read().scenarioAgentCases || [];
  }

  upsertScenarioAgentCase(
    item: Partial<ScenarioAgentCaseConfig> & Pick<ScenarioAgentCaseConfig, "scenarioAgentId" | "title" | "userInput" | "positivePrompt">,
  ): ScenarioAgentCaseConfig {
    const config = this.read();
    const timestamp = now();
    const id = item.id || `scenario_agent_case_${Date.now()}`;
    const scenarioAgentCases = config.scenarioAgentCases || [];
    const existing = scenarioAgentCases.find((caseItem) => caseItem.id === id);
    const next: ScenarioAgentCaseConfig = {
      id,
      scenarioAgentId: item.scenarioAgentId,
      title: item.title,
      userInput: item.userInput,
      positivePrompt: item.positivePrompt,
      negativePrompt: item.negativePrompt || "",
      imageUrl: item.imageUrl || existing?.imageUrl || "",
      thumbnailUrl: item.thumbnailUrl || item.imageUrl || existing?.thumbnailUrl || existing?.imageUrl || "",
      tags: item.tags || existing?.tags || [],
      rating: item.rating || existing?.rating || "excellent",
      notes: item.notes || "",
      enabled: item.enabled ?? true,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    config.scenarioAgentCases = existing
      ? scenarioAgentCases.map((caseItem) => (caseItem.id === id ? next : caseItem))
      : [...scenarioAgentCases, next];
    this.write(config);
    return next;
  }

  deleteScenarioAgentCase(caseId: string): boolean {
    const config = this.read();
    const scenarioAgentCases = config.scenarioAgentCases || [];
    const before = scenarioAgentCases.length;
    config.scenarioAgentCases = scenarioAgentCases.filter((item) => item.id !== caseId);
    this.write(config);
    return config.scenarioAgentCases.length !== before;
  }
}

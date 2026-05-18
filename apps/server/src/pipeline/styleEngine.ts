import { getStylePreset } from "../../../../packages/shared/src/index.ts";
import type { StylePreset } from "../../../../packages/shared/src/index.ts";

export interface StyleParameterPack {
  stylePreset?: StylePreset;
  summary?: {
    shapeProfile: string;
    volumeRatio: number;
    bevelOuter: string;
    bevelInner: string;
    materialPrimary: string;
    materialSecondary: string;
    lighting: string;
    composition: string;
    detailLevel: string;
  };
}

export function buildStylePack(stylePresetId?: string): StyleParameterPack {
  const stylePreset = getStylePreset(stylePresetId);

  if (!stylePreset) {
    return {};
  }

  return {
    stylePreset,
    summary: {
      shapeProfile: `${stylePreset.shapeRules.silhouette}_${stylePreset.shapeRules.detailLevel}`,
      volumeRatio: stylePreset.volumeRules.extrusionRatio,
      bevelOuter: stylePreset.bevelRules.outer,
      bevelInner: stylePreset.bevelRules.inner,
      materialPrimary: stylePreset.materialRules.primary,
      materialSecondary: stylePreset.materialRules.secondary,
      lighting: stylePreset.lightingRules.mainLight,
      composition: `${stylePreset.compositionRules.layout}_${stylePreset.compositionRules.view}_view`,
      detailLevel: stylePreset.shapeRules.detailLevel,
    },
  };
}

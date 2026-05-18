import type { StylePreset } from "./types.ts";

export const stylePresets: StylePreset[] = [
  {
    id: "finance_soft_3d",
    name: "Finance Soft 3D",
    shapeRules: {
      silhouette: "rounded",
      detailLevel: "low",
    },
    volumeRules: {
      extrusionRatio: 0.08,
      frontSideRatio: "8:2",
    },
    bevelRules: {
      outer: "medium",
      inner: "small",
    },
    materialRules: {
      primary: "matte_plastic",
      secondary: "subtle_glass",
    },
    lightingRules: {
      mainLight: "top_left_45",
      shadow: "soft",
      ambientOcclusion: "light",
    },
    colorRules: {
      palette: ["#2563EB", "#22C55E", "#F8FAFC"],
      primaryRatio: 0.72,
      secondaryRatio: 0.18,
      accentRatio: 0.1,
    },
    compositionRules: {
      view: "3q",
      layout: "center",
    },
    negativeRules: [
      "不要复杂背景",
      "不要添加额外物体",
      "不要厚重纹理",
      "不要过曝高光",
    ],
  },
];

export function getStylePreset(stylePresetId?: string): StylePreset | undefined {
  return stylePresets.find((preset) => preset.id === stylePresetId);
}

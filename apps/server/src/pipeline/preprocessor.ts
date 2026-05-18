import type { GenerationConstraints, GenerationMode, InputAsset, PreprocessResult } from "../../../../packages/shared/src/index.ts";

function modeForInput(type: InputAsset["type"]): GenerationMode {
  if (type === "line_sketch") {
    return "sketch_to_3d";
  }

  if (type === "3d_other") {
    return "other3d_to_brand3d";
  }

  if (type === "illustration") {
    return "illustration_to_icon";
  }

  return "flat_to_3d";
}

function formatForMime(mimeType: string): PreprocessResult["normalizedAsset"]["format"] {
  if (mimeType === "image/svg+xml") {
    return "svg";
  }

  if (mimeType === "application/pdf") {
    return "pdf";
  }

  if (mimeType.startsWith("image/")) {
    return "png";
  }

  return "unknown";
}

export function preprocessInput(inputAsset: InputAsset, constraints: GenerationConstraints): PreprocessResult {
  const steps = [
    "classify_input_type",
    "remove_background_if_needed",
    "extract_silhouette",
    "normalize_to_centered_icon_canvas",
  ];

  if (inputAsset.type === "flat_icon") {
    steps.push("merge_flat_color_blocks");
  }

  if (inputAsset.type === "line_sketch") {
    steps.push("check_shape_closure");
  }

  const warnings = inputAsset.sizeBytes === 0
    ? ["未检测到真实文件内容，当前使用空素材占位。"]
    : [];

  return {
    detectedType: inputAsset.type,
    mode: modeForInput(inputAsset.type),
    steps,
    warnings,
    normalizedAsset: {
      format: formatForMime(inputAsset.mimeType),
      preserveStructure: constraints.preserveStructure,
      transparentBackground: constraints.transparentBackground,
    },
  };
}

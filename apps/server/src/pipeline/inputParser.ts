import type { CreateTaskRequest, InputAsset, InputType, SelectionAsset } from "../../../../packages/shared/src/index.ts";

const imageMimeTypes = new Set(["image/png", "image/jpeg", "image/svg+xml", "image/webp"]);

function detectType(inputType: InputType, filename: string, mimeType: string): InputAsset["type"] {
  if (inputType !== "auto") {
    return inputType;
  }

  const normalizedName = filename.toLowerCase();

  if (mimeType === "image/svg+xml" || /(line|sketch|outline|wireframe|线稿|草图|描边|轮廓稿|手绘线)/i.test(normalizedName)) {
    return "line_sketch";
  }

  if (normalizedName.includes("3d")) {
    return "3d_other";
  }

  if (normalizedName.includes("illustration")) {
    return "illustration";
  }

  return "flat_icon";
}

export function parseInputAsset(request: CreateTaskRequest): InputAsset {
  const type = detectType(request.inputType, request.filename, request.mimeType);

  return {
    id: `asset_${Date.now()}`,
    referenceLabel: request.referenceAssets?.[0]?.referenceLabel,
    type,
    source: request.source,
    filename: request.filename || "untitled-input",
    mimeType: imageMimeTypes.has(request.mimeType) ? request.mimeType : request.mimeType || "application/octet-stream",
    sizeBytes: request.sizeBytes,
    dataUrl: request.assetDataUrl,
    dominantColors: [],
    hasBackground: type !== "line_sketch",
  };
}

function parseSelectionAsset(asset: SelectionAsset, index: number, inputType: InputType): InputAsset {
  const type = detectType(inputType, asset.filename, asset.mimeType);

  return {
    id: asset.id || `asset_${Date.now()}_${index + 1}`,
    referenceLabel: asset.referenceLabel || `图${index + 1}`,
    type,
    source: "figma_selection",
    filename: asset.filename || asset.name || `reference-${index + 1}.png`,
    mimeType: imageMimeTypes.has(asset.mimeType) ? asset.mimeType : asset.mimeType || "application/octet-stream",
    sizeBytes: asset.sizeBytes,
    dataUrl: asset.assetDataUrl,
    width: asset.width,
    height: asset.height,
    dominantColors: [],
    hasBackground: type !== "line_sketch",
  };
}

export function parseReferenceAssets(request: CreateTaskRequest, fallback: InputAsset): InputAsset[] {
  const assets = request.referenceAssets?.length
    ? request.referenceAssets.map((asset, index) => parseSelectionAsset(asset, index, request.inputType))
    : [fallback];

  return assets.map((asset, index) => ({
    ...asset,
    referenceLabel: asset.referenceLabel || `图${index + 1}`,
  }));
}

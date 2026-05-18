import type { GeneratedImage, GenerateImageRequest } from "../../../../packages/shared/src/index.ts";
import type { ImageProvider } from "./imageProvider.ts";

function buildOutputSize(request: GenerateImageRequest): { width: number; height: number } {
  const [ratioWidth, ratioHeight] = request.constraints.aspectRatio.split(":").map(Number);
  const base = request.constraints.resolution === "4k"
    ? 4096
    : request.constraints.resolution === "2k"
      ? 2048
      : 1024;
  const rawWidth = ratioWidth >= ratioHeight
    ? base
    : Math.round(base * ratioWidth / ratioHeight);
  const rawHeight = ratioHeight >= ratioWidth
    ? base
    : Math.round(base * ratioHeight / ratioWidth);
  const width = Math.max(16, Math.floor(rawWidth / 16) * 16);
  const height = Math.max(16, Math.floor(rawHeight / 16) * 16);

  return { width, height };
}

function createMockSvg(request: GenerateImageRequest, rank: number): string {
  const fallbackColors = request.inputAsset.dominantColors.length
    ? request.inputAsset.dominantColors
    : ["#94A3B8", "#CBD5E1", "#64748B"];
  const [primary = "#94A3B8", secondary = "#CBD5E1", accent = "#64748B"] = request.stylePreset?.colorRules.palette || fallbackColors;
  const styleLabel = request.stylePreset?.name || "No style preset";
  const rotation = rank % 2 === 0 ? -5 : 5;
  const detailOpacity = request.inputAsset.type === "line_sketch" ? 0.22 : 0.38;
  const { width, height } = buildOutputSize(request);
  const viewBoxSize = 900;

  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="80" y1="48" x2="832" y2="846" gradientUnits="userSpaceOnUse">
      <stop stop-color="#111827"/>
      <stop offset="1" stop-color="#020617"/>
    </linearGradient>
    <linearGradient id="icon" x1="226" y1="184" x2="682" y2="688" gradientUnits="userSpaceOnUse">
      <stop stop-color="${secondary}"/>
      <stop offset="0.52" stop-color="${primary}"/>
      <stop offset="1" stop-color="${accent}"/>
    </linearGradient>
    <filter id="shadow" x="110" y="120" width="690" height="690" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="38" stdDeviation="36" flood-color="#000000" flood-opacity="0.42"/>
    </filter>
  </defs>
  <rect width="900" height="900" rx="84" fill="url(#bg)"/>
  <circle cx="718" cy="164" r="142" fill="${accent}" opacity="0.18"/>
  <circle cx="190" cy="720" r="176" fill="${secondary}" opacity="0.12"/>
  <g filter="url(#shadow)" transform="rotate(${rotation} 450 450)">
    <rect x="238" y="212" width="424" height="424" rx="132" fill="url(#icon)"/>
    <rect x="302" y="276" width="296" height="296" rx="88" fill="white" opacity="0.13"/>
    <path d="M346 520C386 433 430 346 486 346C542 346 580 426 606 520" stroke="#ffffff" stroke-width="42" stroke-linecap="round" opacity="0.86"/>
    <circle cx="392" cy="382" r="38" fill="#ffffff" opacity="${detailOpacity}"/>
    <path d="M298 600C374 656 526 656 606 600" stroke="#0F172A" stroke-width="34" stroke-linecap="round" opacity="0.22"/>
  </g>
  <rect x="88" y="742" width="724" height="78" rx="39" fill="white" opacity="0.08"/>
  <text x="132" y="792" fill="#F8FAFC" font-family="Arial, sans-serif" font-size="30" font-weight="700">${styleLabel}</text>
  <text x="620" y="792" fill="#D9F99D" font-family="Arial, sans-serif" font-size="30" font-weight="700">${width}x${height}</text>
  <text x="132" y="108" fill="#CBD5E1" font-family="Arial, sans-serif" font-size="26">${request.prompt.template} · mock ${rank} · ${request.constraints.aspectRatio}</text>
  <title>${request.prompt.positive}</title>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export class MockImageProvider implements ImageProvider {
  async generate(request: GenerateImageRequest): Promise<GeneratedImage[]> {
    const outputSize = buildOutputSize(request);

    return Array.from({ length: request.constraints.batchSize }, (_, index) => {
      const rank = index + 1;

      return {
        id: `generated_${rank}`,
        imageUrl: createMockSvg(request, rank),
        width: outputSize.width,
        height: outputSize.height,
        seed: 1000 + rank,
        provider: "mock",
      };
    });
  }
}

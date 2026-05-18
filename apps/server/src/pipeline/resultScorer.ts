import type { GeneratedImage, GenerationResult, GenerateImageRequest, ResultScore } from "../../../../packages/shared/src/index.ts";

function buildScore(index: number, request: GenerateImageRequest): ResultScore {
  const base = 0.94 - index * 0.055;
  const strictBonus = request.constraints.preserveStructure ? 0.02 : 0;

  const score: ResultScore = {
    structureSimilarity: Number(Math.min(0.98, base + strictBonus).toFixed(2)),
    styleMatch: Number((base - 0.01).toFixed(2)),
    materialMatch: Number((base - 0.02).toFixed(2)),
    compositionStability: Number((base - 0.015).toFixed(2)),
    colorMatch: Number((base - 0.025).toFixed(2)),
    clarity: Number((base - 0.03).toFixed(2)),
    usability: Number((base - 0.01).toFixed(2)),
    total: 0,
  };

  score.total = Number((
    score.structureSimilarity * 0.24
    + score.styleMatch * 0.2
    + score.materialMatch * 0.14
    + score.compositionStability * 0.14
    + score.colorMatch * 0.12
    + score.clarity * 0.08
    + score.usability * 0.08
  ).toFixed(2));

  return score;
}

function reasonForRank(rank: number): string {
  const reasons = [
    "结构保留最好，倒角、材质和光影最接近目标风格。",
    "材质接近目标风格，构图略有偏移。",
    "颜色比例合适，但主体细节略复杂。",
    "风格一致性一般，适合作为备选方向。",
  ];

  return reasons[rank - 1] || "可作为额外变化方向。";
}

export function scoreResults(generatedImages: GeneratedImage[], request: GenerateImageRequest): GenerationResult[] {
  return generatedImages
    .map((image, index) => {
      const score = buildScore(index, request);

      return {
        id: `result_${index + 1}`,
        taskId: request.taskId,
        imageUrl: image.imageUrl,
        score,
        rank: index + 1,
        selected: false,
        reason: reasonForRank(index + 1),
        meta: {
          provider: image.provider,
          seed: image.seed,
        },
      };
    })
    .sort((left, right) => right.score.total - left.score.total)
    .map((result, index) => ({
      ...result,
      rank: index + 1,
    }));
}

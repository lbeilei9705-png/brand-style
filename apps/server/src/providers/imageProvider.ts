import type { GeneratedImage, GenerateImageRequest } from "../../../../packages/shared/src/index.ts";

export interface ImageProvider {
  generate(request: GenerateImageRequest): Promise<GeneratedImage[]>;
}

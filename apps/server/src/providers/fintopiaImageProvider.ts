import type { GeneratedImage, GenerateImageRequest } from "../../../../packages/shared/src/index.ts";
import type { FintopiaConfig } from "../config.ts";
import { buildEndpointAttempts, getEndpointLabel, logProviderError, logProviderInfo, summarizeGenerateRequest } from "./fintopiaEndpoint.ts";
import { buildHeaders, buildImagePayload, buildOutputSize, getActualImageSize } from "./fintopiaPayload.ts";
import { collectImageUrls, getErrorMessage } from "./fintopiaResponse.ts";
import type { ImageProvider } from "./imageProvider.ts";

interface FintopiaImageResponse { error?: { message?: string } | string }

export class FintopiaImageProvider implements ImageProvider {
  private readonly config: FintopiaConfig;

  constructor(config: FintopiaConfig) {
    this.config = config;
  }

  async generate(request: GenerateImageRequest): Promise<GeneratedImage[]> {
    const attempts = buildEndpointAttempts(this.config);
    const hasYunwuCredentials = Boolean(this.config.apiUrl && this.config.apiKey);
    const hasGoogleProxy = attempts.some((attempt) => attempt.googleProxy && attempt.bearerToken);

    if (!hasYunwuCredentials && !hasGoogleProxy) {
      throw new Error("当前模型缺少 API URL 或 API Key。请在模型管理中补齐配置，或为 Nano 模型配置 GOOGLE_API_TOKEN。");
    }

    const usableAttempts = attempts.filter((attempt) => (
      attempt.googleProxy ? Boolean(attempt.bearerToken) : hasYunwuCredentials
    ));

    if (!usableAttempts.length) {
      throw new Error("Nano Banana 图像模型必须配置 GOOGLE_API_TOKEN，并通过 Google gemini-proxy 调用。");
    }

    const variantCount = usableAttempts.some((attempt) => attempt.kind === "gemini-generate-content")
      ? Math.min(Math.max(request.constraints.batchSize, 1), 4)
      : 1;
    logProviderInfo("generate request prepared", {
      ...summarizeGenerateRequest(request, this.config),
      endpoints: usableAttempts.map((attempt) => ({
        endpoint: getEndpointLabel(attempt.endpoint),
        kind: attempt.kind,
        timeoutMs: attempt.timeoutMs,
        label: attempt.label || "primary",
        googleProxy: Boolean(attempt.googleProxy),
        modelId: attempt.modelId || this.config.model,
      })),
      variantCount,
    });
    const generateVariant = async (variantIndex: number): Promise<string[]> => {
      let response: Response | undefined;
      const failures: string[] = [];

      for (const attempt of usableAttempts) {
        const endpoint = attempt.kind === "gemini-generate-content" && !attempt.bearerToken
          ? `${attempt.endpoint}${attempt.endpoint.includes("?") ? "&" : "?"}key=${encodeURIComponent(this.config.apiKey)}`
          : attempt.endpoint;
        const endpointLabel = getEndpointLabel(endpoint);
        const requestModel = attempt.modelId || this.config.model;

        try {
          const variantStartedAt = Date.now();
          logProviderInfo("model request started", {
            taskId: request.taskId,
            model: requestModel,
            endpoint: endpointLabel,
            kind: attempt.kind,
            label: attempt.label || "primary",
            googleProxy: Boolean(attempt.googleProxy),
            variantIndex: variantIndex + 1,
            variantCount,
          });
          const headers: Record<string, string> = attempt.bearerToken
            ? {
              "Content-Type": "application/json",
              Authorization: `Bearer ${attempt.bearerToken}`,
            }
            : buildHeaders(this.config.apiKey, attempt.kind) as Record<string, string>;
          response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(buildImagePayload(
              request,
              this.config,
              attempt.kind,
              variantIndex,
              variantCount,
              {
                modelId: attempt.modelId,
                googleProxy: attempt.googleProxy,
              },
            )),
            signal: AbortSignal.timeout(attempt.timeoutMs),
          });
          logProviderInfo("model response received", {
            taskId: request.taskId,
            model: requestModel,
            endpoint: endpointLabel,
            kind: attempt.kind,
            label: attempt.label || "primary",
            googleProxy: Boolean(attempt.googleProxy),
            variantIndex: variantIndex + 1,
            variantCount,
            status: response.status,
            ok: response.ok,
            durationMs: Date.now() - variantStartedAt,
          });

          if (!response.ok && usableAttempts.indexOf(attempt) < usableAttempts.length - 1) {
            let errorMessage = `HTTP ${response.status}`;

            try {
              const failedPayload = await response.clone().json() as FintopiaImageResponse;
              errorMessage = getErrorMessage(failedPayload) || errorMessage;
            } catch {
              // Some gateways return empty/non-JSON errors; keep the HTTP status.
            }

            logProviderError("model response rejected, trying next channel", {
              taskId: request.taskId,
              model: requestModel,
              endpoint: endpointLabel,
              label: attempt.label || "primary",
              status: response.status,
              error: errorMessage,
            });
            failures.push(`${endpointLabel}：${errorMessage}`);
            response = undefined;
            continue;
          }

          break;
        } catch (error) {
          const cause = error instanceof Error && "cause" in error
            ? (error.cause as { code?: string; message?: string } | undefined)
            : undefined;
          const rawDetail = cause?.code || cause?.message || (error instanceof Error ? error.message : "unknown network error");
          const detail = rawDetail.includes("aborted") || rawDetail.includes("timeout")
            ? `请求超过 ${Math.round(attempt.timeoutMs / 1000)} 秒仍未返回，已自动中断`
            : rawDetail;

          logProviderError("model request failed", {
            taskId: request.taskId,
            model: requestModel,
            endpoint: endpointLabel,
            kind: attempt.kind,
            label: attempt.label || "primary",
            googleProxy: Boolean(attempt.googleProxy),
            variantIndex: variantIndex + 1,
            variantCount,
            error: detail,
          });
          failures.push(`${endpointLabel}：${detail}`);
        }
      }

      if (!response) {
        throw new Error(`无法连接当前模型接口：${failures.join("；")}。请确认中转站地址、模型名、网络/VPN/代理或服务白名单后重试。`);
      }

      const payload = await response.json() as FintopiaImageResponse;

      if (!response.ok) {
        const endpointLabel = getEndpointLabel(response.url);
        const errorMessage = getErrorMessage(payload) || `HTTP 状态码 ${response.status}`;
        logProviderError("model response rejected", {
          taskId: request.taskId,
          model: this.config.model,
          endpoint: endpointLabel,
          status: response.status,
          error: errorMessage,
        });
        throw new Error(`${endpointLabel} 请求失败：${errorMessage}。`);
      }

      const urls = collectImageUrls(payload);
      logProviderInfo("model response parsed", {
        taskId: request.taskId,
        model: this.config.model,
        variantIndex: variantIndex + 1,
        imageCount: urls.length,
      });
      return urls;
    };

    const requestedImageCount = Math.min(Math.max(request.constraints.batchSize, 1), 4);
    const variantResults = await Promise.allSettled(
      Array.from({ length: variantCount }, (_, variantIndex) => generateVariant(variantIndex)),
    );
    const imageUrls = [...new Set(variantResults.flatMap((result) => (
      result.status === "fulfilled" ? result.value : []
    )))].slice(0, requestedImageCount);
    const failedVariants = variantResults.filter((result) => result.status === "rejected");

    if (failedVariants.length === variantResults.length) {
      const reason = failedVariants[0]?.reason;
      throw reason instanceof Error
        ? reason
        : new Error(String(reason || "所有图片生成请求均失败。"));
    }

    for (let retryIndex = 0; imageUrls.length < requestedImageCount && retryIndex < requestedImageCount; retryIndex += 1) {
      logProviderInfo("retrying missing image variant", {
        taskId: request.taskId,
        model: this.config.model,
        requestedImageCount,
        currentImageCount: imageUrls.length,
        retryIndex: retryIndex + 1,
      });

      try {
        const retryUrls = await generateVariant(retryIndex % Math.max(variantCount, 1));

        for (const imageUrl of retryUrls) {
          if (!imageUrls.includes(imageUrl)) {
            imageUrls.push(imageUrl);
          }

          if (imageUrls.length >= requestedImageCount) {
            break;
          }
        }
      } catch (error) {
        failedVariants.push({
          status: "rejected",
          reason: error,
        });
      }
    }

    if (!imageUrls.length && failedVariants.length) {
      const reason = failedVariants.at(-1)?.reason;

      if (reason instanceof Error) {
        throw reason;
      }
    }

    if (!imageUrls.length) {
      throw new Error("当前模型接口响应中没有解析到图片。如果你使用的是 /v1/chat/completions 中转站，请确认该模型会在 message.content 或 message.images 中返回图片 URL/base64。");
    }

    if (imageUrls.length < requestedImageCount) {
      logProviderError("model returned fewer images than requested", {
        taskId: request.taskId,
        model: this.config.model,
        requestedImageCount,
        actualImageCount: imageUrls.length,
        failedVariantCount: failedVariants.length,
      });
      throw new Error(`请求生成 ${requestedImageCount} 张图片，但模型仅返回 ${imageUrls.length} 张。已自动补跑仍未补齐，请稍后重试。`);
    }

    const outputSize = buildOutputSize(request);
    const actualSizes = await Promise.all(imageUrls.map((imageUrl) => getActualImageSize(imageUrl)));

    return imageUrls.map((imageUrl, index) => ({
      id: `fintopia_${index + 1}`,
      imageUrl,
      width: actualSizes[index]?.width || outputSize.width,
      height: actualSizes[index]?.height || outputSize.height,
      seed: Date.now() + index,
      provider: "fintopia",
    }));
  }
}

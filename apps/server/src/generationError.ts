export interface GenerationErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  retryAfter?: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

function contains(text: string, pattern: RegExp): boolean {
  return pattern.test(text.toLowerCase());
}

export function classifyGenerationError(error: unknown): GenerationErrorResponse {
  const text = errorText(error);

  if (contains(text, /(?:余额|欠费|额度不足|payment required|billing|insufficient.{0,20}(?:credit|balance|quota)|\b402\b)/i)) {
    return {
      statusCode: 503,
      code: "MODEL_QUOTA_EXHAUSTED",
      message: "当前模型服务额度不足，请联系管理员检查模型账户。",
      retryAfter: 60,
    };
  }

  if (contains(text, /(?:\b429\b|rate.?limit|too many requests|请求过于频繁|限流|负载.{0,10}(?:高|满)|overload|resource_exhausted|server busy)/i)) {
    return {
      statusCode: 429,
      code: "MODEL_RATE_LIMITED",
      message: "当前模型请求过多或负载较高，请稍后重试或切换模型。",
      retryAfter: 30,
    };
  }

  if (contains(text, /(?:\b401\b|\b403\b|unauthori[sz]ed|forbidden|api.?key|密钥|鉴权|认证失败|permission denied)/i)) {
    return {
      statusCode: 502,
      code: "MODEL_AUTH_FAILED",
      message: "当前模型认证失败，请联系管理员检查模型配置。",
    };
  }

  if (contains(text, /(?:timeout|timed out|超时|超过.{0,10}秒|已自动中断|aborterror)/i)) {
    return {
      statusCode: 504,
      code: "MODEL_TIMEOUT",
      message: "当前模型响应超时，请稍后重试或切换模型。",
      retryAfter: 15,
    };
  }

  if (contains(text, /(?:\b400\b|invalid (?:argument|request)|请求参数|图片格式|不支持.{0,10}(?:图片|格式))/i)) {
    return {
      statusCode: 422,
      code: "MODEL_REQUEST_REJECTED",
      message: "当前模型拒绝了本次请求，请检查参考图格式或简化提示词后重试。",
    };
  }

  if (contains(text, /(?:\b50[0234]\b|bad gateway|service unavailable|upstream|服务不可用|无法连接|fetch failed|enotfound|econn)/i)) {
    return {
      statusCode: 503,
      code: "MODEL_UPSTREAM_UNAVAILABLE",
      message: "当前模型服务暂时不可用，请稍后重试或切换模型。",
      retryAfter: 30,
    };
  }

  return {
    statusCode: 500,
    code: "GENERATION_FAILED",
    message: "图片生成失败，请稍后重试；如果持续失败，请导出诊断包。",
  };
}

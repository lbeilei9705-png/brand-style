import fs from "fs";
import path from "path";

function parseEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    values[key] = rawValue.replace(/^["']|["']$/g, "");
  }

  return values;
}

export function loadDotEnv(projectRoot: string): void {
  const envPath = path.join(projectRoot, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const values = parseEnv(fs.readFileSync(envPath, "utf8"));

  for (const [key, value] of Object.entries(values)) {
    process.env[key] ||= value;
  }
}

export interface FintopiaConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  version: string;
  apiStyle?: "azure" | "openai" | "custom";
  apiPath?: string;
}

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
  tableName: string;
}

export interface OssConfig {
  enabled: boolean;
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  endpoint?: string;
  bucketName: string;
  basePath: string;
  customDomain?: string;
  signedUrlExpiresSec: number;
}

export interface AppConfig {
  imageProvider: "mock" | "fintopia";
  fintopia?: FintopiaConfig;
  supabase?: SupabaseConfig;
  oss?: OssConfig;
}

export function getAppConfig(): AppConfig {
  const imageProvider = process.env.IMAGE_PROVIDER === "fintopia" ? "fintopia" : "mock";
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const ossEnabled = process.env.OSS_ENABLED === "true";

  return {
    imageProvider,
    fintopia: {
      apiUrl: process.env.FINTOPIA_API_URL || "",
      apiKey: process.env.FINTOPIA_API_KEY || "",
      model: process.env.FINTOPIA_IMAGE_MODEL || "gpt-image-1.5",
      version: process.env.FINTOPIA_API_VERSION || "",
      apiStyle: (process.env.FINTOPIA_API_STYLE as FintopiaConfig["apiStyle"]) || "azure",
      apiPath: process.env.FINTOPIA_API_PATH || "",
    },
    supabase: supabaseUrl && supabaseServiceRoleKey
      ? {
        url: supabaseUrl,
        serviceRoleKey: supabaseServiceRoleKey,
        tableName: process.env.SUPABASE_CONFIG_TABLE || "brand_style_config",
      }
      : undefined,
    oss: {
      enabled: ossEnabled,
      accessKeyId: process.env.OSS_ACCESS_KEY_ID || "",
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || "",
      region: process.env.OSS_REGION || "cn-hangzhou",
      endpoint: process.env.OSS_ENDPOINT || undefined,
      bucketName: process.env.OSS_BUCKET_NAME || "",
      basePath: process.env.OSS_INSPIRATION_BASE_PATH || "brand-style",
      customDomain: process.env.OSS_CUSTOM_DOMAIN || undefined,
      signedUrlExpiresSec: Number(process.env.OSS_SIGNED_URL_EXPIRES_SEC || 1800),
    },
  };
}

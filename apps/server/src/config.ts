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

export interface AppConfig {
  imageProvider: "mock" | "fintopia";
  fintopia?: FintopiaConfig;
}

export function getAppConfig(): AppConfig {
  const imageProvider = process.env.IMAGE_PROVIDER === "fintopia" ? "fintopia" : "mock";

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
  };
}

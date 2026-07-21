import crypto from "crypto";

export interface UploadAssetInput {
  category: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface UploadedAsset {
  objectKey: string;
  url: string;
}

export interface OssAssetStorageOptions {
  enabled: boolean;
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  endpoint?: string;
  bucketName: string;
  basePath?: string;
  customDomain?: string;
  signedUrlExpiresSec?: number;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function encodeObjectKey(objectKey: string): string {
  return objectKey.split("/").map(encodeURIComponent).join("/");
}

function normalizeEndpoint(endpoint: string | undefined, region: string): string {
  const raw = endpoint?.trim() || `oss-${region}.aliyuncs.com`;
  return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function fileExtension(filename: string, mimeType: string): string {
  const fromName = filename.split(".").pop();

  if (fromName && fromName.length <= 8 && fromName !== filename) {
    return fromName.toLowerCase();
  }

  const byMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
  };

  return byMime[mimeType] || "bin";
}

function safePathSegment(value: string): string {
  return trimSlashes(value)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "asset";
}

export class OssAssetStorage {
  readonly enabled: boolean;
  private readonly options: OssAssetStorageOptions;
  private readonly endpointHost: string;

  constructor(options: OssAssetStorageOptions) {
    this.options = options;
    this.endpointHost = normalizeEndpoint(options.endpoint, options.region);
    this.enabled = Boolean(
      options.enabled
      && options.accessKeyId
      && options.accessKeySecret
      && options.bucketName,
    );
  }

  async upload(input: UploadAssetInput): Promise<UploadedAsset> {
    if (!this.enabled) {
      throw new Error("OSS 未启用或配置不完整，无法上传图片。");
    }

    const objectKey = this.buildObjectKey(input);
    const date = new Date().toUTCString();
    const resource = `/${this.options.bucketName}/${objectKey}`;
    const signature = this.sign([
      "PUT",
      "",
      input.mimeType,
      date,
      resource,
    ].join("\n"));
    const response = await fetch(this.objectUrl(objectKey), {
      method: "PUT",
      headers: {
        Authorization: `OSS ${this.options.accessKeyId}:${signature}`,
        Date: date,
        "Content-Type": input.mimeType,
      },
      body: input.buffer,
    });

    if (!response.ok) {
      throw new Error(`上传 OSS 失败：HTTP ${response.status}`);
    }

    return {
      objectKey,
      url: this.getPublicUrl(objectKey),
    };
  }

  getSignedUrl(objectKey: string): string {
    if (!this.enabled) {
      throw new Error("OSS 未启用或配置不完整，无法生成签名 URL。");
    }

    const expires = Math.floor(Date.now() / 1000) + (this.options.signedUrlExpiresSec || 1800);
    const resource = `/${this.options.bucketName}/${objectKey}`;
    const signature = this.sign(["GET", "", "", String(expires), resource].join("\n"));
    const url = new URL(this.objectUrl(objectKey));
    url.searchParams.set("OSSAccessKeyId", this.options.accessKeyId);
    url.searchParams.set("Expires", String(expires));
    url.searchParams.set("Signature", signature);
    return url.toString();
  }

  private buildObjectKey(input: UploadAssetInput): string {
    const now = new Date();
    const datePath = now.toISOString().slice(0, 10);
    const basePath = trimSlashes(this.options.basePath || "brand-style");
    const category = safePathSegment(input.category || "assets");
    const extension = fileExtension(input.filename, input.mimeType);
    const random = crypto.randomBytes(6).toString("hex");
    return `${basePath}/${category}/${datePath}/${Date.now()}-${random}.${extension}`;
  }

  private objectUrl(objectKey: string): string {
    return `https://${this.bucketHost()}/${encodeObjectKey(objectKey)}`;
  }

  private bucketHost(): string {
    return this.endpointHost.startsWith(`${this.options.bucketName}.`)
      ? this.endpointHost
      : `${this.options.bucketName}.${this.endpointHost}`;
  }

  private getPublicUrl(objectKey: string): string {
    const customDomain = this.options.customDomain?.trim();

    if (customDomain) {
      return `${customDomain.replace(/\/+$/, "")}/${encodeObjectKey(objectKey)}`;
    }

    return `/assets/oss/${encodeObjectKey(objectKey)}`;
  }

  private sign(value: string): string {
    return crypto
      .createHmac("sha1", this.options.accessKeySecret)
      .update(value, "utf8")
      .digest("base64");
  }
}

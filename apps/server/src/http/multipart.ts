export interface MultipartFile {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl?: string;
}

export interface MultipartFields {
  fields: Record<string, string>;
  files: Record<string, MultipartFile>;
}

function getBoundary(contentType: string): string | undefined {
  return contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1]
    || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
}

export async function readRequestBody(req: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function parseMultipart(bodyBuffer: Buffer, contentType: string): MultipartFields {
  const boundary = getBoundary(contentType);
  const parsed: MultipartFields = {
    fields: {},
    files: {},
  };

  if (!boundary) {
    return parsed;
  }

  const body = bodyBuffer.toString("latin1");
  const parts = body.split(`--${boundary}`);

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");

    if (headerEnd === -1) {
      continue;
    }

    const headers = part.slice(0, headerEnd);
    const name = headers.match(/name="([^"]+)"/)?.[1];

    if (!name) {
      continue;
    }

    const rawValue = part.slice(headerEnd + 4).replace(/\r\n$/, "");
    const filename = headers.match(/filename="([^"]*)"/)?.[1];

    if (filename !== undefined) {
      const mimeType = headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || "application/octet-stream";
      const sizeBytes = Math.max(0, Buffer.byteLength(rawValue, "latin1"));
      const base64 = Buffer.from(rawValue, "latin1").toString("base64");

      parsed.files[name] = {
        filename,
        mimeType,
        sizeBytes,
        dataUrl: filename ? `data:${mimeType};base64,${base64}` : undefined,
      };
    } else {
      parsed.fields[name] = rawValue.trim();
    }
  }

  return parsed;
}

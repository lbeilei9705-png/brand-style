const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const port = 5180;
const publicDir = path.join(__dirname, "public");

const inputTypes = {
  auto: "自动识别",
  line_sketch: "线稿",
  flat_icon: "扁平 icon",
};

const stylePresets = {
  finance_soft_3d: {
    name: "Finance Soft 3D",
    material: "matte rounded plastic",
    lighting: "clean commercial lighting",
    colors: ["#2563EB", "#22C55E", "#F8FAFC"],
  },
};

function send(res, statusCode, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": contentType,
  });
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  send(res, statusCode, JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function getBoundary(contentType) {
  return contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1]
    || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
}

function parseMultipartFields(bodyBuffer, contentType) {
  const boundary = getBoundary(contentType);

  if (!boundary) {
    return {};
  }

  const fields = {};
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

    const filename = headers.match(/filename="([^"]*)"/)?.[1];
    const rawValue = part.slice(headerEnd + 4).replace(/\r\n$/, "");

    if (filename !== undefined) {
      fields[name] = {
        filename,
        size: Math.max(0, Buffer.byteLength(rawValue, "latin1")),
      };
    } else {
      fields[name] = rawValue.trim();
    }
  }

  return fields;
}

function detectInputType(fields) {
  if (fields.inputType && fields.inputType !== "auto") {
    return fields.inputType;
  }

  const filename = String(fields.asset?.filename || "").toLowerCase();

  if (filename.includes("line") || filename.includes("sketch") || filename.endsWith(".svg")) {
    return "line_sketch";
  }

  return "flat_icon";
}

function buildPrompt({ detectedType, stylePreset, preserveStructure, styleLock }) {
  const typeLabel = inputTypes[detectedType] || detectedType;

  return [
    `Render a 3D icon based on the ${typeLabel} input image.`,
    preserveStructure === "true" ? "Preserve the original silhouette and main structure." : "Allow light structure simplification.",
    stylePreset ? `Apply ${stylePreset.name}: rounded bevel system, ${stylePreset.material}, ${stylePreset.lighting}.` : "",
    styleLock === "true" ? "Use style lock: consistent material, lighting, color ratio, and centered 3/4 composition." : "Create controlled variations while keeping the same visual family.",
    "No distortion, no extra elements, no sharp edges, no noisy textures, no inconsistent lighting.",
  ].filter(Boolean).join(" ");
}

function createMockSvg({ rank, score, detectedType, stylePreset, prompt }) {
  const [primary, secondary, accent] = stylePreset?.colors || ["#94A3B8", "#CBD5E1", "#64748B"];
  const styleLabel = stylePreset?.name || "No style preset";
  const typeLabel = inputTypes[detectedType] || detectedType;
  const rotation = rank % 2 === 0 ? -6 : 6;
  const detailOpacity = detectedType === "line_sketch" ? 0.22 : 0.38;

  const svg = `<svg width="900" height="900" viewBox="0 0 900 900" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="90" y1="40" x2="820" y2="850" gradientUnits="userSpaceOnUse">
      <stop stop-color="#111827"/>
      <stop offset="1" stop-color="#030712"/>
    </linearGradient>
    <linearGradient id="icon" x1="235" y1="170" x2="674" y2="708" gradientUnits="userSpaceOnUse">
      <stop stop-color="${secondary}"/>
      <stop offset="0.52" stop-color="${primary}"/>
      <stop offset="1" stop-color="${accent}"/>
    </linearGradient>
    <filter id="shadow" x="120" y="120" width="660" height="660" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="34" stdDeviation="34" flood-color="#000000" flood-opacity="0.42"/>
    </filter>
  </defs>
  <rect width="900" height="900" rx="84" fill="url(#bg)"/>
  <circle cx="704" cy="170" r="132" fill="${accent}" opacity="0.18"/>
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
  <text x="644" y="792" fill="#D9F99D" font-family="Arial, sans-serif" font-size="30" font-weight="700">Score ${score}</text>
  <text x="132" y="108" fill="#CBD5E1" font-family="Arial, sans-serif" font-size="26">${typeLabel} → 3D Icon</text>
  <title>${prompt}</title>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function buildResults({ detectedType, stylePreset, prompt }) {
  const reasons = [
    "结构保留最好，倒角和光影最稳定",
    "材质接近目标风格，构图略有偏移",
    "颜色比例合适，但主体细节略复杂",
    "风格一致性一般，适合作为备选方向",
  ];

  return reasons.map((reason, index) => {
    const rank = index + 1;
    const score = Number((0.93 - index * 0.06).toFixed(2));

    return {
      id: `result_${rank}`,
      rank,
      score,
      recommended: rank === 1,
      reason,
      imageDataUrl: createMockSvg({ rank, score, detectedType, stylePreset, prompt }),
    };
  });
}

async function handleGenerate(req, res) {
  const body = await readRequestBody(req);
  const fields = parseMultipartFields(body, req.headers["content-type"] || "");
  const detectedType = detectInputType(fields);
  const stylePreset = stylePresets[fields.stylePreset];
  const prompt = buildPrompt({
    detectedType,
    stylePreset,
    preserveStructure: fields.preserveStructure,
    styleLock: fields.styleLock,
  });

  sendJson(res, 200, {
    taskId: `task_${Date.now()}`,
    input: {
      filename: fields.asset?.filename || "未上传文件",
      detectedType,
      hasAsset: Boolean(fields.asset?.filename),
    },
    stylePreset,
    prompt,
    results: buildResults({ detectedType, stylePreset, prompt }),
  });
}

function serveStatic(pathname, res) {
  if (pathname === "/") {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }

  const safePath = pathname;
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }

    const ext = path.extname(filePath);
    const contentType = ext === ".css"
      ? "text/css; charset=utf-8"
      : ext === ".js"
        ? "application/javascript; charset=utf-8"
        : "text/html; charset=utf-8";

    send(res, 200, content, contentType);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${port}`);

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, name: "3D Icon Style MVP" });
    return;
  }

  if (req.method === "POST" && pathname === "/api/generate") {
    try {
      await handleGenerate(req, res);
    } catch (error) {
      sendJson(res, 500, { error: "生成失败，请检查输入后重试。" });
    }
    return;
  }

  if (req.method === "GET") {
    serveStatic(pathname, res);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed." });
});

server.listen(port, () => {
  console.log(`3D Icon Style MVP listening on http://localhost:${port}`);
});

# Google Gemini API Token 使用指南

> 最后更新：2026-06-02  
> 中转服务：Supabase Edge Function → Google Cloud Vertex AI  
> 鉴权方式：Bearer Token（由管理员分配）

---

## 1. 架构概览

本系统通过 Supabase Edge Function 构建了一层 API 中转代理，将底层 Google Cloud Vertex AI 的鉴权细节对调用方透明化。

```
客户端（你的应用）
  │
  │  POST + Bearer Token
  ▼
Supabase Edge Function（gemini-proxy）
  │
  │  1. 验证 Token → 查询数据库获取 Google API Key
  │  2. 将请求原样转发到 Google Vertex AI
  │  3. 将 Google 响应原样返回
  ▼
Google Vertex AI（aiplatform.googleapis.com）
```

**核心优势：**

- **安全性**：调用方无需持有 Google API Key，仅需一个可随时撤销的 Token
- **可管理**：管理员可在数据库中控制 Token 的启停、绑定不同 API Key
- **性能**：Supabase 服务器与 Google 基础设施网络距离更近，实测延迟反而更低（详见第 8 节）
- **统一入口**：所有 Gemini 模型通过同一个端点调用，简化客户端配置

> **TODO(perf/memory) — 后续优化**：当前链路（客户端 + Edge `gemini-proxy`）对含 `inlineData` 的生图请求是**整包缓冲**，不是端到端 streaming。参考图/生成图 base64 会在 Edge 与调用方各留完整入站+出站 JSON，并发时抬高内存。合适时机可改为 Edge `ReadableStream` 透传、或改用 fileUri/URL 引用图、或生图直连 Google 绕过 Edge。调用方标记见 `backend/agent/utils/gemini_image_api.py`。

---

## 2. 你需要的信息

管理员会提供以下两项信息：

| 项目 | 说明 | 示例 |
|------|------|------|
| **API 端点** | Edge Function 的 URL | `https://zbhvoeakhrvzahmmades.supabase.co/functions/v1/gemini-proxy` |
| **Token** | 你的专属访问令牌 | `gk_a1b2c3d4e5f6...`（以 `gk_` 开头） |

> 请妥善保管你的 Token，不要提交到代码仓库或在公开渠道分享。

---

## 3. 请求格式

### 3.1 基本规范

- **协议**：HTTPS
- **方法**：POST
- **鉴权**：`Authorization: Bearer <你的Token>`
- **Content-Type**：`application/json`
- **请求体格式**：Vertex AI 原生 `generateContent` 格式

### 3.2 两种指定模型的方式

**方式一：模型名放在请求体中（推荐）**

```
POST https://<supabase-url>/functions/v1/gemini-proxy
```

```json
{
  "model": "gemini-3.5-flash",
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "你好" }]
    }
  ]
}
```

**方式二：模型名放在 URL 路径中**

```
POST https://<supabase-url>/functions/v1/gemini-proxy/gemini-3.5-flash:generateContent
```

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [{ "text": "你好" }]
    }
  ]
}
```

> 注意：两种方式效果完全相同，选择你觉得方便的即可。`model` 字段会在转发前自动移除，不会影响 Google API 的解析。

### 3.3 请求体关键字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是（若未在 URL 中指定） | 模型 ID，见第 5 节 |
| `contents` | array | 是 | 消息列表，每条消息必须包含 `role` 和 `parts` |
| `contents[].role` | string | **是** | 必须为 `"user"` 或 `"model"`（不可省略） |
| `contents[].parts` | array | 是 | 消息内容片段 |
| `generationConfig` | object | 否 | 生成参数（temperature、maxOutputTokens 等） |
| `systemInstruction` | object | 否 | 系统指令 |

> **重要**：`contents` 中的每条消息必须包含 `role` 字段，这是 Vertex AI API 的强制要求。省略 `role` 会返回 400 错误。

---

## 4. 响应格式

中转层会原样返回 Google Vertex AI 的响应，格式如下：

### 4.1 成功响应（HTTP 200）

```json
{
  "candidates": [
    {
      "content": {
        "role": "model",
        "parts": [
          { "text": "你好！有什么可以帮助你的吗？" }
        ]
      },
      "finishReason": "STOP"
    }
  ],
  "usageMetadata": {
    "promptTokenCount": 2,
    "candidatesTokenCount": 12,
    "totalTokenCount": 14
  }
}
```

**提取文本内容：**

```
response.candidates[0].content.parts[0].text
```

### 4.2 错误响应

| HTTP 状态码 | 来源 | 含义 |
|-------------|------|------|
| 400 | 中转层/Google | 请求格式错误（如缺少 model、缺少 role） |
| 401 | 中转层 | 缺少 Authorization 头 |
| 403 | 中转层 | Token 无效或已被停用 |
| 404 | Google | 模型名称错误或当前区域不可用 |
| 429 | Google | 配额超限，需等待后重试 |
| 500 | 中转层 | 内部错误（数据库查询失败等） |
| 502 | 中转层 | 无法连接 Google API |

---

## 5. 可用模型列表

以下模型已通过中转层验证可用（2026-06-02）：

### 5.1 文本生成模型

| 模型 ID | 产品名 | 推荐场景 |
|---------|--------|----------|
| `gemini-3.5-flash` | Gemini 3.5 Flash | 日常对话、翻译、摘要（最新稳定版） |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro | 复杂推理、代码生成、数学 |
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash Lite | 高吞吐低成本批量任务 |
| `gemini-3-flash-preview` | Gemini 3 Flash | 通用文本任务 |
| `gemini-2.5-flash` | Gemini 2.5 Flash | 兼容性 / 过渡期项目 |

### 5.2 图像生成模型

| 模型 ID | 产品名 | 推荐场景 |
|---------|--------|----------|
| `gemini-3-pro-image` | **Nano Banana Pro** | 极致画质，支持多图参考融合 |
| `gemini-3.1-flash-image` | **Nano Banana 2** | 兼顾速度与质量，日常图像任务 |

> **区域说明（2026-07-21 复核）**  
> - Vertex 文档标注图像模型可用区域为 **`global`**。  
> - 当前 `gemini-proxy` 转发时使用 Key 绑定区域（实测多为 `asia-southeast1`；部分 Token 曾出现 `us-west4`）。  
> - **`us-west4` / 多数区域端点对 preview 图像模型会直接 404**。  
> - GA 模型 `gemini-3.1-flash-image` / `gemini-3-pro-image` 经当前代理实测可用；preview ID 已退役。

### 5.3 已确认不可用 / 已退役的模型

| 模型 ID | 原因 |
|---------|------|
| `gemini-3.1-flash-image-preview` | **已退役（2026-07-17）**，请改用 `gemini-3.1-flash-image` |
| `gemini-3-pro-image-preview` | **已退役**，请改用 `gemini-3-pro-image` |
| `gemini-2.5-pro` | 当前区域不可用 |
| `gemini-2.5-flash-lite` | 当前区域不可用 |
| `gemini-2.0-flash-001` | 即将退役 |
| `gemini-2.0-flash-lite-001` | 即将退役 |

---

## 6. 调用示例

### 6.1 cURL

**文本生成：**

```bash
curl -X POST "https://zbhvoeakhrvzahmmades.supabase.co/functions/v1/gemini-proxy" \
  -H "Authorization: Bearer gk_你的Token" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.5-flash",
    "contents": [
      {
        "role": "user",
        "parts": [{ "text": "用一句话解释量子计算" }]
      }
    ]
  }'
```

**带参数控制：**

```bash
curl -X POST "https://zbhvoeakhrvzahmmades.supabase.co/functions/v1/gemini-proxy" \
  -H "Authorization: Bearer gk_你的Token" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.1-pro-preview",
    "contents": [
      {
        "role": "user",
        "parts": [{ "text": "用 Python 实现快速排序" }]
      }
    ],
    "generationConfig": {
      "temperature": 1.0,
      "maxOutputTokens": 8192
    }
  }'
```

### 6.2 Python

```python
import requests

API_URL = "https://zbhvoeakhrvzahmmades.supabase.co/functions/v1/gemini-proxy"
TOKEN = "gk_你的Token"

def chat(prompt: str, model: str = "gemini-3.5-flash") -> str:
    resp = requests.post(
        API_URL,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
                }
            ],
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["candidates"][0]["content"]["parts"][0]["text"]

# 使用示例
print(chat("你好，请介绍一下你自己"))
print(chat("用 Python 实现快速排序", model="gemini-3.1-pro-preview"))
```

### 6.3 JavaScript / TypeScript

```typescript
const API_URL = "https://zbhvoeakhrvzahmmades.supabase.co/functions/v1/gemini-proxy";
const TOKEN = "gk_你的Token";

async function chat(prompt: string, model = "gemini-3.5-flash"): Promise<string> {
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  const data = await resp.json();
  return data.candidates[0].content.parts[0].text;
}

// 使用示例
const answer = await chat("你好");
console.log(answer);
```

### 6.4 多轮对话

多轮对话需要客户端自行维护 `contents` 数组，交替添加 `user` 和 `model` 角色的消息：

```python
import requests

API_URL = "https://zbhvoeakhrvzahmmades.supabase.co/functions/v1/gemini-proxy"
TOKEN = "gk_你的Token"

history = []

def chat(user_message: str) -> str:
    history.append({
        "role": "user",
        "parts": [{"text": user_message}],
    })

    resp = requests.post(
        API_URL,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
        json={
            "model": "gemini-3.5-flash",
            "contents": history,
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()

    assistant_content = data["candidates"][0]["content"]
    history.append(assistant_content)

    return assistant_content["parts"][0]["text"]

# 使用示例
print(chat("你好，请记住我的名字叫小明"))
print(chat("我刚才告诉你我叫什么？"))
```

### 6.5 系统指令（System Instruction）

```python
payload = {
    "model": "gemini-3.5-flash",
    "systemInstruction": {
        "parts": [{"text": "你是一个专业的翻译助手，将用户输入翻译成英文。"}]
    },
    "contents": [
        {
            "role": "user",
            "parts": [{"text": "今天天气真好"}],
        }
    ],
}
```

---

## 7. 图像生成

### 7.1 文生图（Text-to-Image）

通过中转层生成图像时，需在 `generationConfig` 中指定 `responseModalities` 包含 `IMAGE`：

```python
import requests
import base64
from io import BytesIO
from PIL import Image

API_URL = "https://zbhvoeakhrvzahmmades.supabase.co/functions/v1/gemini-proxy"
TOKEN = "gk_你的Token"

payload = {
    "model": "gemini-3.1-flash-image",  # Nano Banana 2
    "contents": [
        {
            "role": "user",
            "parts": [{"text": "生成一张日落海滩风景画，写实风格"}],
        }
    ],
    "generationConfig": {
        "responseModalities": ["TEXT", "IMAGE"],
        "imageConfig": {
            "aspectRatio": "16:9",
            "imageSize": "1K"
        }
    },
}

resp = requests.post(
    API_URL,
    headers={
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
    },
    json=payload,
    timeout=120,
)

data = resp.json()
for part in data["candidates"][0]["content"]["parts"]:
    if "inlineData" in part:
        img_bytes = base64.b64decode(part["inlineData"]["data"])
        img = Image.open(BytesIO(img_bytes))
        img.save("output.png")
        print(f"图像已保存: {img.size[0]}x{img.size[1]}")
    elif "text" in part:
        print(part["text"])
```

### 7.2 图生图（Image-to-Image）

将输入图片 Base64 编码后作为 `inlineData` 发送：

```python
import requests
import base64
from io import BytesIO
from PIL import Image

API_URL = "https://zbhvoeakhrvzahmmades.supabase.co/functions/v1/gemini-proxy"
TOKEN = "gk_你的Token"

# 读取并编码输入图片
with open("input.webp", "rb") as f:
    img_b64 = base64.b64encode(f.read()).decode()

payload = {
    "model": "gemini-3.1-flash-image",  # Nano Banana 2
    "contents": [
        {
            "role": "user",
            "parts": [
                {
                    "inlineData": {
                        "mimeType": "image/webp",  # 根据实际格式：image/png, image/jpeg 等
                        "data": img_b64
                    }
                },
                {"text": "转写实风格"}
            ],
        }
    ],
    "generationConfig": {
        "responseModalities": ["TEXT", "IMAGE"],
        "imageConfig": {
            "aspectRatio": "1:1",
            "imageSize": "1K"
        }
    },
}

resp = requests.post(
    API_URL,
    headers={
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
    },
    json=payload,
    timeout=180,
)

data = resp.json()
for part in data["candidates"][0]["content"]["parts"]:
    if "inlineData" in part:
        img_bytes = base64.b64decode(part["inlineData"]["data"])
        img = Image.open(BytesIO(img_bytes))
        img.save("output.png")
        print(f"图像已保存: {img.size[0]}x{img.size[1]}")
```

### 7.3 图像生成参数说明

| 参数 | 可选值 | 说明 |
|------|--------|------|
| `responseModalities` | `["TEXT", "IMAGE"]` | 必须包含 `IMAGE` 才能生成图像 |
| `imageConfig.aspectRatio` | `"1:1"`, `"16:9"`, `"9:16"`, `"4:3"`, `"3:4"` | 输出图像比例 |
| `imageConfig.imageSize` | `"256"`, `"512"`, `"1K"`, `"2K"`, `"4K"` | 输出图像分辨率 |

### 7.4 Nano Banana Pro vs Nano Banana 2

| 对比项 | Nano Banana Pro | Nano Banana 2 |
|--------|----------------|---------------|
| 模型 ID | `gemini-3-pro-image` | `gemini-3.1-flash-image` |
| 基底模型 | Gemini 3 Pro | Gemini 3.1 Flash |
| 图像质量 | 最高 | 接近 Pro 级 |
| 生成速度 | 较慢 | 快（Flash 级延迟） |
| 最高分辨率 | 4K | 4K |
| 文本理解 | 图像生成专用 | 同时支持文本理解和图像生成 |
| 适用场景 | 追求极致画质的创意设计 | 兼顾速度与质量的日常图像任务 |

---

## 8. 性能基准

以下数据基于实际测试（2026-06-02），对比本地直连 Google Vertex AI 和通过 Supabase 中转层的耗时。

### 8.1 文生图（Text-to-Image）

- **模型**：Nano Banana 2 (`gemini-3.1-flash-image`)
- **提示词**：`海边的螃蟹`
- **输出**：1024×1024, 1K

| 方式 | 耗时 |
|------|------|
| 直连 Google (SDK) | ~21.49 秒 |
| Supabase 中转层 | ~17.16 秒 |
| **差异** | **中转层快 ~4.33 秒（-20.1%）** |

### 8.2 图生图（Image-to-Image）

- **模型**：Nano Banana 2 (`gemini-3.1-flash-image`)
- **输入**：101.6 KB WebP 图片
- **提示词**：`转写实风格`
- **输出**：1024×1024, 1K

| 方式 | 耗时 |
|------|------|
| 直连 Google (SDK) | ~26.20 秒 |
| Supabase 中转层 | ~22.27 秒 |
| **差异** | **中转层快 ~3.94 秒（-15.0%）** |

> **结论**：中转层不仅没有增加延迟，反而因 Supabase 服务器与 Google 基础设施间的网络优势，实测比本地直连更快 15%~20%。

---

## 9. Thinking 模式（深度推理）

Gemini 3.x 系列支持 Thinking 模式，可控制推理深度：

```python
payload = {
    "model": "gemini-3.1-pro-preview",
    "contents": [
        {
            "role": "user",
            "parts": [{"text": "证明 √2 是无理数"}],
        }
    ],
    "generationConfig": {
        "temperature": 1.0,
        "maxOutputTokens": 8192,
        "thinkingConfig": {
            "thinkingLevel": "HIGH"
        }
    },
}
```

| 级别 | 适用场景 | 延迟 |
|------|---------|------|
| `MINIMAL` | 极简任务（仅 Flash 系列） | 最低 |
| `LOW` | 简单任务 | 低 |
| `MEDIUM` | 中等复杂度 | 中 |
| `HIGH` | 复杂推理（默认） | 高 |

> 注意：Gemini 3.x 建议保持 `temperature: 1.0`（默认），设低值可能导致循环或推理退化。

---

## 10. 注意事项与最佳实践

### 10.1 请求体格式

- 请求体必须遵循 **Vertex AI 原生 `generateContent` 格式**
- `contents` 数组中每条消息**必须包含 `role` 字段**（`"user"` 或 `"model"`）
- 不支持 OpenAI 兼容格式（如 `messages` 数组、`role: "assistant"` 等）

### 10.2 超时设置

| 场景 | 建议超时 |
|------|---------|
| 文本生成 | 30~60 秒 |
| 文生图 | 60~120 秒 |
| 图生图 | 120~180 秒 |
| 复杂推理（Thinking HIGH） | 60~120 秒 |

### 10.3 Token 安全

- 不要将 Token 硬编码在前端代码中
- 建议通过环境变量或密钥管理服务存储
- 如果 Token 泄露，立即联系管理员停用并生成新 Token

### 10.4 错误重试

- 遇到 429（配额超限）时，使用指数退避策略重试
- 遇到 500/502 时，可稍后重试
- 遇到 400/401/403 时，检查请求格式和 Token 有效性，不要重试

### 10.5 CORS 支持

中转层已配置 CORS 允许跨域请求，可直接从浏览器前端调用：
- `Access-Control-Allow-Origin: *`
- 支持 `OPTIONS` 预检请求

---

## 11. 快速排错

| 症状 | 可能原因 | 解决方法 |
|------|---------|---------|
| 401 Missing Authorization | 未携带 Token | 在请求头中添加 `Authorization: Bearer <token>` |
| 403 Invalid or inactive token | Token 错误或被停用 | 联系管理员确认 Token 状态 |
| 400 Missing model | 未指定模型 | 在请求体或 URL 中指定 `model` |
| 400 invalid role | `contents` 中缺少 `role` | 确保每条消息包含 `"role": "user"` 或 `"role": "model"` |
| 404 NOT_FOUND | 模型名称错误 | 对照第 5 节检查模型 ID |
| 429 RESOURCE_EXHAUSTED | 配额超限 | 等待后重试，或联系管理员 |
| 504 Gateway Timeout | 请求耗时过长 | 增加客户端超时时间，图像生成建议 120s+ |

---

## 12. 完整请求模板速查

### 文本生成

```json
{
  "model": "gemini-3.5-flash",
  "contents": [
    { "role": "user", "parts": [{ "text": "你的提示词" }] }
  ]
}
```

### 带系统指令的文本生成

```json
{
  "model": "gemini-3.5-flash",
  "systemInstruction": {
    "parts": [{ "text": "你是一个专业翻译" }]
  },
  "contents": [
    { "role": "user", "parts": [{ "text": "今天天气真好" }] }
  ]
}
```

### 文生图

```json
{
  "model": "gemini-3.1-flash-image",
  "contents": [
    { "role": "user", "parts": [{ "text": "一只可爱的猫咪" }] }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": { "aspectRatio": "1:1", "imageSize": "1K" }
  }
}
```

### 图生图

```json
{
  "model": "gemini-3.1-flash-image",
  "contents": [
    {
      "role": "user",
      "parts": [
        { "inlineData": { "mimeType": "image/png", "data": "<base64图片数据>" } },
        { "text": "转换为水彩画风格" }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": { "aspectRatio": "1:1", "imageSize": "1K" }
  }
}
```

### 多轮对话

```json
{
  "model": "gemini-3.5-flash",
  "contents": [
    { "role": "user", "parts": [{ "text": "你好" }] },
    { "role": "model", "parts": [{ "text": "你好！有什么可以帮你的？" }] },
    { "role": "user", "parts": [{ "text": "请继续" }] }
  ]
}
```

---

## 13. 相关文档

- [Google Gemini API 调用说明（直连版）](./GOOGLE_API_GUIDE.md) — 管理员参考，包含 SDK 直连用法与模型详细信息
- [Vertex AI 模型文档](https://cloud.google.com/vertex-ai/generative-ai/docs/models)
- [Vertex AI generateContent API](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference)
- [图像生成文档](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-generation)

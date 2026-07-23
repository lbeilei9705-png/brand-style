# 3D Icon Style Engine MVP

根据 `技术方案.pdf` 搭建的 Figma 插件完整链路 MVP。生图能力通过 `ImageProvider` 隔离，可以在 mock 和真实 API provider 之间切换。

## 项目结构

```text
apps/server          Node.js + TypeScript 后端
apps/web             Web 流程验证端
apps/figma-plugin    Figma 插件 manifest、controller、UI
packages/shared      共享类型、风格 preset、API DTO
```

## 核心链路

Figma 选中对象 / Web 上传素材 → Input Parser → Preprocess → Style Engine → Prompt Builder → Image Provider → Result Scorer → 4 张结果 → Web 展示 / Figma 回插。

## 启动后端和 Web 验证端

当前机器没有可用 `npm`，可以直接用 Cursor 自带 Node 运行：

```bash
/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node --experimental-strip-types apps/server/src/index.ts
```

打开：

```text
http://localhost:5180
```

## 生图 API 配置

本地密钥放在 `.env`，这个文件已经加入 `.gitignore`，不要提交。

```text
IMAGE_PROVIDER=fintopia
FINTOPIA_API_URL=https://all-in-one-ai.fintopia.tech/
FINTOPIA_API_KEY=你的 key
FINTOPIA_IMAGE_MODEL=gpt-image-2
FINTOPIA_API_VERSION=2024-02-01
```

如果想临时回到 mock 模式，把 `.env` 改为：

```text
IMAGE_PROVIDER=mock
```

## Figma 插件加载

1. 先启动本地后端：`http://localhost:5180`
2. 在 Figma Desktop 中打开插件开发入口。
3. 选择 `apps/figma-plugin/manifest.json`。
4. 在画布中选中一个或多个图层；按住 Shift 多选时插件会自动同步。
5. 插件顶部选择模型和 Agent。
6. 在底部对话框输入需求并点击“发送并生成”。
7. 选择候选结果并点击“插入 Figma”。

## 后台管理

打开：

```text
http://localhost:5180/admin.html
```

后台可配置：

- 模型：显示名、provider、模型 ID、API URL、API version、quality、API key、启用状态
- Agent：名称、描述、系统提示词、默认风格模板、默认负向规则、驱动模型、启用状态
- Markdown 导入：上传 `.md` 后生成 Agent 草稿，确认后保存

当前是本地开发期后台，API key 会保存到 `data/config.json`。正式产品需要增加登录、权限和密钥加密。

## 生产安全配置

正式部署时必须设置独立的后台管理令牌，不要把该令牌写入 Figma 插件：

```text
BRAND_STYLE_ADMIN_TOKEN=足够长的随机字符串
BRAND_STYLE_PLUGIN_RATE_LIMIT=10
BRAND_STYLE_PLUGIN_GLOBAL_RATE_LIMIT=60
BRAND_STYLE_PLUGIN_RATE_WINDOW_MS=60000
BRAND_STYLE_CONVERSATION_RETENTION_DAYS=30
```

插件只匿名访问读取配置和生成所需接口，这些写请求按来源地址限流。后台写操作、素材上传、调试接口和对话列表仍需要 `BRAND_STYLE_ADMIN_TOKEN`。旧的 `BRAND_STYLE_ACCESS_TOKEN` 仅作为部署迁移期兼容项。

生产隐私政策和使用条款：

- `/privacy.html`
- `/terms.html`
- 支持邮箱：`lbeilei9705@gmail.com`

## API

- `GET /api/health`
- `GET /api/style-presets`
- `POST /api/tasks`
- `GET /api/tasks/:taskId`
- `POST /api/tasks/:taskId/results/:resultId/select`

## 后续扩展真实生图 API

当前生图能力通过 `ImageProvider` 隔离：

```ts
export interface ImageProvider {
  generate(request: GenerateImageRequest): Promise<GeneratedImage[]>;
}
```

当前已有：

```text
MockImageProvider
FintopiaImageProvider
```

如果之后更换 Nano Banana Pro 或其他模型，只需要新增 provider 并在 `apps/server/src/index.ts` 根据环境变量切换，不需要改 Web 和 Figma 插件调用链路。

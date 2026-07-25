import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { getAppConfig, loadDotEnv } from "./config.ts";
import { ConfigStore, type StoredConfig } from "./configStore.ts";
import { ConversationService } from "./conversationService.ts";
import { ConversationStore } from "./conversationStore.ts";
import { sendJson } from "./http/response.ts";
import { handleConfigRoutes } from "./routes/configRoutes.ts";
import { configureServerHttp, consumePluginRateLimit, getMemberToken, handleAssetUpload, handleCreateTask, hasAdminCredentials, isAuthorizedRequest, isProtectedPluginRequest, logError, logInfo, readJsonRequest, redirectOssAsset, serveStatic } from "./serverHttp.ts";
import { MemberAccessStore } from "./memberAccessStore.ts";
import { FintopiaImageProvider } from "./providers/fintopiaImageProvider.ts";
import { MockImageProvider } from "./providers/mockImageProvider.ts";
import { OssAssetStorage } from "./storage/ossAssetStorage.ts";
import { SupabaseConfigStore } from "./storage/supabaseConfigStore.ts";
import { TaskService } from "./taskService.ts";
import { TaskStore } from "./taskStore.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");
loadDotEnv(projectRoot);
configureServerHttp();
const appConfig = getAppConfig();
const port = Number(process.env.PORT || 5180);
const conversationRetentionDays = Math.max(
  1,
  Number(process.env.BRAND_STYLE_CONVERSATION_RETENTION_DAYS || 30),
);
const memberDailyLimit = Math.max(
  1,
  Number(process.env.BRAND_STYLE_MEMBER_DAILY_LIMIT || 20),
);
const memberSessionTtlDays = Math.max(
  1,
  Number(process.env.BRAND_STYLE_MEMBER_SESSION_TTL_DAYS || 30),
);
const dataDir = path.resolve(projectRoot, "data");
const remoteConfigStore = appConfig.supabase
  ? new SupabaseConfigStore<StoredConfig>({
    url: appConfig.supabase.url,
    serviceRoleKey: appConfig.supabase.serviceRoleKey,
    tableName: appConfig.supabase.tableName,
  })
  : undefined;
const configStore = new ConfigStore(dataDir, remoteConfigStore);
await configStore.syncFromRemote().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
});
const conversationStore = new ConversationStore(dataDir, conversationRetentionDays);
const memberAccessStore = new MemberAccessStore(dataDir, memberDailyLimit, memberSessionTtlDays);
conversationStore.list();
const conversationCleanupTimer = setInterval(() => {
  conversationStore.list();
}, 24 * 60 * 60 * 1_000);
conversationCleanupTimer.unref();
const store = new TaskStore();
const assetStorage = new OssAssetStorage({
  enabled: appConfig.oss?.enabled ?? false,
  accessKeyId: appConfig.oss?.accessKeyId || "",
  accessKeySecret: appConfig.oss?.accessKeySecret || "",
  region: appConfig.oss?.region || "cn-hangzhou",
  endpoint: appConfig.oss?.endpoint,
  bucketName: appConfig.oss?.bucketName || "",
  basePath: appConfig.oss?.basePath,
  customDomain: appConfig.oss?.customDomain,
  signedUrlExpiresSec: appConfig.oss?.signedUrlExpiresSec,
});
const imageProvider = appConfig.imageProvider === "fintopia" && appConfig.fintopia
  ? new FintopiaImageProvider(appConfig.fintopia)
  : new MockImageProvider();
const taskService = new TaskService(store, imageProvider);
const conversationService = new ConversationService(conversationStore, configStore, store, appConfig.fintopia);


const server = http.createServer(async (req, res) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const startedAt = Date.now();
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  const pathname = url.pathname;
  res.setHeader("x-request-id", requestId);
  res.on("finish", () => {
    logInfo("http", "request completed", {
      requestId,
      method: req.method,
      pathname,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  logInfo("http", "request received", {
    requestId,
    method: req.method,
    pathname,
    contentType: req.headers["content-type"] || "",
    userAgent: req.headers["user-agent"] || "",
  });

  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        name: "3D Icon Style Engine",
        provider: appConfig.imageProvider,
        model: appConfig.imageProvider === "fintopia" ? appConfig.fintopia?.model : undefined,
        storage: {
          supabase: Boolean(remoteConfigStore?.enabled),
          oss: assetStorage.enabled,
        },
      });
      return;
    }

    if (req.method === "GET" && redirectOssAsset(pathname, res, assetStorage)) {
      return;
    }

    const isInviteRedemption = req.method === "POST" && pathname === "/api/member/session/redeem";

    if (isInviteRedemption) {
      const retryAfterSeconds = consumePluginRateLimit(req);

      if (retryAfterSeconds) {
        res.setHeader("Retry-After", String(retryAfterSeconds));
        sendJson(res, 429, {
          error: `尝试次数过多，请在 ${retryAfterSeconds} 秒后重试。`,
        });
        return;
      }

      try {
        const body = await readJsonRequest(req) as { code?: string };
        sendJson(res, 201, memberAccessStore.redeemInvite(body.code || ""));
      } catch (error) {
        sendJson(res, 400, {
          error: error instanceof Error ? error.message : "邀请码兑换失败。",
        });
      }
      return;
    }

    const isProtectedPluginApi = isProtectedPluginRequest(req.method, pathname);
    const memberSession = isProtectedPluginApi
      ? memberAccessStore.resolveSession(getMemberToken(req))
      : undefined;

    if (isProtectedPluginApi && !memberSession && !hasAdminCredentials(req)) {
      sendJson(res, 401, {
        error: "请使用有效的成员邀请码登录。",
        code: "MEMBER_AUTH_REQUIRED",
      });
      return;
    }

    if (pathname.startsWith("/api/") && !isProtectedPluginApi && !isAuthorizedRequest(req)) {
      sendJson(res, 401, { error: "Unauthorized." });
      return;
    }

    if (isProtectedPluginApi && req.method !== "GET") {
      const retryAfterSeconds = consumePluginRateLimit(req);

      if (retryAfterSeconds) {
        res.setHeader("Retry-After", String(retryAfterSeconds));
        sendJson(res, 429, {
          error: `请求过于频繁，请在 ${retryAfterSeconds} 秒后重试。`,
        });
        return;
      }
    }

    if (req.method === "GET" && pathname === "/api/member/session/me" && memberSession) {
      sendJson(res, 200, { session: memberSession });
      return;
    }

    if (req.method === "DELETE" && pathname === "/api/member/session" && memberSession) {
      memberAccessStore.revokeCurrentSession(memberSession.id);
      sendJson(res, 200, { revoked: true });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/member-access") {
      sendJson(res, 200, memberAccessStore.listForAdmin());
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/member-invites") {
      const body = await readJsonRequest(req) as {
        memberName?: string;
        dailyLimit?: number;
        expiresInHours?: number;
      };

      try {
        sendJson(res, 201, memberAccessStore.createInvite(body));
      } catch (error) {
        sendJson(res, 400, {
          error: error instanceof Error ? error.message : "邀请码创建失败。",
        });
      }
      return;
    }

    const revokeMemberInviteMatch = pathname.match(/^\/api\/admin\/member-invites\/([^/]+)$/);

    if (req.method === "DELETE" && revokeMemberInviteMatch) {
      const revoked = memberAccessStore.revokeInvite(revokeMemberInviteMatch[1]);
      sendJson(res, revoked ? 200 : 404, { revoked });
      return;
    }

    const revokeMemberSessionMatch = pathname.match(/^\/api\/admin\/member-sessions\/([^/]+)$/);

    if (req.method === "DELETE" && revokeMemberSessionMatch) {
      const revoked = memberAccessStore.revokeSession(revokeMemberSessionMatch[1]);
      sendJson(res, revoked ? 200 : 404, { revoked });
      return;
    }

    const revokeMemberMatch = pathname.match(/^\/api\/admin\/members\/([^/]+)$/);

    if (req.method === "DELETE" && revokeMemberMatch) {
      const revoked = memberAccessStore.revokeMember(revokeMemberMatch[1]);
      sendJson(res, revoked ? 200 : 404, { revoked });
      return;
    }

    if (req.method === "POST" && pathname === "/api/assets") {
      await handleAssetUpload(req, res, assetStorage);
      return;
    }


    if (await handleConfigRoutes({
      req,
      res,
      pathname,
      configStore,
      conversationService,
    })) {
      return;
    }


    if (req.method === "GET" && pathname === "/api/conversations") {
      sendJson(res, 200, { conversations: conversationService.list() });
      return;
    }

    if (req.method === "POST" && pathname === "/api/conversations") {
      const conversation = conversationService.create(await readJsonRequest(req) as Parameters<ConversationService["create"]>[0]);
      sendJson(res, 201, { conversation });
      return;
    }

    const conversationMatch = pathname.match(/^\/api\/conversations\/([^/]+)$/);

    if (req.method === "DELETE" && conversationMatch) {
      const deleted = conversationStore.delete(conversationMatch[1]);
      sendJson(res, deleted ? 200 : 404, { deleted });
      return;
    }

    if (req.method === "GET" && conversationMatch) {
      const conversation = conversationService.get(conversationMatch[1]);

      if (!conversation) {
        sendJson(res, 404, { error: "Conversation not found." });
        return;
      }

      sendJson(res, 200, { conversation });
      return;
    }

    const conversationMessageMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);

    if (req.method === "POST" && conversationMessageMatch) {
      let response: Awaited<ReturnType<ConversationService["addMessage"]>>;
      const messageRequest = await readJsonRequest(req) as Parameters<ConversationService["addMessage"]>[1];
      const quotaReservation = memberSession
        ? memberAccessStore.consumeQuota(memberSession.id, 1)
        : undefined;

      if (memberSession && (!quotaReservation || !quotaReservation.allowed)) {
        sendJson(res, 429, {
          error: "今日生成额度已用完，请联系管理员。",
          code: "MEMBER_DAILY_LIMIT_REACHED",
          quota: quotaReservation?.quota,
        });
        return;
      }

      try {
        response = await conversationService.addMessage(
          conversationMessageMatch[1],
          messageRequest,
        );
      } catch (error) {
        if (memberSession && quotaReservation?.allowed) {
          memberAccessStore.refundQuota(memberSession.id, 1);
        }

        if (error instanceof Error && error.message === "Conversation not found.") {
          sendJson(res, 404, { error: error.message });
          return;
        }

        throw error;
      }

      sendJson(res, 201, response);
      return;
    }

    if (req.method === "POST" && pathname === "/api/tasks") {
      await handleCreateTask(req, res, taskService);
      return;
    }

    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);

    if (req.method === "GET" && taskMatch) {
      const task = taskService.getTask(taskMatch[1]);

      if (!task) {
        sendJson(res, 404, { error: "Task not found." });
        return;
      }

      sendJson(res, 200, { task });
      return;
    }

    const selectMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/results\/([^/]+)\/select$/);

    if (req.method === "POST" && selectMatch) {
      const task = taskService.selectResult(selectMatch[1], selectMatch[2]);

      if (!task) {
        sendJson(res, 404, { error: "Task or result not found." });
        return;
      }

      sendJson(res, 200, { task });
      return;
    }

    if (req.method === "GET") {
      serveStatic(pathname, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    logError("http", "request failed", {
      requestId,
      method: req.method,
      pathname,
      error: error instanceof Error ? error.message : String(error),
    });
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Internal server error.",
    });
  }
});

server.listen(port, () => {
  console.log(`3D Icon Style Engine listening on http://localhost:${port}`);
});

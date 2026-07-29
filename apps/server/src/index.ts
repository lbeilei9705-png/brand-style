import http from "http";
import path from "path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "url";
import { getAppConfig, loadDotEnv } from "./config.ts";
import { ConfigStore, type StoredConfig } from "./configStore.ts";
import { ConversationService } from "./conversationService.ts";
import { ConversationStore } from "./conversationStore.ts";
import { sendJson } from "./http/response.ts";
import { handleConfigRoutes } from "./routes/configRoutes.ts";
import { handleTelemetryRoutes } from "./routes/telemetryRoutes.ts";
import { configureServerHttp, consumePluginRateLimit, getMemberToken, handleAssetUpload, handleCreateTask, hasAdminCredentials, isAuthorizedRequest, isProtectedPluginRequest, logError, logInfo, readJsonRequest, redirectOssAsset, routeEventName, serveStatic, stringHeader } from "./serverHttp.ts";
import { MemberAccessStore } from "./memberAccessStore.ts";
import { bindGenerationCancellation } from "./generationCancellation.ts";
import { GenerationConcurrencyLimiter } from "./generationConcurrency.ts";
import { FintopiaImageProvider } from "./providers/fintopiaImageProvider.ts";
import { MockImageProvider } from "./providers/mockImageProvider.ts";
import { OssAssetStorage } from "./storage/ossAssetStorage.ts";
import { SupabaseConfigStore } from "./storage/supabaseConfigStore.ts";
import { TaskService } from "./taskService.ts";
import { TaskStore } from "./taskStore.ts";
import { createTelemetryService } from "./telemetry/index.ts";
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
const maxParallelGenerations = Math.max(1, Number(process.env.BRAND_STYLE_MAX_PARALLEL_GENERATIONS || 3));
const dataDir = path.resolve(projectRoot, process.env.BRAND_STYLE_DATA_DIR || "data");
appConfig.telemetry.localDir = path.resolve(projectRoot, appConfig.telemetry.localDir);
const telemetry = createTelemetryService(appConfig.telemetry);
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
const generationConcurrency = new GenerationConcurrencyLimiter(maxParallelGenerations);
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
  const requestId = `req_${randomUUID()}`;
  const issueId = `issue_${randomUUID()}`;
  const clientSessionId = stringHeader(req.headers["x-client-session-id"]);
  let actorId: string | undefined;
  const startedAt = Date.now();
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  const pathname = url.pathname;
  res.setHeader("x-request-id", requestId);
  res.setHeader("x-issue-id", issueId);
  res.on("finish", () => {
    const failed = res.statusCode >= 400;
    logInfo("http", "request completed", {
      requestId,
      method: req.method,
      pathname,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
    void telemetry.record({
      name: routeEventName(pathname, res.statusCode),
      category: "http",
      source: "server",
      level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      requestId,
      issueId: failed ? issueId : undefined,
      clientSessionId,
      actorId,
      properties: {
        method: req.method || "GET",
        pathname,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      },
    }).catch((error) => logError("telemetry", "failed to record request", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
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
          telemetry: appConfig.telemetry.store,
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
    actorId = memberSession?.memberId;

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

    if (isProtectedPluginApi && req.method !== "GET" && pathname !== "/api/telemetry/events") {
      const retryAfterSeconds = consumePluginRateLimit(req);

      if (retryAfterSeconds) {
        res.setHeader("Retry-After", String(retryAfterSeconds));
        sendJson(res, 429, {
          error: `请求过于频繁，请在 ${retryAfterSeconds} 秒后重试。`,
        });
        return;
      }
    }

    if (await handleTelemetryRoutes({
      req,
      res,
      url,
      telemetry,
      actorId,
      requestId,
      clientSessionId,
      isAdmin: hasAdminCredentials(req),
    })) {
      return;
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
      const concurrencyKey = memberSession?.id || clientSessionId || actorId || req.socket.remoteAddress || "anonymous";

      if (!generationConcurrency.tryAcquire(concurrencyKey)) {
        sendJson(res, 429, {
          error: `最多可同时运行 ${maxParallelGenerations} 个生图任务。`,
          code: "GENERATION_CONCURRENCY_LIMIT",
          active: generationConcurrency.active(concurrencyKey),
        });
        return;
      }

      const cancellation = bindGenerationCancellation(res);
      let quotaReservation: ReturnType<MemberAccessStore["consumeQuota"]>;
      try {
        quotaReservation = memberSession
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

        void telemetry.record({
          name: "generation.started",
          category: "generation",
          source: "server",
          requestId,
          clientSessionId,
          actorId,
          conversationId: conversationMessageMatch[1],
          properties: {
            modelId: messageRequest.modelId,
            skillId: messageRequest.agentId,
            attachmentCount: messageRequest.selectionAssets?.length || 0,
          },
        }).catch(() => undefined);
        response = await conversationService.addMessage(conversationMessageMatch[1], messageRequest, cancellation.signal);
        void telemetry.record({
          name: "generation.succeeded",
          category: "generation",
          source: "server",
          requestId,
          clientSessionId,
          actorId,
          conversationId: conversationMessageMatch[1],
          properties: {
            durationMs: Date.now() - startedAt,
            taskId: response.task?.id,
          },
        }).catch(() => undefined);
      } catch (error) {
        if (memberSession && quotaReservation?.allowed) {
          memberAccessStore.refundQuota(memberSession.id, 1);
        }

        if (cancellation.signal.aborted) return;

        if (error instanceof Error && error.message === "Conversation not found.") {
          sendJson(res, 404, { error: error.message });
          return;
        }

        await telemetry.recordDiagnostic({
          name: "generation.failed",
          level: "error",
          source: "server",
          requestId,
          issueId,
          clientSessionId,
          actorId,
          conversationId: conversationMessageMatch[1],
          diagnostic: {
            code: "GENERATION_FAILED",
            component: "conversation",
            message: error instanceof Error ? error.message : "Generation failed",
            recoverable: true,
          },
        }).catch(() => undefined);
        throw error;
      } finally {
        cancellation.cleanup();
        generationConcurrency.release(concurrencyKey);
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
    await telemetry.recordDiagnostic({
      name: "server.request_failed",
      level: "error",
      source: "server",
      requestId,
      issueId,
      clientSessionId,
      actorId,
      diagnostic: {
        code: "INTERNAL_SERVER_ERROR",
        component: "http",
        message: error instanceof Error ? error.message : "Internal server error",
        recoverable: true,
      },
      properties: { method: req.method || "GET", pathname },
    }).catch(() => undefined);
    sendJson(res, 500, {
      error: "Internal server error.",
      code: "INTERNAL_SERVER_ERROR",
      issueId,
      requestId,
    });
  }
});

server.listen(port, () => {
  console.log(`3D Icon Style Engine listening on http://localhost:${port}`);
});

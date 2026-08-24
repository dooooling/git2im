import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations, clearTestDatabase } from "../helpers/db";
import {
  atomicRegisterEvent,
  updateEventFinished,
  getEventById,
  cleanupOldEvents,
} from "../../src/storage/events";
import {
  insertDelivery,
  getRecentFailures,
  getLastTargetTestDelivery,
  cleanupOldDeliveries,
} from "../../src/storage/deliveries";
import { getDashboardStats } from "../../src/storage/stats";

describe("Storage: Events, Deliveries and Stats Aggregation", () => {
  beforeEach(async () => {
    await applyTestMigrations();
    await clearTestDatabase();
  });

  describe("Events: Atomic Idempotency & Lifecycle", () => {
    it("should atomically register new event and return isNew: true", async () => {
      const deliveryId = "delivery-uuid-001";
      const result = await atomicRegisterEvent(env.DB, {
        deliveryId,
        repository: "owner/repo-a",
        eventType: "push",
        actor: "developer1",
        branch: "main",
      });

      expect(result.isNew).toBe(true);
      expect(result.eventId).toBe(deliveryId);

      const event = await getEventById(env.DB, deliveryId);
      expect(event).toBeTruthy();
      expect(event?.status).toBe("processing");
      expect(event?.repository).toBe("owner/repo-a");
    });

    it("should reject duplicate delivery with isNew: false (Atomic Idempotency)", async () => {
      const deliveryId = "duplicate-delivery-001";

      const firstAttempt = await atomicRegisterEvent(env.DB, {
        deliveryId,
        repository: "owner/repo-a",
        eventType: "push",
      });
      expect(firstAttempt.isNew).toBe(true);

      const secondAttempt = await atomicRegisterEvent(env.DB, {
        deliveryId,
        repository: "owner/repo-a",
        eventType: "push",
      });
      expect(secondAttempt.isNew).toBe(false);
    });

    it("should update event finished status and metrics", async () => {
      const deliveryId = "delivery-finish-001";
      await atomicRegisterEvent(env.DB, {
        deliveryId,
        repository: "owner/repo-a",
        eventType: "pull_request",
      });

      await updateEventFinished(env.DB, deliveryId, {
        status: "processed",
        matchedRouteCount: 2,
        durationMs: 345,
      });

      const event = await getEventById(env.DB, deliveryId);
      expect(event?.status).toBe("processed");
      expect(event?.matched_route_count).toBe(2);
      expect(event?.duration_ms).toBe(345);
      expect(event?.completed_at).toBeTruthy();
    });

    it("should clean up old events older than cutoff", async () => {
      const oldTime = Date.now() - 40 * 24 * 60 * 60 * 1000;
      await atomicRegisterEvent(env.DB, {
        deliveryId: "old-event-1",
        repository: "owner/repo",
        eventType: "push",
        receivedAt: oldTime,
      });

      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const deletedCount = await cleanupOldEvents(env.DB, cutoff);
      expect(deletedCount).toBe(1);

      const event = await getEventById(env.DB, "old-event-1");
      expect(event).toBeNull();
    });
  });

  describe("Deliveries: Tracking & Recent Failures", () => {
    it("should insert delivery record and query recent failures", async () => {
      const deliveryId = "event-deliv-001";
      await atomicRegisterEvent(env.DB, {
        deliveryId,
        repository: "owner/test-repo",
        eventType: "workflow_run",
      });

      // 记录一次成功投递与一次失败投递
      await insertDelivery(env.DB, {
        eventId: deliveryId,
        targetName: "飞书告警群",
        provider: "feishu",
        channelType: "feishu_webhook",
        status: "success",
        durationMs: 120,
      });

      await insertDelivery(env.DB, {
        eventId: deliveryId,
        targetName: "钉钉告警群",
        provider: "dingtalk",
        channelType: "dingtalk_webhook",
        status: "failed",
        httpStatus: 400,
        providerCode: "310000",
        errorCode: "PROVIDER_INVALID_SIGN",
        errorSummary: "Sign signature mismatch with https://oapi.dingtalk.com/robot/send?access_token=secret123",
        durationMs: 80,
      });

      const failures = await getRecentFailures(env.DB, 10);
      expect(failures.length).toBe(1);
      expect(failures[0]?.targetName).toBe("钉钉告警群");
      expect(failures[0]?.provider).toBe("dingtalk");
      expect(failures[0]?.repository).toBe("owner/test-repo");
      // 验证脱敏
      expect(failures[0]?.errorSummary?.includes("secret123")).toBe(false);
      expect(failures[0]?.errorSummary?.includes("[REDACTED]")).toBe(true);
    });

    it("should track last test delivery for a target", async () => {
      const targetId = "target-test-uuid";

      await insertDelivery(env.DB, {
        source: "test",
        targetId,
        targetName: "测试目标",
        provider: "wecom",
        channelType: "wecom_webhook",
        status: "success",
        durationMs: 95,
        createdAt: Date.now() - 10000,
      });

      await insertDelivery(env.DB, {
        source: "test",
        targetId,
        targetName: "测试目标",
        provider: "wecom",
        channelType: "wecom_webhook",
        status: "failed",
        errorSummary: "Timeout connecting to WeCom",
        durationMs: 3000,
        createdAt: Date.now(),
      });

      const lastTest = await getLastTargetTestDelivery(env.DB, targetId);
      expect(lastTest).toBeTruthy();
      expect(lastTest?.lastTestStatus).toBe("failed");
      expect(lastTest?.lastTestDurationMs).toBe(3000);
    });

    it("should clean up old deliveries", async () => {
      const oldTime = Date.now() - 40 * 24 * 60 * 60 * 1000;
      await insertDelivery(env.DB, {
        targetName: "Old Target",
        provider: "feishu",
        channelType: "feishu_webhook",
        status: "success",
        durationMs: 50,
        createdAt: oldTime,
      });

      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const deleted = await cleanupOldDeliveries(env.DB, cutoff);
      expect(deleted).toBe(1);
    });
  });

  describe("Stats: Full Dashboard Multi-Dimensional Aggregation", () => {
    it("should aggregate overview statistics correctly", async () => {
      const now = Date.now();

      // 模拟插入 2 个事件
      await atomicRegisterEvent(env.DB, {
        deliveryId: "ev-1",
        repository: "facebook/react",
        eventType: "push",
        receivedAt: now - 3600 * 1000,
      });
      await updateEventFinished(env.DB, "ev-1", {
        status: "processed",
        matchedRouteCount: 2,
        durationMs: 150,
      });

      await atomicRegisterEvent(env.DB, {
        deliveryId: "ev-2",
        repository: "vuejs/core",
        eventType: "pull_request",
        receivedAt: now - 1800 * 1000,
      });
      await updateEventFinished(env.DB, "ev-2", {
        status: "processed",
        matchedRouteCount: 1,
        durationMs: 120,
      });

      // 模拟插入 1 个 Stale 事件 (超过 5 分钟且处于 processing)
      await atomicRegisterEvent(env.DB, {
        deliveryId: "ev-stale",
        repository: "vuejs/core",
        eventType: "push",
        receivedAt: now - 10 * 60 * 1000,
      });

      // 模拟投递记录：3 次成功，1 次失败
      await insertDelivery(env.DB, {
        eventId: "ev-1",
        targetName: "Feishu Main",
        provider: "feishu",
        channelType: "feishu_webhook",
        status: "success",
        durationMs: 100,
        createdAt: now - 3500 * 1000,
      });
      await insertDelivery(env.DB, {
        eventId: "ev-1",
        targetName: "DingTalk Main",
        provider: "dingtalk",
        channelType: "dingtalk_webhook",
        status: "success",
        durationMs: 80,
        createdAt: now - 3500 * 1000,
      });
      await insertDelivery(env.DB, {
        eventId: "ev-2",
        targetName: "WeCom Main",
        provider: "wecom",
        channelType: "wecom_webhook",
        status: "failed",
        errorCode: "TIMEOUT",
        durationMs: 3000,
        createdAt: now - 1700 * 1000,
      });
      // 测试投递 (不应计入大盘)
      await insertDelivery(env.DB, {
        source: "test",
        targetName: "Test Target",
        provider: "feishu",
        channelType: "feishu_webhook",
        status: "failed",
        durationMs: 50,
        createdAt: now,
      });

      const stats = await getDashboardStats(env.DB, "24h", now);

      expect(stats.validEvents).toBe(3);
      expect(stats.totalDeliveries).toBe(3);
      expect(stats.successDeliveries).toBe(2);
      expect(stats.failedDeliveries).toBe(1);
      expect(stats.successRate).toBe(66.67);
      expect(stats.staleProcessingCount).toBe(1);

      // Event Types 分布
      expect(stats.eventTypes.length).toBe(2);
      const pushStat = stats.eventTypes.find((e) => e.eventType === "push");
      expect(pushStat?.count).toBe(2);

      // Top Repos
      expect(stats.topRepositories.length).toBe(2);

      // Providers 表现
      const feishuStat = stats.providers.find((p) => p.provider === "feishu");
      expect(feishuStat?.attempts).toBe(1);
      expect(feishuStat?.successRate).toBe(100);

      const wecomStat = stats.providers.find((p) => p.provider === "wecom");
      expect(wecomStat?.attempts).toBe(1);
      expect(wecomStat?.failed).toBe(1);
      expect(wecomStat?.successRate).toBe(0);

      // 趋势图数据
      expect(stats.trend.length).toBe(24);
    });
  });
});

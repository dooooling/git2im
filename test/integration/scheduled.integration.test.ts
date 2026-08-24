import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import worker from "../../src/index";
import { applyTestMigrations, clearTestDatabase } from "../helpers/db";
import { atomicRegisterEvent } from "../../src/storage/events";
import { insertDelivery } from "../../src/storage/deliveries";
import { setSecret } from "../../src/security/secret-store";

describe("Integration: Scheduled Cron Cleanup", () => {
  const masterKey = "k8x+N3Z9nLq1sR7uV2wY5zB8cD0eF3gH6jK9mP2rT5v=";

  beforeEach(async () => {
    await applyTestMigrations();
    await clearTestDatabase();
  });

  it("should clean up events and deliveries older than 30 days and expired previous secrets", async () => {
    const oldTime = Date.now() - 35 * 24 * 60 * 60 * 1000;

    // 插入旧 event
    await atomicRegisterEvent(env.DB, {
      deliveryId: "deliv-old-cron",
      repository: "antigravity/old-repo",
      eventType: "push",
      receivedAt: oldTime,
    });

    // 插入旧 delivery
    await insertDelivery(env.DB, {
      targetName: "Old Target",
      provider: "feishu",
      channelType: "feishu_webhook",
      status: "success",
      durationMs: 100,
      createdAt: oldTime,
    });

    // 插入已过期的 previous secret
    await setSecret(
      env.DB,
      masterKey,
      "global",
      "github_webhook",
      "github_webhook_secret_previous",
      "old-secret-val"
    );
    await env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
      .bind("github_webhook_secret_previous_expires_at", String(Date.now() - 1000), Date.now())
      .run();

    // 触发 scheduled handler
    await worker.scheduled({} as ScheduledController, env, {} as ExecutionContext);

    // 验证旧 event 被清除
    const event = await env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind("deliv-old-cron").first();
    expect(event).toBeNull();

    // 验证旧 delivery 被清除
    const deliveries = await env.DB.prepare(`SELECT * FROM deliveries WHERE created_at = ?`).bind(oldTime).all();
    expect(deliveries.results.length).toBe(0);

    // 验证过期 previous secret 被删除
    const prevSecret = await env.DB.prepare(`SELECT * FROM secrets WHERE name = 'github_webhook_secret_previous'`).first();
    expect(prevSecret).toBeNull();
  });
});

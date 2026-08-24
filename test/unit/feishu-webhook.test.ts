import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations, clearTestDatabase } from "../helpers/db";
import { feishuWebhookChannel } from "../../src/channels/feishu/webhook";
import { setSecret } from "../../src/security/secret-store";
import { calculateFeishuWebhookSign } from "../../src/channels/feishu/webhook-signature";
import type { FeishuWebhookTarget } from "../../src/channels/types";
import type { Notification } from "../../src/notification/types";

describe("Channels: Feishu Webhook Channel", () => {
  const testMasterKey = "k8x+N3Z9nLq1sR7uV2wY5zB8cD0eF3gH6jK9mP2rT5v=";
  const target: FeishuWebhookTarget = {
    id: "feishu-t1",
    name: "研发群飞书机器人",
    type: "feishu_webhook",
    enabled: true,
  };

  const notification: Notification = {
    title: "Push to main",
    level: "info",
    repository: "antigravity/git2im",
    eventLabel: "Push",
    fields: [
      { label: "Repository", value: "antigravity/git2im" },
      { label: "Branch", value: "main" },
    ],
    description: "• `a1b2c3d` feat: test feishu webhook",
    action: { text: "View Changes", url: "https://github.com/antigravity/git2im" },
  };

  beforeEach(async () => {
    await applyTestMigrations();
    await clearTestDatabase();
    vi.restoreAllMocks();
  });

  it("should calculate valid Feishu signature", async () => {
    const sign = await calculateFeishuWebhookSign("my-feishu-secret", 1599360473);
    expect(sign).toBeTruthy();
    expect(typeof sign).toBe("string");
  });

  it("should successfully send message to Feishu webhook", async () => {
    await setSecret(
      env.DB,
      testMasterKey,
      "target",
      target.id,
      "webhook_url",
      "https://open.feishu.cn/open-apis/bot/v2/hook/abc-123-valid"
    );

    // Mock 飞书返回 200 OK
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.msg_type).toBe("interactive");
      expect(body.card.header.title.content).toBe("Push to main");

      return new Response(JSON.stringify({ code: 0, msg: "success" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await feishuWebhookChannel.send(env, target, notification);

    expect(fetchSpy).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.provider).toBe("feishu");
    expect(result.channelType).toBe("feishu_webhook");
  });

  it("should handle Feishu API business error", async () => {
    await setSecret(
      env.DB,
      testMasterKey,
      "target",
      target.id,
      "webhook_url",
      "https://open.feishu.cn/open-apis/bot/v2/hook/abc-123-valid"
    );

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: 19001, msg: "sign match fail" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await feishuWebhookChannel.send(env, target, notification);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("FEISHU_WEBHOOK_API_ERROR");
    expect(result.providerCode).toBe("19001");
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations, clearTestDatabase } from "../helpers/db";
import { weComWebhookChannel } from "../../src/channels/wecom/webhook";
import { setSecret } from "../../src/security/secret-store";
import type { WeComWebhookTarget } from "../../src/channels/types";
import type { Notification } from "../../src/notification/types";

describe("Channels: WeCom Webhook Channel", () => {
  const testMasterKey = "k8x+N3Z9nLq1sR7uV2wY5zB8cD0eF3gH6jK9mP2rT5v=";
  const target: WeComWebhookTarget = {
    id: "wecom-t1",
    name: "企微项目告警群",
    type: "wecom_webhook",
    enabled: true,
  };

  const notification: Notification = {
    title: "Push to develop",
    level: "info",
    repository: "antigravity/git2im",
    eventLabel: "Push",
    fields: [
      { label: "Repository", value: "antigravity/git2im" },
      { label: "Branch", value: "develop" },
    ],
    description: "• `c3d4e5f` test wecom markdown",
    action: { text: "View Changes", url: "https://github.com/..." },
  };

  beforeEach(async () => {
    await applyTestMigrations();
    await clearTestDatabase();
    vi.restoreAllMocks();
  });

  it("should send markdown message to WeCom webhook with color tags", async () => {
    await setSecret(
      env.DB,
      testMasterKey,
      "target",
      target.id,
      "webhook_url",
      "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=693a91f6-7xxx"
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      expect(body.msgtype).toBe("markdown");
      expect(body.markdown.content).toContain('<font color="info">Push to develop</font>');
      expect(body.markdown.content).toContain("> **Repository:** antigravity/git2im");

      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await weComWebhookChannel.send(env, target, notification);

    expect(fetchSpy).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.provider).toBe("wecom");
    expect(result.channelType).toBe("wecom_webhook");
  });
});

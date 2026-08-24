import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations, clearTestDatabase } from "../helpers/db";
import { dingTalkWebhookChannel } from "../../src/channels/dingtalk/webhook";
import { setSecret } from "../../src/security/secret-store";
import { calculateDingTalkSign } from "../../src/channels/dingtalk/signature";
import type { DingTalkWebhookTarget } from "../../src/channels/types";
import type { Notification } from "../../src/notification/types";

describe("Channels: DingTalk Webhook Channel", () => {
  const testMasterKey = "k8x+N3Z9nLq1sR7uV2wY5zB8cD0eF3gH6jK9mP2rT5v=";
  const target: DingTalkWebhookTarget = {
    id: "dingtalk-t1",
    name: "钉钉研发告警群",
    type: "dingtalk_webhook",
    enabled: true,
  };

  const notification: Notification = {
    title: "Workflow CI: failure",
    level: "error",
    repository: "antigravity/git2im",
    eventLabel: "Workflow Run",
    fields: [
      { label: "Workflow", value: "CI #12" },
      { label: "Conclusion", value: "FAILURE" },
    ],
    action: { text: "View Action", url: "https://github.com/..." },
  };

  beforeEach(async () => {
    await applyTestMigrations();
    await clearTestDatabase();
    vi.restoreAllMocks();
  });

  it("should calculate DingTalk signature string", async () => {
    const sign = await calculateDingTalkSign("SEC-secret-123", 1600000000000);
    expect(sign).toBeTruthy();
    expect(typeof sign).toBe("string");
  });

  it("should send markdown message to DingTalk with signature query params", async () => {
    await setSecret(
      env.DB,
      testMasterKey,
      "target",
      target.id,
      "webhook_url",
      "https://oapi.dingtalk.com/robot/send?access_token=token-123456"
    );
    await setSecret(
      env.DB,
      testMasterKey,
      "target",
      target.id,
      "sign_secret",
      "SEC-my-sign-secret"
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init: any) => {
      const urlStr = String(url);
      expect(urlStr.includes("timestamp=")).toBe(true);
      expect(urlStr.includes("sign=")).toBe(true);

      const body = JSON.parse(init?.body as string);
      expect(body.msgtype).toBe("markdown");
      expect(body.markdown.title).toBe("Workflow CI: failure");
      expect(body.markdown.text).toContain("### 🔴 Workflow CI: failure");

      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await dingTalkWebhookChannel.send(env, target, notification);

    expect(fetchSpy).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.provider).toBe("dingtalk");
    expect(result.channelType).toBe("dingtalk_webhook");
  });
});

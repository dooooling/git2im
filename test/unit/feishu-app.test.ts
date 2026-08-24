import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations, clearTestDatabase } from "../helpers/db";
import { feishuAppChannel } from "../../src/channels/feishu/app";
import { resetFeishuTokenCache } from "../../src/channels/feishu/app-token";
import { setSecret } from "../../src/security/secret-store";
import type { FeishuAppTarget } from "../../src/channels/types";
import type { Notification } from "../../src/notification/types";

describe("Channels: Feishu App Channel (N:N Support)", () => {
  const testMasterKey = "k8x+N3Z9nLq1sR7uV2wY5zB8cD0eF3gH6jK9mP2rT5v=";
  const target: FeishuAppTarget = {
    id: "feishu-app-t1",
    name: "研发负责人群组",
    type: "feishu_app",
    appId: "cli_test_app_id_1",
    recipients: [
      { receiveIdType: "open_id", receiveId: "ou_1234567890" },
      { receiveIdType: "chat_id", receiveId: "oc_abcdef123456" },
    ],
    enabled: true,
  };

  const notification: Notification = {
    title: "Release v1.0.0",
    level: "success",
    repository: "antigravity/git2im",
    eventLabel: "Release",
    fields: [{ label: "Tag", value: "v1.0.0" }],
    description: "Initial Release",
  };

  beforeEach(async () => {
    await applyTestMigrations();
    await clearTestDatabase();
    resetFeishuTokenCache();
    vi.restoreAllMocks();
  });

  it("should send message using Feishu OpenAPI with per-target App credentials to all recipients", async () => {
    // 1. 在 Target 专属作用域配置 App Secret
    await setSecret(
      env.DB,
      testMasterKey,
      "target",
      target.id,
      "app_secret",
      "test_app_secret_123"
    );

    // 2. Mock 飞书 Token 与发送接口
    const receivedRecipients: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init: any) => {
      const urlStr = String(url);

      if (urlStr.includes("/auth/v3/tenant_access_token/internal")) {
        const body = JSON.parse(init?.body as string);
        expect(body.app_id).toBe("cli_test_app_id_1");
        expect(body.app_secret).toBe("test_app_secret_123");

        return new Response(
          JSON.stringify({
            code: 0,
            msg: "ok",
            tenant_access_token: "t-mock-tenant-token-999",
            expire: 7200,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (urlStr.includes("/im/v1/messages")) {
        expect(init?.headers?.Authorization).toBe("Bearer t-mock-tenant-token-999");
        const body = JSON.parse(init?.body as string);
        receivedRecipients.push(body.receive_id);
        expect(body.msg_type).toBe("interactive");
        expect(typeof body.content).toBe("string");
        const parsedCard = JSON.parse(body.content);
        expect(parsedCard.header.title.content).toBe("Release v1.0.0");

        return new Response(
          JSON.stringify({ code: 0, msg: "success" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("Not Found", { status: 404 });
    });

    const result = await feishuAppChannel.send(env, target, notification);

    expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 次 Token + 2 个 Recipient 投递
    expect(receivedRecipients).toEqual(["ou_1234567890", "oc_abcdef123456"]);
    expect(result.success).toBe(true);
    expect(result.provider).toBe("feishu");
    expect(result.channelType).toBe("feishu_app");
  });

  it("should fail gracefully when App Secret is not configured on target", async () => {
    const result = await feishuAppChannel.send(env, target, notification);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("FEISHU_APP_NOT_CONFIGURED");
  });
});

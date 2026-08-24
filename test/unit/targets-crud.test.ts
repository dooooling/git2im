import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations, clearTestDatabase } from "../helpers/db";
import {
  createTarget,
  updateTarget,
  deleteTarget,
  listTargets,
  getTargetById,
} from "../../src/config/targets";
import { getSecret } from "../../src/security/secret-store";

describe("Config: Targets CRUD & Uniqueness", () => {
  const testMasterKey = "k8x+N3Z9nLq1sR7uV2wY5zB8cD0eF3gH6jK9mP2rT5v=";

  beforeEach(async () => {
    await applyTestMigrations();
    await clearTestDatabase();
  });

  it("should create Feishu App target with unique name, appId, encrypted secret and multiple recipients", async () => {
    const target = await createTarget(env.DB, testMasterKey, {
      name: "支付告警通知组",
      type: "feishu_app",
      appId: "cli_payment_app_001",
      appSecret: "sec_payment_secret_999",
      recipients: [
        { receiveIdType: "chat_id", receiveId: "oc_payment_group_1" },
        { receiveIdType: "open_id", receiveId: "ou_lead_dev_1" },
      ],
      enabled: true,
    });

    expect(target.id).toBeTruthy();
    expect(target.name).toBe("支付告警通知组");
    expect(target.appId).toBe("cli_payment_app_001");
    expect(target.appSecretConfigured).toBe(true);
    expect(target.recipients?.length).toBe(2);

    // 验证 Secret 已安全加密存储在 DB
    const savedSecret = await getSecret(
      env.DB,
      testMasterKey,
      "target",
      target.id,
      "app_secret"
    );
    expect(savedSecret).toBe("sec_payment_secret_999");

    // 验证 getTargetById
    const loaded = await getTargetById(env.DB, target.id);
    expect(loaded?.name).toBe("支付告警通知组");
    expect((loaded as any).appId).toBe("cli_payment_app_001");
    expect((loaded as any).recipients.length).toBe(2);
  });

  it("should reject duplicate target names", async () => {
    await createTarget(env.DB, testMasterKey, {
      name: "告警群",
      type: "wecom_webhook",
      webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=11111111-2222-3333-4444-555555555555",
    });

    await expect(
      createTarget(env.DB, testMasterKey, {
        name: "告警群",
        type: "feishu_webhook",
        webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/11111111-2222-3333-4444-555555555555",
      })
    ).rejects.toThrow(/already exists/);
  });

  it("should reject duplicate target configuration content", async () => {
    const webhookUrl = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=22222222-3333-4444-5555-666666666666";

    await createTarget(env.DB, testMasterKey, {
      name: "企微机器人 A",
      type: "wecom_webhook",
      webhookUrl,
    });

    // 尝试创建不同名称但完全相同 Webhook URL 的 Target
    await expect(
      createTarget(env.DB, testMasterKey, {
        name: "企微机器人 B",
        type: "wecom_webhook",
        webhookUrl,
      })
    ).rejects.toThrow(/identical configuration/);
  });

  it("should reject duplicate Feishu App configuration (same App ID and identical recipients)", async () => {
    await createTarget(env.DB, testMasterKey, {
      name: "飞书目标 1",
      type: "feishu_app",
      appId: "cli_app_shared",
      appSecret: "sec_shared",
      recipients: [
        { receiveIdType: "chat_id", receiveId: "oc_group_1" },
        { receiveIdType: "open_id", receiveId: "ou_user_1" },
      ],
    });

    // 即使接收人顺序颠倒，也应该被内容指纹拦截
    await expect(
      createTarget(env.DB, testMasterKey, {
        name: "飞书目标 2",
        type: "feishu_app",
        appId: "cli_app_shared",
        appSecret: "sec_shared",
        recipients: [
          { receiveIdType: "open_id", receiveId: "ou_user_1" },
          { receiveIdType: "chat_id", receiveId: "oc_group_1" },
        ],
      })
    ).rejects.toThrow(/identical configuration/);
  });

  it("should update and delete target and cascade delete its secrets", async () => {
    const created = await createTarget(env.DB, testMasterKey, {
      name: "研发群",
      type: "feishu_app",
      appId: "cli_app_1",
      appSecret: "sec_1",
      recipients: [{ receiveIdType: "chat_id", receiveId: "oc_1" }],
    });

    // Update
    const updated = await updateTarget(env.DB, testMasterKey, created.id, {
      name: "研发群 (已改名)",
      recipients: [
        { receiveIdType: "chat_id", receiveId: "oc_1" },
        { receiveIdType: "open_id", receiveId: "ou_2" },
      ],
    });
    expect(updated.name).toBe("研发群 (已改名)");
    expect(updated.recipients?.length).toBe(2);

    // Delete
    await deleteTarget(env.DB, created.id);
    const list = await listTargets(env.DB);
    expect(list.length).toBe(0);

    const secretAfter = await getSecret(
      env.DB,
      testMasterKey,
      "target",
      created.id,
      "app_secret"
    );
    expect(secretAfter).toBeNull();
  });
});

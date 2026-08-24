import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations, clearTestDatabase } from "../helpers/db";
import {
  getSecret,
  setSecret,
  prepareDeleteSecretStatement,
  getAcceptedGithubWebhookSecrets,
  rotateGithubWebhookSecret,
} from "../../src/security/secret-store";

describe("Security: D1 SecretStore", () => {
  const testMasterKey = "k8x+N3Z9nLq1sR7uV2wY5zB8cD0eF3gH6jK9mP2rT5v=";

  beforeEach(async () => {
    await applyTestMigrations();
    await clearTestDatabase();
  });

  it("should securely store and retrieve an encrypted secret", async () => {
    const targetId = "target-123";
    const webhookUrl = "https://open.feishu.cn/open-apis/bot/v2/hook/abc-123-uuid";

    await setSecret(env.DB, testMasterKey, "target", targetId, "webhook_url", webhookUrl);

    // 验证 D1 中存储的是密文，而非明文
    const row = await env.DB.prepare("SELECT ciphertext, iv FROM secrets WHERE scope_id = ?")
      .bind(targetId)
      .first<{ ciphertext: string; iv: string }>();

    expect(row).toBeTruthy();
    expect(row?.ciphertext).not.toBe(webhookUrl);
    expect(row?.ciphertext.includes("open.feishu.cn")).toBe(false);

    // 读取解密后的明文
    const decrypted = await getSecret(env.DB, testMasterKey, "target", targetId, "webhook_url");
    expect(decrypted).toBe(webhookUrl);
  });

  it("should return null when secret does not exist", async () => {
    const secret = await getSecret(env.DB, testMasterKey, "target", "non-existent", "webhook_url");
    expect(secret).toBeNull();
  });

  it("should delete secret cleanly", async () => {
    const targetId = "target-delete-test";
    await setSecret(env.DB, testMasterKey, "target", targetId, "sign_secret", "my-sign-secret");

    const stmt = prepareDeleteSecretStatement(env.DB, "target", targetId, "sign_secret");
    await stmt.run();

    const result = await getSecret(env.DB, testMasterKey, "target", targetId, "sign_secret");
    expect(result).toBeNull();
  });

  it("should rotate GitHub Webhook Secret and keep previous secret in candidate list", async () => {
    // 1. 初始化 Current Secret
    const initialSecret = "initial-github-secret-v1";
    await setSecret(
      env.DB,
      testMasterKey,
      "global",
      "github",
      "webhook_secret_current",
      initialSecret
    );

    let candidates = await getAcceptedGithubWebhookSecrets(env.DB, testMasterKey);
    expect(candidates).toEqual([initialSecret]);

    // 2. 触发轮换
    const rotateResult = await rotateGithubWebhookSecret(env.DB, testMasterKey, "new-rotated-secret-v2");
    expect(rotateResult.newSecret).toBe("new-rotated-secret-v2");
    expect(rotateResult.expiresAt).toBeGreaterThan(Date.now());

    // 3. 轮换后由于在 30 分钟内，候选列表应同时包含新密钥和旧密钥
    candidates = await getAcceptedGithubWebhookSecrets(env.DB, testMasterKey);
    expect(candidates).toContain("new-rotated-secret-v2");
    expect(candidates).toContain(initialSecret);
    expect(candidates.length).toBe(2);
  });
});

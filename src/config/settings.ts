/**
 * 系统全局设置管理模块 (System Settings View)
 */

export interface SystemSettingsView {
  githubWebhookSecretConfigured: boolean;
  githubWebhookSecretPreviousActive: boolean;
  githubWebhookSecretPreviousExpiresAt: number | null;
}

/**
 * 获取脱敏后的系统全局设置状态
 */
export async function getSystemSettings(db: D1Database): Promise<SystemSettingsView> {
  const settingsRows = await db
    .prepare(`SELECT key, value FROM settings`)
    .all<{ key: string; value: string }>();

  const settingsMap = new Map<string, string>();
  for (const row of settingsRows.results) {
    settingsMap.set(row.key, row.value);
  }

  // 检查 global 作用域 secrets 配置状态
  const globalSecrets = await db
    .prepare(`SELECT name FROM secrets WHERE scope = 'global'`)
    .all<{ name: string }>();

  const secretNames = new Set(globalSecrets.results.map((s) => s.name));

  const prevExpiresAtStr = settingsMap.get("github_webhook_secret_previous_expires_at");
  const prevExpiresAt = prevExpiresAtStr ? parseInt(prevExpiresAtStr, 10) : null;
  const isPreviousActive =
    secretNames.has("github_webhook_secret_previous") &&
    prevExpiresAt !== null &&
    prevExpiresAt > Date.now();

  return {
    githubWebhookSecretConfigured: secretNames.has("github_webhook_secret_current"),
    githubWebhookSecretPreviousActive: isPreviousActive,
    githubWebhookSecretPreviousExpiresAt: isPreviousActive ? prevExpiresAt : null,
  };
}

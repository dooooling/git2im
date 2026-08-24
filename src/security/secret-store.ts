/**
 * 敏感凭据存储与管理模块 (D1 SecretStore)
 *
 * 核心机制：
 * 1. 所有业务 Secret（Webhook URL, Sign Secret, Feishu App Secret, GitHub Webhook Secret）
 *    写入 D1 前统一使用 AES-256-GCM 加密，并绑定 AAD 作用域 (scope:scope_id:name)。
 * 2. 批量操作支持返回 D1PreparedStatement，以便与 Target/Route CRUD 组合在 env.DB.batch() 事务中原子执行。
 * 3. GitHub Webhook Secret 支持平滑轮换机制 (Rotate)：新密钥生效，旧密钥保留 30 分钟过渡窗口。
 */

import { encryptAesGcm, decryptAesGcm, generateRandomBase64 } from "./crypto";

export interface SecretRecord {
  scope: string;
  scope_id: string;
  name: string;
  ciphertext: string;
  iv: string;
  version: number;
  updated_at: number;
}

export interface GithubSecretMeta {
  current_updated_at: number;
  previous_expires_at?: number;
}

/**
 * 构造 AAD 关联认证数据标识符
 */
export function buildSecretAad(scope: string, scopeId: string, name: string): string {
  return `${scope}:${scopeId}:${name}`;
}

/**
 * 读取并解密单个 Secret
 *
 * @param db Cloudflare D1 实例
 * @param masterKeyBase64 Master Key (Base64)
 * @param scope 作用域 (如 'target', 'global')
 * @param scopeId 作用域实体 ID (如 target_id 或 'github')
 * @param name 凭据标识 (如 'webhook_url', 'sign_secret')
 * @returns 解密后的明文字符串，若不存在返回 null
 */
export async function getSecret(
  db: D1Database,
  masterKeyBase64: string,
  scope: string,
  scopeId: string,
  name: string
): Promise<string | null> {
  const statement = db
    .prepare(
      `SELECT scope, scope_id, name, ciphertext, iv, version, updated_at
       FROM secrets
       WHERE scope = ? AND scope_id = ? AND name = ?`
    )
    .bind(scope, scopeId, name);

  const row = await statement.first<SecretRecord>();
  if (!row) {
    return null;
  }

  const aad = buildSecretAad(scope, scopeId, name);
  return await decryptAesGcm(row.ciphertext, row.iv, masterKeyBase64, aad);
}

/**
 * 构建用于加密写入/覆盖 Secret 的预编译 SQL 语句 (适用于 batch 事务)
 *
 * @param db Cloudflare D1 实例
 * @param masterKeyBase64 Master Key (Base64)
 * @param scope 作用域
 * @param scopeId 作用域实体 ID
 * @param name 凭据标识
 * @param plaintext 待写入的明文凭据
 */
export async function prepareSetSecretStatement(
  db: D1Database,
  masterKeyBase64: string,
  scope: string,
  scopeId: string,
  name: string,
  plaintext: string
): Promise<D1PreparedStatement> {
  const aad = buildSecretAad(scope, scopeId, name);
  const { ciphertext, iv } = await encryptAesGcm(plaintext, masterKeyBase64, aad);
  const now = Date.now();

  return db
    .prepare(
      `INSERT INTO secrets (scope, scope_id, name, ciphertext, iv, version, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(scope, scope_id, name) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         version = secrets.version + 1,
         updated_at = excluded.updated_at`
    )
    .bind(scope, scopeId, name, ciphertext, iv, now);
}

/**
 * 直接加密保存单个 Secret
 */
export async function setSecret(
  db: D1Database,
  masterKeyBase64: string,
  scope: string,
  scopeId: string,
  name: string,
  plaintext: string
): Promise<void> {
  const stmt = await prepareSetSecretStatement(
    db,
    masterKeyBase64,
    scope,
    scopeId,
    name,
    plaintext
  );
  await stmt.run();
}

/**
 * 构建删除单个 Secret 的预编译 SQL 语句
 */
export function prepareDeleteSecretStatement(
  db: D1Database,
  scope: string,
  scopeId: string,
  name: string
): D1PreparedStatement {
  return db
    .prepare(`DELETE FROM secrets WHERE scope = ? AND scope_id = ? AND name = ?`)
    .bind(scope, scopeId, name);
}

/**
 * 构建删除某个 ScopeId 下全部 Secret 的预编译 SQL 语句（如删除 Target 时同步清理其所有凭据）
 */
export function prepareDeleteScopeSecretsStatement(
  db: D1Database,
  scope: string,
  scopeId: string
): D1PreparedStatement {
  return db
    .prepare(`DELETE FROM secrets WHERE scope = ? AND scope_id = ?`)
    .bind(scope, scopeId);
}

/**
 * 获取当前所有有效接收的 GitHub Webhook Secret 列表
 *
 * 规则：
 * 1. 包含当前激活的 Current Secret；
 * 2. 若存在 Previous Secret 且未超过 30 分钟轮换过渡期，同时将其加入候选列表；
 * 3. 验签时依次使用候选 Secret 校验，任一通过即认为合法。
 *
 * @param db D1 实例
 * @param masterKeyBase64 Master Key (Base64)
 * @returns 有效的 Secret 明文数组 (最多 2 个)
 */
export async function getAcceptedGithubWebhookSecrets(
  db: D1Database,
  masterKeyBase64: string
): Promise<string[]> {
  const secrets: string[] = [];

  // 1. 获取 Current Secret
  const currentSecret = await getSecret(
    db,
    masterKeyBase64,
    "global",
    "github",
    "webhook_secret_current"
  );
  if (currentSecret) {
    secrets.push(currentSecret);
  }

  // 2. 检查 Previous Secret 是否仍在 30 分钟有效期内
  const metaRow = await db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind("github_webhook_secret_meta")
    .first<{ value: string }>();

  if (metaRow) {
    try {
      const meta: GithubSecretMeta = JSON.parse(metaRow.value);
      const now = Date.now();
      if (meta.previous_expires_at && meta.previous_expires_at > now) {
        const prevSecret = await getSecret(
          db,
          masterKeyBase64,
          "global",
          "github",
          "webhook_secret_previous"
        );
        if (prevSecret) {
          secrets.push(prevSecret);
        }
      }
    } catch {
      // JSON 解析失败则忽略 Previous Secret
    }
  }

  return secrets;
}

/**
 * 轮换 GitHub Webhook Secret (平滑过渡 30 分钟)
 *
 * @param db D1 实例
 * @param masterKeyBase64 Master Key (Base64)
 * @param customNewSecret 可选自定义新密钥，若未提供则随机生成 32 字节高强度密钥
 * @returns 新生成的 Secret 明文以及旧密钥过期时间戳
 */
export async function rotateGithubWebhookSecret(
  db: D1Database,
  masterKeyBase64: string,
  customNewSecret?: string
): Promise<{ newSecret: string; expiresAt: number }> {
  const now = Date.now();
  const transitionMs = 30 * 60 * 1000; // 30 分钟过渡窗口
  const expiresAt = now + transitionMs;

  const newSecret = customNewSecret || generateRandomBase64(32);

  // 1. 读取原 Current Secret 作为新 Previous Secret
  const currentSecret = await getSecret(
    db,
    masterKeyBase64,
    "global",
    "github",
    "webhook_secret_current"
  );

  const statements: D1PreparedStatement[] = [];

  // 2. 将原 Current Secret 写入 Previous 槽位
  if (currentSecret) {
    const prevStmt = await prepareSetSecretStatement(
      db,
      masterKeyBase64,
      "global",
      "github",
      "webhook_secret_previous",
      currentSecret
    );
    statements.push(prevStmt);
  }

  // 3. 写入新的 Current Secret
  const currStmt = await prepareSetSecretStatement(
    db,
    masterKeyBase64,
    "global",
    "github",
    "webhook_secret_current",
    newSecret
  );
  statements.push(currStmt);

  // 4. 更新轮换元数据
  const meta: GithubSecretMeta = {
    current_updated_at: now,
    previous_expires_at: currentSecret ? expiresAt : undefined,
  };
  const metaStmt = db
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`
    )
    .bind("github_webhook_secret_meta", JSON.stringify(meta), now);
  statements.push(metaStmt);

  // 5. 批处理原子事务执行
  await db.batch(statements);

  return {
    newSecret,
    expiresAt,
  };
}

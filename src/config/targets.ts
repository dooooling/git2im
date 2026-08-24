/**
 * 通知目标配置管理与 D1 持久化模块 (Targets Config CRUD - Name & Content Uniqueness)
 *
 * 核心规范：
 * 1. Target 名称全局唯一性校验 (Name Uniqueness)。
 * 2. Target 配置内容全局唯一性校验 (Content Uniqueness)：
 *    - Webhook 目标：按 Webhook URL 进行哈希去重；
 *    - 飞书企业自建应用：按 App ID + 接收人群组列表进行哈希去重。
 * 3. 严格禁止回显 Secret 明文，仅返回 configured 脱敏标志。
 */

import type { ChannelType, Target, FeishuAppRecipient } from "../channels/types";
import {
  prepareSetSecretStatement,
  prepareDeleteSecretStatement,
  prepareDeleteScopeSecretsStatement,
} from "../security/secret-store";
import { validateWebhookUrl } from "../channels/url-guard";
import { getLastTargetTestDelivery } from "../storage/deliveries";

export interface TargetView {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  appId?: string;
  appSecretConfigured?: boolean;
  recipients?: FeishuAppRecipient[];
  webhookConfigured?: boolean;
  signSecretConfigured?: boolean;
  createdAt: number;
  updatedAt: number;
  lastTest?: {
    at: number;
    status: "success" | "failed";
    durationMs: number;
    errorSummary: string | null;
  } | null;
}

export interface CreateTargetInput {
  name: string;
  type: ChannelType;
  enabled?: boolean;
  webhookUrl?: string;
  signSecret?: string;
  appId?: string;
  appSecret?: string;
  recipients?: FeishuAppRecipient[];
}

export interface UpdateTargetInput {
  name?: string;
  enabled?: boolean;
  webhookUrl?: string;
  clearWebhookUrl?: boolean;
  signSecret?: string;
  clearSignSecret?: boolean;
  appId?: string;
  appSecret?: string;
  clearAppSecret?: boolean;
  recipients?: FeishuAppRecipient[];
}

interface TargetDbRow {
  id: string;
  name: string;
  type: ChannelType;
  enabled: number;
  config_json: string;
  created_at: number;
  updated_at: number;
}

/**
 * 计算配置内容的唯一指纹 SHA-256
 */
async function computeContentHash(raw: string): Promise<string> {
  const enc = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 生成 Target 的内容指纹字符串
 */
function buildTargetContentFingerprint(
  type: ChannelType,
  webhookUrl?: string,
  appId?: string,
  recipients?: FeishuAppRecipient[]
): string {
  if (type === "feishu_app") {
    const sortedRecipients = (recipients || [])
      .map((r) => `${r.receiveIdType}:${r.receiveId.trim()}`)
      .sort()
      .join(",");
    return `feishu_app:${(appId || "").trim()}:${sortedRecipients}`;
  }
  return `${type}:${(webhookUrl || "").trim()}`;
}

/**
 * 校验目标名称是否已存在 (唯一性保证)
 */
async function assertUniqueTargetName(db: D1Database, name: string, excludeId?: string): Promise<void> {
  const existing = await db
    .prepare(`SELECT id, name FROM targets WHERE name = ?`)
    .bind(name.trim())
    .first<{ id: string; name: string }>();

  if (existing && existing.id !== excludeId) {
    throw new Error(`Target with name "${name.trim()}" already exists`);
  }
}

/**
 * 校验配置内容是否已存在 (配置内容唯一性保证)
 */
async function assertUniqueTargetContent(
  db: D1Database,
  contentHash: string,
  excludeId?: string
): Promise<void> {
  const rows = await db
    .prepare(`SELECT id, name, config_json FROM targets`)
    .all<TargetDbRow>();

  for (const row of rows.results) {
    if (row.id === excludeId) continue;
    try {
      const cfg = JSON.parse(row.config_json || "{}");
      if (cfg.content_hash === contentHash) {
        throw new Error(`Target with identical configuration already exists (Target: "${row.name}")`);
      }
    } catch (e: any) {
      if (e.message?.includes("identical configuration")) throw e;
    }
  }
}

/**
 * 获取所有 Target 列表（已注入脱敏标记与最近测试状态）
 */
export async function listTargets(db: D1Database): Promise<TargetView[]> {
  const rows = await db
    .prepare(`SELECT * FROM targets ORDER BY created_at ASC`)
    .all<TargetDbRow>();

  const secretsConfigured = await db
    .prepare(`SELECT scope_id, name FROM secrets WHERE scope = 'target'`)
    .all<{ scope_id: string; name: string }>();

  const configuredSet = new Set(
    secretsConfigured.results.map((r) => `${r.scope_id}:${r.name}`)
  );

  const list: TargetView[] = [];

  for (const row of rows.results) {
    let extraConfig: any = {};
    try {
      extraConfig = JSON.parse(row.config_json || "{}");
    } catch {
      extraConfig = {};
    }

    const lastTest = await getLastTargetTestDelivery(db, row.id);

    list.push({
      id: row.id,
      name: row.name,
      type: row.type,
      enabled: row.enabled === 1,
      appId: extraConfig.appId,
      recipients: extraConfig.recipients || [],
      webhookConfigured: configuredSet.has(`${row.id}:webhook_url`),
      signSecretConfigured: configuredSet.has(`${row.id}:sign_secret`),
      appSecretConfigured: configuredSet.has(`${row.id}:app_secret`),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastTest: lastTest
        ? {
            at: lastTest.lastTestAt,
            status: lastTest.lastTestStatus,
            durationMs: lastTest.lastTestDurationMs,
            errorSummary: lastTest.errorSummary,
          }
        : null,
    });
  }

  return list;
}

/**
 * 根据 ID 查询单个 Target 完整配置
 */
export async function getTargetById(
  db: D1Database,
  id: string
): Promise<Target | null> {
  const row = await db
    .prepare(`SELECT * FROM targets WHERE id = ?`)
    .bind(id)
    .first<TargetDbRow>();

  if (!row) return null;

  let extraConfig: any = {};
  try {
    extraConfig = JSON.parse(row.config_json || "{}");
  } catch {
    extraConfig = {};
  }

  const base = {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
  };

  switch (row.type) {
    case "feishu_app":
      return {
        ...base,
        type: "feishu_app",
        appId: extraConfig.appId || "",
        recipients: extraConfig.recipients || [],
      };
    case "feishu_webhook":
    case "dingtalk_webhook":
    case "wecom_webhook":
      return {
        ...base,
        type: row.type,
      };
  }
}

/**
 * 创建新 Target 并在原子批次中加密保存对应 Secret
 */
export async function createTarget(
  db: D1Database,
  masterKey: string,
  input: CreateTargetInput
): Promise<TargetView> {
  const targetName = input.name.trim();
  await assertUniqueTargetName(db, targetName);

  const id = crypto.randomUUID();
  const now = Date.now();
  const enabled = input.enabled !== false ? 1 : 0;

  // 1. 校验 Webhook URL 域名白名单与必填项
  if (input.type !== "feishu_app" && !input.webhookUrl) {
    throw new Error("Webhook URL is required for webhook targets");
  }

  if (input.webhookUrl) {
    const check = validateWebhookUrl(input.type, input.webhookUrl);
    if (!check.valid) {
      throw new Error(`Invalid Webhook URL: ${check.reason}`);
    }
  }

  const extraConfig: any = {};
  if (input.type === "feishu_app") {
    if (!input.appId) {
      throw new Error("Feishu App Target requires App ID (cli_xxx)");
    }
    if (!input.appSecret) {
      throw new Error("Feishu App Target requires App Secret");
    }
    if (!input.recipients || input.recipients.length === 0) {
      throw new Error("Feishu App Target requires at least one recipient");
    }
    extraConfig.appId = input.appId.trim();
    extraConfig.recipients = input.recipients;
  }

  // 2. 计算配置内容指纹并执行配置唯一性校验
  const fingerprint = buildTargetContentFingerprint(
    input.type,
    input.webhookUrl,
    input.appId,
    input.recipients
  );
  const contentHash = await computeContentHash(fingerprint);
  await assertUniqueTargetContent(db, contentHash);
  extraConfig.content_hash = contentHash;

  const statements: D1PreparedStatement[] = [];

  // 3. 写入 targets 表
  statements.push(
    db
      .prepare(
        `INSERT INTO targets (id, name, type, enabled, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, targetName, input.type, enabled, JSON.stringify(extraConfig), now, now)
  );

  // 4. 加密写入 Webhook URL
  if (input.webhookUrl) {
    const stmt = await prepareSetSecretStatement(
      db,
      masterKey,
      "target",
      id,
      "webhook_url",
      input.webhookUrl.trim()
    );
    statements.push(stmt);
  }

  // 5. 加密写入 Sign Secret
  if (input.signSecret) {
    const stmt = await prepareSetSecretStatement(
      db,
      masterKey,
      "target",
      id,
      "sign_secret",
      input.signSecret.trim()
    );
    statements.push(stmt);
  }

  // 6. 加密写入 Feishu App Secret
  if (input.type === "feishu_app" && input.appSecret) {
    const stmt = await prepareSetSecretStatement(
      db,
      masterKey,
      "target",
      id,
      "app_secret",
      input.appSecret.trim()
    );
    statements.push(stmt);
  }

  // 7. 执行 D1 原子事务
  await db.batch(statements);

  return {
    id,
    name: targetName,
    type: input.type,
    enabled: enabled === 1,
    appId: extraConfig.appId,
    recipients: extraConfig.recipients,
    webhookConfigured: !!input.webhookUrl,
    signSecretConfigured: !!input.signSecret,
    appSecretConfigured: !!input.appSecret,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 更新已有 Target 并在原子批次中维护对应 Secret
 */
export async function updateTarget(
  db: D1Database,
  masterKey: string,
  id: string,
  input: UpdateTargetInput
): Promise<TargetView> {
  const existing = await getTargetById(db, id);
  if (!existing) {
    throw new Error("Target not found");
  }

  if (input.name) {
    await assertUniqueTargetName(db, input.name, id);
  }

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];

  const updatedName = input.name !== undefined ? input.name.trim() : existing.name;
  const updatedEnabled = input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled ? 1 : 0;

  // 读取已有 extraConfig
  const existingRow = await db
    .prepare(`SELECT config_json FROM targets WHERE id = ?`)
    .bind(id)
    .first<{ config_json: string }>();

  let extraConfig: any = {};
  try {
    extraConfig = JSON.parse(existingRow?.config_json || "{}");
  } catch {
    extraConfig = {};
  }

  if (existing.type === "feishu_app") {
    if (input.appId !== undefined) extraConfig.appId = input.appId.trim();
    if (input.recipients !== undefined) extraConfig.recipients = input.recipients;

    const fingerprint = buildTargetContentFingerprint(
      "feishu_app",
      undefined,
      extraConfig.appId,
      extraConfig.recipients
    );
    const contentHash = await computeContentHash(fingerprint);
    await assertUniqueTargetContent(db, contentHash, id);
    extraConfig.content_hash = contentHash;
  } else if (input.webhookUrl) {
    const fingerprint = buildTargetContentFingerprint(existing.type, input.webhookUrl);
    const contentHash = await computeContentHash(fingerprint);
    await assertUniqueTargetContent(db, contentHash, id);
    extraConfig.content_hash = contentHash;
  }

  statements.push(
    db
      .prepare(
        `UPDATE targets
         SET name = ?, enabled = ?, config_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(updatedName, updatedEnabled, JSON.stringify(extraConfig), now, id)
  );

  // 更新或删除 Webhook URL
  if (input.clearWebhookUrl) {
    statements.push(prepareDeleteSecretStatement(db, "target", id, "webhook_url"));
  } else if (input.webhookUrl) {
    const check = validateWebhookUrl(existing.type, input.webhookUrl);
    if (!check.valid) {
      throw new Error(`Invalid Webhook URL: ${check.reason}`);
    }
    const stmt = await prepareSetSecretStatement(
      db,
      masterKey,
      "target",
      id,
      "webhook_url",
      input.webhookUrl.trim()
    );
    statements.push(stmt);
  }

  // 更新或删除 Sign Secret
  if (input.clearSignSecret) {
    statements.push(prepareDeleteSecretStatement(db, "target", id, "sign_secret"));
  } else if (input.signSecret) {
    const stmt = await prepareSetSecretStatement(
      db,
      masterKey,
      "target",
      id,
      "sign_secret",
      input.signSecret.trim()
    );
    statements.push(stmt);
  }

  // 更新或删除 App Secret (Feishu App)
  if (input.clearAppSecret) {
    statements.push(prepareDeleteSecretStatement(db, "target", id, "app_secret"));
  } else if (input.appSecret) {
    const stmt = await prepareSetSecretStatement(
      db,
      masterKey,
      "target",
      id,
      "app_secret",
      input.appSecret.trim()
    );
    statements.push(stmt);
  }

  await db.batch(statements);

  const all = await listTargets(db);
  const target = all.find((t) => t.id === id);
  if (!target) {
    throw new Error("Failed to load updated target");
  }
  return target;
}

/**
 * 删除 Target 并同步清理所有关联 Secret 以及 Routes 中的失效引用
 */
export async function deleteTarget(db: D1Database, id: string): Promise<void> {
  // 1. 查询所有 routes 并剔除已删除的 target ID
  const routesRows = await db
    .prepare(`SELECT id, target_ids_json, enabled FROM routes`)
    .all<{ id: string; target_ids_json: string; enabled: number }>();

  const routeStatements: D1PreparedStatement[] = [];

  for (const row of routesRows.results) {
    let tids: string[] = [];
    try {
      tids = JSON.parse(row.target_ids_json || "[]");
    } catch {
      tids = [];
    }

    if (tids.includes(id)) {
      const remaining = tids.filter((tid) => tid !== id);
      const enabled = remaining.length > 0 ? row.enabled : 0;
      routeStatements.push(
        db
          .prepare(
            `UPDATE routes
             SET target_ids_json = ?, enabled = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(JSON.stringify(remaining), enabled, Date.now(), row.id)
      );
    }
  }

  const statements = [
    db.prepare(`DELETE FROM targets WHERE id = ?`).bind(id),
    prepareDeleteScopeSecretsStatement(db, "target", id),
    ...routeStatements,
  ];

  await db.batch(statements);
}

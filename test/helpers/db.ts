import { env } from "cloudflare:test";

export const INITIAL_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS secrets (
    scope TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    name TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (scope, scope_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS targets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('feishu_webhook', 'feishu_app', 'dingtalk_webhook', 'wecom_webhook')),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_targets_type ON targets(type)`,
  `CREATE TABLE IF NOT EXISTS routes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repository TEXT NOT NULL,
    event_type TEXT NOT NULL,
    conditions_json TEXT NOT NULL DEFAULT '{}',
    target_ids_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    priority INTEGER NOT NULL DEFAULT 100,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_routes_match ON routes(repository, event_type, enabled)`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    repository TEXT NOT NULL,
    event_type TEXT NOT NULL,
    action TEXT,
    branch TEXT,
    actor TEXT,
    status TEXT NOT NULL CHECK (status IN ('processing', 'processed', 'ignored', 'internal_error')),
    matched_route_count INTEGER NOT NULL DEFAULT 0,
    received_at INTEGER NOT NULL,
    completed_at INTEGER,
    duration_ms INTEGER,
    error_code TEXT,
    error_summary TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_repository_received ON events(repository, received_at)`,
  `CREATE INDEX IF NOT EXISTS idx_events_type_received ON events(event_type, received_at)`,
  `CREATE TABLE IF NOT EXISTS deliveries (
    id TEXT PRIMARY KEY,
    event_id TEXT,
    source TEXT NOT NULL DEFAULT 'github' CHECK (source IN ('github', 'test')),
    target_id TEXT,
    target_name TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('feishu', 'dingtalk', 'wecom')),
    channel_type TEXT NOT NULL CHECK (channel_type IN ('feishu_webhook', 'feishu_app', 'dingtalk_webhook', 'wecom_webhook')),
    status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
    http_status INTEGER,
    provider_code TEXT,
    error_code TEXT,
    error_summary TEXT,
    duration_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_deliveries_event ON deliveries(event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deliveries_created ON deliveries(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_deliveries_status_created ON deliveries(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_deliveries_provider_created ON deliveries(provider, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_deliveries_channel_created ON deliveries(channel_type, created_at)`,
];

/**
 * 在测试数据库中执行迁移
 */
export async function applyTestMigrations(): Promise<void> {
  for (const statement of INITIAL_SCHEMA_STATEMENTS) {
    await env.DB.prepare(statement).run();
  }
}

/**
 * 清空所有业务数据表
 */
export async function clearTestDatabase(): Promise<void> {
  const tables = ["deliveries", "events", "routes", "targets", "secrets", "settings"];
  for (const table of tables) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
}

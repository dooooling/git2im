-- ==============================================================================
-- 迁移版本: 0001_initial.sql
-- 描述: git2im 核心数据表初始化（Settings, Secrets, Targets, Routes, Events, Deliveries）
-- 数据库: Cloudflare D1 (SQLite)
-- 约定: 时间戳统一使用 Unix 毫秒数 (epoch milliseconds)
-- ==============================================================================

-- 1. 系统设置表 (Settings)
-- 用于持久化非敏感配置（如：当前 GitHub Secret 轮换状态等）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,                       -- 配置键名（如 'github_webhook_secret_meta'）
  value TEXT NOT NULL,                        -- 配置值（JSON 字符串）
  updated_at INTEGER NOT NULL                 -- 最后更新时间戳（毫秒）
);

-- 2. 敏感凭据加密存储表 (Secrets)
-- 业务 Secret（如 Webhook URL, App Secret 等）经由 AES-256-GCM 加密后存入本表，只写不回显
CREATE TABLE IF NOT EXISTS secrets (
  scope TEXT NOT NULL,                        -- 作用域（如 'target', 'global'）
  scope_id TEXT NOT NULL,                     -- 作用域实体 ID（如 target_id 或 'github'）
  name TEXT NOT NULL,                         -- 凭据标识名称（如 'url', 'sign_secret', 'app_secret'）
  ciphertext TEXT NOT NULL,                   -- AES-256-GCM 密文 (Base64 编码)
  iv TEXT NOT NULL,                           -- 初始化向量 12-byte IV (Base64 编码)
  version INTEGER NOT NULL DEFAULT 1,         -- 密钥版本号
  updated_at INTEGER NOT NULL,                -- 最后更新时间戳（毫秒）

  PRIMARY KEY (scope, scope_id, name)
);

-- 3. 通知目标表 (Targets)
-- 维护各 IM 平台的投递目标（飞书机器人、飞书自建应用、钉钉机器人、企业微信机器人）
CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY,                        -- 目标唯一 ID (UUID v4)
  name TEXT NOT NULL,                         -- 目标名称（如 '研发主群告警'）
  type TEXT NOT NULL                          -- 目标通道类型
    CHECK (
      type IN (
        'feishu_webhook',
        'feishu_app',
        'dingtalk_webhook',
        'wecom_webhook'
      )
    ),
  enabled INTEGER NOT NULL DEFAULT 1          -- 是否启用 (1: 启用, 0: 禁用)
    CHECK (enabled IN (0, 1)),
  config_json TEXT NOT NULL DEFAULT '{}',     -- 非敏感配置（如 receive_id_type, receive_id 等 JSON 串）
  created_at INTEGER NOT NULL,                -- 创建时间戳（毫秒）
  updated_at INTEGER NOT NULL                 -- 最后更新时间戳（毫秒）
);

CREATE INDEX IF NOT EXISTS idx_targets_type
  ON targets(type);

-- 4. 路由规则表 (Routes)
-- 维护 GitHub 仓库与事件到通知目标的映射规则
CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,                        -- 规则唯一 ID (UUID v4)
  name TEXT NOT NULL,                         -- 规则名称（如 'Main 分支 Push 通知'）
  repository TEXT NOT NULL,                   -- 目标仓库（'owner/repo'，通配或精确匹配）
  event_type TEXT NOT NULL,                   -- 监听事件 ('push', 'pull_request', 'workflow_run', 'release')
  conditions_json TEXT NOT NULL DEFAULT '{}', -- 匹配条件 JSON（如分支、PR 动作、Actions 结果等）
  target_ids_json TEXT NOT NULL,              -- 关联的 Target ID 列表 JSON（如 '["id1", "id2"]'）
  enabled INTEGER NOT NULL DEFAULT 1          -- 是否启用 (1: 启用, 0: 禁用)
    CHECK (enabled IN (0, 1)),
  priority INTEGER NOT NULL DEFAULT 100,      -- 优先级权重（数字越小优先级越高）
  created_at INTEGER NOT NULL,                -- 创建时间戳（毫秒）
  updated_at INTEGER NOT NULL                 -- 最后更新时间戳（毫秒）
);

CREATE INDEX IF NOT EXISTS idx_routes_match
  ON routes(repository, event_type, enabled);

-- 5. GitHub 事件记录表 (Events)
-- 记录接收到的 GitHub Webhook 元数据；同时作为 DeliveryId 唯一主键约束实现原子幂等
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,                        -- GitHub Delivery ID (X-GitHub-Delivery Header)
  repository TEXT NOT NULL,                   -- 仓库全名 ('owner/repo')
  event_type TEXT NOT NULL,                   -- 事件类型 ('push', 'pull_request', 等)
  action TEXT,                                -- 事件具体子动作（如 'opened', 'completed'）
  branch TEXT,                                -- 关联分支名
  actor TEXT,                                 -- 操作触发者用户名

  status TEXT NOT NULL                        -- 事件生命周期状态
    CHECK (
      status IN (
        'processing',
        'processed',
        'ignored',
        'internal_error'
      )
    ),

  matched_route_count INTEGER NOT NULL DEFAULT 0, -- 命中路由规则数量

  received_at INTEGER NOT NULL,               -- 接收时间戳（毫秒）
  completed_at INTEGER,                       -- 处理完成时间戳（毫秒）
  duration_ms INTEGER,                        -- 网关总处理耗时（毫秒）

  error_code TEXT,                            -- 处理异常错误码
  error_summary TEXT                          -- 异常信息摘要（已脱敏）
);

CREATE INDEX IF NOT EXISTS idx_events_received_at
  ON events(received_at);

CREATE INDEX IF NOT EXISTS idx_events_repository_received
  ON events(repository, received_at);

CREATE INDEX IF NOT EXISTS idx_events_type_received
  ON events(event_type, received_at);

-- 6. 投递记录表 (Deliveries)
-- 记录每一次针对具体 Target 的通知投递尝试与结果
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,                        -- 投递记录唯一 ID (UUID v4)
  event_id TEXT,                              -- 关联的 GitHub Event ID（测试发送时为 NULL）
  source TEXT NOT NULL DEFAULT 'github'       -- 投递来源 ('github': 真实事件, 'test': 管理端测试发送)
    CHECK (source IN ('github', 'test')),
  target_id TEXT,                             -- 投递目标 ID（支持快照保存，即使 Target 被删除仍可查历史）
  target_name TEXT NOT NULL,                  -- 投递目标名称快照
  provider TEXT NOT NULL                      -- IM 提供商
    CHECK (provider IN ('feishu', 'dingtalk', 'wecom')),
  channel_type TEXT NOT NULL                  -- 通道类型快照
    CHECK (
      channel_type IN (
        'feishu_webhook',
        'feishu_app',
        'dingtalk_webhook',
        'wecom_webhook'
      )
    ),

  status TEXT NOT NULL                        -- 投递状态
    CHECK (status IN ('success', 'failed')),

  http_status INTEGER,                        -- 平台响应 HTTP 状态码
  provider_code TEXT,                         -- 平台返回的业务错误码（如 errcode / code）
  error_code TEXT,                            -- 网关内部归一化错误码
  error_summary TEXT,                         -- 错误简要摘要（严格脱敏，不含 Token/Secret）

  duration_ms INTEGER NOT NULL,               -- 单次投递网络耗时（毫秒）
  created_at INTEGER NOT NULL                 -- 投递创建时间戳（毫秒）
);

CREATE INDEX IF NOT EXISTS idx_deliveries_event
  ON deliveries(event_id);

CREATE INDEX IF NOT EXISTS idx_deliveries_created
  ON deliveries(created_at);

CREATE INDEX IF NOT EXISTS idx_deliveries_status_created
  ON deliveries(status, created_at);

CREATE INDEX IF NOT EXISTS idx_deliveries_provider_created
  ON deliveries(provider, created_at);

CREATE INDEX IF NOT EXISTS idx_deliveries_channel_created
  ON deliveries(channel_type, created_at);

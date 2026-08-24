/**
 * 路由规则配置管理与 D1 持久化模块 (Routes Config CRUD - Name & Content Uniqueness)
 *
 * 核心规范：
 * 1. Route 名称全局唯一性校验。
 * 2. Route 规则内容全局唯一性校验 (Repository + EventType + Conditions + TargetIds)。
 * 3. 校验绑定的 Target IDs 是否存在，单条规则最多绑定 6 个 Target。
 */

import type { Route, RouteConditions } from "../notification/route-matcher";
import type { GithubEventType } from "../github/types";
import { MAX_RESOLVED_TARGETS_PER_EVENT } from "../notification/route-matcher";

export interface CreateRouteInput {
  name: string;
  repository: string;
  eventType: GithubEventType;
  conditions?: RouteConditions;
  targetIds: string[];
  enabled?: boolean;
  priority?: number;
}

export interface UpdateRouteInput {
  name?: string;
  repository?: string;
  eventType?: GithubEventType;
  conditions?: RouteConditions;
  targetIds?: string[];
  enabled?: boolean;
  priority?: number;
}

interface RouteDbRow {
  id: string;
  name: string;
  repository: string;
  event_type: GithubEventType;
  conditions_json: string;
  target_ids_json: string;
  enabled: number;
  priority: number;
  created_at: number;
  updated_at: number;
}

function parseRouteRow(row: RouteDbRow): Route {
  let conditions: RouteConditions = {};
  try {
    conditions = JSON.parse(row.conditions_json || "{}");
  } catch {
    conditions = {};
  }

  let targetIds: string[] = [];
  try {
    targetIds = JSON.parse(row.target_ids_json || "[]");
  } catch {
    targetIds = [];
  }

  return {
    id: row.id,
    name: row.name,
    repository: row.repository,
    eventType: row.event_type,
    conditions,
    targetIds,
    enabled: row.enabled === 1,
    priority: row.priority ?? 100,
  };
}

/**
 * 归一化生成 Route 的内容指纹
 */
function buildRouteFingerprint(
  repository: string,
  eventType: GithubEventType,
  conditions: RouteConditions = {},
  targetIds: string[] = []
): string {
  const normCond: any = {};
  if (conditions.branch) normCond.branch = conditions.branch.trim();
  if (conditions.workflow) normCond.workflow = conditions.workflow.trim();
  if (conditions.action) normCond.action = [...conditions.action].sort();
  if (conditions.conclusion) normCond.conclusion = [...conditions.conclusion].sort();
  if (conditions.merged !== undefined) normCond.merged = conditions.merged;
  if (conditions.prerelease !== undefined) normCond.prerelease = conditions.prerelease;

  const sortedTargets = [...targetIds].sort();

  return `${repository.trim().toLowerCase()}:${eventType}:${JSON.stringify(normCond)}:${sortedTargets.join(",")}`;
}

/**
 * 校验路由规则名称唯一性
 */
async function assertUniqueRouteName(db: D1Database, name: string, excludeId?: string): Promise<void> {
  const existing = await db
    .prepare(`SELECT id, name FROM routes WHERE name = ?`)
    .bind(name.trim())
    .first<{ id: string; name: string }>();

  if (existing && existing.id !== excludeId) {
    throw new Error(`Route with name "${name.trim()}" already exists`);
  }
}

/**
 * 校验路由规则内容唯一性
 */
async function assertUniqueRouteContent(
  db: D1Database,
  repository: string,
  eventType: GithubEventType,
  conditions: RouteConditions = {},
  targetIds: string[] = [],
  excludeId?: string
): Promise<void> {
  const targetFingerprint = buildRouteFingerprint(repository, eventType, conditions, targetIds);

  const rows = await db.prepare(`SELECT * FROM routes`).all<RouteDbRow>();
  for (const row of rows.results) {
    if (row.id === excludeId) continue;
    const r = parseRouteRow(row);
    const fp = buildRouteFingerprint(r.repository, r.eventType, r.conditions, r.targetIds);
    if (fp === targetFingerprint) {
      throw new Error(`Route with identical conditions and targets already exists (Route: "${r.name}")`);
    }
  }
}

/**
 * 获取所有路由规则列表 (按 priority 升序，created_at 升序排列)
 */
export async function listRoutes(db: D1Database): Promise<Route[]> {
  const result = await db
    .prepare(`SELECT * FROM routes ORDER BY priority ASC, created_at ASC`)
    .all<RouteDbRow>();

  return result.results.map(parseRouteRow);
}

/**
 * 根据 ID 获取单条路由规则
 */
export async function getRouteById(db: D1Database, id: string): Promise<Route | null> {
  const row = await db
    .prepare(`SELECT * FROM routes WHERE id = ?`)
    .bind(id)
    .first<RouteDbRow>();

  return row ? parseRouteRow(row) : null;
}

/**
 * 创建新路由规则
 */
export async function createRoute(
  db: D1Database,
  input: CreateRouteInput
): Promise<Route> {
  if (!input.name || !input.repository || !input.eventType) {
    throw new Error("Route requires name, repository, and eventType");
  }

  const name = input.name.trim();
  const repository = input.repository.trim();

  // 1. 唯一性校验
  await assertUniqueRouteName(db, name);

  if (!input.targetIds || input.targetIds.length === 0) {
    throw new Error("Route must have at least one targetId");
  }

  if (input.targetIds.length > MAX_RESOLVED_TARGETS_PER_EVENT) {
    throw new Error(`Route cannot exceed ${MAX_RESOLVED_TARGETS_PER_EVENT} targets`);
  }

  // 2. 校验关联 Target 是否在数据库中存在
  const placeholders = input.targetIds.map(() => "?").join(",");
  const existingTargets = await db
    .prepare(`SELECT id FROM targets WHERE id IN (${placeholders})`)
    .bind(...input.targetIds)
    .all<{ id: string }>();

  if (existingTargets.results.length !== input.targetIds.length) {
    throw new Error("One or more targetIds do not exist");
  }

  // 3. 校验规则内容唯一性
  await assertUniqueRouteContent(db, repository, input.eventType, input.conditions, input.targetIds);

  const id = crypto.randomUUID();
  const now = Date.now();
  const enabled = input.enabled !== false ? 1 : 0;
  const priority = input.priority ?? 100;
  const conditionsJson = JSON.stringify(input.conditions || {});
  const targetIdsJson = JSON.stringify(input.targetIds);

  await db
    .prepare(
      `INSERT INTO routes (id, name, repository, event_type, conditions_json, target_ids_json, enabled, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      name,
      repository,
      input.eventType,
      conditionsJson,
      targetIdsJson,
      enabled,
      priority,
      now,
      now
    )
    .run();

  return {
    id,
    name,
    repository,
    eventType: input.eventType,
    conditions: input.conditions || {},
    targetIds: input.targetIds,
    enabled: enabled === 1,
    priority,
  };
}

/**
 * 更新已有路由规则
 */
export async function updateRoute(
  db: D1Database,
  id: string,
  input: UpdateRouteInput
): Promise<Route> {
  const existing = await getRouteById(db, id);
  if (!existing) {
    throw new Error("Route not found");
  }

  const name = input.name !== undefined ? input.name.trim() : existing.name;
  const repository = input.repository !== undefined ? input.repository.trim() : existing.repository;
  const eventType = input.eventType ?? existing.eventType;
  const conditions = input.conditions ?? existing.conditions;
  const targetIds = input.targetIds ?? existing.targetIds;
  const enabled = input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled ? 1 : 0;
  const priority = input.priority ?? existing.priority;

  if (input.name) {
    await assertUniqueRouteName(db, name, id);
  }

  if (targetIds.length === 0) {
    throw new Error("Route must have at least one targetId");
  }

  if (targetIds.length > MAX_RESOLVED_TARGETS_PER_EVENT) {
    throw new Error(`Route cannot exceed ${MAX_RESOLVED_TARGETS_PER_EVENT} targets`);
  }

  if (input.targetIds) {
    const placeholders = targetIds.map(() => "?").join(",");
    const existingTargets = await db
      .prepare(`SELECT id FROM targets WHERE id IN (${placeholders})`)
      .bind(...targetIds)
      .all<{ id: string }>();

    if (existingTargets.results.length !== targetIds.length) {
      throw new Error("One or more targetIds do not exist");
    }
  }

  await assertUniqueRouteContent(db, repository, eventType, conditions, targetIds, id);

  const now = Date.now();
  await db
    .prepare(
      `UPDATE routes
       SET name = ?, repository = ?, event_type = ?, conditions_json = ?, target_ids_json = ?, enabled = ?, priority = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      name,
      repository,
      eventType,
      JSON.stringify(conditions),
      JSON.stringify(targetIds),
      enabled,
      priority,
      now,
      id
    )
    .run();

  return {
    id,
    name,
    repository,
    eventType,
    conditions,
    targetIds,
    enabled: enabled === 1,
    priority,
  };
}

/**
 * 删除路由规则
 */
export async function deleteRoute(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM routes WHERE id = ?`).bind(id).run();
}

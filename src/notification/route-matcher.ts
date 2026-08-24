/**
 * 路由规则匹配与目标去重解析器 (Route Matcher)
 *
 * 核心规范：
 * 1. 严格支持 Repository、EventType 与针对具体事件类型的 Conditions 进行匹配。
 * 2. 多条规则命中时，汇总所有关联的 Target 并进行唯一去重。
 * 3. 最终解析出的唯一 Target 数量不得超过 6 个 (MAX_RESOLVED_TARGETS_PER_EVENT = 6)，
 *    超限时触发 fanoutExceeded 告警，防止同步响应超时。
 */

import type { NormalizedGithubEvent, GithubEventType } from "../github/types";

export const MAX_RESOLVED_TARGETS_PER_EVENT = 6;

export interface RouteConditions {
  /** 分支过滤规则（支持精确或逗号分隔或通配如 "main", "release/*", "main,master"） */
  branch?: string;
  /** PR 或 Release 的 Action 列表（如 ["opened", "merged"]） */
  action?: string[];
  /** Actions 运行结果结论（如 ["failure", "cancelled", "timed_out"]） */
  conclusion?: string[];
  /** Actions Workflow 名称（精确或包含匹配） */
  workflow?: string;
  /** PR 是否已合并 */
  merged?: boolean;
  /** Release 是否为预发布 */
  prerelease?: boolean;
}

export interface Route {
  id: string;
  name: string;
  repository: string;
  eventType: GithubEventType;
  conditions: RouteConditions;
  targetIds: string[];
  enabled: boolean;
  priority: number;
}

/**
 * 检查分支名是否匹配给定的规则模式 (支持通配符 * 与逗号分隔)
 */
function matchBranchPattern(pattern: string, branchName: string): boolean {
  if (!pattern || !branchName) return false;

  const patterns = pattern.split(",").map((p) => p.trim());
  for (const pat of patterns) {
    if (pat === "*" || pat === branchName) {
      return true;
    }
    if (pat.endsWith("/*")) {
      const prefix = pat.slice(0, -2);
      if (branchName.startsWith(prefix + "/")) {
        return true;
      }
    }
    if (pat.includes("*")) {
      // 简易通配符转正则
      const regexStr = "^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
      const regex = new RegExp(regexStr);
      if (regex.test(branchName)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 校验单条 Route 规则是否与当前 GitHub 事件匹配
 *
 * @param event 标准化后的 GitHub 事件
 * @param route 待测试的路由规则
 * @returns 是否完全匹配
 */
export function matchRoute(event: NormalizedGithubEvent, route: Route): boolean {
  // 1. 检查启用状态
  if (!route.enabled) {
    return false;
  }

  // 2. 检查事件类型
  if (route.eventType !== event.type) {
    return false;
  }

  // 3. 检查仓库全名 (支持 "*" 通配或大小写不敏感匹配)
  if (route.repository !== "*" && route.repository.toLowerCase() !== event.repository.toLowerCase()) {
    return false;
  }

  const conditions = route.conditions || {};

  // 4. 分支匹配 (适用于 push, pull_request, workflow_run)
  if (conditions.branch) {
    const eventBranch = event.branch || "";
    if (!matchBranchPattern(conditions.branch, eventBranch)) {
      return false;
    }
  }

  // 5. Action 匹配 (适用于 PR, Release)
  if (conditions.action && conditions.action.length > 0) {
    const eventAction = event.action || "";
    if (!conditions.action.includes(eventAction)) {
      return false;
    }
  }

  // 6. Workflow Conclusion 匹配 (适用于 workflow_run)
  if (conditions.conclusion && conditions.conclusion.length > 0) {
    const eventConclusion = (event.metadata.conclusion as string) || "";
    if (!conditions.conclusion.map((c) => c.toLowerCase()).includes(eventConclusion.toLowerCase())) {
      return false;
    }
  }

  // 7. Workflow 名称匹配 (适用于 workflow_run)
  if (conditions.workflow) {
    const eventWorkflowName = (event.metadata.workflowName as string) || "";
    if (
      conditions.workflow.toLowerCase() !== eventWorkflowName.toLowerCase() &&
      !eventWorkflowName.toLowerCase().includes(conditions.workflow.toLowerCase())
    ) {
      return false;
    }
  }

  // 8. PR Merged 状态匹配
  if (conditions.merged !== undefined) {
    const isMerged = !!event.metadata.merged;
    if (conditions.merged !== isMerged) {
      return false;
    }
  }

  // 9. Release Prerelease 状态匹配
  if (conditions.prerelease !== undefined) {
    const isPrerelease = !!event.metadata.prerelease;
    if (conditions.prerelease !== isPrerelease) {
      return false;
    }
  }

  return true;
}

/**
 * 在全部可用路由中解析命中规则，并聚合去重最终的 Target ID 列表
 *
 * @param event 标准化 GitHub 事件
 * @param allRoutes 系统中已配置的所有路由列表
 * @returns 命中的路由规则列表、合并去重后的 Target ID 列表及是否超出 6 个目标限制
 */
export function resolveRoutes(
  event: NormalizedGithubEvent,
  allRoutes: Route[]
): {
  matchedRoutes: Route[];
  targetIds: string[];
  fanoutExceeded: boolean;
} {
  // 1. 过滤命中规则，并按 priority 升序排序 (权重越小越优先)
  const matchedRoutes = allRoutes
    .filter((route) => matchRoute(event, route))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  // 2. 汇聚 Target ID 并严格去重（保持出现次序）
  const targetIdSet = new Set<string>();
  for (const route of matchedRoutes) {
    if (Array.isArray(route.targetIds)) {
      for (const targetId of route.targetIds) {
        if (targetId) {
          targetIdSet.add(targetId);
        }
      }
    }
  }

  const targetIds = Array.from(targetIdSet);
  const fanoutExceeded = targetIds.length > MAX_RESOLVED_TARGETS_PER_EVENT;

  return {
    matchedRoutes,
    targetIds,
    fanoutExceeded,
  };
}

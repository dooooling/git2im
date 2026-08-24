/**
 * GitHub Webhook 事件分发与标准化主解析器 (Event Parser)
 *
 * 规范：
 * 1. 支持标准解析 'push', 'pull_request', 'workflow_run', 'release', 'ping'。
 * 2. 遇到不支持的非目标事件类型时，安全返回 null，不抛出异常。
 */

import type { NormalizedGithubEvent } from "./types";
import { parsePushEvent, type PushEventPayload } from "./events/push";
import { parsePullRequestEvent, type PullRequestEventPayload } from "./events/pull-request";
import { parseWorkflowRunEvent, type WorkflowRunEventPayload } from "./events/workflow-run";
import { parseReleaseEvent, type ReleaseEventPayload } from "./events/release";
import { parsePingEvent, type PingEventPayload } from "./events/ping";

/**
 * 解析并标准化 GitHub Webhook Payload
 *
 * @param deliveryId GitHub Delivery ID
 * @param eventType X-GitHub-Event 请求头事件名称
 * @param payload JSON 解析后的 Webhook Payload
 * @returns 标准化的 NormalizedGithubEvent 对象，不支持的事件返回 null
 */
export function parseGithubEvent(
  deliveryId: string,
  eventType: string,
  payload: any
): NormalizedGithubEvent | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const normalizedType = eventType.toLowerCase().trim();

  switch (normalizedType) {
    case "push":
      return parsePushEvent(deliveryId, payload as PushEventPayload);

    case "pull_request":
      return parsePullRequestEvent(deliveryId, payload as PullRequestEventPayload);

    case "workflow_run":
      return parseWorkflowRunEvent(deliveryId, payload as WorkflowRunEventPayload);

    case "release":
      return parseReleaseEvent(deliveryId, payload as ReleaseEventPayload);

    case "ping":
      return parsePingEvent(deliveryId, payload as PingEventPayload);

    default:
      // 未知或暂不支持的事件类型
      return null;
  }
}

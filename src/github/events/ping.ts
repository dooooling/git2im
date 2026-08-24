/**
 * Ping 事件标准化解析模块
 */

import type { NormalizedGithubEvent } from "../types";

export interface PingEventPayload {
  zen?: string;
  hook_id?: number;
  repository?: {
    full_name: string;
    html_url: string;
  };
  sender?: {
    login: string;
  };
}

export function parsePingEvent(
  deliveryId: string,
  payload: PingEventPayload
): NormalizedGithubEvent {
  const repository = payload.repository?.full_name || "github";
  const repositoryUrl = payload.repository?.html_url || "https://github.com";
  const actor = payload.sender?.login || "github";
  const zen = payload.zen || "Keep it logically awesome.";

  return {
    deliveryId,
    type: "ping",
    repository,
    repositoryUrl,
    actor,
    action: "ping",
    title: "GitHub Webhook Ping",
    summary: zen,
    url: repositoryUrl,
    severity: "info",
    shouldNotify: false, // Ping 事件不向下游 IM 路由发送消息
    metadata: {
      zen,
      hookId: payload.hook_id ?? null,
    },
  };
}

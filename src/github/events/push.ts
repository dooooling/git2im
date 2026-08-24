/**
 * Push 事件标准化解析模块
 */

import type { NormalizedGithubEvent } from "../types";

export interface PushCommit {
  id: string;
  message: string;
  url: string;
  author: {
    name: string;
    username?: string;
  };
}

export interface PushEventPayload {
  ref: string;
  before: string;
  after: string;
  created: boolean;
  deleted: boolean;
  forced: boolean;
  compare: string;
  commits?: PushCommit[];
  head_commit?: PushCommit | null;
  repository: {
    full_name: string;
    html_url: string;
    name: string;
  };
  sender?: {
    login: string;
  };
  pusher?: {
    name: string;
  };
}

export function parsePushEvent(
  deliveryId: string,
  payload: PushEventPayload
): NormalizedGithubEvent {
  const repository = payload.repository.full_name;
  const repositoryUrl = payload.repository.html_url;
  const actor = payload.sender?.login || payload.pusher?.name || "unknown";

  // 提取分支名 (去除 refs/heads/ 或 refs/tags/)
  const rawRef = payload.ref || "";
  let branch = rawRef;
  if (rawRef.startsWith("refs/heads/")) {
    branch = rawRef.substring("refs/heads/".length);
  } else if (rawRef.startsWith("refs/tags/")) {
    branch = rawRef.substring("refs/tags/".length);
  }

  const isDeleted = !!payload.deleted;
  const isForced = !!payload.forced;
  const isCreated = !!payload.created;

  let action = "pushed";
  if (isDeleted) action = "deleted";
  else if (isCreated) action = "created";
  else if (isForced) action = "force-pushed";

  const commitCount = payload.commits?.length || 0;
  const headCommitMessage = payload.head_commit?.message || "";
  const firstLineMessage = headCommitMessage.split("\n")[0] || "";

  // 提取最多 3 条最近 commit 摘要供渲染使用（SHA 取前 7 位）
  const topCommits = (payload.commits || [])
    .slice(-3)
    .reverse()
    .map((c) => ({
      sha: c.id.substring(0, 7),
      message: (c.message || "").split("\n")[0] || "",
    }));

  let title = `Push to ${branch}`;
  if (isDeleted) {
    title = `Deleted branch ${branch}`;
  } else if (isCreated) {
    title = `Created branch ${branch}`;
  } else if (isForced) {
    title = `Force-pushed to ${branch}`;
  }

  return {
    deliveryId,
    type: "push",
    repository,
    repositoryUrl,
    actor,
    action,
    branch,
    title,
    summary: firstLineMessage,
    url: payload.compare || payload.head_commit?.url || repositoryUrl,
    severity: isDeleted || isForced ? "warning" : "info",
    shouldNotify: true,
    metadata: {
      commitCount,
      headSha: payload.after ? payload.after.substring(0, 7) : null,
      commitsSummary: JSON.stringify(topCommits),
      forced: isForced,
      deleted: isDeleted,
    },
  };
}

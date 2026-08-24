/**
 * Pull Request 事件标准化解析模块
 */

import type { NormalizedGithubEvent, Severity } from "../types";

export interface PullRequestEventPayload {
  action: string;
  number: number;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: "open" | "closed";
    draft?: boolean;
    merged?: boolean;
    merged_at?: string | null;
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
      sha: string;
    };
    user: {
      login: string;
    };
  };
  repository: {
    full_name: string;
    html_url: string;
  };
  sender: {
    login: string;
  };
}

export function parsePullRequestEvent(
  deliveryId: string,
  payload: PullRequestEventPayload
): NormalizedGithubEvent {
  const pr = payload.pull_request;
  const repository = payload.repository.full_name;
  const repositoryUrl = payload.repository.html_url;
  const actor = payload.sender?.login || pr.user.login || "unknown";

  const isMerged = !!pr.merged;
  let action = payload.action;

  // 若为 closed 且 merged 为 true，归一化动作定义为 'merged'
  if (action === "closed" && isMerged) {
    action = "merged";
  }

  let severity: Severity = "info";
  if (action === "merged") {
    severity = "success";
  } else if (action === "closed" && !isMerged) {
    severity = "warning";
  }

  const baseBranch = pr.base.ref;
  const headBranch = pr.head.ref;
  const title = `PR #${pr.number} ${action}: ${pr.title}`;

  return {
    deliveryId,
    type: "pull_request",
    repository,
    repositoryUrl,
    actor,
    action,
    branch: baseBranch, // PR 主要关注合并的目标基准分支
    title,
    summary: pr.title,
    url: pr.html_url,
    severity,
    shouldNotify: true,
    metadata: {
      prNumber: pr.number,
      prTitle: pr.title,
      baseBranch,
      headBranch,
      merged: isMerged,
      draft: !!pr.draft,
    },
  };
}

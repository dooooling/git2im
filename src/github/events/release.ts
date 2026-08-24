/**
 * Release 事件标准化解析模块
 */

import type { NormalizedGithubEvent } from "../types";

export interface ReleaseEventPayload {
  action: string;
  release: {
    tag_name: string;
    target_commitish: string;
    name: string | null;
    draft: boolean;
    prerelease: boolean;
    html_url: string;
    body: string | null;
    author: {
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

export function parseReleaseEvent(
  deliveryId: string,
  payload: ReleaseEventPayload
): NormalizedGithubEvent {
  const rel = payload.release;
  const repository = payload.repository.full_name;
  const repositoryUrl = payload.repository.html_url;
  const actor = payload.sender?.login || rel.author.login || "unknown";

  const tagName = rel.tag_name;
  const releaseName = rel.name || tagName;
  const isPrerelease = !!rel.prerelease;
  const isDraft = !!rel.draft;

  const title = `Release ${tagName}: ${releaseName}`;
  const firstLineBody = (rel.body || "").split("\n")[0] || "";

  return {
    deliveryId,
    type: "release",
    repository,
    repositoryUrl,
    actor,
    action: payload.action,
    branch: rel.target_commitish,
    title,
    summary: firstLineBody || `Release ${tagName} ${payload.action}`,
    url: rel.html_url,
    severity: isPrerelease ? "warning" : "success",
    shouldNotify: true,
    metadata: {
      tagName,
      releaseName,
      prerelease: isPrerelease,
      draft: isDraft,
    },
  };
}

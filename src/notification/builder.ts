/**
 * 标准化事件到通用 Notification 构建模块 (NotificationBuilder)
 *
 * 核心职责：
 * 将 NormalizedGithubEvent 转换为语义明确、视觉整洁的 Notification 通用结构。
 */

import type { NormalizedGithubEvent } from "../github/types";
import type { Notification, NotificationField } from "./types";

/**
 * 将标准化 GitHub 事件构建为通用通知消息模型
 *
 * @param event 标准化 GitHub 事件
 * @returns 平台无关的 Notification 对象
 */
export function buildNotification(event: NormalizedGithubEvent): Notification {
  const fields: NotificationField[] = [];
  let description: string | undefined;
  let actionText = "View on GitHub";

  switch (event.type) {
    case "push": {
      const commitCount = (event.metadata.commitCount as number) || 1;
      fields.push({ label: "Repository", value: event.repository });
      fields.push({ label: "Branch", value: event.branch || "unknown" });
      fields.push({ label: "Actor", value: event.actor });
      fields.push({ label: "Commits", value: `${commitCount} commit(s)` });

      // 若有解析好的 commit 摘要，格式化为项目列表展示
      if (event.metadata.commitsSummary) {
        try {
          const commits = JSON.parse(event.metadata.commitsSummary as string) as Array<{
            sha: string;
            message: string;
          }>;
          if (commits.length > 0) {
            description = commits
              .map((c) => `• \`${c.sha}\` ${c.message}`)
              .join("\n");
          }
        } catch {
          description = event.summary;
        }
      } else {
        description = event.summary;
      }

      actionText = "View Changes";
      break;
    }

    case "pull_request": {
      const baseBranch = (event.metadata.baseBranch as string) || "main";
      const headBranch = (event.metadata.headBranch as string) || "unknown";
      const statusLabel = (event.action || "updated").toUpperCase();

      fields.push({ label: "Repository", value: event.repository });
      fields.push({ label: "Branch", value: `${headBranch} → ${baseBranch}` });
      fields.push({ label: "Actor", value: event.actor });
      fields.push({ label: "Status", value: statusLabel });

      description = event.summary;
      actionText = "View Pull Request";
      break;
    }

    case "workflow_run": {
      const workflowName = (event.metadata.workflowName as string) || "Workflow";
      const runNumber = (event.metadata.runNumber as number) || 1;
      const conclusion = (event.metadata.conclusion as string) || "completed";

      fields.push({ label: "Repository", value: event.repository });
      fields.push({ label: "Branch", value: event.branch || "main" });
      fields.push({ label: "Workflow", value: `${workflowName} #${runNumber}` });
      fields.push({ label: "Conclusion", value: conclusion.toUpperCase() });
      fields.push({ label: "Actor", value: event.actor });

      description = event.summary;
      actionText = "View Actions Run";
      break;
    }

    case "release": {
      const tagName = (event.metadata.tagName as string) || "v1.0.0";
      const isPrerelease = !!event.metadata.prerelease;

      fields.push({ label: "Repository", value: event.repository });
      fields.push({ label: "Tag", value: tagName });
      fields.push({ label: "Type", value: isPrerelease ? "Pre-release" : "Official Release" });
      fields.push({ label: "Actor", value: event.actor });

      description = event.summary;
      actionText = "View Release";
      break;
    }

    case "ping":
    default: {
      fields.push({ label: "Repository", value: event.repository });
      fields.push({ label: "Actor", value: event.actor });
      description = event.summary;
      break;
    }
  }

  const labelMap: Record<string, string> = {
    push: "Push",
    pull_request: "Pull Request",
    workflow_run: "Workflow Run",
    release: "Release",
    ping: "Ping",
  };

  return {
    title: event.title,
    level: event.severity,
    repository: event.repository,
    eventLabel: labelMap[event.type] ?? "GitHub Event",
    fields,
    description,
    action: event.url ? { text: actionText, url: event.url } : undefined,
  };
}

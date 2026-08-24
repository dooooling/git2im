/**
 * 钉钉机器人 Markdown 消息渲染器 (DingTalk Markdown Renderer)
 */

import type { Notification } from "../../notification/types";
import type { Severity } from "../../github/types";

function severityToDingTalkIcon(severity: Severity): string {
  switch (severity) {
    case "success":
      return "🟢";
    case "error":
      return "🔴";
    case "warning":
      return "🟡";
    case "info":
    default:
      return "ℹ️";
  }
}

/**
 * 渲染钉钉机器人 Markdown 消息载荷
 */
export function renderDingTalkMarkdown(notification: Notification): {
  msgtype: "markdown";
  markdown: {
    title: string;
    text: string;
  };
} {
  const icon = severityToDingTalkIcon(notification.level);
  const lines: string[] = [];

  // 1. 标题行
  lines.push(`### ${icon} ${notification.title}\n`);

  // 2. 字段列表
  for (const field of notification.fields) {
    lines.push(`- **${field.label}:** ${field.value}`);
  }

  // 3. 描述内容
  if (notification.description) {
    lines.push(`\n${notification.description}`);
  }

  // 4. 底部链接
  if (notification.action) {
    lines.push(`\n[${notification.action.text}](${notification.action.url})`);
  }

  return {
    msgtype: "markdown",
    markdown: {
      title: notification.title,
      text: lines.join("\n"),
    },
  };
}

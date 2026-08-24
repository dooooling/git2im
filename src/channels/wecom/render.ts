/**
 * 企业微信机器人 Markdown 消息渲染器 (WeCom Markdown Renderer)
 *
 * 核心规范：
 * 1. 企业微信机器人 Markdown 语法支持标题、加粗、链接、行内代码与颜色标签 (<font color="info|comment|warning">)。
 * 2. 严格做 UTF-8 字节截断（内部保守上限 3 KiB = 3072 字节），防止突破官方 4096 字节限制。
 */

import type { Notification } from "../../notification/types";
import type { Severity } from "../../github/types";
import { truncateByBytes } from "../../notification/truncate";

const WECOM_MAX_PAYLOAD_BYTES = 3072; // 3 KiB 保守上限

function severityToWeComColor(severity: Severity): string {
  switch (severity) {
    case "error":
      return "comment"; // 企业微信支持的灰色/告警色
    case "warning":
      return "warning"; // 橙色
    case "success":
    case "info":
    default:
      return "info"; // 绿色
  }
}

/**
 * 渲染企业微信群机器人 Markdown 载荷
 */
export function renderWeComMarkdown(notification: Notification): {
  msgtype: "markdown";
  markdown: {
    content: string;
  };
} {
  const color = severityToWeComColor(notification.level);
  const lines: string[] = [];

  // 1. 标题
  lines.push(`### <font color="${color}">${notification.title}</font>\n`);

  // 2. 结构化字段 (使用引用块 > 提升排版质感)
  for (const field of notification.fields) {
    lines.push(`> **${field.label}:** ${field.value}`);
  }

  // 3. 描述内容
  if (notification.description) {
    lines.push(`\n${notification.description}`);
  }

  // 4. 底部主操作链接
  if (notification.action) {
    lines.push(`\n[${notification.action.text}](${notification.action.url})`);
  }

  const rawContent = lines.join("\n");
  const safeContent = truncateByBytes(rawContent, WECOM_MAX_PAYLOAD_BYTES);

  return {
    msgtype: "markdown",
    markdown: {
      content: safeContent,
    },
  };
}

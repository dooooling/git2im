/**
 * 飞书卡片消息渲染器 (Feishu Interactive Card Renderer)
 */

import type { Notification } from "../../notification/types";
import type { Severity } from "../../github/types";

function severityToFeishuHeaderColor(severity: Severity): string {
  switch (severity) {
    case "success":
      return "green";
    case "error":
      return "red";
    case "warning":
      return "orange";
    case "info":
    default:
      return "blue";
  }
}

/**
 * 渲染飞书交互式卡片 JSON 对象
 */
export function renderFeishuCard(notification: Notification): Record<string, any> {
  const elements: any[] = [];

  // 1. 结构化 Fields 块
  if (notification.fields.length > 0) {
    const fieldsList = notification.fields.map((f) => ({
      is_short: true,
      text: {
        tag: "lark_md",
        content: `**${f.label}:**\n${f.value}`,
      },
    }));

    elements.push({
      tag: "div",
      fields: fieldsList,
    });
  }

  // 2. 描述与内容块
  if (notification.description) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: notification.description,
      },
    });
  }

  // 3. 底部主操作跳转按钮
  if (notification.action) {
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          text: {
            tag: "plain_text",
            content: notification.action.text,
          },
          type: "primary",
          url: notification.action.url,
        },
      ],
    });
  }

  return {
    header: {
      title: {
        tag: "plain_text",
        content: notification.title,
      },
      template: severityToFeishuHeaderColor(notification.level),
    },
    elements,
  };
}

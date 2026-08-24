/**
 * 通知通道注册表 (Notification Channel Registry)
 *
 * 维护系统支持的 4 大 Channel 适配器映射，统一入口分发。
 */

import type { ChannelType, NotificationChannel, Target } from "./types";
import { feishuWebhookChannel } from "./feishu/webhook";
import { feishuAppChannel } from "./feishu/app";
import { dingTalkWebhookChannel } from "./dingtalk/webhook";
import { weComWebhookChannel } from "./wecom/webhook";

const channelMap = new Map<ChannelType, NotificationChannel<any>>([
  ["feishu_webhook", feishuWebhookChannel],
  ["feishu_app", feishuAppChannel],
  ["dingtalk_webhook", dingTalkWebhookChannel],
  ["wecom_webhook", weComWebhookChannel],
]);

/**
 * 根据通道类型获取对应的通道适配器实例
 */
export function getNotificationChannel<T extends Target>(
  type: T["type"]
): NotificationChannel<T> | undefined {
  return channelMap.get(type);
}

/**
 * 通知通道与平台适配器领域类型定义
 */

import type { Env } from "../env";
import type { Notification } from "../notification/types";

export type ChannelType =
  | "feishu_webhook"
  | "feishu_app"
  | "dingtalk_webhook"
  | "wecom_webhook";

export type Provider = "feishu" | "dingtalk" | "wecom";

export interface TargetBase {
  id: string;
  name: string;
  enabled: boolean;
}

export interface FeishuWebhookTarget extends TargetBase {
  type: "feishu_webhook";
}

/**
 * 飞书企业自建应用接收人配置项
 */
export interface FeishuAppRecipient {
  receiveIdType: "chat_id" | "open_id";
  receiveId: string;
}

/**
 * 飞书企业自建应用 Target (N:N 独立 App 凭据，支持同一目标配置多个接收人/群聊)
 */
export interface FeishuAppTarget extends TargetBase {
  type: "feishu_app";
  appId: string;
  recipients: FeishuAppRecipient[];
}

export interface DingTalkWebhookTarget extends TargetBase {
  type: "dingtalk_webhook";
}

export interface WeComWebhookTarget extends TargetBase {
  type: "wecom_webhook";
}

export type Target =
  | FeishuWebhookTarget
  | FeishuAppTarget
  | DingTalkWebhookTarget
  | WeComWebhookTarget;

export interface DeliveryResult {
  targetId: string;
  provider: Provider;
  channelType: ChannelType;
  success: boolean;
  httpStatus?: number;
  providerCode?: string;
  errorCode?: string;
  errorSummary?: string;
  durationMs: number;
}

/**
 * 通用通知通道适配器接口
 */
export interface NotificationChannel<T extends Target = Target> {
  readonly type: T["type"];

  /**
   * 投递业务通知
   */
  send(env: Env, target: T, notification: Notification): Promise<DeliveryResult>;

  /**
   * 连通性测试发送
   */
  test(env: Env, target: T): Promise<DeliveryResult>;
}

/**
 * 根据 ChannelType 获取归属的 Provider
 */
export function channelTypeToProvider(type: ChannelType): Provider {
  switch (type) {
    case "feishu_webhook":
    case "feishu_app":
      return "feishu";
    case "dingtalk_webhook":
      return "dingtalk";
    case "wecom_webhook":
      return "wecom";
  }
}

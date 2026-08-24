/**
 * 飞书企业自建应用通道适配器 (Feishu App Channel - N:N Multi-App & Multi-Recipient)
 *
 * 核心规范：
 * 1. 每个 Target 独立配置自身的 App ID 与 App Secret (N:N 模式)。
 * 2. 单个 Target 支持配置多个接收人/群聊 (recipients: [{ receiveIdType, receiveId }])，自动广播。
 * 3. 消息 Body 中 content 字段必须为卡片 JSON 序列化后的字符串。
 */

import type { Env } from "../../env";
import type { FeishuAppTarget, NotificationChannel, DeliveryResult } from "../types";
import type { Notification } from "../../notification/types";
import { getSecret } from "../../security/secret-store";
import { renderFeishuCard } from "./render";
import { getFeishuTenantAccessToken } from "./app-token";
import { sanitizeErrorSummary } from "../../security/redact";

export const feishuAppChannel: NotificationChannel<FeishuAppTarget> = {
  type: "feishu_app",

  async send(
    env: Env,
    target: FeishuAppTarget,
    notification: Notification
  ): Promise<DeliveryResult> {
    const startTime = Date.now();

    try {
      // 1. 校验 Target 自身的 App ID
      if (!target.appId) {
        return {
          targetId: target.id,
          provider: "feishu",
          channelType: "feishu_app",
          success: false,
          errorCode: "FEISHU_APP_CONFIG_ERROR",
          errorSummary: "Feishu App ID is missing in target configuration",
          durationMs: Date.now() - startTime,
        };
      }

      // 2. 读取 Target 专属加密保存的 App Secret
      const appSecret = await getSecret(
        env.DB,
        env.MASTER_KEY,
        "target",
        target.id,
        "app_secret"
      );

      if (!appSecret) {
        return {
          targetId: target.id,
          provider: "feishu",
          channelType: "feishu_app",
          success: false,
          errorCode: "FEISHU_APP_NOT_CONFIGURED",
          errorSummary: "Feishu App Secret is not configured for this target",
          durationMs: Date.now() - startTime,
        };
      }

      // 3. 校验接收人列表
      const recipients = target.recipients || [];
      if (recipients.length === 0) {
        return {
          targetId: target.id,
          provider: "feishu",
          channelType: "feishu_app",
          success: false,
          errorCode: "FEISHU_APP_NO_RECIPIENTS",
          errorSummary: "No recipients configured for this Feishu App target",
          durationMs: Date.now() - startTime,
        };
      }

      // 4. 获取当前 App 专属的租户 Access Token (自动走内存隔离缓存)
      let token: string;
      try {
        const tokenRes = await getFeishuTenantAccessToken(target.appId, appSecret);
        token = tokenRes.token;
      } catch (tokenErr: any) {
        return {
          targetId: target.id,
          provider: "feishu",
          channelType: "feishu_app",
          success: false,
          errorCode: "FEISHU_APP_TOKEN_ERROR",
          errorSummary: sanitizeErrorSummary(tokenErr),
          durationMs: Date.now() - startTime,
        };
      }

      // 5. 构建发送内容（Feishu App 要求 content 为 JSON 字符串）
      const cardObj = renderFeishuCard(notification);
      const contentStr = JSON.stringify(cardObj);

      // 6. 并发投递给所有配置的接收人
      const sendPromises = recipients.map(async (recipient) => {
        const sendUrl = `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${recipient.receiveIdType}`;
        const payload = {
          receive_id: recipient.receiveId,
          msg_type: "interactive",
          content: contentStr,
        };

        const res = await fetch(sendUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          redirect: "error",
          signal: AbortSignal.timeout(3000),
        });

        const json = (await res.json().catch(() => ({}))) as any;
        return {
          ok: res.ok && json.code === 0,
          status: res.status,
          code: json.code,
          msg: json.msg || json.message,
          recipient: recipient.receiveId,
        };
      });

      const results = await Promise.all(sendPromises);
      const allSuccess = results.every((r) => r.ok);
      const durationMs = Date.now() - startTime;

      if (!allSuccess) {
        const failedOne = results.find((r) => !r.ok);
        const errorMsg = failedOne
          ? `Failed delivering to ${failedOne.recipient}: ${failedOne.msg || `code ${failedOne.code}`}`
          : "Feishu App API Error";

        return {
          targetId: target.id,
          provider: "feishu",
          channelType: "feishu_app",
          success: false,
          httpStatus: failedOne?.status || 400,
          providerCode: failedOne?.code !== undefined ? String(failedOne.code) : undefined,
          errorCode: "FEISHU_APP_API_ERROR",
          errorSummary: sanitizeErrorSummary(errorMsg),
          durationMs,
        };
      }

      return {
        targetId: target.id,
        provider: "feishu",
        channelType: "feishu_app",
        success: true,
        durationMs,
      };
    } catch (err: any) {
      const isTimeout = err.name === "TimeoutError" || err.message?.includes("timeout");
      return {
        targetId: target.id,
        provider: "feishu",
        channelType: "feishu_app",
        success: false,
        errorCode: isTimeout ? "FEISHU_APP_TIMEOUT" : "FEISHU_APP_HTTP_ERROR",
        errorSummary: sanitizeErrorSummary(err),
        durationMs: Date.now() - startTime,
      };
    }
  },

  async test(env: Env, target: FeishuAppTarget): Promise<DeliveryResult> {
    const recipientSummary = (target.recipients || [])
      .map((r) => `${r.receiveIdType}:${r.receiveId}`)
      .join(", ");

    const testNotification: Notification = {
      title: "✅ git2im 连通性测试",
      level: "success",
      repository: "git2im",
      eventLabel: "Test",
      fields: [
        { label: "Target", value: target.name },
        { label: "App ID", value: target.appId },
        { label: "Recipients", value: recipientSummary || "None" },
        { label: "Time", value: new Date().toISOString() },
      ],
      description: "恭喜！飞书企业自建应用通知已成功投递到该目标配置的所有接收人/群聊。",
    };

    return this.send(env, target, testNotification);
  },
};

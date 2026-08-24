/**
 * 飞书自定义机器人 Webhook 通道适配器 (Feishu Webhook Channel)
 */

import type { Env } from "../../env";
import type { FeishuWebhookTarget, NotificationChannel, DeliveryResult } from "../types";
import type { Notification } from "../../notification/types";
import { getSecret } from "../../security/secret-store";
import { validateWebhookUrl } from "../url-guard";
import { renderFeishuCard } from "./render";
import { calculateFeishuWebhookSign } from "./webhook-signature";
import { sanitizeErrorSummary } from "../../security/redact";

export const feishuWebhookChannel: NotificationChannel<FeishuWebhookTarget> = {
  type: "feishu_webhook",

  async send(
    env: Env,
    target: FeishuWebhookTarget,
    notification: Notification
  ): Promise<DeliveryResult> {
    const startTime = Date.now();

    try {
      // 1. 读取 Webhook URL 与 Sign Secret
      const webhookUrl = await getSecret(
        env.DB,
        env.MASTER_KEY,
        "target",
        target.id,
        "webhook_url"
      );

      if (!webhookUrl) {
        return {
          targetId: target.id,
          provider: "feishu",
          channelType: "feishu_webhook",
          success: false,
          errorCode: "FEISHU_WEBHOOK_CONFIG_ERROR",
          errorSummary: "Webhook URL is not configured",
          durationMs: Date.now() - startTime,
        };
      }

      // 2. 权威白名单与安全校验 (防 SSRF)
      const urlCheck = validateWebhookUrl("feishu_webhook", webhookUrl);
      if (!urlCheck.valid) {
        return {
          targetId: target.id,
          provider: "feishu",
          channelType: "feishu_webhook",
          success: false,
          errorCode: "FEISHU_WEBHOOK_CONFIG_ERROR",
          errorSummary: `Invalid Webhook URL: ${urlCheck.reason}`,
          durationMs: Date.now() - startTime,
        };
      }

      // 3. 构建发送载荷
      const card = renderFeishuCard(notification);
      const payload: Record<string, any> = {
        msg_type: "interactive",
        card,
      };

      // 4. 检查是否配置了加签密钥
      const signSecret = await getSecret(
        env.DB,
        env.MASTER_KEY,
        "target",
        target.id,
        "sign_secret"
      );

      if (signSecret) {
        const timestamp = Math.floor(Date.now() / 1000);
        const sign = await calculateFeishuWebhookSign(signSecret, timestamp);
        payload.timestamp = String(timestamp);
        payload.sign = sign;
      }

      // 5. 发起网络请求 (超时 3 秒，禁止跟随重定向)
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(payload),
        redirect: "error",
        signal: AbortSignal.timeout(3000),
      });

      const durationMs = Date.now() - startTime;
      const httpStatus = response.status;

      let json: any = {};
      try {
        json = await response.json();
      } catch {
        json = {};
      }

      // 飞书响应状态判定：code === 0 或 StatusCode === 0
      const feishuCode = json.code !== undefined ? json.code : json.StatusCode;
      const isSuccess =
        response.ok && (feishuCode === 0 || feishuCode === "0" || feishuCode === undefined);

      if (!isSuccess) {
        const errorMsg = json.msg || json.message || response.statusText || "Feishu API Error";
        return {
          targetId: target.id,
          provider: "feishu",
          channelType: "feishu_webhook",
          success: false,
          httpStatus,
          providerCode: feishuCode !== undefined ? String(feishuCode) : undefined,
          errorCode: httpStatus === 429 ? "FEISHU_WEBHOOK_RATE_LIMIT" : "FEISHU_WEBHOOK_API_ERROR",
          errorSummary: sanitizeErrorSummary(errorMsg),
          durationMs,
        };
      }

      return {
        targetId: target.id,
        provider: "feishu",
        channelType: "feishu_webhook",
        success: true,
        httpStatus,
        durationMs,
      };
    } catch (err: any) {
      const isTimeout = err.name === "TimeoutError" || err.message?.includes("timeout");
      return {
        targetId: target.id,
        provider: "feishu",
        channelType: "feishu_webhook",
        success: false,
        errorCode: isTimeout ? "FEISHU_WEBHOOK_TIMEOUT" : "FEISHU_WEBHOOK_HTTP_ERROR",
        errorSummary: sanitizeErrorSummary(err),
        durationMs: Date.now() - startTime,
      };
    }
  },

  async test(env: Env, target: FeishuWebhookTarget): Promise<DeliveryResult> {
    const testNotification: Notification = {
      title: "✅ git2im 连通性测试",
      level: "success",
      repository: "git2im",
      eventLabel: "Test",
      fields: [
        { label: "Target", value: target.name },
        { label: "Provider", value: "Feishu Webhook Bot" },
        { label: "Time", value: new Date().toISOString() },
      ],
      description: "恭喜！飞书机器人通知通道已正确配置并成功连接。",
    };

    return this.send(env, target, testNotification);
  },
};

/**
 * 钉钉自定义机器人 Webhook 通道适配器 (DingTalk Webhook Channel)
 */

import type { Env } from "../../env";
import type { DingTalkWebhookTarget, NotificationChannel, DeliveryResult } from "../types";
import type { Notification } from "../../notification/types";
import { getSecret } from "../../security/secret-store";
import { validateWebhookUrl } from "../url-guard";
import { renderDingTalkMarkdown } from "./render";
import { calculateDingTalkSign } from "./signature";
import { sanitizeErrorSummary } from "../../security/redact";

export const dingTalkWebhookChannel: NotificationChannel<DingTalkWebhookTarget> = {
  type: "dingtalk_webhook",

  async send(
    env: Env,
    target: DingTalkWebhookTarget,
    notification: Notification
  ): Promise<DeliveryResult> {
    const startTime = Date.now();

    try {
      // 1. 读取 Webhook URL
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
          provider: "dingtalk",
          channelType: "dingtalk_webhook",
          success: false,
          errorCode: "DINGTALK_WEBHOOK_CONFIG_ERROR",
          errorSummary: "Webhook URL is not configured",
          durationMs: Date.now() - startTime,
        };
      }

      // 2. 域名白名单与 SSRF 防御校验
      const urlCheck = validateWebhookUrl("dingtalk_webhook", webhookUrl);
      if (!urlCheck.valid) {
        return {
          targetId: target.id,
          provider: "dingtalk",
          channelType: "dingtalk_webhook",
          success: false,
          errorCode: "DINGTALK_WEBHOOK_CONFIG_ERROR",
          errorSummary: `Invalid Webhook URL: ${urlCheck.reason}`,
          durationMs: Date.now() - startTime,
        };
      }

      // 3. 构建发送 URL（若配置加签密钥则附加 timestamp & sign 查询参数）
      let targetUrl = webhookUrl;
      const signSecret = await getSecret(
        env.DB,
        env.MASTER_KEY,
        "target",
        target.id,
        "sign_secret"
      );

      if (signSecret) {
        const timestamp = Date.now();
        const sign = await calculateDingTalkSign(signSecret, timestamp);
        const separator = targetUrl.includes("?") ? "&" : "?";
        targetUrl = `${targetUrl}${separator}timestamp=${timestamp}&sign=${sign}`;
      }

      // 4. 构建 Markdown 载荷
      const payload = renderDingTalkMarkdown(notification);

      // 5. 发送请求 (超时 3 秒，禁止跟随重定向)
      const response = await fetch(targetUrl, {
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

      const isSuccess = response.ok && (json.errcode === 0 || json.errcode === "0");

      if (!isSuccess) {
        const errorMsg = json.errmsg || response.statusText || "DingTalk API Error";
        return {
          targetId: target.id,
          provider: "dingtalk",
          channelType: "dingtalk_webhook",
          success: false,
          httpStatus,
          providerCode: json.errcode !== undefined ? String(json.errcode) : undefined,
          errorCode: httpStatus === 429 ? "DINGTALK_WEBHOOK_RATE_LIMIT" : "DINGTALK_WEBHOOK_API_ERROR",
          errorSummary: sanitizeErrorSummary(errorMsg),
          durationMs,
        };
      }

      return {
        targetId: target.id,
        provider: "dingtalk",
        channelType: "dingtalk_webhook",
        success: true,
        httpStatus,
        durationMs,
      };
    } catch (err: any) {
      const isTimeout = err.name === "TimeoutError" || err.message?.includes("timeout");
      return {
        targetId: target.id,
        provider: "dingtalk",
        channelType: "dingtalk_webhook",
        success: false,
        errorCode: isTimeout ? "DINGTALK_WEBHOOK_TIMEOUT" : "DINGTALK_WEBHOOK_HTTP_ERROR",
        errorSummary: sanitizeErrorSummary(err),
        durationMs: Date.now() - startTime,
      };
    }
  },

  async test(env: Env, target: DingTalkWebhookTarget): Promise<DeliveryResult> {
    const testNotification: Notification = {
      title: "git2im 连通性测试",
      level: "success",
      repository: "git2im",
      eventLabel: "Test",
      fields: [
        { label: "Target", value: target.name },
        { label: "Provider", value: "DingTalk Webhook Bot" },
        { label: "Time", value: new Date().toISOString() },
      ],
      description: "恭喜！钉钉自定义机器人通知通道已正确配置并成功连接。",
    };

    return this.send(env, target, testNotification);
  },
};

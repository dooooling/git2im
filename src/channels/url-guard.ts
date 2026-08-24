/**
 * 下游 IM 官方权威 Webhook 域名白名单与 SSRF 防御校验模块
 *
 * 核心安全规范：
 * 1. 投递目标 Webhook URL 必须通过官方白名单校验，严禁向任意内网或非官方外部 URL 发起请求。
 * 2. 必须强制使用 https 协议，禁止携带 userinfo (用户名密码)，禁止非标准端口。
 * 3. 所有 outbound fetch 请求必须显式配置 redirect: "error"，严禁跟随重定向。
 */

import type { ChannelType } from "./types";

export function validateWebhookUrl(
  channelType: ChannelType,
  rawUrl: string
): { valid: boolean; reason?: string } {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { valid: false, reason: "Webhook URL is empty" };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: "Invalid Webhook URL format" };
  }

  // 1. 协议限制为 https
  if (parsed.protocol !== "https:") {
    return { valid: false, reason: "Webhook URL must use HTTPS" };
  }

  // 2. 禁止 userinfo (如 https://user:pass@host)
  if (parsed.username || parsed.password) {
    return { valid: false, reason: "Webhook URL must not contain userinfo" };
  }

  // 3. 端口限制（只允许默认 443 或无明确自定义端口）
  if (parsed.port && parsed.port !== "443") {
    return { valid: false, reason: "Webhook URL must use standard HTTPS port 443" };
  }

  // 4. 各平台域名白名单与路径校验
  switch (channelType) {
    case "feishu_webhook": {
      if (parsed.hostname !== "open.feishu.cn") {
        return { valid: false, reason: "Feishu Webhook domain must be open.feishu.cn" };
      }
      if (!parsed.pathname.startsWith("/open-apis/bot/v2/hook/")) {
        return { valid: false, reason: "Feishu Webhook path must start with /open-apis/bot/v2/hook/" };
      }
      return { valid: true };
    }

    case "dingtalk_webhook": {
      if (parsed.hostname !== "oapi.dingtalk.com") {
        return { valid: false, reason: "DingTalk Webhook domain must be oapi.dingtalk.com" };
      }
      if (parsed.pathname !== "/robot/send") {
        return { valid: false, reason: "DingTalk Webhook path must be /robot/send" };
      }
      if (!parsed.searchParams.has("access_token")) {
        return { valid: false, reason: "DingTalk Webhook must contain access_token query param" };
      }
      return { valid: true };
    }

    case "wecom_webhook": {
      if (parsed.hostname !== "qyapi.weixin.qq.com") {
        return { valid: false, reason: "WeCom Webhook domain must be qyapi.weixin.qq.com" };
      }
      if (parsed.pathname !== "/cgi-bin/webhook/send") {
        return { valid: false, reason: "WeCom Webhook path must be /cgi-bin/webhook/send" };
      }
      if (!parsed.searchParams.has("key")) {
        return { valid: false, reason: "WeCom Webhook must contain key query param" };
      }
      return { valid: true };
    }

    case "feishu_app":
      // 飞书自建应用接口地址写死在代码中，不通过 Webhook URL 输入
      return { valid: true };
  }
}

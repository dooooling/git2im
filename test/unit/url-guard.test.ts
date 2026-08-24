import { describe, it, expect } from "vitest";
import { validateWebhookUrl } from "../../src/channels/url-guard";

describe("Channels: URL Guard & SSRF Protection", () => {
  describe("Feishu Webhook URL Validation", () => {
    it("should accept valid Feishu webhook URL", () => {
      const url = "https://open.feishu.cn/open-apis/bot/v2/hook/abc-123-uuid-456";
      expect(validateWebhookUrl("feishu_webhook", url).valid).toBe(true);
    });

    it("should reject non-HTTPS URLs", () => {
      const url = "http://open.feishu.cn/open-apis/bot/v2/hook/abc-123";
      expect(validateWebhookUrl("feishu_webhook", url).valid).toBe(false);
    });

    it("should reject untrusted domains", () => {
      const url = "https://evil.com/open-apis/bot/v2/hook/abc-123";
      expect(validateWebhookUrl("feishu_webhook", url).valid).toBe(false);
    });

    it("should reject non-standard paths", () => {
      const url = "https://open.feishu.cn/other/api/endpoint";
      expect(validateWebhookUrl("feishu_webhook", url).valid).toBe(false);
    });

    it("should reject userinfo in URL", () => {
      const url = "https://admin:pass@open.feishu.cn/open-apis/bot/v2/hook/abc-123";
      expect(validateWebhookUrl("feishu_webhook", url).valid).toBe(false);
    });
  });

  describe("DingTalk Webhook URL Validation", () => {
    it("should accept valid DingTalk webhook URL", () => {
      const url = "https://oapi.dingtalk.com/robot/send?access_token=0f8392bcdef";
      expect(validateWebhookUrl("dingtalk_webhook", url).valid).toBe(true);
    });

    it("should reject missing access_token query param", () => {
      const url = "https://oapi.dingtalk.com/robot/send";
      expect(validateWebhookUrl("dingtalk_webhook", url).valid).toBe(false);
    });
  });

  describe("WeCom Webhook URL Validation", () => {
    it("should accept valid WeCom webhook URL", () => {
      const url = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=693a91f6-7xxx";
      expect(validateWebhookUrl("wecom_webhook", url).valid).toBe(true);
    });

    it("should reject missing key query param", () => {
      const url = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send";
      expect(validateWebhookUrl("wecom_webhook", url).valid).toBe(false);
    });
  });
});

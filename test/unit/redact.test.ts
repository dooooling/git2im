import { describe, it, expect } from "vitest";
import { redactSecrets, sanitizeErrorSummary } from "../../src/security/redact";

describe("Security: Redaction & Sanitization", () => {
  it("should redact Feishu webhook token from URLs", () => {
    const raw = "Post to https://open.feishu.cn/open-apis/bot/v2/hook/abc-123-secret-uuid failed";
    const redacted = redactSecrets(raw);

    expect(redacted).toBe("Post to https://open.feishu.cn/open-apis/bot/v2/hook/[REDACTED] failed");
    expect(redacted.includes("abc-123-secret-uuid")).toBe(false);
  });

  it("should redact DingTalk webhook token from URLs", () => {
    const raw = "https://oapi.dingtalk.com/robot/send?access_token=0f8392bcdef123456";
    const redacted = redactSecrets(raw);

    expect(redacted).toBe("https://oapi.dingtalk.com/robot/send?access_token=[REDACTED]");
    expect(redacted.includes("0f8392bcdef123456")).toBe(false);
  });

  it("should redact WeCom webhook key from URLs", () => {
    const raw = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=693a91f6-7xxx-4bc4-97a0-0b2ee533954b";
    const redacted = redactSecrets(raw);

    expect(redacted).toBe("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=[REDACTED]");
    expect(redacted.includes("693a91f6-7xxx-4bc4-97a0-0b2ee533954b")).toBe(false);
  });

  it("should redact bearer tokens and sensitive json fields", () => {
    const raw = 'Failed with header Bearer eyJhbGciOiJIUzI1Ni... and "app_secret": "my-secret-key-123"';
    const redacted = redactSecrets(raw);

    expect(redacted.includes("eyJhbGciOiJIUzI1Ni...")).toBe(false);
    expect(redacted.includes("my-secret-key-123")).toBe(false);
  });

  it("should sanitize error summary and truncate long errors", () => {
    const err = new Error("Connection failed to https://open.feishu.cn/open-apis/bot/v2/hook/secret-token-xyz");
    const summary = sanitizeErrorSummary(err);

    expect(summary).toBe("Connection failed to https://open.feishu.cn/open-apis/bot/v2/hook/[REDACTED]");
    expect(summary.includes("secret-token-xyz")).toBe(false);
  });
});

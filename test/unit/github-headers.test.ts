import { describe, it, expect } from "vitest";
import {
  parseGithubWebhookHeaders,
  readBodyLimited,
  MAX_WEBHOOK_BODY_BYTES,
} from "../../src/github/headers";

describe("GitHub: Webhook Headers & Body Size Guard", () => {
  it("should correctly parse valid GitHub webhook headers", () => {
    const request = new Request("https://example.com/webhooks/github", {
      method: "POST",
      headers: {
        "X-GitHub-Delivery": "72d3162e-cc78-11e3-81ab-4c9367dc0958",
        "X-GitHub-Event": "push",
        "X-Hub-Signature-256": "sha256=abcdef123456",
        "Content-Type": "application/json",
        "User-Agent": "GitHub-Hookshot/123",
      },
    });

    const headers = parseGithubWebhookHeaders(request);
    expect(headers).toBeTruthy();
    expect(headers?.deliveryId).toBe("72d3162e-cc78-11e3-81ab-4c9367dc0958");
    expect(headers?.eventType).toBe("push");
    expect(headers?.signature).toBe("sha256=abcdef123456");
  });

  it("should return null when essential headers are missing", () => {
    const request = new Request("https://example.com/webhooks/github", {
      method: "POST",
      headers: {
        "X-GitHub-Event": "push",
        // 缺少 X-GitHub-Delivery
      },
    });

    const headers = parseGithubWebhookHeaders(request);
    expect(headers).toBeNull();
  });

  it("should read normal request body successfully", async () => {
    const bodyContent = JSON.stringify({ action: "opened", repository: "facebook/react" });
    const request = new Request("https://example.com/webhooks/github", {
      method: "POST",
      body: bodyContent,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(new TextEncoder().encode(bodyContent).length),
      },
    });

    const { bodyBytes, bodyText, exceeded } = await readBodyLimited(request);
    expect(exceeded).toBe(false);
    expect(bodyText).toBe(bodyContent);
    expect(bodyBytes.length).toBeGreaterThan(0);
  });

  it("should reject payload exceeding MAX_WEBHOOK_BODY_BYTES limit", async () => {
    // 构造超过 1 MiB 的大 Payload
    const largeBody = new Uint8Array(MAX_WEBHOOK_BODY_BYTES + 1024);
    const request = new Request("https://example.com/webhooks/github", {
      method: "POST",
      body: largeBody,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(largeBody.length),
      },
    });

    const { exceeded } = await readBodyLimited(request);
    expect(exceeded).toBe(true);
  });
});

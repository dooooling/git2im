import { describe, it, expect } from "vitest";
import {
  createSessionToken,
  verifySessionToken,
  serializeSessionCookie,
  serializeClearSessionCookie,
  parseSessionCookie,
  SESSION_COOKIE_NAME,
} from "../../src/security/session";

describe("Security: Session Token & Cookies", () => {
  const testMasterKey = "k8x+N3Z9nLq1sR7uV2wY5zB8cD0eF3gH6jK9mP2rT5v=";

  it("should create and successfully verify a valid session token", async () => {
    const token = await createSessionToken(testMasterKey, 3600);
    expect(token).toBeTruthy();
    expect(token.includes(".")).toBe(true);

    const result = await verifySessionToken(token, testMasterKey);
    expect(result.valid).toBe(true);
    expect(result.payload?.nonce).toBeTruthy();
    expect(result.payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("should reject an expired session token", async () => {
    // 创建一个负 TTL (已过期) 的 token
    const token = await createSessionToken(testMasterKey, -10);
    const result = await verifySessionToken(token, testMasterKey);

    expect(result.valid).toBe(false);
  });

  it("should reject a tampered session token", async () => {
    const token = await createSessionToken(testMasterKey, 3600);
    const parts = token.split(".");
    const tamperedToken = `${parts[0]}X.${parts[1]}`;

    const result = await verifySessionToken(tamperedToken, testMasterKey);
    expect(result.valid).toBe(false);
  });

  it("should serialize and parse session cookie headers", () => {
    const token = "mock-session-token-value";
    const cookieHeader = serializeSessionCookie(token, { isSecure: true, maxAgeSeconds: 3600 });

    expect(cookieHeader).toContain(`${SESSION_COOKIE_NAME}=${token}`);
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("SameSite=Strict");
    expect(cookieHeader).toContain("Secure");

    const parsed = parseSessionCookie(`theme=dark; ${cookieHeader}; other=value`);
    expect(parsed).toBe(token);
  });

  it("should serialize clear session cookie header", () => {
    const clearHeader = serializeClearSessionCookie(true);
    expect(clearHeader).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(clearHeader).toContain("Max-Age=0");
    expect(clearHeader).toContain("Expires=");
  });
});

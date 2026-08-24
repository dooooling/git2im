import { describe, it, expect } from "vitest";
import {
  verifyGithubSignature,
  calculateHmacSha256Hex,
} from "../../src/github/signature";

describe("GitHub: HMAC-SHA256 Signature Verification", () => {
  const secretCurrent = "my-active-github-secret-123456";
  const secretPrevious = "my-old-github-secret-654321";
  const rawBody = new TextEncoder().encode(JSON.stringify({ zen: "Responsive is better than fast." }));

  it("should verify valid signature with active current secret", async () => {
    const expectedHex = await calculateHmacSha256Hex(secretCurrent, rawBody);
    const signatureHeader = `sha256=${expectedHex}`;

    const isValid = await verifyGithubSignature(rawBody, signatureHeader, [secretCurrent]);
    expect(isValid).toBe(true);
  });

  it("should verify valid signature with previous secret in rotation candidate list", async () => {
    const expectedHex = await calculateHmacSha256Hex(secretPrevious, rawBody);
    const signatureHeader = `sha256=${expectedHex}`;

    const isValid = await verifyGithubSignature(rawBody, signatureHeader, [secretCurrent, secretPrevious]);
    expect(isValid).toBe(true);
  });

  it("should reject signature with wrong secret", async () => {
    const expectedHex = await calculateHmacSha256Hex("completely-wrong-secret", rawBody);
    const signatureHeader = `sha256=${expectedHex}`;

    const isValid = await verifyGithubSignature(rawBody, signatureHeader, [secretCurrent, secretPrevious]);
    expect(isValid).toBe(false);
  });

  it("should reject malformed signature header", async () => {
    const isValid1 = await verifyGithubSignature(rawBody, "invalid-header-format", [secretCurrent]);
    expect(isValid1).toBe(false);

    const isValid2 = await verifyGithubSignature(rawBody, null, [secretCurrent]);
    expect(isValid2).toBe(false);

    const isValid3 = await verifyGithubSignature(rawBody, "sha256=123", [secretCurrent]);
    expect(isValid3).toBe(false);
  });
});

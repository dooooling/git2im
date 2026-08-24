import { describe, it, expect } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  generateRandomBase64,
  encryptAesGcm,
  decryptAesGcm,
} from "../../src/security/crypto";

describe("Security: Web Crypto (AES-256-GCM & Base64)", () => {
  const testMasterKey = "k8x+N3Z9nLq1sR7uV2wY5zB8cD0eF3gH6jK9mP2rT5v="; // 32 bytes Base64

  it("should correctly encode and decode Base64 strings", () => {
    const original = "Hello Cloudflare Workers & Web Crypto! 🚀";
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const bytes = encoder.encode(original);
    const base64 = bytesToBase64(bytes);
    const decodedBytes = base64ToBytes(base64);

    expect(decoder.decode(decodedBytes)).toBe(original);
  });

  it("should generate random Base64 strings of exact byte length", () => {
    const randomKey = generateRandomBase64(32);
    const bytes = base64ToBytes(randomKey);
    expect(bytes.byteLength).toBe(32);
  });

  it("should encrypt and decrypt plaintext using AES-256-GCM and AAD", () => {
    return (async () => {
      const plaintext = "https://open.feishu.cn/open-apis/bot/v2/hook/secret-token-123456";
      const aad = "target:target-uuid-1:webhook_url";

      const encrypted = await encryptAesGcm(plaintext, testMasterKey, aad);

      expect(encrypted.ciphertext).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.ciphertext).not.toBe(plaintext);

      const decrypted = await decryptAesGcm(
        encrypted.ciphertext,
        encrypted.iv,
        testMasterKey,
        aad
      );

      expect(decrypted).toBe(plaintext);
    })();
  });

  it("should fail decryption when AAD does not match (Tamper detection)", () => {
    return (async () => {
      const plaintext = "my-secret-value";
      const aad = "target:target-uuid-1:webhook_url";
      const wrongAad = "target:target-uuid-2:webhook_url";

      const encrypted = await encryptAesGcm(plaintext, testMasterKey, aad);

      await expect(
        decryptAesGcm(encrypted.ciphertext, encrypted.iv, testMasterKey, wrongAad)
      ).rejects.toThrow();
    })();
  });

  it("should fail decryption with wrong master key", () => {
    return (async () => {
      const plaintext = "my-secret-value";
      const aad = "target:target-uuid-1:webhook_url";
      const wrongMasterKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 bytes 0

      const encrypted = await encryptAesGcm(plaintext, testMasterKey, aad);

      await expect(
        decryptAesGcm(encrypted.ciphertext, encrypted.iv, wrongMasterKey, aad)
      ).rejects.toThrow();
    })();
  });
});

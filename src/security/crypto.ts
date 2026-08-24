/**
 * Web Crypto 加解密核心工具模块
 *
 * 规范：
 * 1. 采用标准 Web Crypto API (SubtleCrypto)，完全兼容 Cloudflare Workers 环境。
 * 2. 根主密钥 (MASTER_KEY) 通过 HKDF (HMAC-SHA256) 派生子密钥，隔离不同用途。
 * 3. 业务凭据加密采用 AES-256-GCM 算法，12 字节随机 IV，并使用 AAD (附加认证数据) 绑定 scope。
 */

/**
 * 将 Base64 字符串解码为 Uint8Array
 * @param base64 Base64 编码字符串
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * 将 Uint8Array 编码为 Base64 字符串
 * @param bytes 原始字节数组
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

/**
 * 生成指定字节长度的安全随机字节并返回 Base64 格式
 * @param byteLength 随机字节数（默认 32 字节）
 */
export function generateRandomBase64(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

/**
 * 从 Base64 编码的 MASTER_KEY 导入原始密钥素材 (HKDF 根密钥)
 * @param masterKeyBase64 32 字节 Master Key Base64 串
 */
async function importRawMasterKey(masterKeyBase64: string): Promise<CryptoKey> {
  const rawKeyBytes = base64ToBytes(masterKeyBase64);
  if (rawKeyBytes.byteLength !== 32) {
    throw new Error(`Master key must be exactly 32 bytes (256 bits), got ${rawKeyBytes.byteLength} bytes.`);
  }

  return await crypto.subtle.importKey(
    "raw",
    rawKeyBytes,
    "HKDF",
    false,
    ["deriveKey"]
  );
}

/**
 * 基于 HKDF 派生 AES-256-GCM 加密密钥
 * @param masterKeyBase64 Master Key (Base64)
 * @param info 派生上下文标识（如 "git2im-d1-secrets-v1"）
 */
export async function deriveAesGcmKey(
  masterKeyBase64: string,
  info = "git2im-d1-secrets-v1"
): Promise<CryptoKey> {
  const masterKey = await importRawMasterKey(masterKeyBase64);
  const encoder = new TextEncoder();

  return await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0), // 规范：无 salt 时使用空 byte array
      info: encoder.encode(info),
    },
    masterKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * 基于 HKDF 派生 HMAC-SHA256 签名密钥 (用于 Session Token 签名)
 * @param masterKeyBase64 Master Key (Base64)
 * @param info 派生上下文标识（如 "admin-session-v1"）
 */
export async function deriveHmacKey(
  masterKeyBase64: string,
  info = "admin-session-v1"
): Promise<CryptoKey> {
  const masterKey = await importRawMasterKey(masterKeyBase64);
  const encoder = new TextEncoder();

  return await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: encoder.encode(info),
    },
    masterKey,
    {
      name: "HMAC",
      hash: "SHA-256",
      length: 256,
    },
    false,
    ["sign", "verify"]
  );
}

/**
 * AES-256-GCM 字符串加密 (带 AAD 关联认证数据)
 *
 * @param plaintext 待加密明文字符串
 * @param masterKeyBase64 Master Key (Base64)
 * @param aadString 关联附加认证数据 (如 "target:<id>:webhook_url")，防止密文跨作用域复用
 * @returns 加密后的 Base64 密文与 12 字节 Base64 IV
 */
export async function encryptAesGcm(
  plaintext: string,
  masterKeyBase64: string,
  aadString: string
): Promise<{ ciphertext: string; iv: string }> {
  const key = await deriveAesGcmKey(masterKeyBase64);
  const encoder = new TextEncoder();

  // 生成 12 字节标准 GCM IV
  const ivBytes = new Uint8Array(12);
  crypto.getRandomValues(ivBytes);

  const plaintextBytes = encoder.encode(plaintext);
  const aadBytes = encoder.encode(aadString);

  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: ivBytes,
      additionalData: aadBytes,
      tagLength: 128, // 128 位认证标签 (Authentication Tag)
    },
    key,
    plaintextBytes
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
    iv: bytesToBase64(ivBytes),
  };
}

/**
 * AES-256-GCM 字符串解密 (校验 AAD 关联认证数据)
 *
 * @param ciphertextBase64 Base64 编码的密文（包含尾部 Auth Tag）
 * @param ivBase64 Base64 编码的 12 字节 IV
 * @param masterKeyBase64 Master Key (Base64)
 * @param aadString 关联附加认证数据 (必须与加密时传入的完全一致)
 * @returns 解密后的明文字符串
 */
export async function decryptAesGcm(
  ciphertextBase64: string,
  ivBase64: string,
  masterKeyBase64: string,
  aadString: string
): Promise<string> {
  const key = await deriveAesGcmKey(masterKeyBase64);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const ciphertextBytes = base64ToBytes(ciphertextBase64);
  const ivBytes = base64ToBytes(ivBase64);
  const aadBytes = encoder.encode(aadString);

  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivBytes,
      additionalData: aadBytes,
      tagLength: 128,
    },
    key,
    ciphertextBytes
  );

  return decoder.decode(decryptedBuffer);
}

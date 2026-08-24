/**
 * GitHub Webhook HMAC-SHA256 签名校验模块
 *
 * 核心规范：
 * 1. 签名由 X-Hub-Signature-256 请求头传递，格式为 "sha256=<64位十六进制哈希>"。
 * 2. 校验必须对原始 Request Body 字节进行，严禁 JSON 反序列化后再 stringify 验签。
 * 3. 采用 Web Crypto API (HMAC-SHA256) 计算期望哈希，并使用 timingSafeEqual 恒定时间比对。
 * 4. 支持轮换候选密钥列表（当前密钥 + 30分钟过渡期内的旧密钥）。
 */

import { timingSafeEqual } from "../security/constant-time";

/**
 * 将 ArrayBuffer 转换为 16 进制字符串
 */
function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * 计算原始字节数据的 HMAC-SHA256 十六进制哈希
 *
 * @param secret Webhook Secret 字符串
 * @param data 原始请求体字节数组
 * @returns 64 位小写十六进制签名哈希
 */
export async function calculateHmacSha256Hex(
  secret: string,
  data: Uint8Array
): Promise<string> {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(secret);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, data);
  return bufferToHex(signatureBuffer);
}

/**
 * 校验 GitHub Webhook 请求签名
 *
 * @param bodyBytes 原始请求体 Uint8Array
 * @param signatureHeader X-Hub-Signature-256 请求头的值
 * @param candidateSecrets 候选 Secret 明文列表（当前密钥与过渡期旧密钥）
 * @returns 若任一候选 Secret 验签通过返回 true，否则返回 false
 */
export async function verifyGithubSignature(
  bodyBytes: Uint8Array,
  signatureHeader: string | null,
  candidateSecrets: string[]
): Promise<boolean> {
  if (!signatureHeader || typeof signatureHeader !== "string") {
    return false;
  }

  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }

  const actualHex = signatureHeader.substring(prefix.length).trim().toLowerCase();
  if (actualHex.length !== 64) {
    return false;
  }

  if (!candidateSecrets || candidateSecrets.length === 0) {
    return false;
  }

  // 依次尝试候选密钥进行恒定时间校验
  for (const secret of candidateSecrets) {
    if (!secret) continue;
    try {
      const expectedHex = await calculateHmacSha256Hex(secret, bodyBytes);
      if (timingSafeEqual(expectedHex, actualHex)) {
        return true;
      }
    } catch {
      // 忽略单个密钥计算异常，继续尝试下一个
    }
  }

  return false;
}

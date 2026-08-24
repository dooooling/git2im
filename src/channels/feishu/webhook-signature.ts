/**
 * 飞书自定义机器人 Webhook 加签计算模块
 *
 * 签名算法（飞书官方标准）：
 * 1. timestamp = 当前 Unix 秒级时间戳 (如 1599360473)。
 * 2. stringToSign = `${timestamp}\n${secret}`。
 * 3. 密钥为 stringToSign，数据内容为空字节，计算 HMAC-SHA256 并进行 Base64 编码。
 */

import { bytesToBase64 } from "../../security/crypto";

export async function calculateFeishuWebhookSign(
  secret: string,
  timestampSeconds: number
): Promise<string> {
  const stringToSign = `${timestampSeconds}\n${secret}`;
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(stringToSign);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // 对空数据进行签名
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new Uint8Array(0)
  );

  return bytesToBase64(new Uint8Array(signatureBuffer));
}

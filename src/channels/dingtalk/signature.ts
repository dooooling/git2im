/**
 * 钉钉自定义机器人 Webhook 加签计算模块
 *
 * 签名算法（钉钉官方标准）：
 * 1. timestamp = 当前 Unix 毫秒时间戳 (如 1599360473000)。
 * 2. stringToSign = `${timestamp}\n${secret}`。
 * 3. 密钥为 secret，数据为 stringToSign，计算 HMAC-SHA256，进行 Base64 编码，并使用 URL-Encode 编码。
 * 4. 签名与时间戳通过 URL Query 传递（&timestamp=...&sign=...），禁止放入 Body。
 */

import { bytesToBase64 } from "../../security/crypto";

export async function calculateDingTalkSign(
  secret: string,
  timestampMs: number
): Promise<string> {
  const stringToSign = `${timestampMs}\n${secret}`;
  const encoder = new TextEncoder();

  const keyBytes = encoder.encode(secret);
  const dataBytes = encoder.encode(stringToSign);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    dataBytes
  );

  const base64Sign = bytesToBase64(new Uint8Array(signatureBuffer));
  return encodeURIComponent(base64Sign);
}

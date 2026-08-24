/**
 * 管理后台 Session 鉴权模块
 *
 * 规范：
 * 1. 签名算法：HMAC-SHA256。
 * 2. 密钥来源：从 MASTER_KEY 通过 HKDF (info="admin-session-v1") 派生，无需单独配置 SESSION_SECRET。
 * 3. Cookie 属性：HttpOnly, Secure, SameSite=Strict, Max-Age=43200 (12小时)。
 * 4. Token 结构：Base64URL(Payload JSON) + "." + Base64URL(Signature)。
 */

import { deriveHmacKey, base64ToBytes, bytesToBase64 } from "./crypto";
import { timingSafeEqual } from "./constant-time";

export const SESSION_COOKIE_NAME = "gim_session";
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 43200; // 12 小时 (12 * 3600)

export interface SessionPayload {
  /** 签发时间戳 (秒) */
  iat: number;
  /** 过期时间戳 (秒) */
  exp: number;
  /** 随机 Nonce，保证每次签发的 Token 唯一 */
  nonce: string;
}

/**
 * 将 Base64 编码转换为 URL 安全的 Base64URL
 */
function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 将 Base64URL 还原为标准 Base64 编码
 */
function fromBase64Url(base64url: string): string {
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return base64;
}

/**
 * 签发新的管理员 Session Token
 *
 * @param masterKeyBase64 Master Key (Base64)
 * @param ttlSeconds Token 有效期（秒，默认 12 小时）
 * @returns 签名后的 Session Token 字符串
 */
export async function createSessionToken(
  masterKeyBase64: string,
  ttlSeconds = DEFAULT_SESSION_MAX_AGE_SECONDS
): Promise<string> {
  const hmacKey = await deriveHmacKey(masterKeyBase64, "admin-session-v1");
  const now = Math.floor(Date.now() / 1000);

  const payload: SessionPayload = {
    iat: now,
    exp: now + ttlSeconds,
    nonce: crypto.randomUUID(),
  };

  const encoder = new TextEncoder();
  const payloadJson = JSON.stringify(payload);
  const payloadBase64Url = toBase64Url(bytesToBase64(encoder.encode(payloadJson)));

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    encoder.encode(payloadBase64Url)
  );

  const signatureBase64Url = toBase64Url(bytesToBase64(new Uint8Array(signatureBuffer)));

  return `${payloadBase64Url}.${signatureBase64Url}`;
}

/**
 * 校验 Session Token 的合法性与有效期限
 *
 * @param token 待校验的 Token
 * @param masterKeyBase64 Master Key (Base64)
 * @returns 校验结果与 Session Payload
 */
export async function verifySessionToken(
  token: string,
  masterKeyBase64: string
): Promise<{ valid: boolean; payload?: SessionPayload }> {
  if (!token || typeof token !== "string") {
    return { valid: false };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false };
  }

  const [payloadBase64Url, signatureBase64Url] = parts;
  if (!payloadBase64Url || !signatureBase64Url) {
    return { valid: false };
  }

  try {
    const hmacKey = await deriveHmacKey(masterKeyBase64, "admin-session-v1");
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // 1. 重新计算签名
    const expectedSignatureBuffer = await crypto.subtle.sign(
      "HMAC",
      hmacKey,
      encoder.encode(payloadBase64Url)
    );

    const actualSignatureBytes = base64ToBytes(fromBase64Url(signatureBase64Url));
    const expectedSignatureBytes = new Uint8Array(expectedSignatureBuffer);

    // 2. 恒定时间比对签名
    if (!timingSafeEqual(actualSignatureBytes, expectedSignatureBytes)) {
      return { valid: false };
    }

    // 3. 解析 Payload
    const payloadBytes = base64ToBytes(fromBase64Url(payloadBase64Url));
    const payload: SessionPayload = JSON.parse(decoder.decode(payloadBytes));

    // 4. 检查是否过期
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) {
      return { valid: false };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

/**
 * 生成设置 Session 的 Set-Cookie 响应头字符串
 *
 * @param token Session Token
 * @param options Cookie 属性选项
 */
export function serializeSessionCookie(
  token: string,
  options?: { isSecure?: boolean; maxAgeSeconds?: number }
): string {
  const isSecure = options?.isSecure ?? true;
  const maxAge = options?.maxAgeSeconds ?? DEFAULT_SESSION_MAX_AGE_SECONDS;

  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Strict",
  ];

  if (isSecure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

/**
 * 生成清除 Session 的 Set-Cookie 响应头字符串
 */
export function serializeClearSessionCookie(isSecure = true): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "SameSite=Strict",
  ];

  if (isSecure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

/**
 * 从 HTTP Request Headers 的 Cookie 字段中解析 Session Token
 *
 * @param cookieHeader Request.headers.get("Cookie")
 * @returns Session Token 或 null
 */
export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (trimmed.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      return trimmed.substring(SESSION_COOKIE_NAME.length + 1);
    }
  }

  return null;
}

/**
 * 恒定时间比较模块 (Constant-time equality comparison)
 *
 * 用于防止密码、HMAC 签名、Token 等敏感字符串的时序侧信道攻击 (Timing Attack)。
 */

/**
 * 恒定时间比较两个字符串或字节数组是否相等
 *
 * @param a 待比较的第一个值（字符串或 Uint8Array）
 * @param b 待比较的第二个值（字符串或 Uint8Array）
 * @returns 若完全相等返回 true，否则返回 false
 */
export function timingSafeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const encoder = new TextEncoder();
  const bufA: Uint8Array = typeof a === "string" ? encoder.encode(a) : a;
  const bufB: Uint8Array = typeof b === "string" ? encoder.encode(b) : b;

  if (bufA.byteLength !== bufB.byteLength) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < bufA.byteLength; i++) {
    const byteA = bufA[i] ?? 0;
    const byteB = bufB[i] ?? 0;
    result |= byteA ^ byteB;
  }

  return result === 0;
}

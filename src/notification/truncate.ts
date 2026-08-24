/**
 * UTF-8 字节安全截断工具模块 (Byte Truncation)
 *
 * 核心规范：
 * 1. 飞书、钉钉、企业微信对请求体/Markdown 长度均有严格的 UTF-8 字节数上限限制（例如企微 Markdown 4096 字节）。
 * 2. 截断时必须在完整的 Unicode 代码点 / UTF-8 字符边界进行，严禁切断多字节汉字或 Emoji 产生乱码。
 */

/**
 * 获取字符串的 UTF-8 字节数
 */
export function getUtf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * 按照 UTF-8 字节数安全截断字符串，并追加可选省略符
 *
 * @param text 原始字符串
 * @param maxBytes 允许的最大 UTF-8 字节数
 * @param ellipsis 超限时追加的省略符（默认 "..."，占 3 字节）
 * @returns 截断后的安全字符串，其 UTF-8 字节长度必然 <= maxBytes
 */
export function truncateByBytes(
  text: string,
  maxBytes: number,
  ellipsis = "..."
): string {
  if (!text) return "";
  if (maxBytes <= 0) return "";

  const encoder = new TextEncoder();
  const fullBytes = encoder.encode(text);

  // 未超限直接返回
  if (fullBytes.length <= maxBytes) {
    return text;
  }

  const ellipsisBytes = encoder.encode(ellipsis);
  if (ellipsisBytes.length >= maxBytes) {
    // 若省略符自身已达到或超过限制，则硬切前 maxBytes 字节
    const sub = fullBytes.subarray(0, maxBytes);
    return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(sub);
  }

  const targetBytes = maxBytes - ellipsisBytes.length;
  const subBytes = fullBytes.subarray(0, targetBytes);

  // 使用 fatal: false 安全解码并丢弃末尾被切断的不完整字节序列
  const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false });
  let decoded = decoder.decode(subBytes);

  // 修复因代理对（Surrogate Pair）被拆开造成的末尾非法字符
  if (decoded.length > 0) {
    const lastCode = decoded.charCodeAt(decoded.length - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
      decoded = decoded.slice(0, -1);
    }
  }

  return decoded + ellipsis;
}

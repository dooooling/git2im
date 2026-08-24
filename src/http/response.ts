/**
 * HTTP 统一响应与安全响应头辅助模块
 *
 * 核心规范：
 * 1. 成功响应统一格式：{ ok: true, data: ... }
 * 2. 失败响应统一格式：{ ok: false, error: { code: string, message: string } }
 * 3. 严格注入安全响应头 (Content-Security-Policy, X-Content-Type-Options, X-Frame-Options 等)
 */

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self';",
};

/**
 * 构建 JSON 成功响应
 */
export function jsonSuccess<T = any>(
  data: T,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      data,
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...SECURITY_HEADERS,
        ...extraHeaders,
      },
    }
  );
}

/**
 * 构建 JSON 错误响应
 */
export function jsonError(
  code: string,
  message: string,
  status = 400,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
      },
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...SECURITY_HEADERS,
        ...extraHeaders,
      },
    }
  );
}

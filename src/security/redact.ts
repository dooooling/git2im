/**
 * 敏感信息脱敏模块 (Secret Redaction & Sanitization)
 *
 * 保证所有对外输出的日志、错误摘要 (error_summary) 与配置导出中，绝不泄漏：
 * 1. 飞书 / 钉钉 / 企业微信 Webhook Token
 * 2. 飞书 App Secret / Tenant Access Token
 * 3. GitHub Webhook Secret
 * 4. Authorization / Bearer 请求头
 * 5. Master Key 与 Admin Password
 */

/**
 * 脱敏文本或 URL 中的敏感凭证与 Token
 *
 * @param input 原始文本或 URL
 * @returns 已脱敏的安全字符串
 */
export function redactSecrets(input: string): string {
  if (!input || typeof input !== "string") return "";

  let result = input;

  // 1. 脱敏飞书 Webhook Token: /open-apis/bot/v2/hook/<token>
  result = result.replace(
    /(open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/)([a-zA-Z0-9_-]+)/gi,
    "$1[REDACTED]"
  );

  // 2. 脱敏钉钉 Webhook Access Token: access_token=<token>
  result = result.replace(
    /(access_token=)([a-zA-Z0-9_-]+)/gi,
    "$1[REDACTED]"
  );

  // 3. 脱敏企业微信 Webhook Key: key=<token>
  result = result.replace(
    /(qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?[^ \n\r]*key=)([a-zA-Z0-9_-]+)/gi,
    "$1[REDACTED]"
  );
  result = result.replace(
    /([?&]key=)([a-zA-Z0-9_-]{10,})/gi,
    "$1[REDACTED]"
  );

  // 4. 脱敏 Bearer / Token 头部与字段
  result = result.replace(
    /(Bearer\s+)[a-zA-Z0-9_.\-]+/gi,
    "$1[REDACTED]"
  );

  // 5. 脱敏 JSON 键值中的凭证
  result = result.replace(
    /("?(?:app_secret|secret|tenant_access_token|password|master_key)"?\s*[:=]\s*"?[a-zA-Z0-9_./+\-=]{6,}"?)/gi,
    '"secret":"[REDACTED]"'
  );

  return result;
}

/**
 * 将任意捕获的错误对象安全转换为脱敏后的错误摘要简述
 *
 * @param error 捕获的异常对象
 * @param maxLength 最大摘要长度（默认 250 字符）
 * @returns 脱敏后的单行错误摘要
 */
export function sanitizeErrorSummary(error: unknown, maxLength = 250): string {
  let message = "Unknown error";

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (error && typeof error === "object") {
    try {
      message = JSON.stringify(error);
    } catch {
      message = String(error);
    }
  }

  // 执行脱敏
  const sanitized = redactSecrets(message).trim();

  // 截断超长内容
  if (sanitized.length > maxLength) {
    return sanitized.substring(0, maxLength - 3) + "...";
  }

  return sanitized;
}

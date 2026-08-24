/**
 * GitHub Webhook 请求头解析与请求体保护模块
 *
 * 核心规范：
 * 1. 提取并校验 X-GitHub-Delivery, X-GitHub-Event, X-Hub-Signature-256。
 * 2. 限制 Webhook Body 最大为 1 MiB (1024 * 1024 字节)，防止超大恶意 Payload 耗尽内存。
 */

export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024; // 1 MiB

export interface GithubWebhookHeaders {
  deliveryId: string;
  eventType: string;
  signature: string | null;
  contentType: string;
  userAgent: string | null;
}

/**
 * 从 Request 对象中提取并解析 GitHub Webhook 必要请求头
 */
export function parseGithubWebhookHeaders(request: Request): GithubWebhookHeaders | null {
  const deliveryId = request.headers.get("X-GitHub-Delivery");
  const eventType = request.headers.get("X-GitHub-Event");
  const signature = request.headers.get("X-Hub-Signature-256");
  const contentType = request.headers.get("Content-Type") || "";
  const userAgent = request.headers.get("User-Agent");

  if (!deliveryId || !eventType) {
    return null;
  }

  return {
    deliveryId: deliveryId.trim(),
    eventType: eventType.trim().toLowerCase(),
    signature: signature ? signature.trim() : null,
    contentType: contentType.trim().toLowerCase(),
    userAgent: userAgent ? userAgent.trim() : null,
  };
}

/**
 * 带有字节上限保护地读取 Request Body
 *
 * @param request 标准 HTTP Request
 * @param maxBytes 最大允许字节数（默认 1 MiB）
 * @returns 包含 bodyBytes、bodyText 及是否超限标志的对象
 */
export async function readBodyLimited(
  request: Request,
  maxBytes = MAX_WEBHOOK_BODY_BYTES
): Promise<{
  bodyBytes: Uint8Array;
  bodyText: string;
  exceeded: boolean;
}> {
  // 1. 若明确提供了 Content-Length 且已超限，直接拦截
  const contentLengthHeader = request.headers.get("Content-Length");
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!isNaN(contentLength) && contentLength > maxBytes) {
      return {
        bodyBytes: new Uint8Array(0),
        bodyText: "",
        exceeded: true,
      };
    }
  }

  // 2. 读取 Body ArrayBuffer
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    return {
      bodyBytes: new Uint8Array(0),
      bodyText: "",
      exceeded: true,
    };
  }

  const bodyBytes = new Uint8Array(buffer);
  const decoder = new TextDecoder("utf-8");
  const bodyText = decoder.decode(bodyBytes);

  return {
    bodyBytes,
    bodyText,
    exceeded: false,
  };
}

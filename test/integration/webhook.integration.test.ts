import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import worker from "../../src/index";
import { applyTestMigrations, clearTestDatabase } from "../helpers/db";
import { rotateGithubWebhookSecret } from "../../src/security/secret-store";
import { createTarget } from "../../src/config/targets";
import { createRoute } from "../../src/config/routes";
import { calculateHmacSha256Hex } from "../../src/github/signature";

describe("Integration: GitHub Webhook Full Flow", () => {
  const masterKey = "k8x+N3Z9nLq1sR7uV2wY5zB8cD0eF3gH6jK9mP2rT5v=";

  beforeEach(async () => {
    await applyTestMigrations();
    await clearTestDatabase();
    vi.restoreAllMocks();
  });

  it("should process push webhook, route to targets and record deliveries in D1", async () => {
    // 1. 设置 GitHub Webhook Secret
    const { newSecret: githubSecret } = await rotateGithubWebhookSecret(env.DB, masterKey);

    // 2. 创建 2 个 Target (飞书与钉钉)
    const target1 = await createTarget(env.DB, masterKey, {
      name: "Feishu Prod",
      type: "feishu_webhook",
      webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/abc-123-valid",
    });

    const target2 = await createTarget(env.DB, masterKey, {
      name: "DingTalk Prod",
      type: "dingtalk_webhook",
      webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=token-123",
    });

    // 3. 创建路由规则
    await createRoute(env.DB, {
      name: "All Push to Prod",
      repository: "antigravity/git2im",
      eventType: "push",
      conditions: { branch: "main" },
      targetIds: [target1.id, target2.id],
      enabled: true,
      priority: 10,
    });

    // 4. Mock 下游 IM 发送成功
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ code: 0, errcode: 0, msg: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    // 5. 构造 GitHub Push Webhook 请求
    const deliveryId = "github-delivery-uuid-999";
    const payloadObj = {
      ref: "refs/heads/main",
      before: "0000000",
      after: "1111111",
      repository: {
        full_name: "antigravity/git2im",
        html_url: "https://github.com/antigravity/git2im",
        name: "git2im",
      },
      sender: { login: "talon" },
      commits: [{ id: "1111111", message: "feat: full integration test", url: "https://..." }],
      head_commit: { id: "1111111", message: "feat: full integration test", url: "https://..." },
    };

    const rawBody = new TextEncoder().encode(JSON.stringify(payloadObj));
    const signatureHex = await calculateHmacSha256Hex(githubSecret, rawBody);

    const request = new Request("https://gateway.example.com/webhooks/github", {
      method: "POST",
      headers: {
        "X-GitHub-Delivery": deliveryId,
        "X-GitHub-Event": "push",
        "X-Hub-Signature-256": `sha256=${signatureHex}`,
        "Content-Type": "application/json",
      },
      body: rawBody,
    });

    // 6. 执行 Worker 处理
    const response = await worker.fetch(request, env, {} as ExecutionContext);
    expect(response.status).toBe(200);

    const resJson = (await response.json()) as any;
    expect(resJson.ok).toBe(true);
    expect(resJson.data.status).toBe("processed");
    expect(resJson.data.deliveredTargets).toBe(2);

    // 验证下游 fetch 调用了 2 次
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // 验证 D1 中 events 与 deliveries 数据
    const eventRow = await env.DB.prepare(`SELECT * FROM events WHERE id = ?`)
      .bind(deliveryId)
      .first<{ status: string; matched_route_count: number }>();

    expect(eventRow?.status).toBe("processed");
    expect(eventRow?.matched_route_count).toBe(1);

    const deliveries = await env.DB.prepare(`SELECT * FROM deliveries WHERE event_id = ?`)
      .bind(deliveryId)
      .all<{ status: string; target_name: string }>();

    expect(deliveries.results.length).toBe(2);
    expect(deliveries.results.every((d) => d.status === "success")).toBe(true);

    // 7. 测试原子幂等：相同 Delivery ID 再次请求时应直接返回 duplicate: true
    const dupRequest = new Request("https://gateway.example.com/webhooks/github", {
      method: "POST",
      headers: {
        "X-GitHub-Delivery": deliveryId,
        "X-GitHub-Event": "push",
        "X-Hub-Signature-256": `sha256=${signatureHex}`,
        "Content-Type": "application/json",
      },
      body: rawBody,
    });

    const dupResponse = await worker.fetch(dupRequest, env, {} as ExecutionContext);
    expect(dupResponse.status).toBe(200);
    const dupJson = (await dupResponse.json()) as any;
    expect(dupJson.data.duplicate).toBe(true);

    // 下游 fetch 次数仍应为 2 (未发起重复调用)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("should respond to Ping event with pong", async () => {
    const deliveryId = "ping-deliv-001";
    const payload = JSON.stringify({ zen: "Responsive is better than fast.", hook_id: 123 });

    const request = new Request("https://gateway.example.com/webhooks/github", {
      method: "POST",
      headers: {
        "X-GitHub-Delivery": deliveryId,
        "X-GitHub-Event": "ping",
        "Content-Type": "application/json",
      },
      body: payload,
    });

    const response = await worker.fetch(request, env, {} as ExecutionContext);
    expect(response.status).toBe(200);
    const json = (await response.json()) as any;
    expect(json.data.message).toBe("pong");
  });
});

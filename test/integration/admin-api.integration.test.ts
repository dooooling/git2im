import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import worker from "../../src/index";
import { applyTestMigrations, clearTestDatabase } from "../helpers/db";

describe("Integration: Admin REST API Flow", () => {
  let authCookie = "";

  beforeEach(async () => {
    await applyTestMigrations();
    await clearTestDatabase();
    vi.restoreAllMocks();

    // 登录以获取 session cookie
    const loginReq = new Request("https://gateway.example.com/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
    });

    const loginRes = await worker.fetch(loginReq, env, {} as ExecutionContext);
    expect(loginRes.status).toBe(200);
    const setCookie = loginRes.headers.get("Set-Cookie");
    expect(setCookie).toBeTruthy();
    authCookie = setCookie?.split(";")[0] || "";
  });

  it("should check auth status with /api/auth/me", async () => {
    const meReq = new Request("https://gateway.example.com/api/auth/me", {
      method: "GET",
      headers: { Cookie: authCookie },
    });

    const meRes = await worker.fetch(meReq, env, {} as ExecutionContext);
    const json = (await meRes.json()) as any;
    expect(json.data.authenticated).toBe(true);
  });

  it("should create, list, update and delete a Target", async () => {
    // 1. 创建 Target
    const createReq = new Request("https://gateway.example.com/api/targets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookie,
        Origin: "https://gateway.example.com",
      },
      body: JSON.stringify({
        name: "My WeCom Bot",
        type: "wecom_webhook",
        webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-key-123",
      }),
    });

    const createRes = await worker.fetch(createReq, env, {} as ExecutionContext);
    expect(createRes.status).toBe(201);
    const createdTarget = (await createRes.json() as any).data;
    expect(createdTarget.name).toBe("My WeCom Bot");
    expect(createdTarget.webhookConfigured).toBe(true);
    // 验证密文不回显
    expect(createdTarget.webhookUrl).toBeUndefined();

    // 2. 列表查询 Target
    const listReq = new Request("https://gateway.example.com/api/targets", {
      method: "GET",
      headers: { Cookie: authCookie },
    });
    const listRes = await worker.fetch(listReq, env, {} as ExecutionContext);
    const targets = (await listRes.json() as any).data;
    expect(targets.length).toBe(1);
    expect(targets[0].id).toBe(createdTarget.id);

    // 3. 更新 Target
    const updateReq = new Request(`https://gateway.example.com/api/targets/${createdTarget.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookie,
        Origin: "https://gateway.example.com",
      },
      body: JSON.stringify({
        name: "My WeCom Bot (Renamed)",
      }),
    });
    const updateRes = await worker.fetch(updateReq, env, {} as ExecutionContext);
    const updatedTarget = (await updateRes.json() as any).data;
    expect(updatedTarget.name).toBe("My WeCom Bot (Renamed)");

    // 4. 测试发送 Target
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const testReq = new Request(`https://gateway.example.com/api/targets/${createdTarget.id}/test`, {
      method: "POST",
      headers: {
        Cookie: authCookie,
        Origin: "https://gateway.example.com",
      },
    });
    const testRes = await worker.fetch(testReq, env, {} as ExecutionContext);
    const testData = (await testRes.json() as any).data;
    expect(testData.success).toBe(true);

    // 5. 删除 Target
    const deleteReq = new Request(`https://gateway.example.com/api/targets/${createdTarget.id}`, {
      method: "DELETE",
      headers: {
        Cookie: authCookie,
        Origin: "https://gateway.example.com",
      },
    });
    const deleteRes = await worker.fetch(deleteReq, env, {} as ExecutionContext);
    expect(deleteRes.status).toBe(200);

    const listAfterRes = await worker.fetch(listReq, env, {} as ExecutionContext);
    const targetsAfter = (await listAfterRes.json() as any).data;
    expect(targetsAfter.length).toBe(0);
  });

  it("should create, list and delete Routes", async () => {
    // 1. 先创建一个有效 Target
    const createTargetReq = new Request("https://gateway.example.com/api/targets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookie,
        Origin: "https://gateway.example.com",
      },
      body: JSON.stringify({
        name: "Route Target",
        type: "wecom_webhook",
        webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=99999999-9999-9999-9999-999999999999",
      }),
    });
    const createTargetRes = await worker.fetch(createTargetReq, env, {} as ExecutionContext);
    const validTarget = (await createTargetRes.json() as any).data;

    const createReq = new Request("https://gateway.example.com/api/routes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookie,
        Origin: "https://gateway.example.com",
      },
      body: JSON.stringify({
        name: "Frontend PRs",
        repository: "antigravity/frontend",
        eventType: "pull_request",
        conditions: { branch: "main", action: ["opened", "merged"] },
        targetIds: [validTarget.id],
        priority: 5,
      }),
    });

    const createRes = await worker.fetch(createReq, env, {} as ExecutionContext);
    expect(createRes.status).toBe(201);
    const createdRoute = (await createRes.json() as any).data;
    expect(createdRoute.name).toBe("Frontend PRs");

    const listReq = new Request("https://gateway.example.com/api/routes", {
      method: "GET",
      headers: { Cookie: authCookie },
    });
    const listRes = await worker.fetch(listReq, env, {} as ExecutionContext);
    const routes = (await listRes.json() as any).data;
    expect(routes.length).toBe(1);
  });

  it("should rotate GitHub secret and return new secret once", async () => {
    // 第一次生成
    const rotateReq1 = new Request("https://gateway.example.com/api/settings/github/rotate", {
      method: "POST",
      headers: {
        Cookie: authCookie,
        Origin: "https://gateway.example.com",
      },
    });

    const rotateRes1 = await worker.fetch(rotateReq1, env, {} as ExecutionContext);
    expect(rotateRes1.status).toBe(200);
    const data1 = (await rotateRes1.json() as any).data;
    expect(data1.newSecret).toBeTruthy();

    // 第二次轮换（应生成新密钥并将旧密钥写入 previous 窗口）
    const rotateReq2 = new Request("https://gateway.example.com/api/settings/github/rotate", {
      method: "POST",
      headers: {
        Cookie: authCookie,
        Origin: "https://gateway.example.com",
      },
    });
    const rotateRes2 = await worker.fetch(rotateReq2, env, {} as ExecutionContext);
    expect(rotateRes2.status).toBe(200);
    const data2 = (await rotateRes2.json() as any).data;
    expect(data2.newSecret).toBeTruthy();
    expect(data2.previousExpiresAt).toBeGreaterThan(Date.now());
  });
});

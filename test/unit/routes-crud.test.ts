import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyTestMigrations, clearTestDatabase } from "../helpers/db";
import {
  createRoute,
  updateRoute,
  deleteRoute,
  listRoutes,
} from "../../src/config/routes";
import { createTarget } from "../../src/config/targets";

describe("Config: Routes CRUD & Uniqueness", () => {
  const testMasterKey = "k8x+N3Z9nLq1sR7uV2wY5zB8cD0eF3gH6jK9mP2rT5v=";
  let targetId1: string;
  let targetId2: string;

  beforeEach(async () => {
    await applyTestMigrations();
    await clearTestDatabase();

    const t1 = await createTarget(env.DB, testMasterKey, {
      name: "Target 1",
      type: "wecom_webhook",
      webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=11111111-1111-1111-1111-111111111111",
    });
    targetId1 = t1.id;

    const t2 = await createTarget(env.DB, testMasterKey, {
      name: "Target 2",
      type: "dingtalk_webhook",
      webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=22222222222222222222222222222222",
    });
    targetId2 = t2.id;
  });

  it("should create route and list routes", async () => {
    const route = await createRoute(env.DB, {
      name: "Main Push Alert",
      repository: "antigravity/git2im",
      eventType: "push",
      conditions: { branch: "main" },
      targetIds: [targetId1],
      priority: 10,
    });

    expect(route.id).toBeTruthy();
    expect(route.name).toBe("Main Push Alert");
    expect(route.repository).toBe("antigravity/git2im");

    const list = await listRoutes(env.DB);
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe(route.id);
  });

  it("should reject duplicate route names", async () => {
    await createRoute(env.DB, {
      name: "PR Rule",
      repository: "antigravity/git2im",
      eventType: "pull_request",
      targetIds: [targetId1],
    });

    await expect(
      createRoute(env.DB, {
        name: "PR Rule",
        repository: "antigravity/frontend",
        eventType: "pull_request",
        targetIds: [targetId2],
      })
    ).rejects.toThrow(/already exists/);
  });

  it("should reject duplicate route conditions and targets (Content Uniqueness)", async () => {
    await createRoute(env.DB, {
      name: "Rule A",
      repository: "antigravity/git2im",
      eventType: "push",
      conditions: { branch: "main" },
      targetIds: [targetId1, targetId2],
    });

    // 即使 Target ID 顺序颠倒，只要规则条件与目标集合完全相同，即判定为重复规则
    await expect(
      createRoute(env.DB, {
        name: "Rule B",
        repository: "antigravity/git2im",
        eventType: "push",
        conditions: { branch: "main" },
        targetIds: [targetId2, targetId1],
      })
    ).rejects.toThrow(/identical conditions and targets/);
  });

  it("should update and delete route", async () => {
    const created = await createRoute(env.DB, {
      name: "Release Rule",
      repository: "*",
      eventType: "release",
      targetIds: [targetId1],
    });

    const updated = await updateRoute(env.DB, created.id, {
      name: "Release Rule (Renamed)",
      targetIds: [targetId1, targetId2],
    });
    expect(updated.name).toBe("Release Rule (Renamed)");
    expect(updated.targetIds.length).toBe(2);

    await deleteRoute(env.DB, created.id);
    const list = await listRoutes(env.DB);
    expect(list.length).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import {
  matchRoute,
  resolveRoutes,
  type Route,
} from "../../src/notification/route-matcher";
import type { NormalizedGithubEvent } from "../../src/github/types";

describe("Notification: Route Matcher", () => {
  const baseEvent: NormalizedGithubEvent = {
    deliveryId: "deliv-route-1",
    type: "push",
    repository: "my-org/backend-service",
    repositoryUrl: "https://...",
    actor: "john",
    branch: "main",
    title: "Push to main",
    severity: "info",
    shouldNotify: true,
    metadata: { commitCount: 1 },
  };

  it("should match route by exact repository and event type", () => {
    const route: Route = {
      id: "r-1",
      name: "Main push",
      repository: "my-org/backend-service",
      eventType: "push",
      conditions: {},
      targetIds: ["t-1"],
      enabled: true,
      priority: 100,
    };

    expect(matchRoute(baseEvent, route)).toBe(true);
  });

  it("should match wildcard repository '*'", () => {
    const route: Route = {
      id: "r-2",
      name: "All repos",
      repository: "*",
      eventType: "push",
      conditions: {},
      targetIds: ["t-1"],
      enabled: true,
      priority: 100,
    };

    expect(matchRoute(baseEvent, route)).toBe(true);
  });

  it("should reject disabled routes", () => {
    const route: Route = {
      id: "r-disabled",
      name: "Disabled rule",
      repository: "*",
      eventType: "push",
      conditions: {},
      targetIds: ["t-1"],
      enabled: false,
      priority: 100,
    };

    expect(matchRoute(baseEvent, route)).toBe(false);
  });

  it("should match branch wildcard patterns (e.g. release/*)", () => {
    const releaseEvent: NormalizedGithubEvent = {
      ...baseEvent,
      branch: "release/v2.1",
    };

    const route: Route = {
      id: "r-release",
      name: "Release branch",
      repository: "*",
      eventType: "push",
      conditions: { branch: "release/*" },
      targetIds: ["t-1"],
      enabled: true,
      priority: 100,
    };

    expect(matchRoute(releaseEvent, route)).toBe(true);
    expect(matchRoute(baseEvent, route)).toBe(false); // "main" 不匹配 "release/*"
  });

  it("should match workflow_run conclusion condition", () => {
    const workflowEvent: NormalizedGithubEvent = {
      deliveryId: "deliv-wf",
      type: "workflow_run",
      repository: "my-org/backend-service",
      repositoryUrl: "https://...",
      actor: "ci",
      action: "completed",
      branch: "main",
      title: "Workflow CI: failure",
      severity: "error",
      shouldNotify: true,
      metadata: { workflowName: "CI", conclusion: "failure" },
    };

    const failRoute: Route = {
      id: "r-fail",
      name: "CI Failures",
      repository: "*",
      eventType: "workflow_run",
      conditions: { conclusion: ["failure", "cancelled"] },
      targetIds: ["t-dev-alert"],
      enabled: true,
      priority: 50,
    };

    expect(matchRoute(workflowEvent, failRoute)).toBe(true);
  });

  it("should deduplicate targets across multiple matched routes and observe priority", () => {
    const routes: Route[] = [
      {
        id: "r-1",
        name: "Low Priority All",
        repository: "*",
        eventType: "push",
        conditions: {},
        targetIds: ["target-A", "target-B"],
        enabled: true,
        priority: 100,
      },
      {
        id: "r-2",
        name: "High Priority Specific",
        repository: "my-org/backend-service",
        eventType: "push",
        conditions: {},
        targetIds: ["target-B", "target-C"],
        enabled: true,
        priority: 10,
      },
    ];

    const result = resolveRoutes(baseEvent, routes);
    expect(result.matchedRoutes.length).toBe(2);
    // 优先级 r-2 (priority 10) 优先于 r-1 (priority 100)
    expect(result.matchedRoutes[0]?.id).toBe("r-2");

    // 去重后结果应为 target-B, target-C, target-A
    expect(result.targetIds).toEqual(["target-B", "target-C", "target-A"]);
    expect(result.fanoutExceeded).toBe(false);
  });

  it("should detect when resolved target count exceeds MAX_RESOLVED_TARGETS_PER_EVENT limit", () => {
    const route: Route = {
      id: "r-large",
      name: "Too many targets",
      repository: "*",
      eventType: "push",
      conditions: {},
      targetIds: ["t1", "t2", "t3", "t4", "t5", "t6", "t7"], // 7 个目标 > 6 上限
      enabled: true,
      priority: 100,
    };

    const result = resolveRoutes(baseEvent, [route]);
    expect(result.targetIds.length).toBe(7);
    expect(result.fanoutExceeded).toBe(true);
  });
});

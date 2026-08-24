import { describe, it, expect } from "vitest";
import { buildNotification } from "../../src/notification/builder";
import type { NormalizedGithubEvent } from "../../src/github/types";

describe("Notification: NotificationBuilder", () => {
  it("should build structured push notification", () => {
    const event: NormalizedGithubEvent = {
      deliveryId: "deliv-1",
      type: "push",
      repository: "antigravity/gateway",
      repositoryUrl: "https://github.com/antigravity/gateway",
      actor: "alex",
      action: "pushed",
      branch: "main",
      title: "Push to main",
      summary: "feat: add rate limiting",
      url: "https://github.com/antigravity/gateway/compare/1...2",
      severity: "info",
      shouldNotify: true,
      metadata: {
        commitCount: 2,
        commitsSummary: JSON.stringify([
          { sha: "a1b2c3d", message: "feat: add rate limiting" },
          { sha: "e4f5g6h", message: "test: add limiter tests" },
        ]),
      },
    };

    const notif = buildNotification(event);
    expect(notif.title).toBe("Push to main");
    expect(notif.level).toBe("info");
    expect(notif.eventLabel).toBe("Push");
    expect(notif.repository).toBe("antigravity/gateway");

    const branchField = notif.fields.find((f) => f.label === "Branch");
    expect(branchField?.value).toBe("main");

    expect(notif.description).toContain("• `a1b2c3d` feat: add rate limiting");
    expect(notif.action?.text).toBe("View Changes");
  });

  it("should build structured pull request notification", () => {
    const event: NormalizedGithubEvent = {
      deliveryId: "deliv-2",
      type: "pull_request",
      repository: "antigravity/gateway",
      repositoryUrl: "https://...",
      actor: "bob",
      action: "merged",
      branch: "main",
      title: "PR #55 merged: Support WeCom bot",
      summary: "Support WeCom bot",
      url: "https://github.com/antigravity/gateway/pull/55",
      severity: "success",
      shouldNotify: true,
      metadata: {
        prNumber: 55,
        baseBranch: "main",
        headBranch: "feat/wecom",
        merged: true,
      },
    };

    const notif = buildNotification(event);
    expect(notif.eventLabel).toBe("Pull Request");
    expect(notif.level).toBe("success");
    const branchField = notif.fields.find((f) => f.label === "Branch");
    expect(branchField?.value).toBe("feat/wecom → main");
    const statusField = notif.fields.find((f) => f.label === "Status");
    expect(statusField?.value).toBe("MERGED");
  });

  it("should build structured workflow run notification", () => {
    const event: NormalizedGithubEvent = {
      deliveryId: "deliv-3",
      type: "workflow_run",
      repository: "antigravity/gateway",
      repositoryUrl: "https://...",
      actor: "ci-bot",
      action: "completed",
      branch: "release/v1.0",
      title: "Workflow Build & Deploy #88: failure",
      summary: "Workflow 'Build & Deploy' on branch 'release/v1.0' failure",
      url: "https://github.com/antigravity/gateway/actions/runs/88",
      severity: "error",
      shouldNotify: true,
      metadata: {
        workflowName: "Build & Deploy",
        runNumber: 88,
        conclusion: "failure",
      },
    };

    const notif = buildNotification(event);
    expect(notif.eventLabel).toBe("Workflow Run");
    expect(notif.level).toBe("error");
    const workflowField = notif.fields.find((f) => f.label === "Workflow");
    expect(workflowField?.value).toBe("Build & Deploy #88");
    const conclusionField = notif.fields.find((f) => f.label === "Conclusion");
    expect(conclusionField?.value).toBe("FAILURE");
  });
});

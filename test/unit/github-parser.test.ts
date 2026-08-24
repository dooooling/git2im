import { describe, it, expect } from "vitest";
import { parseGithubEvent } from "../../src/github/parser";

describe("GitHub: Webhook Event Normalization", () => {
  const deliveryId = "delivery-test-12345";

  describe("Push Events", () => {
    it("should parse push event with branch and commit summaries", () => {
      const payload = {
        ref: "refs/heads/feature/new-ui",
        before: "0000000",
        after: "a1b2c3d4e5f6",
        created: false,
        deleted: false,
        forced: false,
        compare: "https://github.com/owner/repo/compare/0000...a1b2",
        commits: [
          { id: "a1b2c3d4e5f6", message: "feat: add shiny button\n\nDetails here", url: "https://...", author: { name: "Alice" } },
          { id: "b2c3d4e5f6a1", message: "fix: update colors", url: "https://...", author: { name: "Bob" } },
        ],
        head_commit: {
          id: "b2c3d4e5f6a1",
          message: "fix: update colors",
          url: "https://...",
          author: { name: "Bob" },
        },
        repository: {
          full_name: "owner/repo",
          html_url: "https://github.com/owner/repo",
          name: "repo",
        },
        sender: {
          login: "alice_dev",
        },
      };

      const event = parseGithubEvent(deliveryId, "push", payload);
      expect(event).toBeTruthy();
      expect(event?.type).toBe("push");
      expect(event?.branch).toBe("feature/new-ui");
      expect(event?.repository).toBe("owner/repo");
      expect(event?.actor).toBe("alice_dev");
      expect(event?.title).toBe("Push to feature/new-ui");
      expect(event?.summary).toBe("fix: update colors");
      expect(event?.severity).toBe("info");
      expect(event?.shouldNotify).toBe(true);
      expect(event?.metadata.commitCount).toBe(2);
    });

    it("should mark force push with warning severity", () => {
      const payload = {
        ref: "refs/heads/main",
        before: "1111111",
        after: "2222222",
        forced: true,
        created: false,
        deleted: false,
        compare: "https://...",
        repository: { full_name: "owner/repo", html_url: "https://...", name: "repo" },
        sender: { login: "admin" },
      };

      const event = parseGithubEvent(deliveryId, "push", payload);
      expect(event?.title).toBe("Force-pushed to main");
      expect(event?.severity).toBe("warning");
    });
  });

  describe("Pull Request Events", () => {
    it("should parse opened PR event", () => {
      const payload = {
        action: "opened",
        number: 42,
        pull_request: {
          number: 42,
          title: "Refactor router module",
          body: "This PR improves routing performance",
          html_url: "https://github.com/owner/repo/pull/42",
          state: "open",
          merged: false,
          head: { ref: "feature/router", sha: "123456" },
          base: { ref: "main", sha: "654321" },
          user: { login: "john_doe" },
        },
        repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
        sender: { login: "john_doe" },
      };

      const event = parseGithubEvent(deliveryId, "pull_request", payload);
      expect(event?.type).toBe("pull_request");
      expect(event?.action).toBe("opened");
      expect(event?.branch).toBe("main");
      expect(event?.title).toBe("PR #42 opened: Refactor router module");
      expect(event?.severity).toBe("info");
      expect(event?.shouldNotify).toBe(true);
    });

    it("should parse merged PR event with success severity", () => {
      const payload = {
        action: "closed",
        number: 42,
        pull_request: {
          number: 42,
          title: "Refactor router module",
          body: "Merged!",
          html_url: "https://github.com/owner/repo/pull/42",
          state: "closed",
          merged: true,
          head: { ref: "feature/router", sha: "123456" },
          base: { ref: "main", sha: "654321" },
          user: { login: "john_doe" },
        },
        repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
        sender: { login: "repo_maintainer" },
      };

      const event = parseGithubEvent(deliveryId, "pull_request", payload);
      expect(event?.action).toBe("merged");
      expect(event?.severity).toBe("success");
      expect(event?.title).toBe("PR #42 merged: Refactor router module");
    });
  });

  describe("Workflow Run Events", () => {
    it("should notify on completed workflow failure", () => {
      const payload = {
        action: "completed",
        workflow_run: {
          id: 998877,
          name: "CI / Test Suite",
          head_branch: "main",
          head_sha: "abcdef123456789",
          run_number: 108,
          event: "push",
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/owner/repo/actions/runs/998877",
          actor: { login: "ci-bot" },
        },
        repository: { full_name: "owner/repo", html_url: "https://github.com/owner/repo" },
        sender: { login: "ci-bot" },
      };

      const event = parseGithubEvent(deliveryId, "workflow_run", payload);
      expect(event?.shouldNotify).toBe(true);
      expect(event?.severity).toBe("error");
      expect(event?.title).toBe("Workflow CI / Test Suite #108: failure");
      expect(event?.metadata.conclusion).toBe("failure");
    });

    it("should NOT notify on in_progress / requested actions", () => {
      const payload = {
        action: "in_progress",
        workflow_run: {
          id: 998877,
          name: "CI / Test Suite",
          head_branch: "main",
          head_sha: "abcdef123",
          run_number: 108,
          event: "push",
          status: "in_progress",
          conclusion: null,
          html_url: "https://...",
          actor: { login: "ci-bot" },
        },
        repository: { full_name: "owner/repo", html_url: "https://..." },
        sender: { login: "ci-bot" },
      };

      const event = parseGithubEvent(deliveryId, "workflow_run", payload);
      expect(event?.shouldNotify).toBe(false);
    });
  });

  describe("Release and Ping Events", () => {
    it("should parse release published event", () => {
      const payload = {
        action: "published",
        release: {
          tag_name: "v1.0.0",
          target_commitish: "main",
          name: "Initial Production Release",
          draft: false,
          prerelease: false,
          html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
          body: "Highlights:\n- Full IM support",
          author: { login: "release-manager" },
        },
        repository: { full_name: "owner/repo", html_url: "https://..." },
        sender: { login: "release-manager" },
      };

      const event = parseGithubEvent(deliveryId, "release", payload);
      expect(event?.type).toBe("release");
      expect(event?.severity).toBe("success");
      expect(event?.title).toBe("Release v1.0.0: Initial Production Release");
      expect(event?.shouldNotify).toBe(true);
    });

    it("should parse ping event with shouldNotify: false", () => {
      const payload = {
        zen: "Mind your words, they become actions.",
        hook_id: 12345,
        repository: { full_name: "owner/repo", html_url: "https://..." },
        sender: { login: "github" },
      };

      const event = parseGithubEvent(deliveryId, "ping", payload);
      expect(event?.type).toBe("ping");
      expect(event?.shouldNotify).toBe(false);
    });

    it("should return null for unsupported events", () => {
      const event = parseGithubEvent(deliveryId, "watch", { action: "started" });
      expect(event).toBeNull();
    });
  });
});

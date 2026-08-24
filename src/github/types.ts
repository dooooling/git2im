/**
 * GitHub Webhook 与事件标准化领域类型定义
 */

export type GithubEventType =
  | "push"
  | "pull_request"
  | "workflow_run"
  | "release"
  | "ping";

export type Severity = "info" | "success" | "warning" | "error";

/**
 * 平台无关的标准化 GitHub 事件对象
 */
export interface NormalizedGithubEvent {
  /** GitHub Delivery ID (X-GitHub-Delivery Header) */
  deliveryId: string;

  /** 事件大类 ('push' | 'pull_request' | 'workflow_run' | 'release' | 'ping') */
  type: GithubEventType;

  /** 仓库全名 ('owner/repo') */
  repository: string;

  /** 仓库主页链接 */
  repositoryUrl: string;

  /** 触发者用户名 (GitHub username) */
  actor: string;

  /** 事件子动作（如 PR 'opened' / 'closed' / 'synchronize', Release 'published'） */
  action?: string;

  /** 关联分支名（已去除 'refs/heads/' 前缀） */
  branch?: string;

  /** 标准化卡片标题（如 "Push to main", "PR #12 opened"） */
  title: string;

  /** 事件摘要描述（如 Commit 消息、PR 标题、Release 简要） */
  summary?: string;

  /** 详情跳转链接 (Compare URL, PR URL, Action Run URL, Release URL) */
  url?: string;

  /** 视觉告警级别 */
  severity: Severity;

  /** 是否应进入下游通知路由（ping 或非 completed 的 workflow_run 为 false） */
  shouldNotify: boolean;

  /** 渲染所需少量核心元数据键值 */
  metadata: Record<string, string | number | boolean | null>;
}

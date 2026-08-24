/**
 * Workflow Run (GitHub Actions) 事件标准化解析模块
 *
 * 核心规范：
 * 1. 只有 action === "completed" 的 workflow_run 才触发下游通知 (shouldNotify = true)。
 * 2. requested / in_progress 阶段不发通知 (shouldNotify = false)，避免事件频繁打扰。
 */

import type { NormalizedGithubEvent, Severity } from "../types";

export interface WorkflowRunEventPayload {
  action: string; // 'requested' | 'in_progress' | 'completed'
  workflow_run: {
    id: number;
    name: string;
    head_branch: string;
    head_sha: string;
    run_number: number;
    event: string;
    status: string; // 'completed' | 'in_progress' | 'queued'
    conclusion: string | null; // 'success' | 'failure' | 'cancelled' | 'timed_out' | null
    html_url: string;
    actor: {
      login: string;
    };
  };
  repository: {
    full_name: string;
    html_url: string;
  };
  sender: {
    login: string;
  };
}

export function parseWorkflowRunEvent(
  deliveryId: string,
  payload: WorkflowRunEventPayload
): NormalizedGithubEvent {
  const run = payload.workflow_run;
  const repository = payload.repository.full_name;
  const repositoryUrl = payload.repository.html_url;
  const actor = payload.sender?.login || run.actor.login || "unknown";

  const isCompleted = payload.action === "completed";
  const conclusion = run.conclusion ? run.conclusion.toLowerCase() : null;

  let severity: Severity = "info";
  if (conclusion === "success") {
    severity = "success";
  } else if (conclusion === "failure" || conclusion === "timed_out") {
    severity = "error";
  } else if (conclusion === "cancelled") {
    severity = "warning";
  }

  const resultLabel = conclusion || payload.action;
  const title = `Workflow ${run.name} #${run.run_number}: ${resultLabel}`;
  const summary = `Workflow '${run.name}' on branch '${run.head_branch}' ${resultLabel}`;

  return {
    deliveryId,
    type: "workflow_run",
    repository,
    repositoryUrl,
    actor,
    action: payload.action,
    branch: run.head_branch,
    title,
    summary,
    url: run.html_url,
    severity,
    shouldNotify: isCompleted, // 只有 completed 才真正发通知
    metadata: {
      workflowName: run.name,
      runNumber: run.run_number,
      headBranch: run.head_branch,
      headSha: run.head_sha.substring(0, 7),
      conclusion,
      eventTrigger: run.event,
    },
  };
}

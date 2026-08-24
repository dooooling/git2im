/**
 * 平台无关的通知消息模型类型定义
 *
 * 核心规范：
 * 1. Notification 只描述结构化业务语义，不包含任何飞书/钉钉/企微特定字段。
 * 2. 跨平台渲染全部交由 channels/* 各平台适配器完成。
 */

import type { Severity } from "../github/types";

export interface NotificationField {
  label: string;
  value: string;
}

export interface NotificationAction {
  text: string;
  url: string;
}

export interface Notification {
  /** 消息标题 (如 "Push to main", "PR #12 opened: Add API") */
  title: string;

  /** 视觉告警级别 ('info' | 'success' | 'warning' | 'error') */
  level: Severity;

  /** 仓库全名 ('owner/repo') */
  repository: string;

  /** 事件大类标签 ('Push' | 'Pull Request' | 'Workflow Run' | 'Release') */
  eventLabel: string;

  /** 关键键值字段列表 (如 分支、触发者、Commit 数、运行结果等) */
  fields: NotificationField[];

  /** 可选正文补充描述 (如 Commit 列表简述、PR 描述第一段等) */
  description?: string;

  /** 可选跳转主按钮 (如 "View Commit", "View PR", "View Actions") */
  action?: NotificationAction;
}

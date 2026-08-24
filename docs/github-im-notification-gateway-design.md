# GitHub → IM Notification Gateway 完整设计与开发实施方案

> 文档状态：Implementation Baseline / 可直接进入开发  
> 版本：v1.4 Implementation Baseline  
> 日期：2026-08-24  
> 目标平台：Cloudflare Workers  
> 主要语言：TypeScript  
> 核心目标：GitHub Webhook → 事件标准化 → 路由 → 飞书 / 钉钉 / 企业微信通知通道  
> 设计关键词：克制、易用、稳定、安全、可靠、高性能、可扩展、低维护
> 本版本目标：冻结影响实现一致性的关键合同；不新增基础设施、不扩大 V1 产品范围。
> V1 Provider：飞书（Webhook + App）、钉钉（Webhook）、企业微信（Webhook）
> 非目标：个人微信、钉钉 App、企业微信 App、多租户、RBAC、审计平台

---

## 目录

1. [项目定位](#1-项目定位)
2. [设计原则](#2-设计原则)
3. [V1 范围与非目标](#3-v1-范围与非目标)
4. [总体架构](#4-总体架构)
5. [技术选型](#5-技术选型)
6. [运行拓扑与请求流程](#6-运行拓扑与请求流程)
7. [项目目录设计](#7-项目目录设计)
8. [核心领域模型](#8-核心领域模型)
9. [GitHub Webhook 接入设计](#9-github-webhook-接入设计)
10. [事件标准化设计](#10-事件标准化设计)
11. [路由规则设计](#11-路由规则设计)
12. [消息模型与跨平台渲染设计](#12-消息模型与跨平台渲染设计)
13. [通知通道抽象设计](#13-通知通道抽象设计)
14. [平台适配器实现规范](#14-平台适配器实现规范)
15. [配置管理与 Secret 设计](#15-配置管理与-secret-设计)
16. [管理页面设计](#16-管理页面设计)
17. [D1 数据模型与迁移](#17-d1-数据模型与迁移)
18. [HTTP API 设计](#18-http-api-设计)
19. [事件统计与成功失败分析](#19-事件统计与成功失败分析)
20. [可靠性、幂等与错误处理](#20-可靠性幂等与错误处理)
21. [安全设计](#21-安全设计)
22. [日志与可观测性](#22-日志与可观测性)
23. [测试与质量保证方案](#23-测试与质量保证方案)
24. [本地开发与部署](#24-本地开发与部署)
25. [开发阶段与任务拆分](#25-开发阶段与任务拆分)
26. [验收标准与 Production Release Gate](#26-验收标准与-production-release-gate)
27. [后续扩展边界](#27-后续扩展边界)
28. [风险与取舍](#28-风险与取舍)
29. [官方参考资料](#29-官方参考资料)

---

# 1. 项目定位

## 1.1 项目解决的问题

本项目是一个面向国内团队的轻量 GitHub 事件通知网关：

```text
GitHub
  │
  │ Webhook
  ▼
Cloudflare Worker
  │
  ├─ 验签
  ├─ 事件解析
  ├─ 标准化
  ├─ 路由匹配
  ├─ 消息构建
  │
  └──────────── NotificationChannel ────────────┐
                                                 │
                  ┌──────────────────────────────┼──────────────────────┐
                  ▼                              ▼                      ▼
               飞书                           钉钉                   企业微信
          ┌───────┴───────┐                     │                      │
          ▼               ▼                     ▼                      ▼
      Webhook Bot      Feishu App          Webhook Bot            Webhook Bot
```

项目不承担 GitHub 的业务逻辑，不做 CI/CD 编排，不做代理，不做通用 Webhook 转发，也不做个人微信协议适配。

它只做四件事：

```text
Receive
  ↓
Normalize
  ↓
Route
  ↓
Send
```

## 1.2 产品目标

V1 必须做到：

- GitHub Webhook 一次配置即可长期使用。
- 同时支持以下 4 个通知通道：
  - 飞书自定义机器人 Webhook。
  - 飞书企业自建应用。
  - 钉钉自定义机器人 Webhook。
  - 企业微信群机器人 Webhook。
- 用户通过页面配置目标和路由，不需要频繁改代码。
- 同一个 GitHub 事件可以同时投递到不同 IM 平台。
- 页面可以查看事件量、投递成功率、按平台/通道成功率、失败原因和最近失败。
- Secret 不以明文形式存入代码仓库或普通配置导出。
- GitHub 原始 Payload 不长期存储。
- 项目部署结构简单，单 Worker 即可运行。
- 后续能够增加 DingTalk App、WeCom App 或新的 IM Provider，但 V1 不为所有未来能力提前建设复杂平台。

## 1.3 产品边界

本项目定位为：

> GitHub Notification Gateway for China IM

不是：

- IM 聚合聊天客户端。
- 通用消息总线。
- Webhook SaaS 平台。
- 开放代理。
- 个人微信机器人。
- 多租户通知平台。

# 2. 设计原则

## 2.1 克制优先

任何新增基础设施必须回答：

> 当前需求是否真正需要它？

V1 明确不引入：

- KV
- Queues
- R2
- Durable Objects
- Analytics Engine
- Redis
- 外部数据库
- 消息中间件
- ORM
- 工作流引擎
- 插件系统
- 多租户系统
- RBAC
- 审计平台
- 日志平台
- SaaS 计费

V1 使用：

```text
Cloudflare Workers
+ D1
+ Workers Static Assets
+ Workers Logs
+ Rate Limiting Binding
```

## 2.2 配置优先于代码修改

普通配置应通过 UI 完成：

- 通知目标（飞书 / 钉钉 / 企业微信）
- 路由规则
- GitHub Webhook Secret
- 飞书应用凭据
- 启停规则
- 测试发送

只有以下启动级 Secret 需要通过 Cloudflare Secret 初始化一次：

- `ADMIN_PASSWORD`
- `MASTER_KEY`

部署完成后，日常配置原则上无需重新部署 Worker。

## 2.3 核心领域与外部平台解耦

GitHub 原始 Payload 不进入发送层。

任何 IM 平台的消息格式都不进入 GitHub 解析层。

核心结构：

```text
GitHub Payload
    ↓
GithubEvent
    ↓
Notification
    ↓
Channel Adapter
```

## 2.4 失败可观察，但不过度持久化

系统记录：

- 哪个仓库
- 什么事件
- 哪个通道
- 是否成功
- HTTP 状态
- 错误代码
- 简短错误摘要
- 耗时

系统不记录：

- 完整 GitHub Payload
- 完整第三方 IM 请求体
- App Secret
- Webhook URL
- Token
- Authorization Header
- 完整 Commit Diff

---

# 3. V1 范围与非目标

## 3.1 GitHub 事件

V1 正式支持：

| Event | 用途 |
|---|---|
| `push` | 分支代码提交 |
| `pull_request` | PR 创建、更新、关闭、合并 |
| `workflow_run` | GitHub Actions 运行结果 |
| `release` | Release 发布 |
| `ping` | GitHub Webhook 连通性测试 |

其他事件：

- 验签成功后返回 `200`。
- 标记为 unsupported / ignored。
- 不发送通知。
- 后续按统一事件注册机制扩展。

## 3.2 通知输出

V1 正式支持 4 个 Channel Type：

| Channel Type | Provider | 方式 | V1 |
|---|---|---|---:|
| `feishu_webhook` | 飞书 | 自定义机器人 Webhook | ✅ |
| `feishu_app` | 飞书 | 企业自建应用 OpenAPI | ✅ |
| `dingtalk_webhook` | 钉钉 | 自定义机器人 Webhook | ✅ |
| `wecom_webhook` | 企业微信 | 群机器人 Webhook | ✅ |

### A. Feishu Webhook Bot

适合：开发群、运维群、Release 群、普通广播。

### B. Feishu App

V1 采用：

- 一个企业自建应用连接。
- 多个 App 目标。
- 目标支持 `chat_id` 和 `open_id`。

适合：指定群、指定用户、重要失败提醒。

### C. DingTalk Webhook Bot

适合：研发群、制造/企业内部群、项目通知、CI/CD 告警。

V1 使用 Markdown 消息作为默认渲染格式；机器人加签 Secret 可选配置。

### D. WeCom Webhook Bot

适合：企业微信群、项目群、告警群。

V1 使用 Markdown 消息作为默认渲染格式，并按 UTF-8 字节数做保守裁剪。

## 3.3 V1 明确不做

- 钉钉企业应用发送。
- 企业微信自建应用发送。
- 飞书事件订阅。
- @机器人对话。
- 卡片按钮回调。
- 从 IM 平台操作 GitHub。
- 双向 DevOps 控制。
- 个人微信 Hook、逆向协议、PC Hook、非官方个人号机器人。
- Slack / Telegram / Discord 等海外 Provider。

这些能力只有在真实需求出现后才增加。

## 3.4 管理能力

V1 有配置页面，但不是“后台平台”。

页面只有：

1. Overview
2. Targets
3. Routes
4. Settings

不做：

- 用户管理
- 角色
- RBAC
- 审计日志
- 组织结构
- 多租户
- 消息全文历史
- BI 报表
- 工作流画布

# 4. 总体架构

```text
                      ┌─────────────────────────────┐
                      │          GitHub             │
                      │ push / PR / workflow /      │
                      │ release / ping              │
                      └──────────────┬──────────────┘
                                     │
                                     │ HTTPS POST
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Cloudflare Worker                             │
│                                                                     │
│  POST /webhooks/github                                              │
│           │                                                         │
│           ▼                                                         │
│  Body Size Guard                                                    │
│           │                                                         │
│           ▼                                                         │
│  HMAC-SHA256 Signature Verification                                 │
│           │                                                         │
│           ▼                                                         │
│  GitHub Event Parser                                                │
│           │                                                         │
│           ▼                                                         │
│  Normalized GithubEvent                                             │
│           │                                                         │
│           ▼                                                         │
│  Route Matcher                                                      │
│           │                                                         │
│           ▼                                                         │
│  Provider-neutral Notification                                      │
│           │                                                         │
│           ▼                                                         │
│  NotificationChannel Registry                                       │
│     │                │                 │                 │           │
│     ▼                ▼                 ▼                 ▼           │
│ FeishuWebhook   FeishuApp       DingTalkWebhook      WeComWebhook    │
│     │                │                 │                 │           │
│     └────────────────┴─────────────────┴─────────────────┘           │
│                              │                                      │
│                              ▼                                      │
│                       Delivery Result                               │
│                              │                                      │
│                              ▼                                      │
│                             D1                                      │
│              config + event + delivery summary                      │
│                                                                     │
│  Workers Static Assets                                              │
│       └─ Config / Overview UI                                       │
└─────────────────────────────────────────────────────────────────────┘
       │                 │                    │                 │
       ▼                 ▼                    ▼                 ▼
    飞书 Bot          飞书 OpenAPI          钉钉 Bot          企业微信 Bot
```

关键约束：

- GitHub 解析层不知道任何 IM 平台 JSON。
- Router 不知道平台 API。
- `Notification` 不包含飞书/钉钉/企微专有字段。
- 每个平台仅负责“渲染 + 发送 + 响应映射”。
- 新增 Provider 不得修改 GitHub Parser 和 Route Matcher 的核心逻辑。

# 5. 技术选型

## 5.1 后端

- TypeScript
- Cloudflare Workers ES Modules
- Web Standards API
- `fetch`
- Web Crypto API
- D1 Binding
- Workers Static Assets
- Rate Limiting Binding

### 不引入运行时 Web 框架

V1 不使用：

- Hono
- Express
- NestJS
- Fastify

原因：

- API 数量有限。
- 路由逻辑简单。
- Cloudflare Worker 本身已经提供标准 Request/Response。
- 减少依赖和升级成本。

实现一个极小 Router 即可。

## 5.2 管理页面

采用：

- HTML
- CSS
- 原生 JavaScript ES Modules
- SVG 绘制趋势图

不使用：

- React
- Vue
- Angular
- 大型 UI Library
- Chart.js / ECharts

原因：

管理页面只有四个功能页，没有必要构建 SPA 框架体系。

## 5.3 数据与存储架构决策

### 5.3.1 V1 存储结论

V1 采用：

```text
Cloudflare D1
+ Cloudflare Secrets
+ Workers Logs
```

其中：

> **D1 是 V1 唯一业务数据 Source of Truth。**

不使用 KV、R2、Analytics Engine、Durable Objects、Queues 作为 V1 的业务数据源。它们只有在出现可量化的性能、规模或可靠性需求后才引入。

职责划分：

```text
Cloudflare D1
├─ Settings
├─ Targets
├─ Routes
├─ 加密后的业务 Secret
├─ GitHub Event 摘要
└─ Delivery 摘要

Cloudflare Secrets
├─ MASTER_KEY
└─ ADMIN_PASSWORD

Workers Logs
├─ Runtime exception
├─ 结构化运行日志
└─ 深度排错信息
```

D1 负责：

- Targets 普通配置。
- Routes。
- 非敏感 Settings。
- AES-256-GCM 加密后的业务 Secret。
- GitHub Event 摘要。
- Delivery 摘要。
- 24h / 7d / 30d 统计查询。
- `X-GitHub-Delivery` 幂等约束。

Workers Logs 负责：

- 详细错误排查。
- Runtime exception。
- 调试信息。

Workers Logs 不作为业务历史数据库，也不作为 Dashboard 的数据源。

### 5.3.2 为什么选择 D1

本项目的数据不是单纯的 `key -> value` 配置，而是结构化且互相关联的数据：

```text
Target ──────┐
             │
Route ───────┤
             │
Event ───────┤── Filter / Query / Aggregate
             │
Delivery ────┤
             │
Statistics ──┘
```

D1 的 SQL / SQLite 语义可以直接解决以下需求：

1. **配置 CRUD**：Targets、Routes、Settings 的增删改查。
2. **条件查询**：按 Repository、Event Type、Enabled 等条件读取匹配规则。
3. **幂等**：使用 `events.id PRIMARY KEY` 约束 GitHub `X-GitHub-Delivery`。
4. **运行记录**：Event 与 Delivery 使用结构化行记录，而不是大 JSON Blob。
5. **统计**：可以直接使用 `COUNT / SUM / GROUP BY / ORDER BY` 生成 Dashboard。
6. **索引**：可针对 `repository + event_type + enabled`、时间字段和状态字段建立索引。
7. **本地开发**：Migration、测试数据库和 Worker Binding 都属于同一套开发模型。

典型查询例如：

```sql
SELECT
  provider,
  COUNT(*) AS attempts,
  SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
FROM deliveries
WHERE source = 'github'
  AND created_at >= ?
GROUP BY provider;
```

如果使用 KV，实现同类统计就必须额外维护日期桶、Provider 计数器、Repository 索引和失败索引，反而会在应用层重新实现一套小型数据库。

### 5.3.3 为什么不使用 Workers KV 作为 Source of Truth

Workers KV 非常适合：

- 高读低写配置。
- 缓存。
- Allowlist。
- 用户偏好。
- TTL 数据。
- 对短时间旧值可容忍的数据。

但 V1 不把 KV 作为主存储，原因有三点。

#### A. 最终一致性不适合精确幂等

KV 的核心优势来自全球缓存，因此读取相对于写入是最终一致的。不同 Cloudflare 节点可能在一段时间内看到旧值。

如果使用：

```text
delivery:<X-GitHub-Delivery>
```

做幂等，典型流程可能变成：

```text
Request A -> KV.get(id) -> not found
Request B -> KV.get(id) -> not found
Request A -> KV.put(id)
Request B -> KV.put(id)
```

这不是本项目希望依赖的幂等语义。

D1 直接使用：

```sql
PRIMARY KEY (id)
```

由数据库唯一约束处理冲突，模型更自然。

#### B. Route / Target 查询不是纯 Key-Value

本项目需要：

```text
repository = owner/project
event_type = workflow_run
enabled = true
```

然后继续匹配 Conditions 和 Targets。

若使用 KV，则需要自行选择：

- 扫描 Key Prefix。
- 维护 Repository -> Route ID 的二级索引。
- 把所有 Route 塞进一个大 JSON。
- 或复制数据形成多个读取视图。

这些方案都会增加一致性和更新复杂度。

#### C. Dashboard 聚合不适合 KV

本项目需要按时间、Repository、Event、Provider、Channel、Status 聚合。D1 可以直接 SQL 查询；KV 则必须提前设计并维护多维计数器。

因此结论是：

> **KV 适合未来做配置缓存，不适合成为 V1 的业务 Source of Truth。**

### 5.3.4 为什么不同时使用 D1 + KV

V1 不采用：

```text
D1 = Source of Truth
KV = Route / Target Cache
```

不是因为该架构不可行，而是当前没有可量化的性能瓶颈证明它有必要。

引入双存储以后必须解决：

```text
D1 写成功
    ↓
KV 更新失败怎么办？

Route 删除
    ↓
KV 什么时候失效？

D1 与 KV 数据版本不同
    ↓
Worker 应信任哪一个？
```

还会额外增加：

- Cache invalidation。
- 配置版本。
- 双写失败处理。
- 读路径降级。
- 测试矩阵。

对于 V1 的事件量和配置规模，这些复杂度没有收益。

只有在生产指标明确显示 **Route / Target 的 D1 读取已经成为可观测瓶颈** 后，才允许引入 KV 作为 read-through / compiled-config cache。D1 仍保持唯一 Source of Truth。

### 5.3.5 为什么不使用其他 Cloudflare 存储产品

| 产品 | 最适合的场景 | V1 是否使用 | 当前判断 |
|---|---|---:|---|
| **D1** | SQL、结构化关系、查询、聚合、CRUD | ✅ | 唯一业务 Source of Truth |
| **KV** | 全球高速 Key-Value 读取、缓存、TTL | ❌ | 未来可作为配置缓存 |
| **R2** | 文件、对象、大 Blob | ❌ | 当前没有附件或大文件 |
| **Analytics Engine** | 高吞吐 Metrics / Telemetry | ❌ | 当前 D1 30 天统计足够 |
| **Durable Objects** | 强一致协调、单实体状态机、串行化 | ❌ | 当前没有长生命周期协调对象 |
| **Queues** | 异步执行、可靠重试、削峰 | ❌ | V1 接受同步通知的可靠性取舍 |
| **Workers Logs** | 运行排错、异常、Trace | ✅ | 只做可观测性，不做业务存储 |

### 5.3.6 未来允许引入其他存储的量化触发条件

禁止仅因为“Cloudflare 有这个产品”而加入新基础设施。必须先有指标证明当前架构存在问题。

#### KV

仅当：

- Route / Target D1 读取成为明确热点。
- D1 读取延迟显著影响 Webhook 总耗时。
- 配置读远高于写，并且可以接受短暂缓存旧值。

升级形态：

```text
                 KV
                 │
           compiled config cache
                 │
Worker ───────────┤
                 │
                 ▼
                 D1
          Source of Truth
```

#### Analytics Engine

仅当：

- Event / Delivery 量级明显增大。
- D1 聚合统计成为可观测成本或性能瓶颈。
- 需要比 30 天更高吞吐、更高维的 Metrics 分析。

届时：

```text
D1
├─ Config
├─ Routes
├─ Targets
└─ Recent failures

Analytics Engine
└─ Metrics / Trend
```

#### Queues

仅当：

- 需要 Provider 自动重试。
- Webhook 处理需要快速 ACK。
- 下游平台延迟明显影响 GitHub 10 秒响应预算。
- 通知丢失风险已经不可接受。

#### Durable Objects

仅当出现必须串行化或需要实体级强一致状态的功能，例如：

- 精确全局 Provider Rate Limit。
- 某个 Target 的严格顺序投递。
- 长生命周期状态机。

#### R2

仅当未来需要保存：

- 大附件。
- 构建产物摘要文件。
- 图片。
- 大型导出文件。

### 5.3.7 数据生命周期与安全边界

持久数据分为两类：

#### 长期配置数据

```text
settings
targets
routes
secrets
```

正常情况下不按时间自动删除。

#### 短期运行数据

```text
events
deliveries
```

默认保留 30 天，由 Scheduled Handler 清理。

系统明确不长期保存：

- GitHub 完整 Webhook Payload。
- Commit Diff。
- 完整 IM 请求体。
- 完整 IM 响应体。
- Access Token。
- Authorization Header。

业务 Secret 使用 AES-256-GCM 加密后存 D1；`MASTER_KEY` 和 `ADMIN_PASSWORD` 使用 Cloudflare Secrets 保存，不进入 D1。

### 5.3.8 存储架构原则

开发阶段必须遵守以下原则：

> **D1 是 V1 唯一业务数据 Source of Truth。**

> **KV 只能在有量化性能证据时作为 Cache 引入，不能取代 D1 的真实配置源。**

> **Analytics Engine 只解决规模化 Metrics，不承担配置或幂等。**

> **Queues 解决异步与重试，不是数据库。**

> **R2 解决对象存储，不用于结构化业务数据。**

> **Workers Logs 用于排错，不作为产品功能依赖的持久数据源。**

## 5.4 测试

使用：

- Vitest
- `@cloudflare/vitest-plugin`
- Workers runtime 测试
- D1 本地迁移
- Outbound Fetch Mock

截至本方案日期，Cloudflare 官方已推荐新的 `@cloudflare/vitest-plugin` 作为 Workers Vitest 集成。

---

# 6. 运行拓扑与请求流程

## 6.1 GitHub 正常请求

```text
GitHub
  │
  │ POST /webhooks/github
  ▼
Worker
  │
  ├─ 1. Method 检查
  ├─ 2. Content-Type 检查
  ├─ 3. Payload 大小检查
  ├─ 4. 获取原始 Body
  ├─ 5. X-Hub-Signature-256 验签
  ├─ 6. JSON Parse
  ├─ 7. X-GitHub-Delivery 幂等检查
  ├─ 8. Event Normalize
  ├─ 9. Route Match
  ├─ 10. Target 去重
  ├─ 11. Notification Build
  ├─ 12. Channel Deliver
  ├─ 13. 保存结果
  │
  ▼
200 OK
```

## 6.2 为什么下游 IM 发送失败仍返回 GitHub 200

GitHub Webhook 是否成功与下游 IM 投递是否成功是两个不同状态。

如果：

```text
GitHub Event 已成功接收
↓
某个 IM Provider API 临时 500
```

如果 Worker 对 GitHub 返回 `500`：

```text
GitHub 可能重投
↓
导致已经成功的其他目标重复收到消息
```

因此规则：

### 返回非 2xx 的情况

仅限 GitHub 请求本身未被系统正确接收：

- Body 无效
- 签名无效
- D1 无法完成初始事件登记
- 关键内部错误发生在“接受事件”之前

### 返回 200 的情况

- 无匹配规则
- 不支持的 Event
- 某个通知目标失败
- 所有通知目标失败
- 重复 Delivery

下游失败由 Dashboard 展示，不通过 GitHub 重试解决。

---

# 7. 项目目录设计

```text
github-im-gateway/
├── src/
│   ├── index.ts
│   ├── env.ts
│   │
│   ├── http/
│   │   ├── router.ts
│   │   ├── response.ts
│   │   ├── body.ts
│   │   └── admin-auth.ts
│   │
│   ├── github/
│   │   ├── signature.ts
│   │   ├── headers.ts
│   │   ├── parser.ts
│   │   ├── types.ts
│   │   └── events/
│   │       ├── push.ts
│   │       ├── pull-request.ts
│   │       ├── workflow-run.ts
│   │       └── release.ts
│   │
│   ├── notification/
│   │   ├── types.ts
│   │   ├── builder.ts
│   │   ├── route-matcher.ts
│   │   └── truncate.ts
│   │
│   ├── channels/
│   │   ├── types.ts
│   │   ├── registry.ts
│   │   ├── feishu/
│   │   │   ├── webhook.ts
│   │   │   ├── app.ts
│   │   │   ├── render.ts
│   │   │   ├── webhook-signature.ts
│   │   │   └── app-token.ts
│   │   ├── dingtalk/
│   │   │   ├── webhook.ts
│   │   │   ├── render.ts
│   │   │   └── signature.ts
│   │   └── wecom/
│   │       ├── webhook.ts
│   │       └── render.ts
│   │
│   ├── config/
│   │   ├── targets.ts
│   │   ├── routes.ts
│   │   ├── settings.ts
│   │   └── validation.ts
│   │
│   ├── security/
│   │   ├── crypto.ts
│   │   ├── secret-store.ts
│   │   ├── session.ts
│   │   └── constant-time.ts
│   │
│   ├── storage/
│   │   ├── db.ts
│   │   ├── events.ts
│   │   ├── deliveries.ts
│   │   └── stats.ts
│   │
│   ├── api/
│   │   ├── auth.ts
│   │   ├── settings.ts
│   │   ├── targets.ts
│   │   ├── routes.ts
│   │   ├── stats.ts
│   │   └── export.ts
│   │
│   └── scheduled/
│       └── cleanup.ts
│
├── public/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── favicon.svg
│
├── migrations/
│   └── 0001_initial.sql
│
├── test/
│   ├── fixtures/
│   │   └── github/
│   │       ├── ping.json
│   │       ├── push-single.json
│   │       ├── push-multiple.json
│   │       ├── push-deleted.json
│   │       ├── pull-request-opened.json
│   │       ├── pull-request-merged.json
│   │       ├── workflow-success.json
│   │       ├── workflow-failure.json
│   │       ├── workflow-cancelled.json
│   │       └── release-published.json
│   ├── apply-migrations.ts
│   ├── unit/
│   │   ├── github-signature.test.ts
│   │   ├── github-parser.test.ts
│   │   ├── route-matcher.test.ts
│   │   ├── notification-builder.test.ts
│   │   ├── secret-store.test.ts
│   │   ├── feishu-webhook.test.ts
│   │   ├── feishu-app.test.ts
│   │   ├── dingtalk-webhook.test.ts
│   │   └── wecom-webhook.test.ts
│   ├── integration/
│   │   ├── webhook.integration.test.ts
│   │   ├── admin-api.integration.test.ts
│   │   ├── stats.integration.test.ts
│   │   └── migrations.integration.test.ts
│   └── helpers/
│       ├── github-signature.ts
│       ├── db.ts
│       └── outbound-mock.ts
│
├── scripts/
│   └── send-webhook.ts
│
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── wrangler.jsonc
├── vitest.config.ts
├── tsconfig.json
├── package.json
├── .dev.vars.example
├── .gitignore
└── README.md
```

目录禁止继续拆出多层 `domain/application/infrastructure`。

只有当某个平台适配器单文件明显超过约 400~500 行或具备多个独立 API 时，才继续拆分。

# 8. 核心领域模型

## 8.1 GitHubEvent

```ts
export type GithubEventType =
  | "push"
  | "pull_request"
  | "workflow_run"
  | "release";

export type Severity =
  | "info"
  | "success"
  | "warning"
  | "error";

export interface GithubEvent {
  deliveryId: string;
  type: GithubEventType;

  repository: string;
  repositoryUrl: string;

  actor: string;

  action?: string;
  branch?: string;

  title: string;
  summary?: string;
  url?: string;

  severity: Severity;

  metadata: Record<string, string | number | boolean | null>;
}
```

### 约束

`metadata` 只能放渲染真正需要的少量字段。

禁止把完整 Payload 放进：

```ts
metadata.payload = originalPayload;
```

## 8.2 Target

V1 使用“具体 Channel Type”而不是任意 `provider + mode` 组合，避免出现当前并不支持的无效组合。

```ts
export type ChannelType =
  | "feishu_webhook"
  | "feishu_app"
  | "dingtalk_webhook"
  | "wecom_webhook";

export type Provider =
  | "feishu"
  | "dingtalk"
  | "wecom";

export type Target =
  | FeishuWebhookTarget
  | FeishuAppTarget
  | DingTalkWebhookTarget
  | WeComWebhookTarget;

export interface TargetBase {
  id: string;
  name: string;
  enabled: boolean;
}

export interface FeishuWebhookTarget extends TargetBase {
  type: "feishu_webhook";
}

export interface FeishuAppTarget extends TargetBase {
  type: "feishu_app";
  receiveIdType: "chat_id" | "open_id";
  receiveId: string;
}

export interface DingTalkWebhookTarget extends TargetBase {
  type: "dingtalk_webhook";
}

export interface WeComWebhookTarget extends TargetBase {
  type: "wecom_webhook";
}
```

以下敏感信息不出现在普通 Target 数据中：

- 飞书机器人 Webhook URL / Sign Secret。
- 钉钉机器人 Webhook URL / Sign Secret。
- 企业微信群机器人 Webhook URL。
- 飞书 App Secret。

这些值统一从 `SecretStore` 获取。

Provider 通过 `channelTypeToProvider()` 确定，不接受前端随意提交：

```ts
function channelTypeToProvider(type: ChannelType): Provider {
  switch (type) {
    case "feishu_webhook":
    case "feishu_app":
      return "feishu";
    case "dingtalk_webhook":
      return "dingtalk";
    case "wecom_webhook":
      return "wecom";
  }
}
```

## 8.3 Route

```ts
export interface Route {
  id: string;
  name: string;
  enabled: boolean;

  repository: string;
  eventType: GithubEventType;

  conditions: RouteConditions;

  targetIds: string[];

  priority: number;
}
```

## 8.4 RouteConditions

```ts
export interface RouteConditions {
  branch?: string;
  action?: string[];
  conclusion?: string[];
  workflow?: string;
  merged?: boolean;
  prerelease?: boolean;
}
```

不是所有条件都对所有事件有效。

保存规则时由 `validation.ts` 按事件类型校验。

## 8.5 Notification

```ts
export interface Notification {
  title: string;
  level: Severity;

  repository: string;
  eventLabel: string;

  fields: Array<{
    label: string;
    value: string;
  }>;

  description?: string;

  action?: {
    text: string;
    url: string;
  };
}
```

Channel 只接收 Notification，不接收 GitHub Payload。

## 8.6 DeliveryResult

```ts
export interface DeliveryResult {
  targetId: string;
  provider: "feishu" | "dingtalk" | "wecom";
  channelType:
    | "feishu_webhook"
    | "feishu_app"
    | "dingtalk_webhook"
    | "wecom_webhook";

  success: boolean;

  httpStatus?: number;
  providerCode?: string;
  errorCode?: string;
  errorSummary?: string;

  durationMs: number;
}
```

所有 Adapter 必须返回统一 `DeliveryResult`，不得把平台原始响应对象传回业务层。


# 9. GitHub Webhook 接入设计

## 9.1 Endpoint

```http
POST /webhooks/github
```

## 9.2 必须读取的 Header

```text
X-GitHub-Event
X-GitHub-Delivery
X-Hub-Signature-256
Content-Type
User-Agent
```

其中：

- `X-GitHub-Delivery` 作为事件幂等 ID。
- `X-GitHub-Event` 作为事件类型。
- `X-Hub-Signature-256` 必须验证。

## 9.3 Body 大小

V1 自定义限制：

```text
1 MiB
```

实现：

```ts
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
```

不能只相信 `Content-Length`。

实现：

```ts
readBodyLimited(request, MAX_WEBHOOK_BODY_BYTES)
```

流式读取并在超过限制时立即停止。

## 9.4 GitHub HMAC 验签

GitHub 官方规则：

```text
X-Hub-Signature-256: sha256=<hex>
```

校验算法：

```text
expected =
  HMAC-SHA256(
    key = githubWebhookSecret,
    data = rawRequestBody
  )
```

必须：

- 对原始 Body 字节验签。
- 验签后才能信任 JSON。
- 使用常量时间比较。
- 不要重新 stringify JSON 后验签。

伪代码：

```ts
async function verifyGithubSignature(
  body: Uint8Array,
  signatureHeader: string,
  secret: string
): Promise<boolean> {
  if (!signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expected = await hmacSha256Hex(secret, body);
  const actual = signatureHeader.slice("sha256=".length);

  return timingSafeEqual(expected, actual);
}
```

## 9.5 GitHub Webhook Secret

V1 仍使用一个全局 GitHub Webhook Secret，不引入 per-repository Secret。

优点：

- UI 简单。
- 所有仓库配置一致。
- Worker 无需先识别仓库再选择 Secret。
- 不需要 Source 表。

管理页面支持：

```text
Generate
Rotate
Copy once
```

### 9.5.1 旋转策略

为了避免多个仓库逐个更新 Secret 时出现通知中断，V1 只增加一个非常小的“双 Secret 过渡窗口”，不建设复杂密钥版本系统。

存储方式：

```text
secrets:
  github_webhook_secret_current
  github_webhook_secret_previous   // 可选

settings:
  github_webhook_secret_previous_expires_at
```

Rotate 时：

```text
current → previous
生成新 current
previous_expires_at = now + 30 minutes
```

验签顺序：

```text
current
  ↓ fail
previous（仅未过期时）
```

30 分钟后旧 Secret 自动失效；Scheduled Cleanup 可删除过期 previous Secret。

约束：

- 同一时间最多接受 2 个 GitHub Webhook Secret。
- UI 只返回新 Secret 一次，不回显 current / previous 明文。
- 不允许无限保留历史 Secret。
- 该设计只解决安全轮换期间的短暂兼容，不是密钥版本管理平台。

---

# 10. 事件标准化设计

## 10.1 Push

映射：

```text
repository.full_name     → repository
repository.html_url      → repositoryUrl
sender.login             → actor
ref                      → branch
compare                   → url
commits.length            → metadata.commitCount
head_commit.message       → summary
```

`refs/heads/main`：

```text
main
```

标题：

```text
Push to main
```

消息内容最多展示：

- 3 个最近 Commit
- Commit SHA 前 7 位
- Commit message 第一行

禁止展示完整 Commit 列表。

## 10.2 Pull Request

支持 action：

```text
opened
reopened
synchronize
closed
```

额外识别：

```text
pull_request.merged
```

标准字段：

```text
PR #number
title
actor
head.ref
base.ref
html_url
merged
```

推荐 Severity：

| 情况 | Severity |
|---|---|
| opened | info |
| synchronize | info |
| merged | success |
| closed 未合并 | warning |

## 10.3 Workflow Run

核心字段：

```text
workflow_run.name
workflow_run.run_number
workflow_run.head_branch
workflow_run.conclusion
workflow_run.html_url
workflow_run.actor.login
```

Severity：

| Conclusion | Severity |
|---|---|
| success | success |
| failure | error |
| cancelled | warning |
| timed_out | error |
| 其他 | info |

UI Route 条件重点支持：

```text
workflow name
branch
conclusion
```

### V1 Workflow Run 通知语义

GitHub `workflow_run` Payload 可以出现 `requested`、`in_progress`、`completed` 等 action。

V1 明确规定：

> **只有 `action === "completed"` 的 workflow_run 才进入 Route Match 和通知发送。**

`requested` / `in_progress`：

- Parser 必须能够安全识别。
- Event 可记录为 `ignored`。
- 不进入通知路由。
- 不产生 Delivery。

这样避免一次 Workflow 因状态变化产生多次无意义通知。

## 10.4 Release

核心字段：

```text
release.tag_name
release.name
release.html_url
release.prerelease
release.draft
release.author.login
action
```

默认建议只配置：

```text
action = published
```

## 10.5 Ping

`ping` 不进入正常通知流程。

返回：

```json
{
  "ok": true,
  "message": "pong"
}
```

可在日志中记录一次 info。

---

# 11. 路由规则设计

## 11.1 核心原则

Router 不做通用表达式引擎。

不支持：

- JavaScript Expression
- JSONPath
- CEL
- AND/OR 树
- Regex DSL
- 自定义脚本

V1 规则就是：

```text
Repository
+
Event
+
少量 Event-specific Conditions
+
Targets
```

## 11.2 匹配规则

### Push

```text
repository
event=push
branch?
```

### Pull Request

```text
repository
event=pull_request
action?
branch?      // base branch
merged?
```

### Workflow Run

```text
repository
event=workflow_run
workflow?
branch?
conclusion?
```

### Release

```text
repository
event=release
action?
prerelease?
```

## 11.3 多条规则同时命中

允许。

例如：

```text
Rule A:
workflow_run + failure → dev-bot

Rule B:
workflow_run + failure → owner-app
```

最终：

```text
targets = union(A.targets, B.targets)
```

同一事件、同一 Target 最多发送一次。

## 11.4 Priority

Route 有：

```text
priority
```

V1 只用于 UI 排序和确定性匹配顺序。

不会实现：

```text
stop propagation
```

## 11.5 没有匹配规则

事件：

```text
status = ignored
```

不属于失败。

## 11.6 V1 路由与 Fan-out 上限

为了保证同步发送仍能稳定满足 GitHub Webhook 的响应时间预算，V1 设置一个明确、简单的上限：

```ts
const MAX_RESOLVED_TARGETS_PER_EVENT = 6;
```

规则：

- 单条 Route 最多选择 6 个 Target。
- 多条 Route 合并并去重后，最终 Target 仍不得超过 6 个。
- UI 保存 Route 时进行前置校验。
- Runtime 在发送前再次校验，防止脏数据绕过 UI。
- 超过上限时不静默截断，事件标记为 `internal_error`，不进行部分发送，并在页面给出 `TARGET_FANOUT_LIMIT_EXCEEDED`。

该限制与 `Provider Concurrency = 3`、`Single Provider Timeout = 3s` 配合，最坏常规发送为两批，给 D1、解析和响应预留足够时间。

如果未来确实需要单事件通知超过 6 个目标，应优先升级 Queue 异步架构，而不是继续扩大同步 fan-out。

---

# 12. 消息模型与跨平台渲染设计

## 12.1 一套 Notification，多套 Renderer

```text
GithubEvent
   ↓
Notification
   │
   ├─ renderFeishu()
   ├─ renderDingTalk()
   └─ renderWeCom()
```

`NotificationBuilder` 不知道最终平台。

平台差异只存在于 Renderer / Adapter 中。

V1 默认消息形态：

| Channel | 默认消息类型 |
|---|---|
| Feishu Webhook | interactive card |
| Feishu App | interactive card |
| DingTalk Webhook | markdown |
| WeCom Webhook | markdown |

选择 Markdown 作为钉钉和企微 V1 默认输出，是为了降低模板复杂度和平台差异。以后确有需求，再分别增加 DingTalk ActionCard / 企业微信 Template Card。

## 12.2 Push 内容

```text
🚀 Push

Repository
owner/project

Branch
main

Actor
talon

Commits
3 commits

Latest
a82f312 fix: modbus parser

View changes: <GitHub URL>
```

## 12.3 PR 内容

```text
🔀 Pull Request

owner/project

#128 Add Modbus driver

feature/modbus → main

Actor
talon

Status
MERGED

View Pull Request: <GitHub URL>
```

## 12.4 Workflow 内容

```text
❌ Workflow Failed

owner/project / main

Workflow
CI #938

Conclusion
failure

Actor
talon

View GitHub Actions: <GitHub URL>
```

## 12.5 Release 内容

```text
🚀 Release Published

owner/project

v1.4.2
Gateway v1.4.2

Actor
talon

View Release: <GitHub URL>
```

## 12.6 跨平台内容约束

`Notification` 只描述语义：

```ts
export interface Notification {
  title: string;
  level: Severity;
  repository: string;
  eventLabel: string;
  fields: Array<{ label: string; value: string }>;
  description?: string;
  action?: { text: string; url: string };
}
```

禁止在 `Notification` 中出现：

```text
msg_type
msgtype
interactive
markdown.content
openConversationId
webhook key
```

## 12.7 消息大小保护

平台限制不同，不使用一个假的“通用最大值”。

采用两层保护：

### 第一层：业务内容裁剪

统一限制：

```ts
const MAX_COMMITS = 3;
const MAX_DESCRIPTION_CHARS = 1200;
const MAX_FIELD_VALUE_CHARS = 500;
```

### 第二层：Provider Payload Guard

每个 Renderer 自己按 UTF-8 Byte Size 校验最终 Payload。

V1 建议内部上限：

```ts
const INTERNAL_LIMITS = {
  feishu_webhook: 16 * 1024,
  feishu_app: 16 * 1024,
  dingtalk_webhook: 12 * 1024,
  wecom_webhook_markdown: 3 * 1024
};
```

这些是项目内部的保守阈值，不等价于平台官方最大值。

特别是企业微信群机器人 Markdown 官方文档长期采用 4096 UTF-8 字节上限，因此内部采用 3 KiB，给链接、Markdown 标记和未来字段留余量。

超限时按顺序裁剪：

1. Commit 列表。
2. description。
3. 次要 fields。
4. 最终只保留核心字段和 GitHub 链接。

永远保留：

- Repository。
- Event / 状态。
- GitHub URL。

# 13. 通知通道抽象设计

## 13.1 NotificationChannel

所有通知 Provider 必须实现相同接口：

```ts
export interface NotificationChannel<T extends Target = Target> {
  readonly type: T["type"];

  send(
    env: Env,
    target: T,
    notification: Notification
  ): Promise<DeliveryResult>;

  test(
    env: Env,
    target: T
  ): Promise<DeliveryResult>;
}
```

禁止业务代码：

```ts
if (target.type === "feishu_webhook") { ... }
else if (...) { ... }
```

统一通过 Registry：

```ts
const channel = channelRegistry.get(target.type);
return channel.send(env, target, notification);
```

## 13.2 Registry

V1 注册：

```ts
const channelRegistry = new Map<ChannelType, NotificationChannel>([
  ["feishu_webhook", feishuWebhookChannel],
  ["feishu_app", feishuAppChannel],
  ["dingtalk_webhook", dingTalkWebhookChannel],
  ["wecom_webhook", weComWebhookChannel]
]);
```

如果某个类型没有注册：

```text
CHANNEL_NOT_SUPPORTED
```

属于配置/程序错误，不尝试动态加载插件。

## 13.3 Channel 的职责

每个 Channel 只负责：

1. 读取自身配置和 Secret。
2. 将 `Notification` 渲染为平台 Payload。
3. 发起外部 HTTP 请求。
4. 解析 HTTP / 业务响应。
5. 映射为统一 `DeliveryResult`。

不负责：

- GitHub 事件解析。
- Route Match。
- D1 Event 状态管理。
- Dashboard 统计。
- 业务重试编排。

## 13.4 Deadline 与 Timeout

V1 不允许每个 Adapter 各自独立计算完整 3 秒后再无限叠加，而是使用“请求总 Deadline + 单次 Provider Timeout”双层保护。

固定保护线：

```ts
const WEBHOOK_HARD_BUDGET_MS = 8_000;
const PROVIDER_TIMEOUT_MS = 3_000;
const PROVIDER_CONCURRENCY = 3;
```

Webhook 入口创建：

```ts
const deadlineAt = Date.now() + WEBHOOK_HARD_BUDGET_MS;
```

每次 Provider Call 使用：

```text
effectiveTimeout = min(
  PROVIDER_TIMEOUT_MS,
  deadlineAt - now - responseReserve
)
```

约束：

- `responseReserve` 至少保留 500ms 给 D1 最终写入与 HTTP Response。
- 若剩余时间不足，不再启动新的外部请求。
- 未启动的 Target 记录失败：`PROVIDER_DEADLINE_EXCEEDED`。
- 已启动请求由 AbortController / AbortSignal 取消。
- Adapter 只接收剩余预算，不自行放大 Timeout。
- GitHub Webhook Handler 正常目标仍是 8 秒内完成返回。

统一通过 `fetchWithDeadline()` 实现，不要每个 Adapter 复制 timeout/deadline 代码。

---

# 14. 平台适配器实现规范

## 14.1 飞书自定义机器人 Webhook

### Target

```json
{
  "id": "dev-feishu",
  "name": "飞书开发群",
  "type": "feishu_webhook",
  "enabled": true
}
```

Secret：

```json
{
  "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/...",
  "signSecret": "..."
}
```

`signSecret` 可选，但 UI 推荐启用。

### Wire Contract

Endpoint 只能来自经过校验的 Target Secret：

```text
POST https://open.feishu.cn/open-apis/bot/v2/hook/<token>
Content-Type: application/json; charset=utf-8
redirect: error
```

V1 使用交互式卡片：

```json
{
  "msg_type": "interactive",
  "card": { "...": "provider-rendered card" }
}
```

启用 Sign Secret 时，在 Body 中增加：

```json
{
  "timestamp": 1234567890,
  "sign": "base64-signature"
}
```

签名合同：

```text
timestamp = Unix seconds
stringToSign = timestamp + "\n" + secret
sign = Base64(HMAC-SHA256(key = UTF8(stringToSign), data = empty bytes))
```

实现必须使用 Web Crypto / 标准 HMAC，不允许自己拼接非标准哈希。

成功判定：

- HTTP 必须为 2xx。
- 新版响应若存在 `code`，必须 `code === 0`。
- 兼容旧格式若存在 `StatusCode`，必须 `StatusCode === 0`。
- HTTP 2xx 但业务 code 非 0 仍属于失败。

错误码：

```text
FEISHU_WEBHOOK_CONFIG_ERROR
FEISHU_WEBHOOK_TIMEOUT
FEISHU_WEBHOOK_HTTP_ERROR
FEISHU_WEBHOOK_API_ERROR
FEISHU_WEBHOOK_INVALID_RESPONSE
```

## 14.2 飞书企业自建应用

V1 只配置一个飞书企业自建应用：

```text
App ID
App Secret
```

多个 Target 共享该 App：

```text
App
 ├─ 开发群 chat_id
 ├─ 运维群 chat_id
 ├─ 负责人 open_id
 └─ 发布负责人 open_id
```

App Target：

```json
{
  "id": "feishu-owner",
  "name": "负责人",
  "type": "feishu_app",
  "receiveIdType": "open_id",
  "receiveId": "ou_xxx",
  "enabled": true
}
```

### Wire Contract

Token Endpoint 固定，不允许配置：

```text
POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
Content-Type: application/json; charset=utf-8
redirect: error
```

Body：

```json
{
  "app_id": "cli_xxx",
  "app_secret": "..."
}
```

Token 成功必须满足：

```text
HTTP 2xx
AND code == 0（若响应包含 code）
AND tenant_access_token 非空
```

发送 Endpoint 固定：

```text
POST https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=<chat_id|open_id>
Authorization: Bearer <tenant_access_token>
Content-Type: application/json; charset=utf-8
redirect: error
```

V1 发送 Body：

```json
{
  "receive_id": "oc_xxx-or-ou_xxx",
  "msg_type": "interactive",
  "content": "{...JSON.stringify(cardPayload)...}"
}
```

注意：Feishu App 的 `content` 是卡片 JSON 序列化后的字符串，而 Feishu Webhook Bot 使用的是 `card` 对象；两个 Adapter 不得共用 wire payload。

V1 仅开放：

```text
chat_id
open_id
```

应用要求：

- 开启机器人能力。
- 申请发送消息所需的 `im:message` 权限。
- 应用版本已发布并在目标租户/可用范围内生效。

发送成功必须满足 HTTP 2xx 且飞书业务 `code === 0`。

Token Cache 使用 Worker isolate 内存：

```ts
let tokenCache:
  | { token: string; expiresAt: number }
  | undefined;
```

冷启动重新获取 Token 可接受，不为此引入 KV。

错误码：

```text
FEISHU_APP_NOT_CONFIGURED
FEISHU_APP_TOKEN_ERROR
FEISHU_APP_TIMEOUT
FEISHU_APP_HTTP_ERROR
FEISHU_APP_API_ERROR
FEISHU_APP_INVALID_RESPONSE
```

## 14.3 钉钉自定义机器人 Webhook

### Target

```json
{
  "id": "dev-dingtalk",
  "name": "钉钉研发群",
  "type": "dingtalk_webhook",
  "enabled": true
}
```

Secret：

```json
{
  "webhookUrl": "https://oapi.dingtalk.com/robot/send?access_token=...",
  "signSecret": "SEC..."
}
```

`signSecret` 可选；如果机器人启用“加签”安全设置则必填。

### Wire Contract

Endpoint 必须通过 Provider URL 校验后使用：

```text
POST https://oapi.dingtalk.com/robot/send?access_token=<token>[&timestamp=...&sign=...]
Content-Type: application/json; charset=utf-8
redirect: error
```

启用加签时：

```text
timestamp = Unix milliseconds
stringToSign = timestamp + "\n" + secret
signatureBytes = HMAC-SHA256(key = secret, data = stringToSign)
sign = URL-encode(Base64(signatureBytes))
```

`timestamp` 与 `sign` 使用 URL Query 参数发送；不得放入消息 Body。

V1 默认发送 Markdown：

```json
{
  "msgtype": "markdown",
  "markdown": {
    "title": "CI Failed",
    "text": "..."
  }
}
```

Renderer 负责把 `Notification.action.url` 追加为明确的 Markdown 链接。

成功判定：

```text
HTTP 2xx
AND errcode === 0
```

HTTP 2xx 但 `errcode != 0` 必须映射为 Provider API Error。

错误码：

```text
DINGTALK_WEBHOOK_CONFIG_ERROR
DINGTALK_WEBHOOK_TIMEOUT
DINGTALK_WEBHOOK_HTTP_ERROR
DINGTALK_WEBHOOK_API_ERROR
DINGTALK_WEBHOOK_INVALID_RESPONSE
```

V1 不实现：

- Stream 模式机器人。
- 企业应用机器人。
- 互动卡片回调。
- ActionCard 专属模板。

## 14.4 企业微信群机器人 Webhook

### Target

```json
{
  "id": "ops-wecom",
  "name": "企业微信告警群",
  "type": "wecom_webhook",
  "enabled": true
}
```

Secret：

```json
{
  "webhookUrl": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
}
```

Webhook URL 本身视为 Secret。

### Wire Contract

Endpoint 必须通过 Provider URL 校验后使用：

```text
POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<key>
Content-Type: application/json; charset=utf-8
redirect: error
```

V1 默认发送 Markdown：

```json
{
  "msgtype": "markdown",
  "markdown": {
    "content": "..."
  }
}
```

企业微信 Markdown 支持的是有限语法子集，因此 Renderer 只使用：

- 标题。
- 加粗。
- 链接。
- 引用。
- 官方支持的少量字体颜色（可选）。

不要输出 Markdown 表格或复杂 HTML。

成功判定：

```text
HTTP 2xx
AND errcode === 0
```

HTTP 2xx 但 `errcode != 0` 必须记录为 Provider API Error。

错误码：

```text
WECOM_WEBHOOK_CONFIG_ERROR
WECOM_WEBHOOK_TIMEOUT
WECOM_WEBHOOK_HTTP_ERROR
WECOM_WEBHOOK_API_ERROR
WECOM_WEBHOOK_INVALID_RESPONSE
```

## 14.5 测试发送

所有 Target 都必须支持：

```http
POST /api/targets/:id/test
```

测试消息统一语义：

```text
✅ Test Notification

Provider: <provider>
Target: <target name>
Time: <current time>

GitHub IM Gateway is configured correctly.
```

Adapter 自己渲染。

测试发送也写入 `deliveries`，但增加：

```text
source = test
```

如果不希望测试污染核心统计，Dashboard 默认统计 `source = github`，Test Delivery 仅在 Target 页面显示最近一次测试结果。

# 15. 配置管理与 Secret 设计

## 15.1 两类配置

### 普通配置

放 D1 明文：

- Target name。
- Target type。
- Feishu App `receiveId`。
- Route。
- Repository。
- Event。
- Conditions。
- Feishu App ID。
- enabled。

### Secret

加密后放 D1：

- GitHub Webhook Secret。
- Feishu App Secret。
- Feishu Webhook URL。
- Feishu Webhook Sign Secret。
- DingTalk Webhook URL。
- DingTalk Sign Secret。
- WeCom Webhook URL。

## 15.2 为什么所有 Webhook URL 都按 Secret 处理

飞书、钉钉、企业微信机器人的 Webhook URL 都携带可直接发送消息的凭证信息。

因此不能：

- 出现在日志。
- 出现在普通配置导出。
- 出现在错误正文。
- 长期返回给前端。
- 写入 README 示例的真实值。

## 15.3 Master Key

Cloudflare Secret：

```text
MASTER_KEY
```

要求：

- 32 字节随机值。
- Base64 存储。
- 只设置一次。
- 不进入 D1。
- 不进入 Git。
- 不通过 UI 修改。
- 必须在团队认可的安全位置离线备份一次。

恢复边界：

> 如果 `MASTER_KEY` 丢失，D1 中已加密的 Webhook URL / App Secret 无法恢复明文，只能重新配置这些业务 Secret。

V1 不实现在线 Master Key Rotation；这属于低频运维操作，未来确需轮换时使用专门 migration/maintenance 流程，不把复杂密钥管理系统带入 V1。

生成：

```text
openssl rand -base64 32
```

然后：

```text
npx wrangler secret put MASTER_KEY
```

## 15.4 AES-GCM

SecretStore：

```text
plaintext
   ↓
AES-256-GCM
   ↓
ciphertext + iv
   ↓
D1
```

表中保存：

```text
ciphertext
iv
version
```

Associated Data：

```text
scope + ":" + scope_id + ":" + name
```

## 15.5 Secret 命名

推荐：

```text
global / github / webhook_secret_current
global / github / webhook_secret_previous
global / feishu_app / app_secret

target / <target-id> / webhook_url
target / <target-id> / sign_secret
```

同一套 `webhook_url` / `sign_secret` 命名即可覆盖不同 Provider，具体 Provider 从 Target Type 判断。

## 15.6 Secret 读取策略

API 返回 Target 时，只能返回：

```json
{
  "webhookConfigured": true,
  "signSecretConfigured": true
}
```

不能返回原值。

更新普通 Provider Secret：

```text
传新值
↓
加密
↓
覆盖
```

GitHub Webhook Secret 是例外：Rotate 使用 `current + previous + expires_at` 过渡模型；Webhook 请求读取 `getAcceptedGithubSecrets()`，最多返回两个候选 Secret。

如果前端传：

```text
null
```

表示“不修改”。

显式删除使用：

```text
clearSecret=true
```

## 15.7 D1 原子写入边界

以下操作在业务语义上必须“全成或全败”，统一使用 `env.DB.batch()` 事务批次：

- 创建 Target + 写入对应 Secret。
- 更新 Target + 更新/删除 Secret。
- 删除未被 Route 使用的 Target + 清理对应 Secret。
- Config Import 的 replace 写入。
- GitHub Secret Rotate 的 current / previous / expiry 更新。

要求：

- 先在内存完成 Validation 和 AES-GCM 加密，再进入 batch。
- batch 任一 statement 失败，整批回滚。
- 不使用 `exec()` 执行业务动态 SQL。
- 所有动态值使用 prepared statement + bind。

这样避免出现“Target 已创建但 Webhook Secret 没写入”之类半完成配置。

# 16. 管理页面设计

## 16.1 页面导航

```text
GitHub → IM Gateway

Overview
Targets
Routes
Settings
```

## 16.2 Overview

顶部四个指标：

```text
Valid GitHub Events
Notifications
Delivery Success Rate
Failed Deliveries
```

时间：

```text
24h
7d
30d
```

下方：

1. 每日事件 / 投递趋势。
2. Event Type 分布。
3. Repository 分布。
4. Provider 成功率。
5. Channel 成功率。
6. Recent Failures。

Provider 成功率示例：

| Provider | Deliveries | Success | Failed | Rate |
|---|---:|---:|---:|---:|
| Feishu | 824 | 823 | 1 | 99.88% |
| DingTalk | 417 | 417 | 0 | 100% |
| WeCom | 306 | 302 | 4 | 98.69% |

不做复杂 BI 可视化。

## 16.3 Targets

列表：

| Name | Platform | Type | Destination | Status | Test |
|---|---|---|---|---|---|
| 飞书开发群 | 飞书 | Webhook | Configured | Enabled | Test |
| 负责人 | 飞书 | App | open_id | Enabled | Test |
| 钉钉研发群 | 钉钉 | Webhook | Configured | Enabled | Test |
| 企微告警群 | 企业微信 | Webhook | Configured | Enabled | Test |

### 新增 Target

第一步：

```text
Platform
[ Feishu | DingTalk | WeCom ]
```

第二步：

```text
Delivery Method
```

规则：

- Feishu：`Webhook` / `Application`。
- DingTalk：V1 仅 `Webhook`。
- WeCom：V1 仅 `Webhook`。

### Feishu Webhook 字段

```text
Name *
Webhook URL *
Sign Secret
Enabled
```

### Feishu App Target 字段

```text
Name *
Receive ID Type *
Receive ID *
Enabled
```

### DingTalk Webhook 字段

```text
Name *
Webhook URL *
Sign Secret
Enabled
```

### WeCom Webhook 字段

```text
Name *
Webhook URL *
Enabled
```

每个 Target 必须有：

```text
[Test Send]
```

并显示：

```text
Last test: success / failed
Duration
Provider error summary
```

## 16.4 Routes

表格：

| Name | Repository | Event | Conditions | Targets | Enabled |
|---|---|---|---|---|---|
| Main Push | owner/project | push | main | 飞书开发群 | ✓ |
| CI Fail | owner/project | workflow_run | failure | 飞书, 钉钉, 企微 | ✓ |

同一个 Route 的 Targets 可以跨平台。

新增规则采用普通表单。

根据 Event 动态显示条件。

### Push

```text
Branch
```

### PR

```text
Action
Base Branch
Merged
```

### Workflow

```text
Workflow Name
Branch
Conclusion
```

### Release

```text
Action
Prerelease
```

## 16.5 Settings

### GitHub Webhook

展示：

```text
Webhook URL
https://xxx.workers.dev/webhooks/github

Secret
Configured

[Rotate Secret]
```

旋转时：

1. 二次确认。
2. 当前 Secret 进入 previous 槽位。
3. 生成新 current Secret。
4. 返回新 Secret 明文一次。
5. previous Secret 继续接受 30 分钟。
6. 提示在 30 分钟内同步更新所有 GitHub Webhook。
7. 离开页面后不可再次查看明文。

UI 可显示：

```text
Current Secret: Configured
Previous Secret: Active until HH:mm   // 仅轮换窗口存在
```

不显示任何 Secret 内容。

### Feishu App

只有 Feishu App 是 V1 的全局 Application Connection：

```text
App ID
App Secret: Configured

[Verify Connection]
```

Verify 只测试能否获取 `tenant_access_token`，不发送消息。

钉钉和企业微信 V1 没有全局 App 设置；它们只在 Targets 中配置 Webhook。

## 16.6 初始 Setup Wizard

第一次运行：

```text
Step 1
GitHub Webhook Secret

Step 2
Add Notification Target
  ├─ Feishu Webhook
  ├─ Feishu App
  ├─ DingTalk Webhook
  └─ WeCom Webhook

Step 3
Routes

Step 4
GitHub Webhook Setup
```

Feishu App 不是 Setup 必填项。

只要存在至少一个可用 Target，即可完成初始化。

# 17. D1 数据模型与迁移

文件：

```text
migrations/0001_initial.sql
```

建议 SQL：

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS secrets (
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,

  PRIMARY KEY (scope, scope_id, name)
);

CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL
    CHECK (
      type IN (
        'feishu_webhook',
        'feishu_app',
        'dingtalk_webhook',
        'wecom_webhook'
      )
    ),
  enabled INTEGER NOT NULL DEFAULT 1
    CHECK (enabled IN (0, 1)),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_targets_type
  ON targets(type);

CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repository TEXT NOT NULL,
  event_type TEXT NOT NULL,
  conditions_json TEXT NOT NULL DEFAULT '{}',
  target_ids_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
    CHECK (enabled IN (0, 1)),
  priority INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_routes_match
  ON routes(repository, event_type, enabled);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  repository TEXT NOT NULL,
  event_type TEXT NOT NULL,
  action TEXT,
  branch TEXT,
  actor TEXT,

  status TEXT NOT NULL
    CHECK (
      status IN (
        'processing',
        'processed',
        'ignored',
        'internal_error'
      )
    ),

  matched_route_count INTEGER NOT NULL DEFAULT 0,

  received_at INTEGER NOT NULL,
  completed_at INTEGER,
  duration_ms INTEGER,

  error_code TEXT,
  error_summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_received_at
  ON events(received_at);

CREATE INDEX IF NOT EXISTS idx_events_repository_received
  ON events(repository, received_at);

CREATE INDEX IF NOT EXISTS idx_events_type_received
  ON events(event_type, received_at);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  source TEXT NOT NULL DEFAULT 'github'
    CHECK (source IN ('github', 'test')),
  target_id TEXT,
  target_name TEXT NOT NULL,
  provider TEXT NOT NULL
    CHECK (provider IN ('feishu', 'dingtalk', 'wecom')),
  channel_type TEXT NOT NULL
    CHECK (
      channel_type IN (
        'feishu_webhook',
        'feishu_app',
        'dingtalk_webhook',
        'wecom_webhook'
      )
    ),

  status TEXT NOT NULL
    CHECK (status IN ('success', 'failed')),

  http_status INTEGER,
  provider_code TEXT,
  error_code TEXT,
  error_summary TEXT,

  duration_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deliveries_event
  ON deliveries(event_id);

CREATE INDEX IF NOT EXISTS idx_deliveries_created
  ON deliveries(created_at);

CREATE INDEX IF NOT EXISTS idx_deliveries_status_created
  ON deliveries(status, created_at);

CREATE INDEX IF NOT EXISTS idx_deliveries_provider_created
  ON deliveries(provider, created_at);

CREATE INDEX IF NOT EXISTS idx_deliveries_channel_created
  ON deliveries(channel_type, created_at);
```

## 17.1 为什么没有 Foreign Key

V1 允许删除 Target。

历史 Delivery 仍需要显示：

```text
原 target_name
原 provider
原 channel_type
```

因此 Delivery 使用快照字段，不强依赖 Targets 行长期存在。

测试发送没有 GitHub Event，因此：

```text
deliveries.event_id = NULL
source = test
```

## 17.2 ID

使用：

```ts
crypto.randomUUID()
```

事件：

```text
events.id = X-GitHub-Delivery
```

Delivery / Route / Target：

```text
crypto.randomUUID()
```

## 17.3 时间

数据库统一：

```text
Unix timestamp milliseconds
```

值为 UTC epoch milliseconds，UI 转成本地时区展示。

# 18. HTTP API 设计

所有 JSON API 返回：

```json
{
  "ok": true,
  "data": {}
}
```

错误：

```json
{
  "ok": false,
  "error": {
    "code": "ROUTE_NOT_FOUND",
    "message": "Route not found"
  }
}
```

## 18.1 Public API

### Health

```http
GET /health
```

返回：

```json
{
  "ok": true,
  "service": "github-im-gateway",
  "version": "0.1.0"
}
```

不主动调用任何 IM Provider，不查询外部依赖。

### GitHub

```http
POST /webhooks/github
```

## 18.2 Auth

### Login

```http
POST /api/auth/login
```

Body：

```json
{
  "password": "..."
}
```

成功设置 HttpOnly Cookie，不返回 Token。

### Logout

```http
POST /api/auth/logout
```

## 18.3 Settings

### Get

```http
GET /api/settings
```

返回：

```json
{
  "github": {
    "webhookUrl": "...",
    "secretConfigured": true
  },
  "feishuApp": {
    "appId": "cli_xxx",
    "secretConfigured": true
  }
}
```

### Rotate GitHub Secret

```http
POST /api/settings/github/rotate-secret
```

只返回一次新 Secret。

### Update Feishu App

```http
PUT /api/settings/feishu-app
```

```json
{
  "appId": "cli_xxx",
  "appSecret": "new-value-or-null"
}
```

`null` 表示保持不变。

### Verify Feishu App

```http
POST /api/settings/feishu-app/verify
```

## 18.4 Targets

```http
GET    /api/targets
POST   /api/targets
PATCH  /api/targets/:id
DELETE /api/targets/:id
POST   /api/targets/:id/test
```

创建 Target 请求按 `type` 使用 discriminated union 校验。

V1 接受的创建结构：

```ts
type CreateTargetRequest =
  | {
      name: string;
      type: "feishu_webhook";
      enabled?: boolean;
      webhookUrl: string;
      signSecret?: string;
    }
  | {
      name: string;
      type: "feishu_app";
      enabled?: boolean;
      receiveIdType: "chat_id" | "open_id";
      receiveId: string;
    }
  | {
      name: string;
      type: "dingtalk_webhook";
      enabled?: boolean;
      webhookUrl: string;
      signSecret?: string;
    }
  | {
      name: string;
      type: "wecom_webhook";
      enabled?: boolean;
      webhookUrl: string;
    };
```

示例：

```json
{
  "name": "钉钉研发群",
  "type": "dingtalk_webhook",
  "enabled": true,
  "webhookUrl": "...",
  "signSecret": "..."
}
```

Secret 在 API 层提取后写入 `SecretStore`，不得写入 `targets.config_json`。

Webhook URL 保存前必须执行 Provider-specific URL Validation；仅校验“是 HTTPS URL”不够。

删除 Target 前如果存在 Route 引用：

```text
409 TARGET_IN_USE
```

## 18.5 Routes

```http
GET    /api/routes
POST   /api/routes
PATCH  /api/routes/:id
DELETE /api/routes/:id
```

保存时做完整 Validation。

## 18.6 Stats

```http
GET /api/stats?range=24h
GET /api/stats?range=7d
GET /api/stats?range=30d
```

默认：

```text
source = github
```

返回至少包含：

```text
summary
eventBreakdown
repositoryBreakdown
providerBreakdown
channelBreakdown
trend
```

## 18.7 Failures

```http
GET /api/failures?limit=20
```

`limit`：1 ~ 100。

## 18.8 Config Export

```http
GET /api/config/export
```

永远不包含 Secret。

示例：

```json
{
  "version": 2,
  "settings": {
    "feishuAppId": "cli_xxx"
  },
  "targets": [],
  "routes": []
}
```

## 18.9 Config Import

```http
POST /api/config/import
```

默认先 `validate-only`，UI 预览差异后再执行 replace。

Secret 永远不导入导出。

# 19. 事件统计与成功失败分析

## 19.1 统计定义

必须区分：

### Event

GitHub 发来的一次有效事件。

### Delivery

向某个 Target 的一次消息投递。

例如：

```text
1 个 workflow_run
↓
飞书 Bot + 钉钉 Bot + 企微 Bot
↓
1 Event + 3 Deliveries
```

因此核心 SLA 指标是：

```text
Delivery Success Rate
```

而不是 Event Success Rate。

## 19.2 Dashboard 核心指标

### Valid GitHub Events

```sql
COUNT(events)
```

不包含：无效签名、非法请求、过大 Body。这些只进 Workers Logs。

### Notifications

```sql
COUNT(deliveries WHERE source = 'github')
```

### Delivery Success Rate

```text
success delivery
---------------- × 100%
all github delivery
```

### Failed Deliveries

```text
source = github AND status = failed
```

## 19.3 时间范围

只提供：

```text
24h
7d
30d
```

不做任意时间选择器。

## 19.4 Event 分布

```text
push
pull_request
workflow_run
release
```

## 19.5 Provider 分布

```text
feishu
dingtalk
wecom
```

展示：

```text
attempts
success
failed
success_rate
avg_duration_ms
```

## 19.6 Channel 分布

```text
feishu_webhook
feishu_app
dingtalk_webhook
wecom_webhook
```

Provider 用于回答：

> 哪个平台总体最稳定？

Channel 用于回答：

> 飞书 Bot 与飞书 App 哪个环节有问题？

## 19.7 Repository 分布

展示 Top 10，避免页面无限增长。

## 19.8 Trend

24h：按小时。

7d / 30d：按天。

前端用 SVG 简单折线。

## 19.9 Recent Failures

最多 20 条。

字段：

```text
time
repository
event_type
target_name
provider
channel_type
http_status
provider_code
error_code
error_summary
duration_ms
```

错误摘要最大 256 字符并做 Secret Redaction。

## 19.10 Test Delivery

Target 的 Test Send 记录 `source = test`。

Dashboard 默认不统计 Test Delivery，避免人为测试改变成功率。

Target 页面可显示最近一次测试：

```text
last_test_at
last_test_status
last_test_duration
```

可通过查询 `deliveries` 获取，不新增 Target 状态字段。

## 19.11 保留策略

默认 30 天。

Scheduled Handler 每日执行：

```sql
DELETE FROM deliveries
WHERE created_at < ?;

DELETE FROM events
WHERE received_at < ?;
```

如果未来需要半年以上趋势或大规模高维 Metrics，再评估 Analytics Engine。

# 20. 可靠性、幂等与错误处理

## 20.1 幂等键

使用：

```text
X-GitHub-Delivery
```

`events.id` 是 PRIMARY KEY。

## 20.2 第一次请求：原子幂等登记

禁止实现：

```text
SELECT event
↓ not found
INSERT event
```

该 check-then-insert 在并发请求下存在竞态。

V1 必须直接依赖 `events.id PRIMARY KEY` 做原子登记：

```sql
INSERT INTO events (
  id, repository, event_type, action, branch, actor,
  status, received_at
)
VALUES (?, ?, ?, ?, ?, ?, 'processing', ?)
ON CONFLICT(id) DO NOTHING;
```

然后检查 D1 `result.meta.changes`：

```text
changes = 1 → 当前请求拥有该 Delivery 的处理权
changes = 0 → duplicate
```

只有 `changes = 1` 才允许发生任何外部 Provider Call。

如果原子 INSERT 因数据库故障失败：

```text
不要发送任何 IM 消息
返回 500
```

这样不会出现“Provider 已发送，但幂等记录不存在”的状态。

## 20.3 重复 Delivery

原子 INSERT 返回：

```text
changes = 0
```

直接：

```http
200
```

返回：

```json
{
  "ok": true,
  "duplicate": true
}
```

不重新解析路由、不读取 Target、不调用任何 Provider。

## 20.4 一个重要取舍

V1 不引入 Durable Queue。

因此存在一个极小窗口：

```text
事件已写 processing
↓
Worker 异常终止
↓
消息可能没有发送
↓
GitHub 重投被幂等拦截
```

这是 V1 有意接受的可靠性取舍。

原因：

- GitHub → IM 是通知，不是金融交易。
- 引入 Queue 会显著增加系统复杂度。
- Dashboard 会显示长期 `processing` 事件，可人工发现。

如果未来要求：

```text
at-least-once delivery
```

再引入 Cloudflare Queues。

## 20.5 Stale Processing

Dashboard 统计：

```text
processing > 5 分钟
```

视为：

```text
stale
```

在 Overview 显示：

```text
Stale Events: N
```

但不自动重放。

## 20.6 外部发送并发与总预算

对同一事件：

```text
最多 6 个 resolved Target
最多并行 3 个 Target
单 Provider Call 最多 3 秒
Webhook 总预算 8 秒
```

实现一个极小 `mapLimitWithDeadline()`，不用第三方并发库。

发送循环每启动一个任务前检查剩余 Deadline；剩余时间不足时停止启动新请求，并为未启动目标生成 `PROVIDER_DEADLINE_EXCEEDED` 的失败结果。

## 20.7 自动重试

V1 不做通用自动重试。

原因：

- 下游 IM 是否已经收到消息有时不能仅靠网络错误判断。
- 自动重试可能造成重复消息。
- 事件量低。
- Dashboard 可以明确看见失败。

`429` 或 `5xx` 先记失败。

后续如真实数据证明需要，再设计带幂等策略的 Retry。

## 20.8 Provider 限流策略

飞书、钉钉、企业微信都存在各自的调用频率限制，而且限制可能随平台规则调整。

V1 不实现分布式 per-target 限流器，因为那会迫使系统引入 Durable Objects / Queue 等额外基础设施。

V1 采用：

- GitHub 端只订阅真正需要的事件。
- 同一 Event / Target 去重。
- 单事件最多并发 3 个 Target。
- Provider 返回限流错误时记录 `failed` 和平台错误码。
- Dashboard 按 Provider 展示失败率，观察是否真的需要限流层。

如果真实运行中频繁出现 Provider Rate Limit，再进入 Queue/Retry 扩展阶段，而不是预先建设。

---

# 21. 安全设计

## 21.1 安全边界

系统公开入口只有：

```text
POST /webhooks/github
GET /health
静态 Admin UI shell
POST /api/auth/login
```

其他 `/api/*` 必须登录。

## 21.2 禁止通用代理

系统永远不接受：

```json
{
  "targetUrl": "https://..."
}
```

禁止：

```text
/proxy
/forward
/fetch
/request
```

所有外部目标只能来自已保存配置。

### 21.2.1 Provider Destination Allowlist

保存 Target 和真正发送前都必须进行同一套 URL 校验（defense in depth）。

固定允许：

```text
feishu_webhook
  scheme: https
  host: open.feishu.cn
  path prefix: /open-apis/bot/v2/hook/


dingtalk_webhook
  scheme: https
  host: oapi.dingtalk.com
  path: /robot/send
  required query: access_token

wecom_webhook
  scheme: https
  host: qyapi.weixin.qq.com
  path: /cgi-bin/webhook/send
  required query: key
```

额外规则：

- URL 不允许 username/password userinfo。
- 不允许自定义非标准端口。
- 不允许 `http:`。
- Feishu App 的 Token/Message URL 完全写死在代码中，不允许 UI 配置。
- 所有 Provider `fetch()` 使用 `redirect: "error"`，禁止跟随 3xx 到其他域名。
- Validation 失败返回 `TARGET_CONFIG_INVALID`，不得尝试网络请求。

这条规则是 V1 防 SSRF / 防通用代理的核心安全边界。

## 21.3 管理登录

不构建用户系统。

Cloudflare Secret：

```text
ADMIN_PASSWORD
```

登录成功后生成签名 Session Cookie。

## 21.4 Session

Cookie：

```text
Name: gim_session
HttpOnly
Secure
SameSite=Strict
Path=/
Max-Age=43200
```

即：

```text
12 小时
```

Session 内容：

```json
{
  "iat": 123,
  "exp": 456,
  "nonce": "..."
}
```

签名：

```text
HMAC-SHA256
```

签名 Key 从 `MASTER_KEY` 派生：

```text
HKDF label = "admin-session-v1"
```

不额外引入 SESSION_SECRET。

## 21.5 Login Rate Limit

使用 Workers Rate Limiting binding。

建议：

```text
10 次 / 60 秒
```

Key：

```text
login:<CF-Connecting-IP>
```

这里限流仅用于防密码暴力尝试，不用于用户配额。

## 21.6 CSRF

状态修改请求必须：

- Session Cookie 合法。
- `Origin` 与当前 Worker Origin 完全一致。
- `Content-Type: application/json`。
- `SameSite=Strict`。

拒绝跨 Origin 写操作。

## 21.7 Secret Redaction

统一：

```ts
sanitizeError()
```

禁止日志出现：

```text
open.feishu.cn/open-apis/bot/v2/hook/<token>
oapi.dingtalk.com/robot/send?access_token=<token>
qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<token>
app_secret
tenant_access_token
Authorization
github webhook secret
MASTER_KEY
ADMIN_PASSWORD
```

## 21.8 Repository 信任

验签通过以后才解析和处理。

路由只对配置中的 Repository 生效。

未配置 Repository：

```text
ignored
```

## 21.9 Security Headers

管理页面返回：

```text
Content-Security-Policy
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
```

CSP 尽量：

```text
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data:;
connect-src 'self';
frame-ancestors 'none';
```

不加载第三方 CDN JavaScript。

## 21.10 Admin UI XSS 约束

管理页面会显示 GitHub 仓库名、分支、PR 标题、Commit message、Target name 和 Provider error，这些都视为不可信外部字符串。

实现规则：

- 动态文本默认使用 `textContent` / `createTextNode()`。
- 禁止把外部字符串直接拼进 `innerHTML`。
- 如极少数位置必须生成 HTML，只允许使用本项目内部静态模板，不插入未转义外部数据。
- 外部 URL 先用 `new URL()` 校验，只允许 `https:` 后再设置到 `href`。
- 打开外部链接时使用 `rel="noopener noreferrer"`。
- Provider error 展示前继续执行 Secret Redaction。

不引入第三方 HTML Sanitizer Library；V1 通过“不使用不可信 HTML”从源头规避 XSS。

---

# 22. 日志与可观测性

## 22.1 结构化日志

统一：

```ts
console.log(JSON.stringify({
  level: "info",
  event: "delivery_completed",
  deliveryId,
  repository,
  eventType,
  targetId,
  channelType,
  success,
  durationMs
}));
```

## 22.2 日志等级

```text
debug
info
warn
error
```

生产默认：

- info
- warn
- error

## 22.3 不记录

禁止：

```text
完整 webhook body
完整第三方 IM 响应 body
webhook URL
token
secret
Authorization
```

## 22.4 D1 与 Workers Logs 职责

D1：

```text
用户需要看的运行结果
```

Workers Logs：

```text
开发者排错
```

不要在项目里重新实现日志搜索系统。

---

# 23. 测试与质量保证方案

本章是 V1 的强制开发规范，不是上线前补做的检查项。

测试目标不是“把覆盖率做高”，而是保证以下四个问题都可以被快速回答：

1. GitHub 请求是否被正确验证和标准化？
2. 路由是否选中了正确且唯一的通知目标？
3. 每个 IM Adapter 是否构造了正确请求并准确映射成功/失败？
4. 失败发生后，能否从 D1 统计和 Workers Logs 快速判断故障环节？

## 23.1 测试分层

V1 固定采用四层测试：

```text
L1 Unit
  ↓
L2 Worker + D1 Integration
  ↓
L3 Provider Smoke
  ↓
L4 GitHub → Worker → IM E2E
```

| 层级 | 是否访问真实 GitHub | 是否访问真实 IM | 是否使用 D1 | 目的 |
|---|---:|---:|---:|---|
| L1 Unit | ❌ | ❌ | 可选/最小 | 验证纯逻辑、签名、Parser、Renderer、Adapter Contract |
| L2 Integration | ❌ | ❌，全部 Mock | ✅ 本地隔离 | 验证完整 Worker、D1、幂等、API、统计 |
| L3 Provider Smoke | ❌ | ✅ 测试群 | ✅ | 验证真实平台凭据、消息格式、权限、限流基本行为 |
| L4 E2E | ✅ 测试仓库 | ✅ 测试群 | ✅ | 验证 GitHub 到 IM 的真实全链路 |

原则：

- 日常 `npm test` 禁止向真实飞书、钉钉、企微发送消息。
- CI 禁止依赖真实 IM Secret。
- 真实 Provider 测试只允许显式执行。
- E2E 使用独立测试仓库和独立测试群，不污染正式仓库/群。
- 任何平台 Adapter 都必须先通过 Mock Contract Test，才能进入真实 Smoke Test。

## 23.2 测试工具基线

使用：

- Vitest 4.1+。
- `@cloudflare/vitest-plugin`。
- `@msw/cloudflare` 或等价的 Workers Runtime outbound request mock。
- `@vitest/coverage-istanbul`。
- 本地 D1。
- Wrangler Local Explorer。
- Wrangler Local Dev Tunnel。

`@cloudflare/vitest-plugin` 必须直接运行在 Workers Runtime 中，测试代码不能假设普通 Node.js 运行环境。

### 23.2.1 vitest.config.ts

建议：

```ts
import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        path.join(__dirname, "migrations")
      );

      return {
        wrangler: {
          configPath: "./wrangler.jsonc",
        },
        miniflare: {
          // 只用于测试，把 migration 描述传入 Workers Runtime。
          bindings: {
            TEST_MIGRATIONS: migrations,
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "html", "json"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/env.ts",
        "src/**/*.d.ts",
      ],
    },
  },
});
```

`test/apply-migrations.ts`：

```ts
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";

await applyD1Migrations(
  env.DB,
  env.TEST_MIGRATIONS
);
```

测试类型声明中给 `ProvidedEnv` 增加 `DB` 和 `TEST_MIGRATIONS`，不要在业务 `Env` 中加入仅测试使用的字段。

Cloudflare Workers Vitest 集成当前不能使用原生 V8 Runtime Coverage，因此覆盖率必须选择 Istanbul instrumented coverage。

## 23.3 Fixture 规范

所有 GitHub Parser 测试必须基于 Fixture，不允许每个测试临时拼一个不完整 Payload。

建议：

```text
test/fixtures/github/
├── ping.json
├── push-single.json
├── push-multiple.json
├── push-deleted.json
├── pull-request-opened.json
├── pull-request-merged.json
├── workflow-success.json
├── workflow-failure.json
├── workflow-cancelled.json
└── release-published.json
```

Fixture 来源优先级：

1. 独立 GitHub 测试仓库产生的真实 Webhook Payload。
2. GitHub 官方事件示例。
3. 最后才允许手工构造。

Fixture 提交仓库前必须脱敏：

- 删除真实邮箱。
- 删除内部仓库敏感名字（如果存在）。
- 删除 Token / Secret / Authorization。
- 可以保留结构、字段类型、Commit 数量和状态字段。

Fixture 不应该为了让 Parser “好测”而删掉 GitHub 正常会携带的嵌套结构。

## 23.4 GitHub Signature Unit Test

验签测试必须覆盖 GitHub 官方测试向量和本项目边界。

### 官方测试向量

```text
secret:
It's a Secret to Everybody

payload:
Hello, World!

expected X-Hub-Signature-256:
sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17
```

### 必测用例

```text
SIG-001 正确官方测试向量                  → true
SIG-002 正确真实 JSON                     → true
SIG-003 错误 Secret                       → false
SIG-004 Body 修改 1 byte                  → false
SIG-005 缺少 sha256=                      → false
SIG-006 缺少 Signature Header             → reject
SIG-007 Unicode / 中文 Commit             → true
SIG-008 空 Body                            → 按 API 规则 reject
SIG-009 非 hex Signature                   → false
SIG-010 长度不同 Signature                → false 且不抛异常
```

验签测试必须证明：

> 验证对象是原始 Body 字节，而不是 `JSON.parse()` 后重新 `JSON.stringify()` 的字符串。

## 23.5 GitHub Parser Unit Test

### Push

必须覆盖：

```text
PARSE-PUSH-001 main 单 Commit
PARSE-PUSH-002 main 多 Commit
PARSE-PUSH-003 develop
PARSE-PUSH-004 force push
PARSE-PUSH-005 branch deleted
PARSE-PUSH-006 head_commit 为空的合法边界
```

断言至少包括：

- `type`。
- `repository`。
- `repositoryUrl`。
- `actor`。
- `branch`。
- `title`。
- `summary`。
- `url`。
- `severity`。
- `metadata.commitCount`。

### Pull Request

必须覆盖：

```text
opened
reopened
synchronize
closed without merge
closed + merged=true
```

特别断言：

```text
closed + merged=true
```

必须与普通 `closed` 能区分。

### Workflow Run

至少覆盖：

```text
requested
in_progress
completed + success
completed + failure
completed + cancelled
completed + timed_out
```

Router 通常只对 `completed` 产生最终通知，但 Parser 必须稳定识别所有状态。

### Release

至少覆盖：

```text
published
released
prereleased
```

### Unknown Event

未知事件：

```text
parse → unsupported
HTTP → 200 ignored
Provider → 0 calls
```

## 23.6 Route Matcher Unit Test

路由是本项目最重要的纯业务逻辑之一。

必须覆盖：

```text
ROUTE-001 exact repository match
ROUTE-002 wrong repository
ROUTE-003 branch match
ROUTE-004 branch mismatch
ROUTE-005 PR action match
ROUTE-006 merged condition
ROUTE-007 workflow conclusion match
ROUTE-008 workflow name match
ROUTE-009 release action match
ROUTE-010 disabled route
ROUTE-011 disabled target
ROUTE-012 multi-route match
ROUTE-013 cross-provider targets
ROUTE-014 duplicate target across routes
ROUTE-015 target dedupe
```

核心断言：

```text
同一个 Event + Target
即使被多个 Route 命中
最终最多发送 1 次
```

## 23.7 Notification Builder / Renderer Unit Test

### Notification Builder

必须断言：

- 必要字段存在。
- URL 不丢失。
- `Notification` 不含飞书/钉钉/企微专有字段。
- Commit/PR 标题包含 Markdown 特殊字符时仍能安全渲染。
- 超长 description 能被裁剪。
- 空可选字段不会产生 `undefined` 文本。

### Provider Renderer

分别测试：

```text
Feishu interactive/card payload
Feishu app message payload
DingTalk markdown payload
WeCom markdown payload
```

必须测试：

- Provider-specific escaping。
- UTF-8 字节裁剪。
- 超长中文。
- Emoji。
- GitHub URL。
- 空字段。
- 极长 Commit Message。
- Provider Payload Guard。

## 23.8 SecretStore Unit Test

必须覆盖：

```text
SECRET-001 encrypt result != plaintext
SECRET-002 decrypt(encrypt(x)) == x
SECRET-003 same plaintext + random nonce → different ciphertext
SECRET-004 wrong AAD fails
SECRET-005 wrong MASTER_KEY fails
SECRET-006 malformed ciphertext fails safely
SECRET-007 provider URL redaction
SECRET-008 export does not contain encrypted secret rows
```

测试日志中也不得打印 Secret 明文。

## 23.9 Channel Adapter Contract Test

所有 outbound `fetch()` 必须 Mock。

Adapter 的测试目标不是“平台真的在线”，而是验证统一契约：

```text
Notification + Target
↓
Renderer
↓
HTTP Request
↓
Provider Response
↓
DeliveryResult
```

每个 Adapter 至少覆盖：

| 场景 | DeliveryResult |
|---|---|
| HTTP 2xx + Provider success | `success=true` |
| HTTP 4xx | `success=false` + httpStatus |
| HTTP 429 | `success=false` + `errorCode=PROVIDER_RATE_LIMITED` |
| HTTP 5xx | `success=false` + provider/http error |
| Network error | `success=false` + network error |
| Timeout | `success=false` + timeout |
| Invalid JSON | `success=false` + invalid response |
| Provider returns logical error in 200 | `success=false` + providerCode |

### Feishu Webhook

额外覆盖：

```text
with sign secret
without sign secret
signature timestamp payload
test send
```

### Feishu App

额外覆盖：

```text
token success
token failure
cached token
token expiry margin
chat_id send
open_id send
API logical failure
```

### DingTalk Webhook

额外覆盖：

```text
with sign secret
without sign secret
signature generation
markdown escaping
```

### WeCom Webhook

额外覆盖：

```text
markdown escaping
3 KiB internal guard
UTF-8 byte truncation
```

禁止通过真实平台刷 429 来测试限流；429 必须通过 Mock 模拟。

## 23.10 Worker + D1 Integration Test

Integration Test 必须执行完整 Worker Handler，不允许只调用 Parser/Router 函数拼接结果。

典型测试：

```text
POST signed workflow failure
↓
GitHub HMAC pass
↓
D1 event inserted: processing
↓
Parser
↓
Route match
↓
Targets: Feishu + DingTalk + WeCom
↓
Outbound fetch mocked
↓
3 DeliveryResult
↓
D1 delivery rows inserted
↓
Event → processed
↓
HTTP 200
```

### Integration Case：幂等

同一个 `X-GitHub-Delivery` 连续发送两次：

```text
第一次：正常处理
第二次：duplicate=true
```

必须断言：

- 第二次 Provider Call = 0。
- `deliveries` 不新增。
- D1 只有一个逻辑事件。
- HTTP 仍为 200。

### Integration Case：无路由

```text
event.status = ignored
delivery rows = 0
HTTP = 200
```

### Integration Case：单平台失败

例如：

```text
Feishu   success
DingTalk failed 429
WeCom    success
```

必须断言：

```text
event = processed
deliveries = 3
success = 2
failed = 1
GitHub HTTP = 200
```

单个 Provider 失败不得阻断其他 Provider。

### Integration Case：全部 Provider 失败

```text
all provider calls failed
```

仍应：

```text
GitHub HTTP 200
event processed
delivery failure = N
Overview 可统计失败
```

### Integration Case：关键接收阶段 D1 失败

在“初始幂等事件登记”之前/期间模拟 D1 不可用。

预期：

```text
HTTP 5xx
没有任何 outbound Provider call
```

这用于避免“消息已经发出但幂等记录没写入”的不确定状态。

## 23.11 HTTP 与安全集成测试

必须覆盖：

```text
HTTP-001 GET /webhooks/github                  → 405
HTTP-002 POST unknown path                     → 404
HTTP-003 missing Content-Type                  → 415/按规范拒绝
HTTP-004 malformed JSON                        → 400
HTTP-005 body > 1 MiB                          → 413
HTTP-006 missing X-GitHub-Delivery             → 400
HTTP-007 invalid signature                     → 401
HTTP-008 unsupported GitHub event              → 200 ignored
```

Admin API：

```text
AUTH-001 未登录 GET /api/targets              → 401
AUTH-002 错误密码                              → 401
AUTH-003 正确登录                              → Session Cookie
AUTH-004 合法 Cookie                           → 200
AUTH-005 伪造 Cookie                           → 401
AUTH-006 跨 Origin PUT                         → 403
AUTH-007 Login Rate Limit                      → 429
AUTH-008 Target GET 不返回 Webhook URL
AUTH-009 Export 不包含 Secret
AUTH-010 Security Headers 存在
```

## 23.12 D1 Migration 与 Stats Test

### Migration

每次 CI 必须：

1. 从空数据库开始。
2. 执行全部 migrations。
3. 执行 Integration Tests。
4. 禁止依赖人工 SQL。
5. 禁止依赖开发者机器上残留的本地 D1 状态。

### Stats

测试数据必须显式构造。

例如：

```text
80 success
20 failed
```

API：

```text
GET /api/stats?range=24h
```

必须得到：

```text
Deliveries   100
Success       80
Failed        20
Rate          80%
```

还必须覆盖：

```text
0 delivery                    → rate = 0，不是 NaN / Infinity
provider breakdown
channel breakdown
event breakdown
repository top
recent failures
test delivery excluded by default
24h / 7d / 30d boundary
UTC timestamp boundary
30-day cleanup
```

## 23.13 本地 Webhook Simulator

项目必须自带：

```text
scripts/send-webhook.ts
```

用途：

```text
Fixture
↓
读取本地 GITHUB_WEBHOOK_SECRET
↓
HMAC-SHA256
↓
生成随机 X-GitHub-Delivery
↓
POST http://localhost:8787/webhooks/github
```

命令：

```bash
npm run webhook:test -- push
npm run webhook:test -- pull_request_opened
npm run webhook:test -- pull_request_merged
npm run webhook:test -- workflow_success
npm run webhook:test -- workflow_failure
npm run webhook:test -- release
```

脚本参数规范：

```text
--base-url       默认 http://localhost:8787
--delivery-id    可选，便于重复 Delivery 测试
--secret         默认从环境变量读取，不建议命令行明文
--fixture        可覆盖默认 Fixture
```

示例：

```bash
npm run webhook:test -- workflow_failure \
  --delivery-id duplicate-test-001
```

连续执行两次，用于验证幂等。

## 23.14 Local Explorer 调试规范

本地运行：

```bash
npm run dev
```

打开 Wrangler Local Explorer：

```text
http://localhost:8787/cdn-cgi/explorer
```

或者在 Wrangler 终端按：

```text
e
```

Local Explorer 用于：

- 查看本地 D1 表。
- 检查 `events` / `deliveries`。
- 执行 SQL。
- 查看 Worker invocation trace。
- 定位哪一条 D1 操作失败。
- 检查本地日志。

Local Explorer 只用于开发/调试，不作为产品管理页面的一部分。

注意：使用该能力时 Wrangler 应满足官方当前最低版本要求；开发环境安装依赖时必须重新核对 Cloudflare 最新文档。

## 23.15 Provider Smoke Test

三个平台分别建立独立测试群：

```text
Gateway Test - Feishu
Gateway Test - DingTalk
Gateway Test - WeCom
```

Feishu App 使用独立测试用户或测试群 Target。

### Smoke Test 只验证

- Secret / URL 是否有效。
- 权限是否正确。
- 平台能否收到消息。
- Markdown/Card 是否正确显示。
- URL 按钮/链接是否可点击。
- 中文/Emoji 是否正常。
- 平台错误能否被映射并记录。

### 固定测试消息

```text
🔔 GitHub IM Gateway Test

Provider: <provider>
Channel: <channel>
Status: Connected
Environment: Staging

这是一条测试消息。
```

真实 Smoke Test 不用于压测和限流测试。

### 故障 Smoke Test

每个平台至少人工验证一次错误配置：

```text
Feishu    → 错误 Webhook / Secret
DingTalk  → 错误 Sign Secret
WeCom     → 无效 Webhook Key
FeishuApp → 无效 App Secret / receive_id
```

断言：

- 页面 Test Send 明确显示失败。
- D1 记录 `source=test`。
- Overview 默认成功率不包含 Test Delivery。
- Recent Failures 可按设计决定是否包含测试失败；若包含必须标记 `test`。

## 23.16 GitHub E2E Test Repository

必须建立独立测试仓库，例如：

```text
github-im-gateway-e2e
```

不要第一天就在正式项目上做 E2E。

E2E 仓库至少包含：

```text
.github/workflows/e2e-success.yml
.github/workflows/e2e-failure.yml
README.md
```

### E2E 事件

#### Push

```bash
git commit --allow-empty -m "test: webhook push"
git push
```

#### Pull Request

创建：

```text
test/e2e → main
```

验证：

```text
opened
merged
```

#### Workflow

分别触发：

```text
completed / success
completed / failure
```

#### Release

发布：

```text
v0.0.1-e2e
```

验证 `release published`。

## 23.17 本地 Worker 接收真实 GitHub Webhook

需要本地调试真实 GitHub Payload 时：

```bash
npm run dev
```

Wrangler 终端按：

```text
t
```

或者：

```bash
npx wrangler dev --tunnel
```

得到临时：

```text
https://<random>.trycloudflare.com
```

GitHub Test Repository Webhook：

```text
Payload URL:
https://<random>.trycloudflare.com/webhooks/github

Content type:
application/json

Secret:
本地测试 Secret
```

此 Tunnel 仅用于本地测试，不作为 Production 域名。

## 23.18 GitHub Recent Deliveries / Redeliver

E2E 出现 Parser 或 Router Bug 时，不需要反复制造相同 CI。

GitHub：

```text
Repository
→ Settings
→ Webhooks
→ <Gateway Webhook>
→ Recent deliveries
```

可以检查：

- Request headers。
- GitHub Payload。
- 发送时间。
- Worker Response。

GitHub 当前可查看并手工重投最近 3 天的 Webhook Delivery。

重投测试必须注意本项目幂等：

- 原始 Delivery 的 Redeliver 可能保留/产生 GitHub Delivery 标识行为，以 GitHub 实际当前行为为准。
- 如果系统识别为相同 `X-GitHub-Delivery`，预期应进入 duplicate，不重新通知。
- 如果需要重新走完整发送链路，应使用新的测试事件或明确的测试数据清理流程，不要绕过生产幂等规则。

## 23.19 10 秒响应与 Timeout 测试

GitHub 要求 Webhook 接收端在 10 秒内返回 2xx，否则会将 Delivery 记录为失败，并且 GitHub 默认不会自动重投失败的 Delivery。

因此 V1 必须设置内部时间预算。

建议：

```text
GitHub Request Hard Budget        8s
Single Provider Timeout           3s
Provider Concurrency              3
Max Resolved Targets              6
Response Reserve                  >= 500ms
D1 + Parse + Route 目标           < 500ms（正常规模）
```

这不是 SLA，而是实现保护线。

测试：

```text
TIME-001 Provider 100ms              → success
TIME-002 Provider 3s+                → timeout result
TIME-003 one timeout + others ok     → others still success
TIME-004 6 targets / all slow        → GitHub response < 8s target / definitely < 10s
TIME-005 deadline exhausted          → remaining target not started
TIME-006 resolved targets > 6        → reject fan-out, 0 provider calls
```

如果真实规模让同步投递无法稳定满足该约束，触发 Queue 架构升级条件；不要继续增加同步超时时间。

## 23.20 性能与边界测试

V1 不需要做大规模 benchmark，但必须做以下边界：

```text
PERF-001 1 Target
PERF-002 4 Targets（四 Channel）
PERF-003 20 matched routes + target dedupe
PERF-004 1 MiB inbound body rejection
PERF-005 最大内部 Notification 字段
PERF-006 中文/Emoji 长内容
PERF-007 20 次重复 Delivery
PERF-008 Provider 429 mock
PERF-009 Provider 500 mock
PERF-010 D1 initial insert failure
```

要求：

- 不出现未捕获异常。
- 不泄露 Secret。
- 失败状态可被 D1 统计识别。
- 单个平台失败不产生级联失败。

## 23.21 CI 质量门禁

`.github/workflows/ci.yml` 至少执行：

```text
checkout
↓
npm ci
↓
npm run typecheck
↓
npm run test:unit
↓
npm run test:integration
↓
npm run test:coverage
↓
npm run check
```

示意：

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npm run test:integration
      - run: npm run test:coverage
```

CI 不配置真实：

- Feishu Webhook。
- Feishu App Secret。
- DingTalk Webhook。
- WeCom Webhook。

真实 Provider Test 由 Staging/人工 Release Gate 执行。

## 23.22 覆盖率策略

覆盖率只是辅助指标。

建议最低门槛：

```text
Statements  ≥ 80%
Branches    ≥ 75%
Functions   ≥ 80%
Lines       ≥ 80%
```

但以下模块要求接近完全覆盖：

- GitHub Signature。
- SecretStore。
- Route Matcher。
- Target Deduplication。
- Provider Response Mapping。
- Payload Guard。

允许 UI DOM 操作和简单展示代码覆盖率较低，不允许为了数字写没有业务价值的测试。

## 23.23 测试失败定位矩阵

| 现象 | 优先检查 |
|---|---|
| GitHub 显示 401 | HMAC Secret、原始 Body、Signature Header |
| GitHub 显示 413 | Payload Size Guard |
| GitHub 显示 timeout | Worker 总耗时、Provider timeout、D1 慢操作 |
| GitHub 200 但无通知 | Event status、Route match、Target enabled |
| 一个群收不到 | 对应 DeliveryResult / Target config |
| 三个平台都失败 | 网络、共享业务错误、Notification Renderer 前置错误 |
| Feishu App 单独失败 | tenant token、权限、receive_id |
| DingTalk 逻辑失败 | Webhook / sign / provider code |
| WeCom 逻辑失败 | Webhook key / payload size / provider code |
| Dashboard 不一致 | D1 delivery rows、Stats SQL、test source filter |
| 重复消息 | X-GitHub-Delivery 幂等、Target dedupe |

## 23.24 Release Test Matrix

每个 Production Release 至少完成：

| 项目 | 自动 | Staging | Production Smoke |
|---|---:|---:|---:|
| Typecheck | ✅ | - | - |
| Unit Tests | ✅ | - | - |
| Integration Tests | ✅ | - | - |
| Migration from empty DB | ✅ | ✅ | - |
| Migration from previous schema | ✅ | ✅ | - |
| Security API Tests | ✅ | - | - |
| Stats Tests | ✅ | - | - |
| Feishu Webhook | Mock | ✅ | ✅ 1 条 |
| Feishu App | Mock | ✅ | ✅ 1 条 |
| DingTalk Webhook | Mock | ✅ | ✅ 1 条 |
| WeCom Webhook | Mock | ✅ | ✅ 1 条 |
| GitHub Push E2E | Fixture | ✅ | 可选 |
| GitHub PR E2E | Fixture | ✅ | 可选 |
| Workflow failure E2E | Fixture | ✅ | 可选 |
| Release E2E | Fixture | ✅ | 可选 |

Production Smoke 必须低频，只验证“连接仍可用”，不能用生产群做压测。

---

# 24. 本地开发与部署

## 24.1 package.json 与测试命令

建议固定以下开发入口：

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run test/unit",
    "test:integration": "vitest run test/integration",
    "test:coverage": "vitest run --coverage",
    "check": "npm run typecheck && npm run test",
    "webhook:test": "tsx scripts/send-webhook.ts",
    "db:migrate:local": "wrangler d1 migrations apply github-im-gateway --local",
    "db:migrate:remote": "wrangler d1 migrations apply github-im-gateway --remote",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/vitest-plugin": "^1.0.0",
    "@msw/cloudflare": "^0.0.1",
    "@vitest/coverage-istanbul": "^4.1.0",
    "tsx": "^4.23.12",
    "typescript": "^5",
    "vitest": "^4.1.0",
    "wrangler": "^4.118.0"
  }
}
```

版本号是设计基线示意，不是长期锁死值。

安装依赖时必须执行：

```bash
npm outdated
npm test
npm run typecheck
```

并重新核对：

- `@cloudflare/vitest-plugin` 与 Vitest 当前兼容范围。
- Wrangler Local Explorer / Tunnel 最低版本要求。
- `@msw/cloudflare` 当前兼容版本。

如果实际安装版本已经更新，应提交 lockfile，以 lockfile 为 CI / Production Build 的一致性基线。

### 24.1.1 Node.js

CI 与本地建议统一使用当前项目明确声明的 Node.js LTS，例如：

```text
Node.js 24
```

使用 `.nvmrc` 或 `package.json#engines` 固定开发主版本，避免本地与 CI 差异。

---

## 24.2 wrangler.jsonc

示意：

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "github-im-gateway",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-24",

  "assets": {
    "directory": "./public",
    "binding": "ASSETS"
  },

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "github-im-gateway",
      "database_id": "<replace-after-create>",
      "migrations_dir": "migrations"
    }
  ],

  "ratelimits": [
    {
      "name": "LOGIN_RATE_LIMITER",
      "namespace_id": "1001",
      "simple": {
        "limit": 10,
        "period": 60
      }
    }
  ],

  "triggers": {
    "crons": ["17 3 * * *"]
  },

  "observability": {
    "enabled": true
  }
}
```

## 24.3 Env 类型

```ts
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  LOGIN_RATE_LIMITER: RateLimit;

  ADMIN_PASSWORD: string;
  MASTER_KEY: string;

  VERSION?: string;
}
```

通过：

```text
wrangler types
```

生成/校验 Runtime bindings 类型时，以当前 Wrangler 官方行为为准。

## 24.4 首次初始化

### 1. 创建项目

```text
npm create cloudflare@latest
```

选择 Worker TypeScript 项目。

### 2. 创建 D1

```text
npx wrangler d1 create github-im-gateway
```

把 database ID 写入 `wrangler.jsonc`。

### 3. 初始化 migration

```text
migrations/0001_initial.sql
```

### 4. Local migrate

```text
npm run db:migrate:local
```

### 5. 设置本地 Secret

`.dev.vars`：

```text
ADMIN_PASSWORD=local-dev-password
MASTER_KEY=<base64-32-byte-key>
```

`.dev.vars` 必须进入 `.gitignore`。

### 6. 开发

```text
npm run dev
```

### 7. Test

```text
npm test
npm run typecheck
```

## 24.5 Production 初始化

设置：

```text
ADMIN_PASSWORD
MASTER_KEY
```

命令：

```text
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put MASTER_KEY
```

执行：

```text
npm run db:migrate:remote
npm run deploy
```

## 24.6 第一次打开页面

访问：

```text
https://<worker-domain>/
```

登录。

系统检测：

```text
github webhook secret not configured
```

进入 Setup。

## 24.7 GitHub 配置

Repository：

```text
Settings
→ Webhooks
→ Add webhook
```

Payload URL：

```text
https://<worker-domain>/webhooks/github
```

Content Type：

```text
application/json
```

Secret：

```text
管理页面生成的 Secret
```

Events：

只勾选实际使用：

```text
Pushes
Pull requests
Workflow runs
Releases
```

不要勾：

```text
Send me everything
```

降低无意义 Webhook 流量。


## 24.8 本地测试标准流程

第一次拉取项目：

```bash
npm ci
npm run db:migrate:local
npm run typecheck
npm test
npm run dev
```

另一个终端：

```bash
npm run webhook:test -- push
npm run webhook:test -- workflow_failure
```

浏览器：

```text
http://localhost:8787/
http://localhost:8787/cdn-cgi/explorer
```

开发者在提交代码前至少执行：

```bash
npm run check
```

涉及以下模块时，还必须执行 `npm run test:integration`：

- `src/github/**`
- `src/notification/**`
- `src/channels/**`
- `src/storage/**`
- `migrations/**`
- `src/security/**`

## 24.9 Staging 环境

强烈建议创建独立 Staging Worker，而不是所有真实测试都打 Production。

例如：

```text
github-im-gateway-staging
```

Staging 使用：

- 独立 D1。
- 独立 `MASTER_KEY`。
- 独立 `ADMIN_PASSWORD`。
- 独立 GitHub E2E 仓库。
- 独立飞书/钉钉/企微测试群。
- 独立 Feishu App 测试 Target（如条件允许）。

禁止 Staging 与 Production 共用同一个 D1。

## 24.10 Production 发布流程

固定顺序：

```text
PR CI 全绿
↓
Staging migrate
↓
Staging deploy
↓
Staging E2E
↓
Production migration review
↓
Production migrate
↓
Production deploy
↓
4 Channel 低频 Smoke
↓
检查 Overview / Workers Logs
```

Production Migration 在执行前必须确认：

- Migration 可重复执行策略明确。
- 已在空库和上一版本 Schema 上测试。
- 不包含不可逆的大范围数据删除，除非专门评审。

## 24.11 GitHub Webhook 调试

GitHub 仓库页面：

```text
Settings
→ Webhooks
→ <Gateway URL>
→ Recent deliveries
```

调试顺序：

1. 先看 GitHub 是否真的发出了 Event。
2. 看 HTTP Status / Response。
3. 看 Worker Local Explorer 或 Workers Logs。
4. 看 D1 `events`。
5. 看 `deliveries`。
6. 最后再排查 IM 平台。

不要一上来就怀疑平台机器人；先定位请求在哪个阶段丢失。


---

# 25. 开发阶段与任务拆分

下面顺序直接作为开发计划执行。

原则：

> 每个 Phase 不仅要“代码完成”，还必须通过对应测试门禁才能进入下一阶段。

---

## Phase 0：工程初始化

### 任务

- [ ] 创建 Cloudflare Worker TypeScript 项目。
- [ ] 建立目录。
- [ ] TypeScript `strict`。
- [ ] 配置 Wrangler。
- [ ] 创建 D1。
- [ ] 建立 `0001_initial.sql`。
- [ ] 配置 `@cloudflare/vitest-plugin`。
- [ ] 配置 Istanbul Coverage。
- [ ] 配置 `.gitignore`。
- [ ] 添加 `/health`。
- [ ] 创建 `.github/workflows/ci.yml`。

### 测试门禁

```text
npm ci
npm run typecheck
npm test
npm run db:migrate:local
GET /health → 200
```

### 完成条件

- CI 在空仓库逻辑上可稳定执行。
- Local D1 migration 可重复初始化。
- `wrangler dev` 正常启动。

---

## Phase 1：GitHub 接收链路

### 任务

- [ ] Limited body reader。
- [ ] Header parser。
- [ ] HMAC-SHA256。
- [ ] Constant-time compare。
- [ ] `POST /webhooks/github`。
- [ ] `ping`。
- [ ] Atomic Event initial insert (`ON CONFLICT DO NOTHING`)。
- [ ] Duplicate check via `meta.changes`，禁止 SELECT-then-INSERT。

### 测试门禁

- [ ] SIG-001~010。
- [ ] HTTP Method / Content-Type。
- [ ] 1 MiB Body Guard。
- [ ] Missing Delivery ID。
- [ ] Duplicate Delivery。
- [ ] GitHub Ping。

### 完成条件

```text
正确签名 → 接受
错误签名 → 401
重复 Delivery → 200 duplicate
任何非法请求 → 0 Provider calls
```

---

## Phase 2：事件标准化

### 任务

- [ ] `push`。
- [ ] `pull_request`。
- [ ] `workflow_run`。
- [ ] `release`。
- [ ] Event Parser Registry。
- [ ] Unknown Event Handling。

### 测试门禁

- [ ] 所有 GitHub Fixture。
- [ ] 中文 Commit / Emoji。
- [ ] PR merged vs closed。
- [ ] Workflow success/failure/cancelled/timed_out。
- [ ] workflow_run requested/in_progress → ignored，只有 completed 可进入通知路由。
- [ ] Unknown event。

### 完成条件

所有 Fixture 稳定生成 Provider-neutral `GithubEvent`。

---

## Phase 3：Targets / Routes / Channel Registry

### 任务

- [ ] Target CRUD Repository。
- [ ] Route CRUD Repository。
- [ ] ChannelType discriminated union。
- [ ] Provider 映射。
- [ ] Route validation。
- [ ] Match engine。
- [ ] Target dedupe。
- [ ] Max resolved targets = 6。
- [ ] Disabled behavior。
- [ ] Channel Registry。

### 测试门禁

- [ ] ROUTE-001~015。
- [ ] 多 Route 命中同 Target 只保留一次。
- [ ] Cross-provider target set。

### 完成条件

同一 `GithubEvent` 可以得到跨平台、最终唯一 Target 集合。

---

## Phase 4：Notification 与 Renderer 基础

### 任务

- [ ] 统一 Notification。
- [ ] Push content。
- [ ] PR content。
- [ ] Workflow content。
- [ ] Release content。
- [ ] Provider-neutral validation。
- [ ] UTF-8 size helper。
- [ ] Truncation helper。

### 测试门禁

- [ ] Provider-neutral structure test。
- [ ] Markdown special chars。
- [ ] Long Chinese text。
- [ ] Emoji。
- [ ] Empty optional fields。

### 完成条件

`Notification` 不包含任何飞书/钉钉/企微专有字段。

---

## Phase 5：Feishu Webhook

### 任务

- [ ] Interactive Renderer。
- [ ] Webhook URL Secret + official host/path allowlist。
- [ ] Bot Signature（Unix seconds + Feishu HMAC contract）。
- [ ] Send / Deadline / redirect=error。
- [ ] Response Parse。
- [ ] Error Mapping。
- [ ] Test Send。

### 测试门禁

- [ ] Contract Mock 全场景。
- [ ] 429 Mock。
- [ ] Timeout Mock。
- [ ] 有/无 Sign Secret。
- [ ] URL allowlist：wrong host / http / redirect 必须拒绝。
- [ ] Staging 飞书测试群 Smoke。

### 完成条件

真实飞书测试群收到规范测试消息，错误配置可被准确记录。

---

## Phase 6：Feishu App

### 任务

- [ ] App ID Setting。
- [ ] App Secret Encryption。
- [ ] Tenant Token Client。
- [ ] Memory Token Cache。
- [ ] Token Expiry Margin。
- [ ] `chat_id` Send。
- [ ] `open_id` Send。
- [ ] Response Mapping。
- [ ] Verify Connection。
- [ ] Target Test Send。

### 测试门禁

- [ ] Token success/failure。
- [ ] Cached token。
- [ ] Chat ID / Open ID。
- [ ] Provider logical error。
- [ ] Timeout。
- [ ] Staging Smoke。

### 完成条件

同一 Notification 可通过 Feishu Bot 和 App 分别投递成功。

---

## Phase 7：DingTalk Webhook

### 任务

- [ ] Markdown Renderer。
- [ ] Webhook URL Secret + official host/path allowlist。
- [ ] Optional Sign Secret。
- [ ] Signature Generation（Unix milliseconds + DingTalk HMAC contract）。
- [ ] Send / Deadline / redirect=error。
- [ ] Response Parse。
- [ ] Error Mapping。
- [ ] Payload Guard。
- [ ] Test Send。

### 测试门禁

- [ ] Contract Mock 全场景。
- [ ] 有/无 Sign Secret。
- [ ] Markdown escape。
- [ ] URL allowlist：wrong host / http / redirect 必须拒绝。
- [ ] 429 / 500 / Timeout Mock。
- [ ] Staging 钉钉测试群 Smoke。

### 完成条件

真实钉钉测试群收到测试消息，错误 Sign Secret 能明确失败。

---

## Phase 8：WeCom Webhook

### 任务

- [ ] Markdown Renderer。
- [ ] Webhook URL Secret + official host/path allowlist。
- [ ] Send / Deadline / redirect=error。
- [ ] Response Parse。
- [ ] Error Mapping。
- [ ] 3 KiB Internal Markdown Guard。
- [ ] UTF-8 Byte Truncation。
- [ ] Test Send。

### 测试门禁

- [ ] Contract Mock 全场景。
- [ ] UTF-8 Boundary。
- [ ] 中文/Emoji 长内容。
- [ ] URL allowlist：wrong host / http / redirect 必须拒绝。
- [ ] 429 / 500 / Timeout Mock。
- [ ] Staging 企业微信测试群 Smoke。

### 完成条件

真实企业微信测试群收到测试消息，超长内容不会造成未处理错误。

---

## Phase 9：SecretStore

### 任务

- [ ] MASTER_KEY Parse。
- [ ] AES-GCM Encrypt / Decrypt。
- [ ] Random Nonce。
- [ ] AAD。
- [ ] Global Secret。
- [ ] Target Secret。
- [ ] GitHub Secret Generate/Rotate（current + previous 30min overlap）。
- [ ] MASTER_KEY recovery document。
- [ ] Provider URL Redaction。

### 测试门禁

- [ ] SECRET-001~008。
- [ ] Wrong key / AAD。
- [ ] GitHub current secret accepted。
- [ ] GitHub previous secret accepted within 30min。
- [ ] GitHub previous secret rejected after expiry。
- [ ] Log Scan。
- [ ] Export Scan。

### 完成条件

数据库、API、Export、普通日志中都不能直接看到敏感 Secret 明文。

---

## Phase 10：Admin Authentication

### 任务

- [ ] Login API。
- [ ] ADMIN_PASSWORD Compare。
- [ ] Rate Limit。
- [ ] Session Signing。
- [ ] Cookie。
- [ ] Logout。
- [ ] API Middleware。
- [ ] Origin Check。
- [ ] Security Headers。

### 测试门禁

- [ ] AUTH-001~010。
- [ ] Session tamper。
- [ ] Origin reject。
- [ ] Login rate limit。

### 完成条件

无合法 Session 无法访问配置 API，Webhook 入口不依赖 Admin Session。

---

## Phase 11：Config UI

### 任务

- [ ] Layout / Login。
- [ ] Overview Shell。
- [ ] Targets CRUD。
- [ ] Platform / Method 联动表单。
- [ ] Target Test。
- [ ] Routes CRUD。
- [ ] Settings。
- [ ] GitHub Secret Rotate。
- [ ] Feishu App Verify。
- [ ] Inline Validation。
- [ ] XSS-safe DOM rendering（external text only via textContent/DOM API）。
- [ ] Loading / Empty / Error States。

### 测试门禁

- [ ] API Integration。
- [ ] Secret 不回显。
- [ ] Sanitized Export。
- [ ] Test Send source 标记。
- [ ] 页面错误状态可见。

UI 不实现任何用户、角色、租户、审计页面。

---

## Phase 12：统计

### 任务

- [ ] Event Status Update。
- [ ] Delivery Result Insert。
- [ ] Test Delivery Source。
- [ ] 24h / 7d / 30d。
- [ ] Event Breakdown。
- [ ] Repository Breakdown。
- [ ] Provider Breakdown。
- [ ] Channel Breakdown。
- [ ] Recent Failures。
- [ ] Stale Processing Count。
- [ ] SVG Trend。

### 测试门禁

- [ ] 80/20 success fixture。
- [ ] Zero delivery。
- [ ] UTC boundary。
- [ ] Provider / Channel Breakdown。
- [ ] Test Delivery exclusion。

### 完成条件

真实 Staging GitHub 事件后刷新页面可看到与 D1 一致的平台级成功/失败统计。

---

## Phase 13：Cleanup / Observability

### 任务

- [ ] Scheduled Handler。
- [ ] 30-day Cleanup。
- [ ] Expired previous GitHub Secret cleanup（或惰性清理）。
- [ ] Structured Logs。
- [ ] Redaction。
- [ ] Duration Measurement。
- [ ] Production Observability。

### 测试门禁

- [ ] 30-day boundary。
- [ ] Cleanup idempotent。
- [ ] Secret log scan。
- [ ] Runtime exception log format。

---

## Phase 14：Config Export / Import

### 任务

- [ ] Sanitized Export。
- [ ] Version Field = 2。
- [ ] Import Validation。
- [ ] Conflict Preview。
- [ ] Replace Strategy。
- [ ] Unknown Channel Type 拒绝。

### 测试门禁

- [ ] Export Secret Scan。
- [ ] Invalid JSON。
- [ ] Unknown Version。
- [ ] Unknown Channel Type。
- [ ] Route references missing Target。

Secret 永远不导入导出。

---

## Phase 15：Staging E2E

### 任务

- [ ] 建立 GitHub E2E Test Repository。
- [ ] 建立 3 个 IM 测试群。
- [ ] 配置 Staging Worker + Staging D1。
- [ ] Push E2E。
- [ ] PR Open/Merge E2E。
- [ ] Workflow Success E2E。
- [ ] Workflow Failure E2E。
- [ ] Release E2E。
- [ ] 一个事件四 Channel 投递。
- [ ] GitHub Recent Delivery / Redeliver 调试流程验证。

### 完成条件

GitHub Test Repository 的真实事件能稳定进入 Staging，并在对应测试群产生符合路由预期的通知。

---

## Phase 16：Release Hardening

### 自动测试

- [ ] 全量 Unit。
- [ ] 全量 Integration。
- [ ] Coverage Gate。
- [ ] Empty DB Migration。
- [ ] Previous Schema Migration。
- [ ] Security Tests。
- [ ] Stats Tests。

### 故障模拟

- [ ] 单 Provider 失败不影响其他 Provider。
- [ ] 20 次重复 Delivery + 并发 duplicate race。
- [ ] Provider URL allowlist / redirect blocking。
- [ ] Fan-out > 6。
- [ ] Deadline exhaustion。
- [ ] Malformed Input。
- [ ] 1 MiB Body。
- [ ] 429 Simulation。
- [ ] Timeout Simulation。
- [ ] D1 Initial Insert Failure。
- [ ] Provider Invalid JSON。
- [ ] Secret Log Scan。

### 真实 Smoke

- [ ] Feishu Bot。
- [ ] Feishu App。
- [ ] DingTalk Bot。
- [ ] WeCom Bot。

### 文档

- [ ] README。
- [ ] Deployment Docs。
- [ ] Upgrade/Migration Docs。
- [ ] Test/E2E Docs。

### 完成条件

满足第 26 章全部 Production Release Gate 后才允许标记 V1 Release。

---

# 26. 验收标准与 Production Release Gate

本章所有“必须”项属于 V1 Release Gate。

## 26.1 GitHub Ingress

- [ ] `ping` 返回 200。
- [ ] Push 正常。
- [ ] PR opened / merged 正常。
- [ ] Workflow success / failure / cancelled / timed_out 能正确标准化。
- [ ] Release published 正常。
- [ ] 错误签名无法进入业务。
- [ ] Unicode Payload 验签正确。
- [ ] 1 MiB 超限请求被拒绝。
- [ ] 重复 Delivery 不重复通知。
- [ ] 并发相同 Delivery 只有一个请求获得处理权。
- [ ] Unsupported Event 200 ignored。
- [ ] workflow_run requested/in_progress 不产生通知。
- [ ] GitHub 接收路径正常目标 8 秒内完成，硬性必须低于 GitHub 10 秒窗口。

## 26.2 Routing

- [ ] Repository 精确匹配。
- [ ] Branch 条件正确。
- [ ] PR action / merged 条件正确。
- [ ] Workflow conclusion / name 条件正确。
- [ ] Release action 条件正确。
- [ ] Disabled Route 不生效。
- [ ] Disabled Target 不发送。
- [ ] 多 Route Target 去重。
- [ ] 同一 Route 可以选择跨平台 Target。
- [ ] resolved Target 数量不得超过 6。
- [ ] 单个 Provider 失败不阻断其他 Provider。

## 26.3 Feishu Webhook

- [ ] 无签名 Bot 可发送。
- [ ] 有签名 Bot 可发送。
- [ ] Invalid Webhook 被记录失败。
- [ ] 429 正确映射。
- [ ] Timeout 正确映射。
- [ ] 测试发送可用。
- [ ] Production Smoke 1 条成功。

## 26.4 Feishu App

- [ ] App 验证可用。
- [ ] `chat_id` 可发送。
- [ ] `open_id` 可发送。
- [ ] Token 可复用。
- [ ] Token 失败可识别。
- [ ] App API Logical Error 可识别。
- [ ] App Secret 不返回前端。
- [ ] Production Smoke 1 条成功。

## 26.5 DingTalk Webhook

- [ ] 无加签机器人可发送。
- [ ] 加签机器人可发送。
- [ ] Markdown 正常。
- [ ] 加签错误可识别。
- [ ] API 错误可映射。
- [ ] 429 / Timeout 可映射。
- [ ] 测试发送可用。
- [ ] Production Smoke 1 条成功。

## 26.6 WeCom Webhook

- [ ] Markdown 正常。
- [ ] UTF-8 字节裁剪正确。
- [ ] 中文/Emoji 长消息不会突破内部 Guard。
- [ ] Webhook URL 不返回前端。
- [ ] API 错误可映射。
- [ ] 429 / Timeout 可映射。
- [ ] 测试发送可用。
- [ ] Production Smoke 1 条成功。

## 26.7 Delivery Contract

每个 `DeliveryResult` 必须满足：

- [ ] `targetId` 正确。
- [ ] `provider` 正确。
- [ ] `channelType` 正确。
- [ ] `success` 正确。
- [ ] `httpStatus` 可用时正确。
- [ ] Provider Code 可用时被保存。
- [ ] `durationMs` 有值。
- [ ] `errorSummary` 不含 Secret。

## 26.8 管理页面

- [ ] 配置 Target 无需改代码。
- [ ] 配置 Route 无需重新部署。
- [ ] Platform / Method 表单只允许 V1 有效组合。
- [ ] Secret 可更新但不可读回。
- [ ] Test Send 可用。
- [ ] Feishu App Verify 可用。
- [ ] Provider / Channel 统计可见。
- [ ] Recent Failures 可见。
- [ ] 空数据页面正常。
- [ ] 错误状态明确，不静默失败。

## 26.9 Admin Security

- [ ] 不存在任意 URL 转发。
- [ ] Secret 不进入 Git。
- [ ] Secret 不进入普通日志。
- [ ] Secret 不进入 Config Export。
- [ ] Cookie `HttpOnly`。
- [ ] Cookie `Secure`（Production）。
- [ ] Cookie `SameSite` 按设计配置。
- [ ] Origin 检查。
- [ ] Login Rate Limit。
- [ ] GitHub HMAC。
- [ ] CSP / Security Headers。
- [ ] Webhook URL 全部按 Secret 处理。
- [ ] Feishu/DingTalk/WeCom Webhook URL 只能命中官方 allowlist。
- [ ] Provider fetch 禁止跟随 Redirect。
- [ ] Admin UI 不把外部字符串直接写入 innerHTML。

## 26.10 D1 与 Migration

- [ ] 空数据库可运行全部 migrations。
- [ ] 上一版本 Schema 可升级到当前版本。
- [ ] Migration 不依赖手工 SQL。
- [ ] Migration Failure 不会偷偷继续部署。
- [ ] Event Initial Insert Failure 不产生 Provider Call。
- [ ] Atomic idempotency 使用 PRIMARY KEY + ON CONFLICT，不使用 SELECT-then-INSERT。
- [ ] Target + Secret / Import 等多行配置写入使用 D1 batch 原子提交。
- [ ] 30-day Cleanup 正常。
- [ ] Cleanup 可重复执行。

## 26.11 统计

- [ ] 24h / 7d / 30d。
- [ ] Event Count。
- [ ] Delivery Count。
- [ ] Success Rate。
- [ ] Failure Count。
- [ ] Provider Breakdown。
- [ ] Channel Breakdown。
- [ ] Event Breakdown。
- [ ] Repository Top。
- [ ] Recent Failures。
- [ ] Test Delivery 不污染默认成功率。
- [ ] 0 Delivery 不出现 NaN/Infinity。
- [ ] UTC 时间边界正确。

## 26.12 Automated Quality Gate

Production Release 前：

```bash
npm ci
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:coverage
```

全部必须成功。

建议 Coverage Gate：

```text
Statements  ≥ 80%
Branches    ≥ 75%
Functions   ≥ 80%
Lines       ≥ 80%
```

核心安全/路由模块不得仅靠总体覆盖率掩盖缺失分支测试。

## 26.13 Staging E2E Gate

必须在独立 GitHub E2E 仓库执行：

- [ ] Push。
- [ ] PR opened。
- [ ] PR merged。
- [ ] Workflow success。
- [ ] Workflow failure。
- [ ] Release published。
- [ ] 一个 Event 同时命中多 Provider。
- [ ] 单 Provider 人工故障不影响其他 Provider。

并确认：

- [ ] Overview 统计正确。
- [ ] D1 Delivery 行与实际收到的消息一致。
- [ ] Workers Logs 无 Secret。

## 26.14 Production Smoke Gate

部署后只做低频测试：

```text
Feishu Webhook  1 条
Feishu App      1 条
DingTalk        1 条
WeCom           1 条
```

成功后检查：

- [ ] 页面 Target Healthy/Test Send 成功。
- [ ] D1 记录 `source=test`。
- [ ] 默认业务成功率不被 Smoke/Test 污染。
- [ ] Workers Logs 无异常。

禁止 Production 群压测。

## 26.15 最终 Go / No-Go

只有下列全部成立才 Go：

```text
CI 全绿
+
Migration Gate 通过
+
Staging E2E 通过
+
4 Channel Production Smoke 通过
+
Secret Scan 通过
+
无 P0/P1 已知缺陷
```

出现任意以下情况必须 No-Go：

- GitHub HMAC 可绕过。
- 重复 / 并发 Delivery 会重复群发。
- Provider URL 可以跳出官方 allowlist 或通过 Redirect 访问任意目标。
- 同步 fan-out 无法稳定控制在 GitHub 10 秒窗口内。
- Secret 会出现在 API/日志/Export。
- 单个平台失败会阻断所有平台。
- Migration 可能破坏现有配置。
- Worker 无法稳定在 GitHub Webhook 超时窗口内响应。
- Dashboard 成功率与 D1 真实 Delivery 明显不一致。

---

# 27. 后续扩展边界

以下不是 V1，但架构应允许以后增加。

## 27.1 新 GitHub Event

例如：

```text
issues
deployment_status
discussion
check_run
```

只新增 parser、route condition schema、notification builder；不修改 Channel 核心。

## 27.2 DingTalk App

只有需要：

- 指定用户通知。
- 企业内部应用身份。
- 更复杂互动卡片。
- 双向动作。

才新增：

```text
dingtalk_app
```

而不是让 `dingtalk_webhook` 承担应用能力。

## 27.3 WeCom App

只有需要：

- 指定成员 / 部门应用消息。
- 企业微信自建应用身份。
- 更深的企业微信 API。

才新增：

```text
wecom_app
```

对应独立 Token Client / Adapter。

## 27.4 Feishu Callback

如果未来需要：

```text
卡片按钮
@机器人
重新运行 CI
```

新增：

```text
POST /callbacks/feishu
```

不改 GitHub Webhook 流程。

其他 Provider 的 Callback 同样独立增加，不建设一个“万能 callback DSL”。

## 27.5 Queue

只有明确需要可靠异步投递时：

```text
GitHub
↓
Ingress Worker
↓
Queue
↓
Consumer
↓
Channels
```

当前 Event / Router / Notification / Channel 可以复用。

## 27.6 Analytics Engine

只有事件量明显变大、D1 30 天聚合不够或需要高维时间序列才迁移统计。

D1 继续保留配置。

## 27.7 新 Provider

例如 Slack / Telegram 未来真有需求时：

```text
新增 ChannelType
新增 Target validation
新增 Renderer + Adapter
新增测试
新增 UI 选项
```

不得修改 GitHub Parser。

## 27.8 个人微信

个人微信不是规划中的 Provider。

除非未来腾讯提供适合本项目的正式、稳定、可合规使用的服务器端消息 API，否则不接入：

- PC Hook。
- 逆向协议。
- 非官方登录。
- 模拟个人客户端。

# 28. 风险与取舍

## 28.1 不使用 Queue

优点：少资源、少消费者、少重试策略、部署简单。

代价：极端 Worker 中断时可能丢一次通知。

当前是通知网关，可接受。

## 28.2 使用 D1 做统计

优点：配置和统计一个存储、SQL 简单、Recent Failures 自然、开发量小。

代价：不适合长期大规模 Metrics。

当前只保留 30 天。

## 28.3 原生前端

优点：无前端框架依赖、Static Assets 直接部署、安全边界清晰。

代价：UI 组件需要少量原生 DOM 逻辑。

## 28.4 单全局 GitHub Secret

优点：配置和验签最简单。

代价：多仓库共享一个 Secret。

V1 接受，并通过 `current + previous` 最多 30 分钟的轮换重叠窗口降低多仓库更新期间的通知中断风险；不扩展为 per-repository Secret 管理系统。

## 28.5 只有 Feishu App，没有 DingTalk/WeCom App

这是主动的范围控制，不是架构缺陷。

原因：

- 当前核心需求是通知。
- 钉钉 / 企微 Webhook 已覆盖群通知。
- Feishu App 是已明确提出的指定用户/群应用能力需求。
- 同时开发 3 套 App Token / 权限 / Recipient 模型会明显扩大 V1。

未来新增 `dingtalk_app` / `wecom_app` 不会破坏 Channel 抽象。

## 28.6 多平台 Markdown 差异

钉钉和企业微信虽然都支持 Markdown 类消息，但语法和限制不是完全一致。

因此禁止实现一个“通用 Markdown 字符串直接群发三平台”的方案。

必须：

```text
Notification
↓
Provider-specific Renderer
```

## 28.7 Provider API 变化

IM 平台的消息格式、限流、安全设置可能调整。

工程措施：

- Provider API 都封装在独立 Adapter。
- 不把平台限制散落在 Router/Builder。
- 开发/发布前用官方文档和真实测试群复核。
- Provider 限制写成命名常量并配测试，不散落魔法数字。

# 29. 官方参考资料

开发时以官方平台文档的最新行为为最终依据。第三方文章只能用于定位资料，不作为协议规范。

## Cloudflare

- Workers: https://developers.cloudflare.com/workers/
- Runtime APIs: https://developers.cloudflare.com/workers/runtime-apis/
- Bindings: https://developers.cloudflare.com/workers/runtime-apis/bindings/
- Secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Static Assets: https://developers.cloudflare.com/workers/static-assets/
- D1 Worker API: https://developers.cloudflare.com/d1/worker-api/
- Rate Limiting Binding: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Observability: https://developers.cloudflare.com/workers/observability/
- Testing: https://developers.cloudflare.com/workers/testing/
- Vitest Integration: https://developers.cloudflare.com/workers/testing/vitest-integration/
- Vitest Recipes / outbound mock / D1 testing: https://developers.cloudflare.com/workers/testing/vitest-integration/recipes/
- Local Explorer: https://developers.cloudflare.com/workers/local-development/local-explorer/
- Local Dev Tunnels: https://developers.cloudflare.com/workers/local-development/local-dev-tunnels/
- D1 Local Development: https://developers.cloudflare.com/d1/best-practices/local-development/
- D1 Overview: https://developers.cloudflare.com/d1/
- D1 SQL Statements: https://developers.cloudflare.com/d1/sql-api/sql-statements/
- D1 Query Best Practices: https://developers.cloudflare.com/d1/best-practices/query-d1/
- Workers KV - How KV Works / Consistency: https://developers.cloudflare.com/kv/concepts/how-kv-works/
- Analytics Engine: https://developers.cloudflare.com/analytics/analytics-engine/
- Queues: https://developers.cloudflare.com/queues/
- Durable Objects: https://developers.cloudflare.com/durable-objects/
- R2: https://developers.cloudflare.com/r2/

## GitHub

- Validating Webhook Deliveries: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- Webhook Events and Payloads: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- Creating Webhooks: https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks
- Handling Webhook Deliveries: https://docs.github.com/en/webhooks/using-webhooks/handling-webhook-deliveries
- Handling Failed Webhook Deliveries: https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries
- Viewing Webhook Deliveries: https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries
- Redelivering Webhooks: https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks

## Feishu

- 开放平台: https://open.feishu.cn/
- 自定义机器人文档: https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
- 自定义机器人入口: `https://open.feishu.cn/open-apis/bot/v2/hook/...`
- tenant_access_token 文档: https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal
- tenant_access_token: `POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal`
- 发送消息文档: https://open.feishu.cn/document/server-docs/im-v1/message/create
- 发送消息: `POST https://open.feishu.cn/open-apis/im/v1/messages`

开发时应重新确认自定义机器人消息格式、签名方式、请求体限制和频率限制。

## DingTalk

- 钉钉开放平台: https://open.dingtalk.com/
- 自定义机器人接入: https://open.dingtalk.com/document/orgapp/custom-robot-access
- 自定义机器人安全设置/加签: https://open.dingtalk.com/document/dingstart/customize-robot-security-settings

开发时重点确认：

- Webhook URL 格式。
- 自定义机器人安全设置。
- 加签算法。
- Markdown 消息格式。
- 调用频率限制。

## WeCom / 企业微信

- 企业微信开发者中心: https://developer.work.weixin.qq.com/
- 群机器人配置说明: https://developer.work.weixin.qq.com/document/path/91770
- 发送应用消息（未来 WeCom App 参考）: https://developer.work.weixin.qq.com/document/path/90236

V1 群机器人重点使用 Markdown；开发时重新确认官方当前消息格式、字节限制和发送频率。

# Appendix I：V1 Implementation Contract（必须遵守）

本附录用于冻结“不同开发者不能自行发挥”的关键行为，不增加新产品能力。

## I.1 不可改变的运行常量

```ts
MAX_WEBHOOK_BODY_BYTES = 1 * 1024 * 1024;
WEBHOOK_HARD_BUDGET_MS = 8_000;
PROVIDER_TIMEOUT_MS = 3_000;
PROVIDER_CONCURRENCY = 3;
MAX_RESOLVED_TARGETS_PER_EVENT = 6;
RESPONSE_RESERVE_MS = 500;
EVENT_RETENTION_DAYS = 30;
```

这些值以后可以根据真实指标调整，但 V1 开发阶段不得由各模块自行定义不同值。

## I.2 Provider URL Contract

```text
Feishu Bot  → https://open.feishu.cn/open-apis/bot/v2/hook/*
DingTalk    → https://oapi.dingtalk.com/robot/send?access_token=*
WeCom       → https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=*
Feishu App  → URL 固定在代码中，不接受配置
```

全部：

```text
HTTPS only
no userinfo
no custom port
redirect = error
validate on write + validate before send
```

## I.3 GitHub Event Contract

```text
push          → route
pull_request  → route
release       → route
workflow_run  → only action=completed routes
ping          → pong, no event/delivery
unknown       → 200 ignored, no provider call
```

## I.4 Idempotency Contract

```text
PRIMARY KEY(events.id = X-GitHub-Delivery)
+ INSERT ... ON CONFLICT DO NOTHING
+ result.meta.changes
```

禁止：

```text
SELECT → not found → INSERT
```

## I.5 Delivery Contract

一个 Target 的失败：

```text
只影响该 Delivery
不 throw 中断其他 Target
最终写入 deliveries
```

只有以下错误允许中止整个事件发送：

- Notification Builder 无法构造基本消息。
- resolved Target 超过 V1 fan-out 上限。
- 关键 D1 状态不可写且尚未进行外部发送。

## I.6 D1 Transaction Contract

使用 `DB.batch()` 原子完成：

```text
Target + Secret create/update/delete
GitHub Secret rotate
Config import replace
```

单条普通读写使用 prepared statement；业务请求不使用 `exec()`。

## I.7 UI Security Contract

```text
external string → textContent / createTextNode
external URL    → URL parse + https check → href
innerHTML       → only static trusted template
```

## I.8 不新增基础设施原则

出现性能或可靠性问题时，必须先用现有数据证明瓶颈，再按第 5.3 / 27 章升级。

V1 禁止为了“可能以后需要”提前加入：KV、Queue、Durable Objects、R2、Analytics Engine、Redis、外部数据库、前端框架或插件系统。

---

# Appendix T：最小可执行测试清单

开发者拿到项目后，可以按下面顺序验证环境和核心链路：

```bash
# 1. 安装
npm ci

# 2. 类型
npm run typecheck

# 3. 本地 D1
npm run db:migrate:local

# 4. 自动测试
npm run test:unit
npm run test:integration
npm run test:coverage

# 5. 启动 Worker
npm run dev
```

另一个终端：

```bash
# 6. 模拟 GitHub
npm run webhook:test -- push
npm run webhook:test -- workflow_failure

# 7. 幂等
npm run webhook:test -- workflow_failure --delivery-id idem-001
npm run webhook:test -- workflow_failure --delivery-id idem-001
```

检查：

```text
http://localhost:8787/cdn-cgi/explorer
```

确认：

```text
events: 事件状态正确
deliveries: 数量正确
duplicate: 第二次未新增 delivery
```

然后再进入：

```text
Provider Smoke
↓
GitHub Test Repository E2E
↓
Staging
↓
Production
```

---

# Appendix A：推荐错误码

```text
AUTH_REQUIRED
AUTH_INVALID_PASSWORD
AUTH_RATE_LIMITED
AUTH_INVALID_SESSION
AUTH_ORIGIN_REJECTED

WEBHOOK_METHOD_NOT_ALLOWED
WEBHOOK_UNSUPPORTED_CONTENT_TYPE
WEBHOOK_BODY_TOO_LARGE
WEBHOOK_SIGNATURE_MISSING
WEBHOOK_SIGNATURE_INVALID
WEBHOOK_INVALID_JSON
WEBHOOK_DELIVERY_ID_MISSING

GITHUB_EVENT_UNSUPPORTED
GITHUB_EVENT_PARSE_ERROR

TARGET_NOT_FOUND
TARGET_DISABLED
TARGET_IN_USE
TARGET_CONFIG_INVALID
CHANNEL_NOT_SUPPORTED

ROUTE_NOT_FOUND
ROUTE_CONFIG_INVALID
TARGET_FANOUT_LIMIT_EXCEEDED

PROVIDER_RATE_LIMITED
PROVIDER_DEADLINE_EXCEEDED

SECRET_NOT_CONFIGURED
SECRET_ENCRYPT_ERROR
SECRET_DECRYPT_ERROR

FEISHU_WEBHOOK_CONFIG_ERROR
FEISHU_WEBHOOK_TIMEOUT
FEISHU_WEBHOOK_HTTP_ERROR
FEISHU_WEBHOOK_API_ERROR
FEISHU_WEBHOOK_INVALID_RESPONSE

FEISHU_APP_NOT_CONFIGURED
FEISHU_APP_TOKEN_ERROR
FEISHU_APP_TIMEOUT
FEISHU_APP_HTTP_ERROR
FEISHU_APP_API_ERROR
FEISHU_APP_INVALID_RESPONSE

DINGTALK_WEBHOOK_CONFIG_ERROR
DINGTALK_WEBHOOK_TIMEOUT
DINGTALK_WEBHOOK_HTTP_ERROR
DINGTALK_WEBHOOK_API_ERROR
DINGTALK_WEBHOOK_INVALID_RESPONSE

WECOM_WEBHOOK_CONFIG_ERROR
WECOM_WEBHOOK_TIMEOUT
WECOM_WEBHOOK_HTTP_ERROR
WECOM_WEBHOOK_API_ERROR
WECOM_WEBHOOK_INVALID_RESPONSE

PAYLOAD_TOO_LARGE_AFTER_RENDER
PROVIDER_RENDER_ERROR

DB_READ_ERROR
DB_WRITE_ERROR
INTERNAL_ERROR
```

# Appendix B：推荐 HTTP Status

| 场景 | HTTP |
|---|---:|
| 正常 | 200 |
| 创建成功 | 201 |
| 参数错误 | 400 |
| 未登录 | 401 |
| GitHub 签名错误 | 401 |
| Origin 拒绝 | 403 |
| 不存在 | 404 |
| Method 错误 | 405 |
| Target 被 Route 使用 | 409 |
| Payload 过大 | 413 |
| Content-Type 错误 | 415 |
| Login 限流 | 429 |
| 初始化/数据库关键故障 | 500 |
| 系统未完成初始设置 | 503 |

---

# Appendix C：核心 Webhook 伪代码

```ts
async function handleGithubWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  const deadlineAt = Date.now() + 8_000;

  assertPost(request);
  assertJson(request);

  const rawBody = await readBodyLimited(
    request,
    1024 * 1024
  );

  const signature =
    request.headers.get("x-hub-signature-256");

  const acceptedSecrets =
    await secretStore.getAcceptedGithubSecrets(env);

  const signatureValid = signature
    ? await verifyGithubSignatureAny(
        rawBody,
        signature,
        acceptedSecrets
      )
    : false;

  if (!signatureValid) {
    return jsonError(
      401,
      "WEBHOOK_SIGNATURE_INVALID"
    );
  }

  const githubEvent =
    request.headers.get("x-github-event");

  const deliveryId =
    request.headers.get("x-github-delivery");

  if (!deliveryId) {
    return jsonError(
      400,
      "WEBHOOK_DELIVERY_ID_MISSING"
    );
  }

  if (githubEvent === "ping") {
    return jsonOk({ message: "pong" });
  }

  const payload =
    JSON.parse(new TextDecoder().decode(rawBody));

  let event: GithubEvent;

  try {
    event = parseGithubEvent(
      githubEvent,
      deliveryId,
      payload
    );
  } catch (error) {
    if (isUnsupportedEvent(error)) {
      return jsonOk({ ignored: true });
    }

    return jsonError(
      400,
      "GITHUB_EVENT_PARSE_ERROR"
    );
  }

  // 原子幂等边界：禁止 SELECT-then-INSERT
  const claim = await claimProcessingEvent(
    env.DB,
    event
  );

  if (!claim.inserted) {
    return jsonOk({ duplicate: true });
  }

  if (
    event.type === "workflow_run" &&
    event.action !== "completed"
  ) {
    await markEventIgnored(
      env.DB,
      event.deliveryId
    );
    return jsonOk({ ignored: true });
  }

  try {
    const routes =
      await loadMatchingRoutes(
        env.DB,
        event.repository,
        event.type
      );

    const targets =
      await matchAndResolveTargets(
        env.DB,
        event,
        routes
      );

    if (targets.length > 6) {
      await markEventInternalError(
        env.DB,
        event.deliveryId,
        "TARGET_FANOUT_LIMIT_EXCEEDED"
      );
      return jsonOk({
        accepted: true,
        processingError: true
      });
    }

    if (targets.length === 0) {
      await markEventIgnored(
        env.DB,
        event.deliveryId
      );

      return jsonOk({ ignored: true });
    }

    const notification =
      buildNotification(event);

    const results =
      await mapLimitWithDeadline(
        targets,
        3,
        deadlineAt,
        target =>
          sendToTarget(
            env,
            target,
            notification,
            deadlineAt
          )
      );

    await saveDeliveryResults(
      env.DB,
      event,
      results
    );

    await markEventProcessed(
      env.DB,
      event.deliveryId,
      routes.length
    );

    return jsonOk({
      delivered: results.length,
      success: results.filter(
        r => r.success
      ).length,
      failed: results.filter(
        r => !r.success
      ).length
    });
  } catch (error) {
    await markEventInternalError(
      env.DB,
      event.deliveryId,
      safeError(error)
    );

    // 已经建立幂等记录后，不应盲目让 GitHub 重放。
    console.error(
      safeLogError(error)
    );

    return jsonOk({
      accepted: true,
      processingError: true
    });
  }
}
```

> 实现阶段应进一步区分“任何外部发送尚未发生之前的内部失败”和“已经可能发送之后的内部失败”。一旦存在外部发送成功的可能，就优先避免 GitHub 重放造成重复通知。

---

# Appendix D：配置示例

## Targets

```json
[
  {
    "id": "dev-feishu",
    "name": "飞书开发群",
    "type": "feishu_webhook",
    "enabled": true
  },
  {
    "id": "owner-feishu",
    "name": "飞书负责人",
    "type": "feishu_app",
    "receiveIdType": "open_id",
    "receiveId": "ou_xxx",
    "enabled": true
  },
  {
    "id": "dev-dingtalk",
    "name": "钉钉研发群",
    "type": "dingtalk_webhook",
    "enabled": true
  },
  {
    "id": "ops-wecom",
    "name": "企业微信告警群",
    "type": "wecom_webhook",
    "enabled": true
  }
]
```

## Routes

```json
[
  {
    "id": "main-push",
    "name": "Main Push",
    "repository": "owner/project",
    "eventType": "push",
    "conditions": {
      "branch": "main"
    },
    "targetIds": [
      "dev-feishu",
      "dev-dingtalk"
    ],
    "enabled": true,
    "priority": 100
  },
  {
    "id": "ci-failure",
    "name": "CI Failure",
    "repository": "owner/project",
    "eventType": "workflow_run",
    "conditions": {
      "branch": "main",
      "conclusion": [
        "failure",
        "timed_out"
      ]
    },
    "targetIds": [
      "dev-feishu",
      "owner-feishu",
      "dev-dingtalk",
      "ops-wecom"
    ],
    "enabled": true,
    "priority": 100
  }
]
```

## Secret Snapshot（概念）

不会出现在普通 Export 中：

```text
global/github/webhook_secret

global/feishu_app/app_secret

target/dev-feishu/webhook_url
target/dev-feishu/sign_secret

target/dev-dingtalk/webhook_url
target/dev-dingtalk/sign_secret

target/ops-wecom/webhook_url
```

# Appendix E：最终 V1 架构确认

最终 V1 必须保持：

```text
1 Cloudflare Worker
1 D1 Database
1 Static Config / Overview UI
1 GitHub Webhook Endpoint

4 GitHub Event Parsers
1 Simple Router
1 Provider-neutral Notification Model
1 Channel Registry

4 Notification Channels
  ├─ Feishu Webhook
  ├─ Feishu App
  ├─ DingTalk Webhook
  └─ WeCom Webhook

3 Providers
  ├─ Feishu
  ├─ DingTalk
  └─ WeCom

1 Single Admin Password
1 Encrypted Secret Store

30 Days Event / Delivery Summary
Provider + Channel Success/Failure Statistics
Workers Logs for Deep Debugging
```

明确不增加：

```text
No Personal WeChat Hook
No DingTalk App in V1
No WeCom App in V1
No KV
No Queue
No R2
No Durable Objects
No Analytics Engine
No ORM
No Backend Framework
No Frontend Framework
No Multi-tenant
No RBAC
No Audit Platform
No Plugin System
No Generic Proxy
```

## V1 架构判定规则

如果开发过程中出现“为了更通用”而想增加基础设施或抽象，先回答：

1. 当前四个 Channel 是否真的做不到？
2. 当前单 Worker + D1 是否真的无法满足？
3. 是否存在真实用户场景，而不是想象中的未来需求？

三个问题中没有明确“是”，就不增加。

## 核心成功标准

这个项目最终应该让使用者做到：

```text
部署 Worker
↓
打开配置页
↓
添加飞书 / 钉钉 / 企业微信 Target
↓
配置 GitHub Webhook Secret
↓
添加 Repository Route
↓
Test Send
↓
开始接收通知
```

整个过程中不需要修改业务代码，也不需要理解 Cloudflare D1 表结构。

这就是 V1 的最终产品边界。


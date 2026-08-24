# AGENTS.md - git2im 开发指引与智能体规范

> 本文档是 `git2im` 项目的 AI Agent 核心开发指引与规范基线。
> 详尽设计方案请参考完整设计文档：`docs/github-im-notification-gateway-design.md`，UI 规范请参考 `DESIGN.md`。

---

## 1. 项目定位与核心流程

`git2im` 是基于 Cloudflare Workers 构建的轻量级 GitHub 事件到 IM（飞书、钉钉、企业微信）的通知网关。

核心业务管道遵循 4 步无状态流转：
```text
Receive (Webhook 验签/幂等)
  ↓
Normalize (标准化为 GithubEvent)
  ↓
Route (多规则匹配与 Target 去重)
  ↓
Send (各平台适配器渲染与并发投递)
```

---

## 2. 架构硬性约束 (Strict Constraints - 严禁破坏)

为保持系统极简、高效、易维护与低开销，所有 Agent 在编写代码时必须严格遵守以下原则：

1. **禁止引入 Web 运行时框架**：
   - 严禁安装或引入 Hono、Express、Fastify、NestJS 等框架。
   - 全部使用 Web Standards API（`Request`, `Response`, `fetch`, `Web Crypto`），路由采用轻量原生原生实现（`src/http/router.ts`）。
2. **D1 为 V1 唯一业务 Source of Truth**：
   - 严禁在 V1 中引入或混用 KV、Queues、R2、Durable Objects、Redis 或外部数据库。
   - 所有配置（Targets/Routes/Settings）、幂等约束、事件摘要、统计聚合均基于 Cloudflare D1 (SQLite)。
3. **禁止引入 ORM**：
   - 严禁引入 Prisma、Drizzle、TypeORM 等。直接通过 D1 API 执行标准预编译 SQL。
4. **管理前端极简无框架**：
   - `public/` 目录下全部采用原生 HTML5 + CSS3 + 原生 ES Modules + SVG 绘制图表。
   - 严禁引入 React、Vue、Angular 或大型图表库（ECharts/Chart.js）。
5. **单 Worker 极简部署**：
   - 所有服务端逻辑整合在单 Worker 运行，配合 Workers Static Assets 托管前端静态资源。

---

## 3. 安全与数据完整性铁律

1. **Secret 绝不回显与明文泄露**：
   - 启动密钥：`ADMIN_PASSWORD` 与 `MASTER_KEY` 仅通过 Cloudflare Secrets 管理，不写入 D1。
   - 业务凭据（Webhook URL、Feishu App Secret、Sign Secret）必须通过 **AES-256-GCM** 加密后写入 D1。
   - 前端 API 查询配置时**严禁回显 Secret 明文**（仅返回脱敏标记如 `configured: true`）。
   - 日志与配置导出（Export）必须做字段脱敏，绝不输出任何密钥与 Token。
2. **防 SSRF 与 Webhook 白名单**：
   - 投递目标 Webhook URL 必须通过官方权威域名白名单校验：
     - 飞书：`open.feishu.cn`
     - 钉钉：`oapi.dingtalk.com`
     - 企业微信：`qyapi.weixin.qq.com`
   - 发起 `fetch` 请求时**必须显式指定 `redirect: "error"`**，严禁跟随重定向。
3. **隐私与短期数据生命周期**：
   - 严禁持久化存储 GitHub 原始 Payload、Commit Diff、IM 完整请求/响应体。
   - `events` 与 `deliveries` 仅保存元数据与错误摘要，默认保留 30 天，由 Scheduled Handler 定时清理。
4. **原子幂等性**：
   - 使用 GitHub `X-GitHub-Delivery` 配合 D1 `PRIMARY KEY` 约束实现原子幂等，严禁使用弱一致性的 SELECT-then-INSERT 模式。

---

## 4. V1 功能范围与通道规范

### 4.1 支持的 GitHub 事件
- `push`（代码推送）
- `pull_request`（PR 打开、更新、关闭、合并）
- `workflow_run`（Actions 运行完成结果）
- `release`（版本发布）
- `ping`（连通性测试）

### 4.2 支持的 4 类通知通道
1. `feishu_webhook`：飞书自定义机器人 Webhook（支持加签）。
2. `feishu_app`：飞书企业自建应用 OpenAPI（支持 `chat_id` 与 `open_id`）。
3. `dingtalk_webhook`：钉钉自定义机器人 Webhook（支持加签，Markdown）。
4. `wecom_webhook`：企业微信群机器人 Webhook（Markdown，严格做 UTF-8 字节截断防超限）。

*(注：个人微信、钉钉/企微自建应用、双向交互控制、多租户/RBAC 属于明确非目标，严禁提前扩展)*

---

## 5. 目录结构规范

```text
git2im/
├── src/
│   ├── index.ts                # Worker 入口 (Fetch & Scheduled)
│   ├── env.ts                  # 环境变量与 Binding 类型定义
│   ├── http/                   # 轻量原生 HTTP 路由与响应辅助
│   ├── github/                 # Webhook 验签、请求头与事件解析
│   │   └── events/             # push, pull-request, workflow-run, release
│   ├── notification/           # 标准化消息模型与路由匹配器 (Route Matcher)
│   ├── channels/               # 各平台适配器 (feishu, dingtalk, wecom)
│   ├── config/                 # Targets / Routes / Settings 配置校验
│   ├── security/               # Web Crypto AES-256-GCM, Session, 密码哈希
│   ├── storage/                # D1 数据操作 (DB Client, Events, Deliveries, Stats)
│   ├── api/                    # 管理端 REST API (Auth, Targets, Routes, Stats, Export)
│   └── scheduled/              # 定时清理任务 (Cleanup)
├── public/                     # 原生静态管理页面 (HTML / CSS / JS / SVG)
├── migrations/                 # D1 SQL 迁移脚本 (如 0001_initial.sql)
├── test/                       # 单元与集成测试 (Vitest)
│   ├── fixtures/               # GitHub Webhook 样本 JSON
│   ├── unit/                   # 单元测试
│   └── integration/            # Workers Runtime 集成测试
├── wrangler.jsonc              # Cloudflare Worker 配置文件
├── vitest.config.ts            # Vitest 测试配置
└── tsconfig.json               # TypeScript 配置
```

---

## 6. 常用开发与测试命令

```bash
# 1. 依赖安装
npm install

# 2. 本地数据库迁移 (Local D1)
npx wrangler d1 migrations apply DB --local

# 3. 本地开发调试 (包含静态资源)
npm run dev
# 或: npx wrangler dev

# 4. 执行全量测试
npm test
# 或: npx vitest run

# 5. 类型检查
npm run typecheck

# 6. 生成生产部署
npx wrangler deploy
```

---

## 7. 编码与实现质量要求

- **错误处理**：下游 IM 发送失败不导致 GitHub Webhook 返回 500（避免 GitHub 误判重投导致重复消息），下游错误记录至 `deliveries` 并体现在管理面板。
- **XSS 防护**：前端 UI 渲染所有动态外部文本（如 commit 信息、repo 名称）必须通过 `textContent` 或安全 DOM 操作，严禁直接拼入 `innerHTML`。
- **单通道隔离**：单次事件分发到多个 Target 时，单 Target 投递超时或异常不得阻断其他 Target。

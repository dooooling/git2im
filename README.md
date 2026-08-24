# git2im - GitHub IM Notification Gateway

<div align="center">

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)
![Cloudflare D1](https://img.shields.io/badge/Cloudflare_D1-SQLite-blue?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-Passing-green?style=flat-square&logo=vitest&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)

**基于 Cloudflare Workers 构建的轻量级、高可靠 GitHub 事件到 IM（飞书、钉钉、企业微信）通知网关**

[项目简介](#-项目简介) • [核心特性](#-核心特性) • [快速开始](#-快速开始) • [生产部署指南](#-生产部署指南) • [Webhook 配置](#-github-webhook-配置指引) • [安全实践](#-生产安全最佳实践)

</div>

---

## 📖 项目简介

`git2im` 是基于 Cloudflare Workers 构建的 GitHub Webhook 通知网关，用于将 GitHub 仓库事件（Push、PR、Actions、Release 等）格式化并实时推送到飞书、钉钉、企业微信等即时通讯（IM）平台。

系统采用 Web Standards API 与 Cloudflare D1 构建，不依赖重型 Web 框架，集成原生管理面板用于配置目标通道、分发规则与查看投递日志。

```text
GitHub Webhook ──> [ 验签 & 原子幂等 ] ──> [ 事件标准化 ] ──> [ 路由匹配与去重 ] ──> [ 并发投递调度 ]
                                                                                   │
                                         ┌─────────────────┬───────────────────────┼────────────────────┐
                                         ▼                 ▼                       ▼                    ▼
                                  飞书自定义机器人    飞书企业自建应用         钉钉自定义机器人     企业微信群机器人
                                  (Interactive)     (OpenAPI / 多接收人)    (Markdown 加签)      (Markdown 截断)
```

---

## ✨ 核心特性

- **支持多种事件与通知通道**：
  - **GitHub 事件**：`push`、`pull_request`、`workflow_run`（Actions 运行完成）、`release`、`ping`。
  - **飞书 Webhook**：支持自定义加签密钥与富文本卡片排版。
  - **飞书自建应用**：支持独立 App ID / App Secret，单目标支持配置多个群聊（`chat_id`）与个人（`open_id`）并行投递。
  - **钉钉 Webhook**：支持 HmacSHA256 加签与 Markdown 格式。
  - **企业微信 Webhook**：支持 Markdown 格式与 3 KiB UTF-8 字节截断防超限保护。
- **多维路由与去重**：
  - 支持仓库精确匹配与通配符（如 `*` 或 `owner/repo`）。
  - 支持按分支（如 `main`, `release/*`）、PR Action、Actions 结果进行条件过滤。
  - 单事件多规则匹配时自动对 Target 进行去重，并限制最大 6 个 Target 分发上限。
  - 支持 Target 与 Route 的名称唯一性及内容指纹去重校验。
- **安全性与可靠性**：
  - **凭据加密**：下游 Webhook URL、加签密钥、App Secret 通过 AES-256-GCM 加密存储，前端脱敏展示。
  - **密钥轮换**：支持 GitHub Webhook Secret 轮换，保留 30 分钟旧密钥兼容窗口。
  - **防 SSRF**：下游 Webhook URL 限制为官方权威域名白名单，显式禁止 HTTP 重定向。
  - **原子幂等**：基于 `X-GitHub-Delivery` 与 D1 数据库主键约束，避免重复事件多次发送。
- **轻量部署与管理面板**：
  - 单 Worker 整合 API 路由与静态资源托管，数据存储于 Cloudflare D1 (SQLite)。
  - 原生单页管理前端，支持 Target / Route / Settings 的增删改查、测试连通性与投递统计。
  - 支持中英文（i18n）即时切换。

---

## ⚡ 快速开始

### 1. 环境准备
- Node.js >= 20.0.0
- npm >= 9.0.0

### 2. 克隆与安装依赖
```bash
git clone https://github.com/your-org/git2im.git
cd git2im
npm install
```

### 3. 本地数据库初始化 (Local D1)
```bash
npm run db:migrate:local
```

### 4. 启动本地开发服务
```bash
npm run dev
```
开发服务器启动后，在浏览器访问：
- **控制台页面**：[http://127.0.0.1:8787](http://127.0.0.1:8787)
- **本地默认密码**：`admin-password-for-local-dev-123456`（配置于 `.dev.vars`）
- **健康检查接口**：`http://127.0.0.1:8787/health`
- **GitHub Webhook 接收端点**：`http://127.0.0.1:8787/webhooks/github`

### 5. 执行全量自动化测试
```bash
# 运行全部 22 个测试套件，96 项测试
npm test

# 执行 TypeScript 严格类型检查
npm run typecheck
```

---

## 🚀 生产部署指南

本项目支持 Cloudflare 自动 D1 资源分配与自动化迁移部署流程，**无需手动在配置文件中填写 Database ID**。

### 方式一：Cloudflare 控制台自动构建（推荐）

1. **连接 GitHub 仓库**：
   在 Cloudflare 控制台进入 **Workers & Pages** -> **Create** -> 连接并选择您的 `git2im` 仓库。
2. **配置构建命令**：
   - **Deploy command**（部署命令）：填入 **`npm run deploy`**
   - *（该命令会在构建时自动执行远程数据库迁移并完成 Worker 发布）*。
3. **配置生产密钥 (Secrets)**：
   首次部署完成后，进入该 Worker 的 **Settings** -> **Variables and Secrets**，添加以下两个必填 Secret：
   - **`ADMIN_PASSWORD`**：设置管理后台登录密码；
   - **`MASTER_KEY`**：设置 32 字节 Base64 主加密密钥（可用下述 Node.js 命令一键生成）。

> 💡 **生成 MASTER_KEY 提示**：
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
> ```

---

### 方式二：本地 CLI 命令行部署

1. **授权登录 Cloudflare**：
   ```bash
   npx wrangler login
   ```
2. **设置生产 Secret**：
   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put MASTER_KEY
   ```
3. **一键迁移并部署**：
   ```bash
   npm run deploy
   ```
   部署完成后，终端将输出您的正式访问域名（如 `https://git2im.<your-subdomain>.workers.dev`）。

---

## 🔧 GitHub Webhook 配置指引

登录 GitHub 进入需要监听的仓库（或 GitHub Organization 组织）：
1. 进入 **Settings** -> **Webhooks** -> **Add webhook**；
2. **Payload URL**：填入 `https://<your-worker-domain>/webhooks/github`；
3. **Content type**：必须选择 **`application/json`**；
4. **Secret**：在 `git2im` 管理后台「系统设置」中点击「生成/轮换 GitHub Webhook Secret」，复制生成的密钥填入此处；
5. **Which events would you like to trigger this webhook?**：
   选择 **Let me select individual events**，勾选：
   - [x] **Pushes**（代码提交推送）
   - [x] **Pull requests**（PR 创建、更新、关闭与合并）
   - [x] **Workflow runs**（Actions 持续集成完成结果）
   - [x] **Releases**（版本发布）
6. 点击 **Add webhook** 保存。

---

## 🔒 生产安全最佳实践

1. **接入 Cloudflare Zero Trust (强烈推荐)**：
   - 在 Cloudflare Dashboard 为网关域名开启 **Cloudflare Access**。
   - 访问管理后台前需通过企业邮箱（Google/GitHub SSO 或邮件 OTP）鉴权，阻断公网扫描与爆破。
2. **定期清理与隐私生命周期**：
   - 系统内置 Daily Scheduled Cron 任务，自动清理 30 天前的事件元数据与投递日志，原始 GitHub Payload 与敏感 Commit Diff 从不持久化落库。
3. **域名白名单**：
   - 目标 Webhook 地址强制限定为 `open.feishu.cn`, `oapi.dingtalk.com`, `qyapi.weixin.qq.com`，杜绝内网 SSRF 风险。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。

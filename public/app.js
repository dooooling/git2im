/**
 * git2im Frontend Application (Native ES Modules with N:N Feishu App & i18n support)
 *
 * 核心设计规范：
 * 1. 严格遵守 DESIGN.md：全站 Weight 400、9999px 胶囊圆角、发丝边框无阴影、Geist Mono 大写 Eyebrow。
 * 2. 动态文本全部使用 textContent 或安全 DOM 创建，严格防御 XSS。
 * 3. 完整支持中英文一键无刷新切换 (i18n)。
 * 4. 飞书企业自建应用直接在 Target 级别独立配置 App ID、App Secret 及多个群聊/接收人。
 */

import { t, setLocale, getLocale } from "./i18n.js";

// 全局应用状态
const state = {
  authenticated: false,
  currentTab: "overview",
  timeframe: "24h",
  stats: null,
  targets: [],
  routes: [],
  settings: null,
  failures: [],
};

/**
 * 通用 Fetch 封装 (带 401 自动拦截与统一 Toast 错误提示)
 */
async function apiFetch(endpoint, options = {}) {
  const defaultHeaders = {
    "Content-Type": "application/json",
  };

  const response = await fetch(endpoint, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });

  const json = await response.json().catch(() => ({}));

  if (response.status === 401) {
    state.authenticated = false;
    renderAuthStatus();
    showLoginModal();
    throw new Error(json.error?.message || "Unauthorized");
  }

  if (!response.ok || json.ok === false) {
    const errorMsg = json.error?.message || response.statusText || "Request failed";
    showToast(errorMsg, "error");
    throw new Error(errorMsg);
  }

  return json.data;
}

/**
 * Toast 提示组件
 */
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast badge-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    toast.style.transition = "all 0.2s ease";
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

/**
 * 模态框辅助函数
 */
function openModal(title, bodyElement, footerButtons = []) {
  const container = document.getElementById("modal-container");
  if (!container) return;

  container.innerHTML = "";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const card = document.createElement("div");
  card.className = "modal-card";

  const header = document.createElement("div");
  header.className = "modal-header";

  const titleEl = document.createElement("h3");
  titleEl.className = "modal-title";
  titleEl.textContent = title;

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn btn-sm";
  closeBtn.textContent = "✕";
  closeBtn.onclick = closeModal;

  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  const footer = document.createElement("div");
  footer.className = "modal-footer";

  footerButtons.forEach((btn) => {
    const b = document.createElement("button");
    b.className = `btn ${btn.className || ""}`;
    b.textContent = btn.text;
    b.onclick = () => btn.onClick(closeModal);
    footer.appendChild(b);
  });

  card.appendChild(header);
  card.appendChild(bodyElement);
  if (footerButtons.length > 0) {
    card.appendChild(footer);
  }

  overlay.appendChild(card);
  container.appendChild(overlay);
}

function closeModal() {
  const container = document.getElementById("modal-container");
  if (container) container.innerHTML = "";
}

/**
 * 登录模态框
 */
function showLoginModal() {
  const form = document.createElement("form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const pwdInput = form.querySelector("#admin-password-input");
    const password = pwdInput.value;

    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      state.authenticated = true;
      closeModal();
      showToast(t("login_success"), "success");
      renderAuthStatus();
      loadCurrentTab();
    } catch {
      // 错误已由 apiFetch 提示
    }
  };

  const group = document.createElement("div");
  group.className = "form-group";

  const label = document.createElement("label");
  label.className = "form-label";
  label.textContent = t("admin_password");

  const input = document.createElement("input");
  input.id = "admin-password-input";
  input.type = "password";
  input.className = "form-control";
  input.placeholder = t("password_placeholder");
  input.required = true;

  group.appendChild(label);
  group.appendChild(input);
  form.appendChild(group);

  openModal(t("login_title"), form, [
    { text: t("cancel"), onClick: closeModal },
    {
      text: t("login_action"),
      className: "btn-primary",
      onClick: () => {
        form.requestSubmit();
      },
    },
  ]);

  setTimeout(() => input.focus(), 100);
}

/**
 * 渲染顶部 Auth 状态与语言按钮
 */
function renderAuthStatus() {
  const container = document.getElementById("auth-status-container");
  if (!container) return;
  container.innerHTML = "";

  if (state.authenticated) {
    const logoutBtn = document.createElement("button");
    logoutBtn.className = "btn btn-sm";
    logoutBtn.textContent = t("logout_btn");
    logoutBtn.onclick = async () => {
      await apiFetch("/api/auth/logout", { method: "POST" });
      state.authenticated = false;
      renderAuthStatus();
      showToast(t("logout_success"), "info");
      loadCurrentTab();
    };
    container.appendChild(logoutBtn);
  } else {
    const loginBtn = document.createElement("button");
    loginBtn.className = "btn btn-sm btn-primary";
    loginBtn.textContent = t("login_btn");
    loginBtn.onclick = showLoginModal;
    container.appendChild(loginBtn);
  }

  // 刷新顶部导航文字
  updateNavLabels();
}

/**
 * 刷新导航 Tab 标签文字
 */
function updateNavLabels() {
  const tabs = {
    overview: t("nav_overview"),
    targets: t("nav_targets"),
    routes: t("nav_routes"),
    settings: t("nav_settings"),
    failures: t("nav_failures"),
    export: t("nav_export"),
  };

  for (const [k, text] of Object.entries(tabs)) {
    const el = document.getElementById(`nav-tab-${k}`);
    if (el) el.textContent = text;
  }

  const langBtn = document.getElementById("lang-switch-btn");
  if (langBtn) {
    langBtn.textContent = getLocale() === "zh-CN" ? "中文 / EN" : "EN / 中文";
  }
}

/**
 * 检查登录状态
 */
async function checkAuth() {
  try {
    const res = await apiFetch("/api/auth/me");
    state.authenticated = res.authenticated;
  } catch {
    state.authenticated = false;
  }
  renderAuthStatus();
}

/**
 * 渲染 Overview / Dashboard 视图
 */
async function renderOverview(container) {
  container.innerHTML = "";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.marginBottom = "24px";

  const titleGroup = document.createElement("div");
  const eyebrow = document.createElement("div");
  eyebrow.className = "eyebrow-mono";
  eyebrow.textContent = t("metrics_eyebrow");
  const title = document.createElement("h1");
  title.className = "heading-display";
  title.style.marginBottom = "0";
  title.textContent = t("metrics_title");
  titleGroup.appendChild(eyebrow);
  titleGroup.appendChild(title);

  // Timeframe 选择器
  const timeframeGroup = document.createElement("div");
  timeframeGroup.style.display = "flex";
  timeframeGroup.style.gap = "8px";

  ["24h", "7d", "30d"].forEach((tf) => {
    const btn = document.createElement("button");
    btn.className = `btn btn-sm ${state.timeframe === tf ? "btn-primary" : ""}`;
    btn.textContent = tf.toUpperCase();
    btn.onclick = () => {
      state.timeframe = tf;
      renderOverview(container);
    };
    timeframeGroup.appendChild(btn);
  });

  header.appendChild(titleGroup);
  header.appendChild(timeframeGroup);
  container.appendChild(header);

  // 加载 Stats
  let stats;
  try {
    stats = await apiFetch(`/api/stats/overview?timeframe=${state.timeframe}`);
  } catch {
    return;
  }

  // 1. 4 大核心卡片
  const grid = document.createElement("div");
  grid.className = "metrics-grid";

  const metrics = [
    { label: t("metric_valid_events"), value: stats.validEvents, sub: t("metric_valid_events_sub") },
    { label: t("metric_deliveries"), value: stats.totalDeliveries, sub: t("metric_deliveries_sub", { success: stats.successDeliveries, failed: stats.failedDeliveries }) },
    { label: t("metric_success_rate"), value: `${stats.successRate}%`, sub: t("metric_success_rate_sub") },
    { label: t("metric_stale"), value: stats.staleProcessingCount, sub: t("metric_stale_sub") },
  ];

  metrics.forEach((m) => {
    const card = document.createElement("div");
    card.className = "metric-card";
    const ey = document.createElement("div");
    ey.className = "eyebrow-mono";
    ey.textContent = m.label;
    const val = document.createElement("div");
    val.className = "metric-value";
    val.textContent = String(m.value);
    const sub = document.createElement("div");
    sub.className = "metric-sub";
    sub.textContent = m.sub;

    card.appendChild(ey);
    card.appendChild(val);
    card.appendChild(sub);
    grid.appendChild(card);
  });

  container.appendChild(grid);

  // 2. 趋势折线图
  const trendCard = document.createElement("div");
  trendCard.className = "card";
  const trendEyebrow = document.createElement("div");
  trendEyebrow.className = "eyebrow-mono";
  trendEyebrow.textContent = t("trend_eyebrow", { timeframe: state.timeframe.toUpperCase() });
  const trendTitle = document.createElement("h2");
  trendTitle.className = "heading-section";
  trendTitle.textContent = t("trend_title");

  trendCard.appendChild(trendEyebrow);
  trendCard.appendChild(trendTitle);

  const chartContainer = document.createElement("div");
  chartContainer.className = "trend-chart-container";
  chartContainer.innerHTML = renderTrendSvg(stats.trend);
  trendCard.appendChild(chartContainer);

  container.appendChild(trendCard);

  // 3. 分布矩阵 (2 列)
  const grid2 = document.createElement("div");
  grid2.className = "grid-2";

  // Provider 表现矩阵
  const providerCard = document.createElement("div");
  providerCard.className = "card";
  providerCard.innerHTML = `<div class="eyebrow-mono">${t("providers_eyebrow")}</div><h2 class="heading-section">${t("providers_title")}</h2>`;
  const provTable = document.createElement("table");
  provTable.className = "data-table";
  provTable.innerHTML = `
    <thead>
      <tr>
        <th>Provider</th>
        <th>Attempts</th>
        <th>Success</th>
        <th>Rate</th>
        <th>Avg Latency</th>
      </tr>
    </thead>
    <tbody>
      ${stats.providers.map(p => `
        <tr>
          <td><span class="badge">${p.provider.toUpperCase()}</span></td>
          <td>${p.attempts}</td>
          <td>${p.success}</td>
          <td><span class="badge ${p.successRate >= 99 ? "badge-success" : p.successRate > 80 ? "badge-warning" : "badge-error"}"><span class="badge-dot"></span>${p.successRate}%</span></td>
          <td>${p.avgDurationMs}ms</td>
        </tr>
      `).join("") || `<tr><td colspan="5" style="text-align:center; color:var(--color-body-mid);">${t("no_delivery_data")}</td></tr>`}
    </tbody>
  `;
  providerCard.appendChild(provTable);
  grid2.appendChild(providerCard);

  // Top 仓库分布
  const repoCard = document.createElement("div");
  repoCard.className = "card";
  repoCard.innerHTML = `<div class="eyebrow-mono">${t("repos_eyebrow")}</div><h2 class="heading-section">${t("repos_title")}</h2>`;
  const repoTable = document.createElement("table");
  repoTable.className = "data-table";
  repoTable.innerHTML = `
    <thead>
      <tr>
        <th>Repository</th>
        <th>Events Count</th>
      </tr>
    </thead>
    <tbody>
      ${stats.topRepositories.map(r => `
        <tr>
          <td><code>${escapeHtml(r.repository)}</code></td>
          <td>${r.count}</td>
        </tr>
      `).join("") || `<tr><td colspan="2" style="text-align:center; color:var(--color-body-mid);">${t("no_event_data")}</td></tr>`}
    </tbody>
  `;
  repoCard.appendChild(repoTable);
  grid2.appendChild(repoCard);

  container.appendChild(grid2);
}

/**
 * 生成纯原生 SVG 趋势图
 */
function renderTrendSvg(points) {
  if (!points || points.length === 0) {
    return `<div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--color-body-mid);">${t("no_trend_data")}</div>`;
  }

  const width = 1100;
  const height = 200;
  const padding = { top: 20, right: 30, bottom: 30, left: 40 };

  const maxVal = Math.max(...points.map(p => p.success + p.failed), 5);
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const getX = (idx) => padding.left + (idx / (points.length - 1)) * chartW;
  const getY = (val) => padding.top + chartH - (val / maxVal) * chartH;

  // 成功折线点
  const successPoints = points.map((p, i) => `${getX(i)},${getY(p.success)}`).join(" ");
  // 失败折线点
  const failedPoints = points.map((p, i) => `${getX(i)},${getY(p.failed)}`).join(" ");

  // X 轴标签
  const step = Math.ceil(points.length / 8);
  const labels = points
    .map((p, i) => {
      if (i % step === 0 || i === points.length - 1) {
        return `<text x="${getX(i)}" y="${height - 8}" fill="#7d8187" font-size="11" font-family="var(--font-mono)" text-anchor="middle">${p.timeLabel}</text>`;
      }
      return "";
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" class="trend-svg">
      <!-- 网格线 -->
      <line x1="${padding.left}" y1="${getY(0)}" x2="${width - padding.right}" y2="${getY(0)}" stroke="#212327" stroke-width="1" />
      <line x1="${padding.left}" y1="${getY(maxVal / 2)}" x2="${width - padding.right}" y2="${getY(maxVal / 2)}" stroke="#212327" stroke-width="1" stroke-dasharray="4" />
      <line x1="${padding.left}" y1="${getY(maxVal)}" x2="${width - padding.right}" y2="${getY(maxVal)}" stroke="#212327" stroke-width="1" stroke-dasharray="4" />

      <!-- 折线 -->
      <polyline fill="none" stroke="#30d158" stroke-width="2" points="${successPoints}" />
      <polyline fill="none" stroke="#ff453a" stroke-width="2" points="${failedPoints}" />

      <!-- 数据圆点 -->
      ${points.map((p, i) => `<circle cx="${getX(i)}" cy="${getY(p.success)}" r="3" fill="#30d158" />`).join("")}
      ${points.map((p, i) => p.failed > 0 ? `<circle cx="${getX(i)}" cy="${getY(p.failed)}" r="3" fill="#ff453a" />` : "").join("")}

      <!-- 坐标标签 -->
      ${labels}
    </svg>
  `;
}

/**
 * 渲染 Targets 目标管理视图
 */
async function renderTargets(container) {
  container.innerHTML = "";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.marginBottom = "24px";

  const titleGroup = document.createElement("div");
  const eyebrow = document.createElement("div");
  eyebrow.className = "eyebrow-mono";
  eyebrow.textContent = t("targets_eyebrow");
  const title = document.createElement("h1");
  title.className = "heading-display";
  title.style.marginBottom = "0";
  title.textContent = t("targets_title");
  titleGroup.appendChild(eyebrow);
  titleGroup.appendChild(title);

  const addBtn = document.createElement("button");
  addBtn.className = "btn btn-primary";
  addBtn.textContent = t("add_target_btn");
  addBtn.onclick = () => showTargetModal();

  header.appendChild(titleGroup);
  header.appendChild(addBtn);
  container.appendChild(header);

  let targets = [];
  try {
    targets = await apiFetch("/api/targets");
    state.targets = targets;
  } catch {
    return;
  }

  const card = document.createElement("div");
  card.className = "card";

  const table = document.createElement("table");
  table.className = "data-table";

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>${t("th_name")}</th>
      <th>${t("th_type")}</th>
      <th>${t("th_status")}</th>
      <th>${t("th_credentials")}</th>
      <th>${t("th_last_test")}</th>
      <th style="text-align:right;">${t("th_actions")}</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  if (targets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--color-body-mid); padding:32px 0;">${t("no_targets")}</td></tr>`;
  } else {
    targets.forEach((tItem) => {
      const tr = document.createElement("tr");

      // Name
      const tdName = document.createElement("td");
      tdName.innerHTML = `<div>${escapeHtml(tItem.name)}</div><div style="font-size:11px; color:var(--color-body-mid); font-family:var(--font-mono);">${tItem.id}</div>`;

      // Type
      const tdType = document.createElement("td");
      tdType.innerHTML = `<span class="badge">${tItem.type}</span>`;

      // Status
      const tdStatus = document.createElement("td");
      tdStatus.innerHTML = tItem.enabled
        ? `<span class="badge badge-success"><span class="badge-dot"></span>ENABLED</span>`
        : `<span class="badge"><span class="badge-dot"></span>DISABLED</span>`;

      // Credentials / App
      const tdCreds = document.createElement("td");
      if (tItem.type === "feishu_app") {
        const recipientsCount = (tItem.recipients || []).length;
        tdCreds.innerHTML = `
          <div><span class="badge">App: <code>${escapeHtml(tItem.appId || "")}</code></span> ${tItem.appSecretConfigured ? '<span class="badge badge-success">Secret ✔</span>' : '<span class="badge badge-error">No Secret</span>'}</div>
          <div style="font-size:11px; color:var(--color-body-mid); margin-top:4px;">${recipientsCount} Recipient(s) configured</div>
        `;
      } else {
        tdCreds.innerHTML = tItem.webhookConfigured
          ? `<span class="badge badge-success">Webhook URL ✔</span>`
          : `<span class="badge badge-error">Not Configured</span>`;
        if (tItem.signSecretConfigured) {
          tdCreds.innerHTML += ` <span class="badge badge-info">Sign ✔</span>`;
        }
      }

      // Last Test
      const tdTest = document.createElement("td");
      if (tItem.lastTest) {
        const isSuccess = tItem.lastTest.status === "success";
        tdTest.innerHTML = `<span class="badge ${isSuccess ? "badge-success" : "badge-error"}"><span class="badge-dot"></span>${tItem.lastTest.status.toUpperCase()} (${tItem.lastTest.durationMs}ms)</span>`;
      } else {
        tdTest.innerHTML = `<span style="color:var(--color-body-mid); font-size:12px;">${t("untested")}</span>`;
      }

      // Actions
      const tdActions = document.createElement("td");
      tdActions.style.textAlign = "right";

      const testBtn = document.createElement("button");
      testBtn.className = "btn btn-sm";
      testBtn.textContent = t("test_btn");
      testBtn.onclick = async () => {
        testBtn.textContent = t("testing");
        try {
          const res = await apiFetch(`/api/targets/${tItem.id}/test`, { method: "POST" });
          if (res.success) {
            showToast(t("test_success", { name: tItem.name }), "success");
          } else {
            showToast(t("test_failed", { error: res.errorSummary || res.errorCode }), "error");
          }
          renderTargets(container);
        } catch {
          testBtn.textContent = t("test_btn");
        }
      };

      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-sm";
      editBtn.style.marginLeft = "8px";
      editBtn.textContent = t("edit_btn");
      editBtn.onclick = () => showTargetModal(tItem);

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-sm btn-danger";
      delBtn.style.marginLeft = "8px";
      delBtn.textContent = t("delete_btn");
      delBtn.onclick = async () => {
        if (confirm(t("delete_target_confirm", { name: tItem.name }))) {
          await apiFetch(`/api/targets/${tItem.id}`, { method: "DELETE" });
          showToast(t("target_deleted"), "success");
          renderTargets(container);
        }
      };

      tdActions.appendChild(testBtn);
      tdActions.appendChild(editBtn);
      tdActions.appendChild(delBtn);

      tr.appendChild(tdName);
      tr.appendChild(tdType);
      tr.appendChild(tdStatus);
      tr.appendChild(tdCreds);
      tr.appendChild(tdTest);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    });
  }

  table.appendChild(tbody);
  card.appendChild(table);
  container.appendChild(card);
}

/**
 * 目标创建 / 编辑模态框 (支持多接收人与独立 App 凭据)
 */
function showTargetModal(target = null) {
  const isEdit = !!target;

  const form = document.createElement("form");
  form.innerHTML = `
    <div class="form-group">
      <label class="form-label">${t("lbl_target_name")}</label>
      <input type="text" id="t-name" class="form-control" required value="${target ? escapeHtml(target.name) : ""}" placeholder="例如：支付告警专属飞书群">
    </div>

    <div class="form-group">
      <label class="form-label">${t("lbl_channel_type")}</label>
      <select id="t-type" class="form-control form-select" ${isEdit ? "disabled" : ""}>
        <option value="feishu_webhook" ${target?.type === "feishu_webhook" ? "selected" : ""}>${t("opt_feishu_webhook")}</option>
        <option value="feishu_app" ${target?.type === "feishu_app" ? "selected" : ""}>${t("opt_feishu_app")}</option>
        <option value="dingtalk_webhook" ${target?.type === "dingtalk_webhook" ? "selected" : ""}>${t("opt_dingtalk_webhook")}</option>
        <option value="wecom_webhook" ${target?.type === "wecom_webhook" ? "selected" : ""}>${t("opt_wecom_webhook")}</option>
      </select>
    </div>

    <!-- Webhook 字段 -->
    <div id="webhook-fields">
      <div class="form-group">
        <label class="form-label">${t("lbl_webhook_url")}</label>
        <input type="password" id="t-webhook" class="form-control" placeholder="${isEdit ? t("hint_secret_keep") : "https://..."}">
        <div class="form-hint" id="webhook-url-hint">${t("hint_webhook_url")}</div>
      </div>
      <div class="form-group" id="sign-secret-group">
        <label class="form-label">${t("lbl_sign_secret")}</label>
        <input type="password" id="t-sign" class="form-control" placeholder="${isEdit ? t("hint_secret_keep") : "SEC... / Secret"}">
      </div>
    </div>

    <!-- 飞书自建应用独立 App 凭据与多接收人字段 -->
    <div id="feishu-app-fields" style="display:none;">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">${t("lbl_app_id")}</label>
          <input type="text" id="t-app-id" class="form-control" value="${target ? escapeHtml(target.appId || "") : ""}" placeholder="cli_xxx">
        </div>
        <div class="form-group">
          <label class="form-label">${t("lbl_app_secret")}</label>
          <input type="password" id="t-app-secret" class="form-control" placeholder="${isEdit ? t("hint_secret_keep") : "App Secret"}">
        </div>
      </div>

      <div class="form-group">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <label class="form-label" style="margin-bottom:0;">${t("lbl_recipients")}</label>
          <button type="button" class="btn btn-sm" id="btn-add-recipient">${t("btn_add_recipient")}</button>
        </div>
        <div id="recipients-list-container" style="display:flex; flex-direction:column; gap:8px;"></div>
      </div>
    </div>

    <div class="form-group" style="margin-top:16px;">
      <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--color-body);">
        <input type="checkbox" id="t-enabled" ${!target || target.enabled ? "checked" : ""}>
        ${t("lbl_enable_target")}
      </label>
    </div>
  `;

  const typeSelect = form.querySelector("#t-type");
  const webhookFields = form.querySelector("#webhook-fields");
  const feishuAppFields = form.querySelector("#feishu-app-fields");
  const signGroup = form.querySelector("#sign-secret-group");
  const recipientsContainer = form.querySelector("#recipients-list-container");

  function addRecipientRow(type = "chat_id", idVal = "") {
    const row = document.createElement("div");
    row.className = "recipient-row";
    row.style.display = "flex";
    row.style.gap = "8px";
    row.innerHTML = `
      <select class="form-control form-select r-type" style="width:130px;">
        <option value="chat_id" ${type === "chat_id" ? "selected" : ""}>${t("opt_chat_id")}</option>
        <option value="open_id" ${type === "open_id" ? "selected" : ""}>${t("opt_open_id")}</option>
      </select>
      <input type="text" class="form-control r-id" placeholder="oc_xxx 或 ou_xxx" value="${escapeHtml(idVal)}" required>
      <button type="button" class="btn btn-sm btn-danger r-del">✕</button>
    `;

    row.querySelector(".r-del").onclick = () => row.remove();
    recipientsContainer.appendChild(row);
  }

  // 初始化接收人行
  const initialRecipients = target?.recipients || [{ receiveIdType: "chat_id", receiveId: "" }];
  initialRecipients.forEach(r => addRecipientRow(r.receiveIdType, r.receiveId));

  form.querySelector("#btn-add-recipient").onclick = () => addRecipientRow("chat_id", "");

  const updateTypeView = () => {
    const val = typeSelect.value;
    if (val === "feishu_app") {
      webhookFields.style.display = "none";
      feishuAppFields.style.display = "block";
    } else {
      webhookFields.style.display = "block";
      feishuAppFields.style.display = "none";
      signGroup.style.display = (val === "feishu_webhook" || val === "dingtalk_webhook") ? "block" : "none";
    }
  };

  typeSelect.onchange = updateTypeView;
  updateTypeView();

  openModal(isEdit ? t("modal_edit_target") : t("modal_add_target"), form, [
    { text: t("cancel"), onClick: closeModal },
    {
      text: isEdit ? t("edit_btn") : t("add_target_btn"),
      className: "btn-primary",
      onClick: async () => {
        const name = form.querySelector("#t-name").value.trim();
        const type = typeSelect.value;
        const enabled = form.querySelector("#t-enabled").checked;
        const webhookUrl = form.querySelector("#t-webhook").value.trim() || undefined;
        const signSecret = form.querySelector("#t-sign").value.trim() || undefined;

        let appId = undefined;
        let appSecret = undefined;
        let recipients = undefined;

        if (type === "feishu_app") {
          appId = form.querySelector("#t-app-id").value.trim();
          appSecret = form.querySelector("#t-app-secret").value.trim() || undefined;

          const rows = form.querySelectorAll(".recipient-row");
          recipients = Array.from(rows).map(row => ({
            receiveIdType: row.querySelector(".r-type").value,
            receiveId: row.querySelector(".r-id").value.trim(),
          })).filter(r => r.receiveId);

          if (!appId) {
            showToast("请输入飞书 App ID", "error");
            return;
          }
          if (!isEdit && !appSecret) {
            showToast("请输入飞书 App Secret", "error");
            return;
          }
          if (recipients.length === 0) {
            showToast("请至少添加一个接收人/群聊 ID", "error");
            return;
          }
        }

        if (!name) {
          showToast(t("lbl_target_name"), "error");
          return;
        }

        try {
          if (isEdit) {
            await apiFetch(`/api/targets/${target.id}`, {
              method: "PUT",
              body: JSON.stringify({
                name,
                enabled,
                webhookUrl,
                signSecret,
                appId,
                appSecret,
                recipients,
              }),
            });
          } else {
            await apiFetch("/api/targets", {
              method: "POST",
              body: JSON.stringify({
                name,
                type,
                enabled,
                webhookUrl,
                signSecret,
                appId,
                appSecret,
                recipients,
              }),
            });
          }
          showToast(t("target_saved"), "success");
          closeModal();
          renderTargets(document.getElementById("app-content"));
        } catch {
          // apiFetch 已提示错误
        }
      },
    },
  ]);
}

/**
 * 渲染 Routes 规则管理视图
 */
async function renderRoutes(container) {
  container.innerHTML = "";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.marginBottom = "24px";

  const titleGroup = document.createElement("div");
  const eyebrow = document.createElement("div");
  eyebrow.className = "eyebrow-mono";
  eyebrow.textContent = t("routes_eyebrow");
  const title = document.createElement("h1");
  title.className = "heading-display";
  title.style.marginBottom = "0";
  title.textContent = t("routes_title");
  titleGroup.appendChild(eyebrow);
  titleGroup.appendChild(title);

  const addBtn = document.createElement("button");
  addBtn.className = "btn btn-primary";
  addBtn.textContent = t("add_route_btn");
  addBtn.onclick = () => showRouteModal();

  header.appendChild(titleGroup);
  header.appendChild(addBtn);
  container.appendChild(header);

  let [routes, targets] = [[], []];
  try {
    [routes, targets] = await Promise.all([
      apiFetch("/api/routes"),
      apiFetch("/api/targets"),
    ]);
    state.routes = routes;
    state.targets = targets;
  } catch {
    return;
  }

  const targetMap = new Map(targets.map(t => [t.id, t.name]));

  const card = document.createElement("div");
  card.className = "card";

  const table = document.createElement("table");
  table.className = "data-table";

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>${t("th_priority")}</th>
      <th>${t("th_name")}</th>
      <th>${t("th_repo")}</th>
      <th>${t("th_event")}</th>
      <th>${t("th_conditions")}</th>
      <th>${t("th_targets")}</th>
      <th>${t("th_status")}</th>
      <th style="text-align:right;">${t("th_actions")}</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  if (routes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--color-body-mid); padding:32px 0;">${t("no_routes")}</td></tr>`;
  } else {
    routes.forEach((r) => {
      const tr = document.createElement("tr");

      // Priority
      const tdPrio = document.createElement("td");
      tdPrio.innerHTML = `<span class="badge">${r.priority}</span>`;

      // Name
      const tdName = document.createElement("td");
      tdName.textContent = r.name;

      // Repo
      const tdRepo = document.createElement("td");
      tdRepo.innerHTML = `<code>${escapeHtml(r.repository)}</code>`;

      // Event
      const tdEvent = document.createElement("td");
      tdEvent.innerHTML = `<span class="badge badge-info">${r.eventType}</span>`;

      // Conditions
      const tdConds = document.createElement("td");
      const condList = [];
      if (r.conditions?.branch) condList.push(`branch: ${r.conditions.branch}`);
      if (r.conditions?.action?.length) condList.push(`action: [${r.conditions.action.join(",")}]`);
      if (r.conditions?.conclusion?.length) condList.push(`conclusion: [${r.conditions.conclusion.join(",")}]`);
      if (r.conditions?.workflow) condList.push(`wf: ${r.conditions.workflow}`);
      if (r.conditions?.merged !== undefined) condList.push(`merged: ${r.conditions.merged}`);
      if (r.conditions?.prerelease !== undefined) condList.push(`prerelease: ${r.conditions.prerelease}`);

      tdConds.innerHTML = condList.length > 0
        ? condList.map(c => `<span class="badge" style="margin-right:4px;">${escapeHtml(c)}</span>`).join("")
        : `<span style="color:var(--color-body-mid); font-size:12px;">${t("all_matched")}</span>`;

      // Targets
      const tdTargets = document.createElement("td");
      tdTargets.innerHTML = (r.targetIds || [])
        .map(id => `<span class="badge">${escapeHtml(targetMap.get(id) || id)}</span>`)
        .join(" ") || `<span class="badge badge-error">${t("no_targets_selected")}</span>`;

      // Status
      const tdStatus = document.createElement("td");
      tdStatus.innerHTML = r.enabled
        ? `<span class="badge badge-success"><span class="badge-dot"></span>ENABLED</span>`
        : `<span class="badge"><span class="badge-dot"></span>DISABLED</span>`;

      // Actions
      const tdActions = document.createElement("td");
      tdActions.style.textAlign = "right";

      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-sm";
      editBtn.textContent = t("edit_btn");
      editBtn.onclick = () => showRouteModal(r);

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-sm btn-danger";
      delBtn.style.marginLeft = "8px";
      delBtn.textContent = t("delete_btn");
      delBtn.onclick = async () => {
        if (confirm(t("delete_route_confirm", { name: r.name }))) {
          await apiFetch(`/api/routes/${r.id}`, { method: "DELETE" });
          showToast(t("route_deleted"), "success");
          renderRoutes(container);
        }
      };

      tdActions.appendChild(editBtn);
      tdActions.appendChild(delBtn);

      tr.appendChild(tdPrio);
      tr.appendChild(tdName);
      tr.appendChild(tdRepo);
      tr.appendChild(tdEvent);
      tr.appendChild(tdConds);
      tr.appendChild(tdTargets);
      tr.appendChild(tdStatus);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    });
  }

  table.appendChild(tbody);
  card.appendChild(table);
  container.appendChild(card);
}

/**
 * 路由规则创建 / 编辑模态框
 */
function showRouteModal(route = null) {
  const isEdit = !!route;
  const targets = state.targets || [];

  const form = document.createElement("form");
  form.innerHTML = `
    <div class="form-group">
      <label class="form-label">${t("lbl_route_name")}</label>
      <input type="text" id="r-name" class="form-control" required value="${route ? escapeHtml(route.name) : ""}" placeholder="e.g. Main Branch Alert">
    </div>

    <div class="grid-2">
      <div class="form-group">
        <label class="form-label">${t("lbl_repository")}</label>
        <input type="text" id="r-repo" class="form-control" required value="${route ? escapeHtml(route.repository) : "*"}" placeholder="* or owner/repo">
        <div class="form-hint">${t("hint_all_repos")}</div>
      </div>
      <div class="form-group">
        <label class="form-label">${t("lbl_event_type")}</label>
        <select id="r-event" class="form-control form-select">
          <option value="push" ${route?.eventType === "push" ? "selected" : ""}>push</option>
          <option value="pull_request" ${route?.eventType === "pull_request" ? "selected" : ""}>pull_request</option>
          <option value="workflow_run" ${route?.eventType === "workflow_run" ? "selected" : ""}>workflow_run</option>
          <option value="release" ${route?.eventType === "release" ? "selected" : ""}>release</option>
        </select>
      </div>
    </div>

    <!-- 动态条件项 -->
    <div id="route-conditions-block" style="background:var(--color-canvas-soft); padding:16px; border-radius:var(--radius-sm); margin-bottom:18px;">
      <div class="eyebrow-mono" style="margin-bottom:12px;">${t("lbl_match_conditions")}</div>

      <div class="form-group" id="cond-branch-group">
        <label class="form-label">${t("lbl_branch_pattern")}</label>
        <input type="text" id="c-branch" class="form-control" value="${route?.conditions?.branch ? escapeHtml(route.conditions.branch) : ""}" placeholder="e.g. main or release/*">
      </div>

      <div class="form-group" id="cond-workflow-group" style="display:none;">
        <label class="form-label">${t("lbl_workflow_name")}</label>
        <input type="text" id="c-wf" class="form-control" value="${route?.conditions?.workflow ? escapeHtml(route.conditions.workflow) : ""}" placeholder="e.g. CI / Test">
        <div style="margin-top:10px;">
          <label class="form-label">${t("lbl_conclusions")}</label>
          <div style="display:flex; gap:12px; font-size:13px; color:var(--color-body);">
            <label><input type="checkbox" name="c-concl" value="failure" ${route?.conditions?.conclusion?.includes("failure") ? "checked" : ""}> failure</label>
            <label><input type="checkbox" name="c-concl" value="success" ${route?.conditions?.conclusion?.includes("success") ? "checked" : ""}> success</label>
            <label><input type="checkbox" name="c-concl" value="cancelled" ${route?.conditions?.conclusion?.includes("cancelled") ? "checked" : ""}> cancelled</label>
            <label><input type="checkbox" name="c-concl" value="timed_out" ${route?.conditions?.conclusion?.includes("timed_out") ? "checked" : ""}> timed_out</label>
          </div>
        </div>
      </div>

      <div class="form-group" id="cond-pr-group" style="display:none;">
        <label class="form-label">${t("lbl_pr_actions")}</label>
        <div style="display:flex; gap:12px; font-size:13px; color:var(--color-body);">
          <label><input type="checkbox" name="c-praction" value="opened" ${route?.conditions?.action?.includes("opened") ? "checked" : ""}> opened</label>
          <label><input type="checkbox" name="c-praction" value="merged" ${route?.conditions?.action?.includes("merged") ? "checked" : ""}> merged</label>
          <label><input type="checkbox" name="c-praction" value="closed" ${route?.conditions?.action?.includes("closed") ? "checked" : ""}> closed</label>
        </div>
      </div>
    </div>

    <!-- 关联 Target 列表 (最多 6 个) -->
    <div class="form-group">
      <label class="form-label">${t("lbl_select_targets")}</label>
      <div id="target-checkboxes" style="display:grid; grid-template-columns:1fr 1fr; gap:8px; max-height:160px; overflow-y:auto; padding:8px; background:var(--color-canvas-soft); border-radius:var(--radius-sm);">
        ${targets.map(tItem => `
          <label style="display:flex; align-items:center; gap:8px; font-size:13px; color:var(--color-body); cursor:pointer;">
            <input type="checkbox" name="r-targets" value="${tItem.id}" ${route?.targetIds?.includes(tItem.id) ? "checked" : ""}>
            <span>${escapeHtml(tItem.name)}</span>
          </label>
        `).join("") || `<div style="color:var(--color-body-mid); font-size:12px; grid-column:span 2;">${t("no_targets")}</div>`}
      </div>
    </div>

    <div class="grid-2">
      <div class="form-group">
        <label class="form-label">${t("lbl_priority")}</label>
        <input type="number" id="r-prio" class="form-control" value="${route ? route.priority : 100}">
      </div>
      <div class="form-group" style="display:flex; align-items:center; padding-top:28px;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; color:var(--color-body);">
          <input type="checkbox" id="r-enabled" ${!route || route.enabled ? "checked" : ""}>
          ${t("lbl_enable_route")}
        </label>
      </div>
    </div>
  `;

  const eventSelect = form.querySelector("#r-event");
  const condBranchGroup = form.querySelector("#cond-branch-group");
  const condWfGroup = form.querySelector("#cond-workflow-group");
  const condPrGroup = form.querySelector("#cond-pr-group");

  const updateCondView = () => {
    const val = eventSelect.value;
    condBranchGroup.style.display = (val === "push" || val === "pull_request" || val === "workflow_run") ? "block" : "none";
    condWfGroup.style.display = (val === "workflow_run") ? "block" : "none";
    condPrGroup.style.display = (val === "pull_request") ? "block" : "none";
  };

  eventSelect.onchange = updateCondView;
  updateCondView();

  openModal(isEdit ? t("modal_edit_route") : t("modal_add_route"), form, [
    { text: t("cancel"), onClick: closeModal },
    {
      text: isEdit ? t("edit_btn") : t("add_route_btn"),
      className: "btn-primary",
      onClick: async () => {
        const name = form.querySelector("#r-name").value.trim();
        const repository = form.querySelector("#r-repo").value.trim();
        const eventType = eventSelect.value;
        const priority = parseInt(form.querySelector("#r-prio").value, 10) || 100;
        const enabled = form.querySelector("#r-enabled").checked;

        // 收集选中的 targetIds
        const targetIds = Array.from(form.querySelectorAll("input[name='r-targets']:checked")).map(cb => cb.value);

        if (!name || !repository) {
          showToast(t("lbl_route_name"), "error");
          return;
        }

        if (targetIds.length === 0) {
          showToast(t("no_targets_selected"), "error");
          return;
        }

        if (targetIds.length > 6) {
          showToast("Max 6 targets allowed", "error");
          return;
        }

        // 收集 Conditions
        const conditions = {};
        const branchVal = form.querySelector("#c-branch").value.trim();
        if (branchVal) conditions.branch = branchVal;

        if (eventType === "workflow_run") {
          const wfVal = form.querySelector("#c-wf").value.trim();
          if (wfVal) conditions.workflow = wfVal;
          const conclList = Array.from(form.querySelectorAll("input[name='c-concl']:checked")).map(c => c.value);
          if (conclList.length > 0) conditions.conclusion = conclList;
        }

        if (eventType === "pull_request") {
          const prActions = Array.from(form.querySelectorAll("input[name='c-praction']:checked")).map(c => c.value);
          if (prActions.length > 0) conditions.action = prActions;
        }

        try {
          if (isEdit) {
            await apiFetch(`/api/routes/${route.id}`, {
              method: "PUT",
              body: JSON.stringify({
                name,
                repository,
                eventType,
                conditions,
                targetIds,
                enabled,
                priority,
              }),
            });
          } else {
            await apiFetch("/api/routes", {
              method: "POST",
              body: JSON.stringify({
                name,
                repository,
                eventType,
                conditions,
                targetIds,
                enabled,
                priority,
              }),
            });
          }
          showToast(t("route_saved"), "success");
          closeModal();
          renderRoutes(document.getElementById("app-content"));
        } catch {
          // apiFetch 已提示
        }
      },
    },
  ]);
}

/**
 * 渲染 Settings 系统设置视图
 */
async function renderSettings(container) {
  container.innerHTML = "";

  const header = document.createElement("div");
  header.style.marginBottom = "24px";
  header.innerHTML = `
    <div class="eyebrow-mono">${t("settings_eyebrow")}</div>
    <h1 class="heading-display" style="margin-bottom:0;">${t("settings_title")}</h1>
  `;
  container.appendChild(header);

  let settings;
  try {
    settings = await apiFetch("/api/settings");
    state.settings = settings;
  } catch {
    return;
  }

  const webhookEndpoint = `${window.location.origin}/webhooks/github`;

  // GitHub Webhook Secret 配置卡片
  const ghCard = document.createElement("div");
  ghCard.className = "card";
  ghCard.innerHTML = `
    <div class="eyebrow-mono">${t("gh_secret_eyebrow")}</div>
    <h2 class="heading-section">${t("gh_secret_title")}</h2>
    <div style="margin-bottom:18px;">
      <div class="form-label">${t("lbl_endpoint_url")}</div>
      <div style="display:flex; gap:8px;">
        <input type="text" class="form-control" readonly value="${escapeHtml(webhookEndpoint)}" id="webhook-endpoint-input">
        <button class="btn btn-sm" id="copy-endpoint-btn">${t("copy_btn")}</button>
      </div>
    </div>

    <div style="margin-bottom:20px;">
      <div class="form-label">${t("lbl_current_status")}</div>
      <div style="display:flex; gap:12px; align-items:center;">
        ${settings.githubWebhookSecretConfigured
          ? `<span class="badge badge-success"><span class="badge-dot"></span>SECRET CONFIGURED</span>`
          : `<span class="badge badge-error"><span class="badge-dot"></span>NOT GENERATED</span>`}

        ${settings.githubWebhookSecretPreviousActive
          ? `<span class="badge badge-warning"><span class="badge-dot"></span>PREVIOUS SECRET ACTIVE (Grace Window)</span>`
          : ""}
      </div>
    </div>

    <div id="new-secret-box" style="display:none; background:var(--color-canvas-soft); padding:16px; border-radius:var(--radius-sm); margin-bottom:18px; border:1px solid rgba(255,159,10,0.3);">
      <div style="color:var(--color-status-warning); font-size:13px; margin-bottom:8px;">${t("rotate_warning")}</div>
      <div style="display:flex; gap:8px;">
        <input type="text" class="form-control" readonly id="new-secret-val">
        <button class="btn btn-sm btn-primary" id="copy-secret-btn">${t("copy_btn")}</button>
      </div>
    </div>

    <div style="display:flex; gap:12px; align-items:center;">
      <button class="btn btn-primary" id="rotate-secret-btn">
        ${settings.githubWebhookSecretConfigured ? t("rotate_secret_btn") : t("generate_secret_btn")}
      </button>
    </div>
  `;

  container.appendChild(ghCard);

  // 绑定 GitHub Secret 复制与轮换事件
  ghCard.querySelector("#copy-endpoint-btn").onclick = () => {
    navigator.clipboard.writeText(webhookEndpoint);
    showToast(t("copied"), "success");
  };

  ghCard.querySelector("#rotate-secret-btn").onclick = async () => {
    if (confirm(t("rotate_confirm"))) {
      try {
        const res = await apiFetch("/api/settings/github/rotate", { method: "POST" });
        const box = ghCard.querySelector("#new-secret-box");
        const valInput = ghCard.querySelector("#new-secret-val");
        valInput.value = res.newSecret;
        box.style.display = "block";
        showToast(t("copied"), "success");
      } catch {}
    }
  };

  ghCard.querySelector("#copy-secret-btn")?.addEventListener("click", () => {
    const val = ghCard.querySelector("#new-secret-val").value;
    navigator.clipboard.writeText(val);
    showToast(t("copied"), "success");
  });
}

/**
 * 渲染 Failures 投递失败日志视图
 */
async function renderFailures(container) {
  container.innerHTML = "";

  const header = document.createElement("div");
  header.style.marginBottom = "24px";
  header.innerHTML = `
    <div class="eyebrow-mono">${t("failures_eyebrow")}</div>
    <h1 class="heading-display" style="margin-bottom:0;">${t("failures_title")}</h1>
  `;
  container.appendChild(header);

  let failures = [];
  try {
    failures = await apiFetch("/api/stats/failures?limit=50");
    state.failures = failures;
  } catch {
    return;
  }

  const card = document.createElement("div");
  card.className = "card";

  const table = document.createElement("table");
  table.className = "data-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>${t("th_time")}</th>
        <th>Target</th>
        <th>Provider</th>
        <th>Repository</th>
        <th>${t("th_errcode")}</th>
        <th>${t("th_summary")}</th>
      </tr>
    </thead>
    <tbody>
      ${failures.map(f => `
        <tr>
          <td style="font-family:var(--font-mono); font-size:12px; color:var(--color-body-mid);">${new Date(f.createdAt).toLocaleString()}</td>
          <td>${escapeHtml(f.targetName)}</td>
          <td><span class="badge">${f.provider}</span></td>
          <td><code>${escapeHtml(f.repository || "unknown")}</code></td>
          <td><span class="badge badge-error">${f.errorCode || "API_ERROR"}</span></td>
          <td style="color:var(--color-status-error); font-size:12px; word-break:break-all;">${escapeHtml(f.errorSummary || "Unknown Error")}</td>
        </tr>
      `).join("") || `<tr><td colspan="6" style="text-align:center; color:var(--color-body-mid); padding:32px 0;">${t("no_failures")}</td></tr>`}
    </tbody>
  `;

  card.appendChild(table);
  container.appendChild(card);
}

/**
 * 渲染 Import / Export 视图
 */
async function renderExportImport(container) {
  container.innerHTML = "";

  const header = document.createElement("div");
  header.style.marginBottom = "24px";
  header.innerHTML = `
    <div class="eyebrow-mono">${t("backup_eyebrow")}</div>
    <h1 class="heading-display" style="margin-bottom:0;">${t("backup_title")}</h1>
  `;
  container.appendChild(header);

  const grid2 = document.createElement("div");
  grid2.className = "grid-2";

  // 1. 导出卡片
  const expCard = document.createElement("div");
  expCard.className = "card";
  expCard.innerHTML = `
    <div class="eyebrow-mono">EXPORT</div>
    <h2 class="heading-section">${t("export_title")}</h2>
    <p style="color:var(--color-body); margin-bottom:20px; font-size:13px;">
      ${t("export_desc")}
    </p>
    <button class="btn btn-primary" id="export-json-btn">${t("export_btn")}</button>
  `;
  grid2.appendChild(expCard);

  expCard.querySelector("#export-json-btn").onclick = async () => {
    try {
      const data = await apiFetch("/api/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `git2im-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(t("copied"), "success");
    } catch {}
  };

  // 2. 导入卡片
  const impCard = document.createElement("div");
  impCard.className = "card";
  impCard.innerHTML = `
    <div class="eyebrow-mono">IMPORT</div>
    <h2 class="heading-section">${t("import_title")}</h2>
    <p style="color:var(--color-body); margin-bottom:20px; font-size:13px;">
      ${t("import_desc")}
    </p>
    <div class="form-group">
      <textarea id="import-json-area" class="form-control" rows="5" placeholder="${t("import_placeholder")}"></textarea>
    </div>
    <button class="btn btn-primary" id="import-json-btn">${t("import_btn")}</button>
  `;
  grid2.appendChild(impCard);

  impCard.querySelector("#import-json-btn").onclick = async () => {
    const text = impCard.querySelector("#import-json-area").value.trim();
    if (!text) {
      showToast(t("import_placeholder"), "error");
      return;
    }

    try {
      const payload = JSON.parse(text);
      const res = await apiFetch("/api/import", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      showToast(t("import_success", { count: res.importedRouteCount }), "success");
      impCard.querySelector("#import-json-area").value = "";
    } catch (e) {
      showToast(e.message || "Invalid JSON", "error");
    }
  };

  container.appendChild(grid2);
}

/**
 * 加载当前激活的 Tab 视图
 */
function loadCurrentTab() {
  const content = document.getElementById("app-content");
  if (!content) return;

  switch (state.currentTab) {
    case "overview":
      renderOverview(content);
      break;
    case "targets":
      renderTargets(content);
      break;
    case "routes":
      renderRoutes(content);
      break;
    case "settings":
      renderSettings(content);
      break;
    case "failures":
      renderFailures(content);
      break;
    case "export":
      renderExportImport(content);
      break;
  }
}

/**
 * 切换导航 Tab
 */
function switchTab(tabName) {
  state.currentTab = tabName;
  document.querySelectorAll(".nav-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tabName);
  });
  window.location.hash = `#/${tabName}`;
  loadCurrentTab();
}

/**
 * 切换语言
 */
function toggleLanguage() {
  const nextLang = getLocale() === "zh-CN" ? "en" : "zh-CN";
  setLocale(nextLang);
  updateNavLabels();
  renderAuthStatus();
  loadCurrentTab();
  showToast(nextLang === "zh-CN" ? "已切换至简体中文" : "Switched to English", "info");
}

/**
 * HTML 转义辅助函数 (XSS 防护)
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * 初始化应用程序
 */
async function initApp() {
  // 1. 绑定导航按钮点击事件
  document.querySelectorAll(".nav-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      if (tab) switchTab(tab);
    });
  });

  // 2. 绑定语言切换按钮
  const langBtn = document.getElementById("lang-switch-btn");
  if (langBtn) {
    langBtn.addEventListener("click", toggleLanguage);
  }

  // 3. Hash 路由监听
  const hash = window.location.hash.replace("#/", "");
  if (hash && ["overview", "targets", "routes", "settings", "failures", "export"].includes(hash)) {
    state.currentTab = hash;
    document.querySelectorAll(".nav-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === hash);
    });
  }

  // 4. 检查鉴权状态并加载视图
  await checkAuth();
  loadCurrentTab();
}

// 启动应用
document.addEventListener("DOMContentLoaded", initApp);

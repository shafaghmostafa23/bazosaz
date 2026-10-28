const root = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const toastRoot = document.querySelector('#toast-root');
const state = {
  authenticated: false,
  username: '',
  page: 'dashboard',
  bots: [],
  selectedBotId: localStorage.getItem('bale-selected-bot') || '',
  dashboard: null,
  flows: [],
  flowDraft: null,
  editingFlowId: null,
  users: [],
  userQuery: '',
  activity: null,
  profile: null,
  modal: null,
  loading: true
};

const pages = {
  dashboard: ['نمای کلی', 'وضعیت ربات‌ها و آخرین رویدادها'],
  bots: ['ربات‌های من', 'اتصال و تنظیم ربات‌های بله'],
  flows: ['جریان‌ها و منوها', 'ساخت مسیرهای گفت‌وگو با فرم و دکمه'],
  users: ['کاربران', 'پروفایل‌ها و مسیر هر کاربر'],
  activity: ['فعالیت و گزارش‌ها', 'رویدادها، پیام‌ها و خطاهای ثبت‌شده']
};
const persianNumber = new Intl.NumberFormat('fa-IR');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function dateLabel(value, withTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
}

function fullName(user) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || (user.username ? `@${user.username}` : `کاربر ${user.id}`);
}

function showToast(message, isError = false) {
  const node = document.createElement('div');
  node.className = `toast${isError ? ' error' : ''}`;
  node.textContent = message;
  toastRoot.append(node);
  window.setTimeout(() => node.remove(), 4300);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.includes('/api/login')) {
    state.authenticated = false;
    renderLogin();
  }
  if (!response.ok) throw new Error(body.error || 'درخواست انجام نشد.');
  return body;
}

function statusBadge(status) {
  if (status === 'active') return '<span class="status status-good">متصل</span>';
  if (status === 'error') return '<span class="status status-bad">نیاز به بررسی</span>';
  return '<span class="status status-warn">در انتظار وب‌هوک</span>';
}

function emptyState(title, description, action = '') {
  return `<div class="empty-state"><div class="empty-illustration">✦</div><strong>${escapeHtml(title)}</strong><div>${escapeHtml(description)}</div>${action}</div>`;
}

function renderLogin(errorText = '') {
  root.innerHTML = `<main class="login-screen"><section class="login-card">
    <div class="brand-mark">ب</div>
    <h1>مدیریت بات‌های بله</h1>
    <p>وارد پنل شخصی خود شوید تا بات‌ها، منوها و مسیرهای گفت‌وگو را مدیریت کنید.</p>
    ${errorText ? `<div class="notice error">${escapeHtml(errorText)}</div>` : ''}
    <form id="login-form">
      <div class="field"><label for="login-username">نام کاربری</label><input id="login-username" name="username" autocomplete="username" required maxlength="64"></div>
      <div class="field"><label for="login-password">گذرواژه</label><input id="login-password" name="password" type="password" autocomplete="current-password" required></div>
      <button class="button button-primary" type="submit" style="width:100%;margin-top:5px">ورود به پنل</button>
    </form>
    <div class="hint" style="margin-top:15px">حساب مدیر از متغیرهای محیطی سرور تنظیم می‌شود.</div>
  </section></main>`;
}

function renderShell() {
  const title = pages[state.page] || pages.dashboard;
  const botOptions = [`<option value="">همهٔ ربات‌ها</option>`, ...state.bots.map((bot) => `<option value="${escapeHtml(bot.id)}" ${state.selectedBotId === bot.id ? 'selected' : ''}>${escapeHtml(bot.name)} · @${escapeHtml(bot.username)}</option>`)].join('');
  root.innerHTML = `<div class="layout">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">ب</div><div class="brand-title">مدیریت بات‌های بله<span class="brand-subtitle">پنل شخصی و مستقل</span></div></div>
      <div class="nav-label">مدیریت</div>
      <nav class="nav" aria-label="ناوبری اصلی">
        <button data-page="dashboard" class="${state.page === 'dashboard' ? 'active' : ''}"><span class="nav-icon">◫</span>نمای کلی</button>
        <button data-page="bots" class="${state.page === 'bots' ? 'active' : ''}"><span class="nav-icon">◉</span>ربات‌های من</button>
        <button data-page="flows" class="${state.page === 'flows' ? 'active' : ''}"><span class="nav-icon">⤳</span>جریان‌ها و منوها</button>
        <button data-page="users" class="${state.page === 'users' ? 'active' : ''}"><span class="nav-icon">♙</span>کاربران</button>
        <button data-page="activity" class="${state.page === 'activity' ? 'active' : ''}"><span class="nav-icon">◷</span>فعالیت و گزارش‌ها</button>
      </nav>
      <div class="sidebar-bottom"><div class="sidebar-note">توکن هر ربات در پایگاه داده به‌صورت رمزگذاری‌شده نگهداری می‌شود. فقط یک مدیر به پنل دسترسی دارد.</div>
        <div class="sidebar-user"><div><span class="sidebar-user-name">${escapeHtml(state.username)}</span><span class="sidebar-user-role">مدیر پنل</span></div><button class="icon-button" data-action="logout" title="خروج" aria-label="خروج">↪</button></div>
      </div>
    </aside>
    <main class="main">
      <header class="topbar"><div class="page-heading"><h1>${title[0]}</h1><p>${title[1]}</p></div>
        <div class="topbar-actions"><select class="bot-picker" id="bot-picker" aria-label="انتخاب ربات">${botOptions}</select><div class="avatar">${escapeHtml((state.username || 'م').slice(0, 1).toUpperCase())}</div></div>
      </header>
      <section class="content" id="page-content">${state.loading ? '<div class="loading">در حال بارگذاری…</div>' : renderPage()}</section>
    </main>
  </div>`;
  renderModal();
}

function renderPage() {
  if (state.page === 'dashboard') return renderDashboard();
  if (state.page === 'bots') return renderBots();
  if (state.page === 'flows') return renderFlows();
  if (state.page === 'users') return renderUsers();
  return renderActivity();
}

function renderStats(stats = {}) {
  const items = [
    ['کاربران', stats.users || 0, '♙', 'شناسه‌های دریافت‌شده از آپدیت‌های بله'],
    ['جریان‌های فعال', stats.flows || 0, '⤳', 'منوها و مسیرهای فعال'],
    ['پیام‌های پذیرفته‌شده', stats.acceptedMessages || 0, '↗', 'درخواست ارسال پذیرفته‌شده توسط بله'],
    ['خطاهای ارسال', stats.errors || 0, '!', 'پیام‌هایی که API بله رد کرده است']
  ];
  return `<div class="stats-grid">${items.map(([label, value, icon, caption]) => `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${persianNumber.format(value)}</div><div class="stat-caption">${caption}</div></article>`).join('')}</div>`;
}

function renderBotRows(bots) {
  if (!bots.length) return emptyState('هنوز رباتی اضافه نشده', 'با توکن ساخته‌شده در بله، اولین ربات را به پنل وصل کنید.', '<button class="button button-primary" data-action="new-bot">افزودن ربات</button>');
  return bots.map((bot) => `<div class="bot-row"><div class="bot-avatar">${escapeHtml(bot.name.slice(0, 1))}</div><div class="bot-row-main"><div class="bot-row-name">${escapeHtml(bot.name)}</div><span class="bot-row-handle">@${escapeHtml(bot.username)}</span></div>${statusBadge(bot.webhookStatus)}</div>`).join('');
}

function renderFeed(events = []) {
  if (!events.length) return '<div class="empty-state" style="padding:28px 12px">هنوز رویدادی ثبت نشده است.</div>';
  return events.map((event) => `<div class="feed-item"><span class="feed-dot"></span><div class="feed-main"><div class="feed-title">${escapeHtml(event.summary || event.type)}${event.first_name || event.last_name ? ` · ${escapeHtml([event.first_name, event.last_name].filter(Boolean).join(' '))}` : ''}</div><div class="feed-meta">${dateLabel(event.created_at)}</div></div></div>`).join('');
}

function renderDashboard() {
  const data = state.dashboard || { stats: {}, bots: [], events: [] };
  return `${renderStats(data.stats)}<div class="dashboard-grid">
    <section class="panel"><div class="panel-head"><h3>آخرین رویدادها</h3><button class="button button-light button-small" data-page="activity">مشاهدهٔ همه</button></div><div class="panel-body">${renderFeed(data.events)}</div></section>
    <section class="panel"><div class="panel-head"><h3>ربات‌ها</h3><button class="button button-light button-small" data-page="bots">مدیریت</button></div><div class="panel-body">${renderBotRows(data.bots)}</div></section>
  </div>
  ${!state.bots.length ? `<section class="panel" style="margin-top:16px">${emptyState('شروع کار با اولین بات', 'توکن را وارد کنید؛ سامانه آن را با getMe بررسی می‌کند و وب‌هوک امن را تنظیم می‌کند.', '<button class="button button-primary" data-action="new-bot">ساخت ربات</button>')}</section>` : ''}`;
}

function renderBots() {
  const bots = state.bots;
  return `<div class="content-head"><div><h2>ربات‌های من</h2><p>هر ربات داده‌ها و کاربران جداگانه دارد.</p></div><button class="button button-primary" data-action="new-bot">＋ افزودن ربات</button></div>
  ${bots.length ? `<div class="bot-grid">${bots.map((bot) => `<article class="bot-card">
    <div class="bot-card-top"><div class="bot-avatar">${escapeHtml(bot.name.slice(0, 1))}</div><div class="bot-card-title"><h3>${escapeHtml(bot.name)}</h3><span>@${escapeHtml(bot.username)}</span></div>${statusBadge(bot.webhookStatus)}</div>
    <div class="webhook-box"><strong>وضعیت دریافت پیام</strong>${bot.webhookUrl ? `<div class="webhook-url">${escapeHtml(bot.webhookUrl)}</div>` : '<div class="hint">برای ثبت خودکار وب‌هوک، APP_BASE_URL و HTTPS عمومی را تنظیم کنید.</div>'}${bot.webhookError ? `<div class="hint" style="color:var(--red);margin-top:5px">${escapeHtml(bot.webhookError)}</div>` : ''}</div>
    <div class="bot-card-actions"><span class="hint">افزوده‌شده ${dateLabel(bot.createdAt, false)}</span><div style="display:flex;gap:6px"><button class="button button-light button-small" data-action="edit-bot" data-id="${escapeHtml(bot.id)}">ویرایش نام</button><button class="button button-light button-small" data-action="sync-webhook" data-id="${escapeHtml(bot.id)}">تنظیم وب‌هوک</button><button class="icon-button" data-action="delete-bot" data-id="${escapeHtml(bot.id)}" aria-label="حذف ربات">×</button></div></div>
    </article>`).join('')}</div>` : `<section class="panel">${emptyState('هنوز رباتی اضافه نشده', 'توکن را وارد کنید تا اتصال با API رسمی بله بررسی شود.', '<button class="button button-primary" data-action="new-bot">افزودن ربات</button>')}</section>`}`;
}

function triggerLabel(flow) {
  return flow.triggerType === 'start' ? 'با /start' : `با «${flow.triggerValue}»`;
}

function defaultDraft() {
  return {
    name: '', triggerType: 'start', triggerValue: '',
    nodes: [
      { type: 'message', text: 'سلام {{first_name}}، خوش آمدید.', keyboard: 'inline', buttons: [{ label: 'ادامه', action: 'next', target: 1 }], next: 1 },
      { type: 'message', text: 'پیام بعدی را اینجا بنویسید.', keyboard: 'none', buttons: [], next: null }
    ]
  };
}

function nodeTargetOptions(value, includeFinish = false) {
  const isEmpty = value === null || value === undefined || value === '';
  const options = includeFinish ? `<option value="" ${isEmpty ? 'selected' : ''}>پایان جریان</option>` : '';
  return options + state.flowDraft.nodes.map((node, index) => `<option value="${index}" ${!isEmpty && Number(value) === index ? 'selected' : ''}>گام ${persianNumber.format(index + 1)} · ${node.type === 'condition' ? 'شرط' : node.type === 'input' ? 'دریافت پاسخ' : 'پیام'}</option>`).join('');
}

function renderButtonConfig(button, nodeIndex, buttonIndex, keyboard) {
  const actions = keyboard === 'inline'
    ? `<option value="next" ${button.action === 'next' ? 'selected' : ''}>رفتن به گام</option><option value="url" ${button.action === 'url' ? 'selected' : ''}>باز کردن پیوند</option>`
    : `<option value="next" selected>رفتن به گام</option>`;
  const valueControl = button.action === 'url' && keyboard === 'inline'
    ? `<input data-draft="nodes.${nodeIndex}.buttons.${buttonIndex}.url" placeholder="https://example.com" value="${escapeHtml(button.url || '')}" aria-label="آدرس پیوند">`
    : `<select data-draft="nodes.${nodeIndex}.buttons.${buttonIndex}.target" aria-label="گام مقصد">${nodeTargetOptions(button.target)}</select>`;
  return `<div class="button-config"><input data-draft="nodes.${nodeIndex}.buttons.${buttonIndex}.label" maxlength="64" placeholder="عنوان دکمه" value="${escapeHtml(button.label || '')}" aria-label="عنوان دکمه"><select data-action="button-action" data-node="${nodeIndex}" data-button="${buttonIndex}" aria-label="عمل دکمه">${actions}</select>${valueControl}<button type="button" class="icon-button" data-action="remove-button" data-node="${nodeIndex}" data-button="${buttonIndex}" aria-label="حذف دکمه">×</button></div>`;
}

function renderNode(node, index) {
  const head = `<div class="node-card-head"><span class="node-number">${persianNumber.format(index + 1)}</span><select data-action="node-type" data-node="${index}" aria-label="نوع گام"><option value="message" ${node.type === 'message' ? 'selected' : ''}>ارسال پیام</option><option value="input" ${node.type === 'input' ? 'selected' : ''}>دریافت پاسخ</option><option value="condition" ${node.type === 'condition' ? 'selected' : ''}>بررسی شرط</option></select><span class="node-spacer"></span><button type="button" class="icon-button" data-action="move-node" data-node="${index}" data-direction="up" aria-label="جابجایی به بالا" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-button" data-action="move-node" data-node="${index}" data-direction="down" aria-label="جابجایی به پایین" ${index === state.flowDraft.nodes.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="icon-button" data-action="remove-node" data-node="${index}" aria-label="حذف گام">×</button></div>`;
  let body = '';
  if (node.type === 'message') {
    body = `<div class="field"><label>متن پیام</label><textarea data-draft="nodes.${index}.text" maxlength="4000" required placeholder="پیام را بنویسید…">${escapeHtml(node.text || '')}</textarea><span class="hint">می‌توانید از {{first_name}}، {{username}}، {{user_id}} یا فیلدهای ذخیره‌شده استفاده کنید.</span></div>
      <div class="node-grid"><div class="field"><label>صفحه‌کلید</label><select data-draft="nodes.${index}.keyboard"><option value="none" ${node.keyboard === 'none' ? 'selected' : ''}>بدون دکمه</option><option value="inline" ${node.keyboard === 'inline' ? 'selected' : ''}>دکمه زیر پیام (Inline)</option><option value="reply" ${node.keyboard === 'reply' ? 'selected' : ''}>منوی پاسخ سریع</option></select></div><div class="field"><label>ادامه با پیام متنی</label><select data-draft="nodes.${index}.next">${nodeTargetOptions(node.next, true)}</select><span class="hint">اگر کاربر متن بنویسد، به این گام می‌رود.</span></div></div>
      ${node.keyboard !== 'none' ? `<div class="node-buttons"><div class="node-buttons-title"><span>دکمه‌های پیام</span><button class="button button-light button-small" type="button" data-action="add-button" data-node="${index}">＋ افزودن دکمه</button></div>${(node.buttons || []).map((button, buttonIndex) => renderButtonConfig(button, index, buttonIndex, node.keyboard)).join('') || '<span class="hint">هنوز دکمه‌ای اضافه نشده است.</span>'}</div>` : ''}`;
  } else if (node.type === 'input') {
    body = `<div class="field"><label>درخواست از کاربر</label><textarea data-draft="nodes.${index}.prompt" maxlength="1000" required placeholder="مثلاً نام شما چیست؟">${escapeHtml(node.prompt || '')}</textarea></div>
      <div class="node-grid"><div class="field"><label>ذخیره در فیلد</label><input data-draft="nodes.${index}.key" maxlength="32" value="${escapeHtml(node.key || '')}" placeholder="name"><span class="hint">نام لاتین؛ نمونه: name یا phone</span></div><div class="field"><label>گام بعدی</label><select data-draft="nodes.${index}.next">${nodeTargetOptions(node.next, true)}</select></div></div>`;
  } else {
    body = `<div class="field"><label>اگر آخرین پاسخ کاربر…</label><input data-draft="nodes.${index}.value" maxlength="250" value="${escapeHtml(node.value || '')}" placeholder="متن مورد انتظار"></div>
      <div class="node-grid"><div class="field"><label>روش بررسی</label><select data-draft="nodes.${index}.mode"><option value="equals" ${node.mode === 'equals' ? 'selected' : ''}>دقیقاً برابر باشد</option><option value="contains" ${node.mode === 'contains' ? 'selected' : ''}>شامل این عبارت باشد</option></select></div><div class="field"><label>اگر برقرار بود</label><select data-draft="nodes.${index}.yes">${nodeTargetOptions(node.yes)}</select></div><div class="field"><label>اگر برقرار نبود</label><select data-draft="nodes.${index}.no">${nodeTargetOptions(node.no)}</select></div></div>`;
  }
  return `<article class="node-card">${head}<div class="node-card-body">${body}</div></article>`;
}

function renderFlowEditor() {
  if (!state.flowDraft) return `<section class="panel">${emptyState('انتخاب یا ساخت یک جریان', 'جریان‌ها، منوهای پاسخ و پیام‌های چندمرحله‌ای را با فرم تنظیم کنید.', '<button class="button button-primary" data-action="new-flow">＋ جریان جدید</button>')}</section>`;
  const draft = state.flowDraft;
  return `<section class="panel flow-editor"><div class="flow-editor-top"><div><h3>${state.editingFlowId ? 'ویرایش جریان' : 'جریان جدید'}</h3><p>گام‌ها را با فرم تنظیم کنید؛ نیازی به نوشتن کد نیست.</p></div><button class="icon-button" data-action="close-flow" aria-label="بستن">×</button></div>
    <form id="flow-form" class="flow-form">
      <div class="flow-meta-grid"><div class="field"><label>نام جریان</label><input data-draft="name" maxlength="64" required value="${escapeHtml(draft.name)}" placeholder="مثلاً خوش‌آمدگویی"></div>
        <div class="field"><label>شروع جریان</label><select data-draft="triggerType"><option value="start" ${draft.triggerType === 'start' ? 'selected' : ''}>با دستور /start</option><option value="keyword" ${draft.triggerType === 'keyword' ? 'selected' : ''}>با یک واژه</option></select></div>
        ${draft.triggerType === 'keyword' ? `<div class="field"><label>واژه یا عبارت دقیق</label><input data-draft="triggerValue" maxlength="80" required value="${escapeHtml(draft.triggerValue)}" placeholder="قیمت"></div>` : ''}
      </div>
      <div class="notice">برای منوی چندمرحله‌ای، پیام و دکمه بسازید؛ می‌توانید پاسخ را ذخیره یا با شرط به گام‌های مختلف هدایت کنید. هر ربات می‌تواند یک جریان /start و یک جریان برای هر واژه داشته باشد.</div>
      <div class="node-list">${draft.nodes.map(renderNode).join('')}</div>
      <div class="node-add-row"><button type="button" class="button button-light button-small" data-action="add-node">＋ افزودن گام</button></div>
      <div class="flow-actions"><div class="flow-action-group"><button type="button" class="button button-light" data-action="close-flow">انصراف</button><button type="submit" class="button button-primary">ذخیرهٔ جریان</button></div><span class="hint">حداکثر ۳۰ گام در هر جریان</span></div>
    </form>
  </section>`;
}

function renderFlows() {
  const current = state.bots.find((bot) => bot.id === state.selectedBotId);
  if (!current) return `<div class="content-head"><div><h2>جریان‌ها و منوها</h2><p>برای نمایش جریان‌ها، یک ربات از بالای صفحه انتخاب کنید.</p></div></div>${emptyState('رباتی انتخاب نشده', 'یک ربات را از فهرست بالای صفحه انتخاب کنید یا ابتدا ربات بسازید.', '<button class="button button-primary" data-page="bots">رفتن به ربات‌ها</button>')}`;
  return `<div class="content-head"><div><h2>جریان‌های @${escapeHtml(current.username)}</h2><p>شروع، منوهای دکمه‌ای، شرط و دریافت پاسخ</p></div><button class="button button-primary" data-action="new-flow">＋ جریان جدید</button></div>
    <div class="flow-layout"><section class="panel"><div class="panel-head"><h3>جریان‌ها</h3><span>${persianNumber.format(state.flows.length)}</span></div><div class="flow-list">${state.flows.length ? state.flows.map((flow) => `<div class="flow-list-row"><button class="flow-list-item ${state.editingFlowId === flow.id ? 'selected' : ''}" data-action="select-flow" data-id="${escapeHtml(flow.id)}"><span class="flow-symbol">⤳</span><span class="flow-list-name">${escapeHtml(flow.name)}<span class="flow-list-meta">${escapeHtml(triggerLabel(flow))}</span></span></button><button class="pill flow-state-button ${flow.enabled ? 'success' : ''}" data-action="toggle-flow" data-id="${escapeHtml(flow.id)}">${flow.enabled ? 'فعال' : 'خاموش'}</button><button class="icon-button" data-action="delete-flow" data-id="${escapeHtml(flow.id)}" aria-label="حذف جریان">×</button></div>`).join('') : '<div class="empty-state" style="padding:28px 10px">هنوز جریانی ساخته نشده.</div>'}</div></section>${renderFlowEditor()}</div>`;
}

function renderUsers() {
  const current = state.bots.find((bot) => bot.id === state.selectedBotId);
  if (!current) return `<div class="content-head"><div><h2>کاربران</h2><p>برای نمایش کاربران، یک ربات انتخاب کنید.</p></div></div>${emptyState('رباتی انتخاب نشده', 'فهرست کاربران برای هر بات جداگانه نگهداری می‌شود.', '<button class="button button-primary" data-page="bots">رفتن به ربات‌ها</button>')}`;
  const users = state.users;
  return `<div class="content-head"><div><h2>کاربران @${escapeHtml(current.username)}</h2><p>اطلاعاتی که در آپدیت‌های دریافتی بله ارائه شده است.</p></div><span class="pill">${persianNumber.format(users.length)} کاربر</span></div>
    <div class="search-row"><input class="search-input" id="user-search" value="${escapeHtml(state.userQuery)}" placeholder="جست‌وجو بر اساس نام، شناسه یا نام کاربری…"><button class="button button-light" data-action="search-users">جست‌وجو</button></div>
    <section class="panel"><div class="table-wrap"><table><thead><tr><th>کاربر</th><th>شناسه بله</th><th>آخرین پیام</th><th>تعداد پیام</th><th>آخرین فعالیت</th></tr></thead><tbody>${users.length ? users.map((user) => `<tr data-action="open-user" data-user-id="${escapeHtml(user.id)}"><td><span class="user-name">${escapeHtml(fullName(user))}</span><div class="user-handle">${user.username ? `@${escapeHtml(user.username)}` : 'نام کاربری ندارد'}</div></td><td>${escapeHtml(user.id)}</td><td>${escapeHtml(user.lastMessage || '—').slice(0, 70)}</td><td>${persianNumber.format(user.messageCount)}</td><td>${dateLabel(user.lastSeen)}</td></tr>`).join('') : '<tr><td colspan="5"><div class="empty-state" style="padding:30px 10px">هنوز کاربری از این بات پیامی نفرستاده است.</div></td></tr>'}</tbody></table></div></section>`;
}

function renderActivity() {
  const current = state.bots.find((bot) => bot.id === state.selectedBotId);
  if (!current) return `<div class="content-head"><div><h2>فعالیت و گزارش‌ها</h2><p>برای نمایش گزارش، یک ربات انتخاب کنید.</p></div></div>${emptyState('رباتی انتخاب نشده', 'رویدادها و گزارش‌های پیام برای هر بات جدا نگهداری می‌شوند.', '<button class="button button-primary" data-page="bots">رفتن به ربات‌ها</button>')}`;
  const events = state.activity?.events || [];
  const messages = state.activity?.messages || [];
  return `<div class="content-head"><div><h2>فعالیت @${escapeHtml(current.username)}</h2><p>رویدادها و نتیجهٔ درخواست‌های ارسال به بله</p></div><button class="button button-light" data-action="refresh">تازه‌سازی</button></div><div class="dashboard-grid">
    <section class="panel"><div class="panel-head"><h3>رویدادهای اخیر</h3><span>${persianNumber.format(events.length)}</span></div><div class="panel-body">${events.length ? events.map((item) => `<div class="feed-item"><span class="feed-dot"></span><div class="feed-main"><div class="feed-title">${escapeHtml(item.summary)}${item.userName ? ` · ${escapeHtml(item.userName)}` : ''}</div><div class="feed-meta">${dateLabel(item.createdAt)} ${item.userId ? `· شناسه ${escapeHtml(item.userId)}` : ''}</div></div></div>`).join('') : '<div class="empty-state" style="padding:30px 10px">رویدادی ثبت نشده است.</div>'}</div></section>
    <section class="panel"><div class="panel-head"><h3>گزارش پیام‌ها</h3><span>وضعیت API بله</span></div><div class="panel-body">${messages.length ? messages.map((message) => `<div class="message-log ${message.direction === 'outbound' ? 'outbound' : ''} ${message.status === 'failed' ? 'failed' : ''}"><div class="message-log-head"><span>${message.direction === 'inbound' ? 'دریافتی' : 'ارسالی'} · ${message.status === 'failed' ? 'ناموفق' : message.status === 'accepted' ? 'پذیرفته‌شده' : 'دریافت‌شده'}</span><span>${dateLabel(message.createdAt)}</span></div><div>${escapeHtml(message.text || message.error || '—')}</div>${message.userId ? `<div class="feed-meta">شناسه کاربر ${escapeHtml(message.userId)}</div>` : ''}</div>`).join('') : '<div class="empty-state" style="padding:30px 10px">پیامی ثبت نشده است.</div>'}</div></section>
  </div><div class="notice" style="margin-top:14px">وضعیت «پذیرفته‌شده» یعنی API بله درخواست ارسال را پذیرفته است. Bot API بله در این نسخه رسید خواندن یا تحویل نهایی پیام ارائه نمی‌دهد.</div>`;
}

function renderModal() {
  if (!state.modal && !state.profile) { modalRoot.innerHTML = ''; return; }
  if (state.profile) {
    const profile = state.profile;
    const user = profile.user;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal wide" role="dialog" aria-modal="true"><div class="modal-head"><h3>پروفایل کاربر</h3><button class="icon-button" data-action="close-profile" aria-label="بستن">×</button></div><div class="profile-head"><div class="profile-avatar">${escapeHtml(fullName(user).slice(0, 1))}</div><div class="profile-main"><h3>${escapeHtml(fullName(user))}</h3><p>${user.username ? `@${escapeHtml(user.username)} · ` : ''}${escapeHtml(user.id)}</p><div class="hint" style="direction:rtl;text-align:right;margin-top:5px">آخرین پیام: ${escapeHtml(user.lastMessage || '—')}</div></div><button class="button button-light button-small" data-action="reset-flow" data-user-id="${escapeHtml(user.id)}">پاک‌کردن وضعیت جریان</button></div>
      <div class="profile-stats"><div class="profile-stat"><span>پیام‌های ثبت‌شده</span><strong>${persianNumber.format(user.messageCount)}</strong></div><div class="profile-stat"><span>اولین فعالیت</span><strong>${dateLabel(user.firstSeen, false)}</strong></div><div class="profile-stat"><span>آخرین فعالیت</span><strong>${dateLabel(user.lastSeen)}</strong></div></div>
      <div class="profile-section"><h4>ارسال پیام به کاربر</h4><form id="message-form" data-user-id="${escapeHtml(user.id)}" class="message-composer"><input name="text" maxlength="4000" placeholder="متن پیام…" required><button class="button button-primary button-small" type="submit">ارسال</button></form><div class="hint" style="margin-top:7px">پیام مستقیم با متد sendMessage بله فرستاده می‌شود.</div></div>
      ${Object.keys(user.variables || {}).length ? `<div class="profile-section"><h4>پاسخ‌های ذخیره‌شده در جریان</h4>${Object.entries(user.variables).map(([key, value]) => `<div class="timeline-row"><div class="timeline-content"><div class="timeline-title">${escapeHtml(key)}: ${escapeHtml(value)}</div></div></div>`).join('')}</div>` : ''}
      <div class="profile-section"><h4>مسیر زمانی</h4><div class="timeline">${profile.events.length ? profile.events.map((item) => `<div class="timeline-row"><span class="feed-dot"></span><div class="timeline-content"><div class="timeline-title">${escapeHtml(item.summary)}</div><div class="timeline-meta">${dateLabel(item.createdAt)}</div></div></div>`).join('') : '<div class="hint">هنوز رویدادی برای این کاربر ثبت نشده است.</div>'}</div></div>
      <div class="profile-section"><h4>پیام‌ها</h4>${profile.messages.length ? profile.messages.map((message) => `<div class="message-log ${message.direction === 'outbound' ? 'outbound' : ''} ${message.status === 'failed' ? 'failed' : ''}"><div class="message-log-head"><span>${message.direction === 'inbound' ? 'دریافتی' : 'ارسالی'} · ${message.status === 'failed' ? 'ناموفق' : message.status === 'accepted' ? 'پذیرفته‌شده' : 'دریافت‌شده'}</span><span>${dateLabel(message.createdAt)}</span></div>${escapeHtml(message.text || message.error || '—')}</div>`).join('') : '<div class="hint">پیامی ثبت نشده است.</div>'}</div>
      </section></div>`;
    return;
  }
  const modal = state.modal;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h3>${escapeHtml(modal.title)}</h3><button class="icon-button" data-action="close-modal" aria-label="بستن">×</button></div><div class="modal-body">${modal.body}</div></section></div>`;
}

async function loadData() {
  state.loading = true;
  renderShell();
  try {
    const botsResult = await api('/api/bots');
    state.bots = botsResult.bots;
    if (state.selectedBotId && !state.bots.some((bot) => bot.id === state.selectedBotId)) state.selectedBotId = '';
    state.dashboard = await api(`/api/dashboard${state.selectedBotId ? `?botId=${encodeURIComponent(state.selectedBotId)}` : ''}`);
    state.loading = false;
    await loadPageData();
    renderShell();
  } catch (error) {
    state.loading = false;
    if (!state.authenticated) return renderLogin();
    if (state.authenticated) showToast(error.message, true);
    renderShell();
  }
}

async function loadPageData() {
  const botId = state.selectedBotId;
  if (state.page === 'flows' && botId) {
    const result = await api(`/api/bots/${encodeURIComponent(botId)}/flows`);
    state.flows = result.flows;
    if (state.editingFlowId && !state.flows.some((flow) => flow.id === state.editingFlowId)) {
      state.editingFlowId = null;
      state.flowDraft = null;
    }
  }
  if (state.page === 'users' && botId) {
    const result = await api(`/api/bots/${encodeURIComponent(botId)}/users?q=${encodeURIComponent(state.userQuery)}`);
    state.users = result.users;
  }
  if (state.page === 'activity' && botId) state.activity = await api(`/api/bots/${encodeURIComponent(botId)}/activity`);
}

async function boot() {
  try {
    const session = await api('/api/session');
    state.authenticated = session.authenticated;
    state.username = session.username || '';
    if (!state.authenticated) return renderLogin();
    await loadData();
  } catch {
    renderLogin('ارتباط با سرور برقرار نشد.');
  }
}

function setPage(page) {
  if (!pages[page]) return;
  state.page = page;
  state.loading = true;
  if (page !== 'users') state.profile = null;
  renderShell();
  loadPageData().then(() => { state.loading = false; renderShell(); }).catch((error) => { state.loading = false; renderShell(); showToast(error.message, true); });
}

function setDraftPath(path, value) {
  if (!state.flowDraft) return;
  const parts = path.split('.');
  let target = state.flowDraft;
  for (const part of parts.slice(0, -1)) target = target[part];
  const key = parts.at(-1);
  if (['target', 'next', 'yes', 'no'].includes(key)) target[key] = value === '' ? null : Number(value);
  else target[key] = value;
}

function resetDraft() {
  state.flowDraft = null;
  state.editingFlowId = null;
}

async function openProfile(userId) {
  const result = await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/users/${encodeURIComponent(userId)}`);
  state.profile = result;
  renderModal();
}

function showNewBotModal() {
  state.modal = {
    title: 'افزودن ربات بله',
    body: `<form id="bot-form"><div class="field"><label>نام نمایشی</label><input name="name" required minlength="2" maxlength="64" placeholder="مثلاً پشتیبانی فروش"></div><div class="field"><label>توکن ربات از @botfather</label><input name="token" type="password" required minlength="20" maxlength="512" autocomplete="off" spellcheck="false" placeholder="توکن فقط برای ثبت و بررسی وارد می‌شود"><span class="hint">توکن در پنل نمایش داده نمی‌شود و در پایگاه داده رمزگذاری خواهد شد.</span></div><div class="notice">برای دریافت پیام‌ها، سرور باید با HTTPS عمومی در دسترس باشد و APP_BASE_URL تنظیم شده باشد. توکن ابتدا با getMe بررسی می‌شود.</div><div class="modal-actions"><button class="button button-light" type="button" data-action="close-modal">انصراف</button><button class="button button-primary" type="submit">بررسی و افزودن</button></div></form>`
  };
  renderModal();
}

function showEditBotModal(bot) {
  state.modal = {
    title: 'ویرایش نام ربات',
    body: `<form id="edit-bot-form" data-id="${escapeHtml(bot.id)}"><div class="field"><label>نام نمایشی</label><input name="name" required minlength="2" maxlength="64" value="${escapeHtml(bot.name)}"></div><div class="modal-actions"><button class="button button-light" type="button" data-action="close-modal">انصراف</button><button class="button button-primary" type="submit">ذخیره</button></div></form>`
  };
  renderModal();
}

document.addEventListener('input', (event) => {
  const target = event.target;
  if (target.matches('[data-draft]')) setDraftPath(target.dataset.draft, target.value);
});

document.addEventListener('change', async (event) => {
  const target = event.target;
  if (target.id === 'bot-picker') {
    state.selectedBotId = target.value;
    localStorage.setItem('bale-selected-bot', target.value);
    state.dashboard = null;
    state.flowDraft = null;
    state.editingFlowId = null;
    state.userQuery = '';
    state.loading = true;
    renderShell();
    try {
      state.dashboard = await (await api(`/api/dashboard${state.selectedBotId ? `?botId=${encodeURIComponent(state.selectedBotId)}` : ''}`));
      await loadPageData();
    } catch (error) { showToast(error.message, true); }
    state.loading = false;
    renderShell();
    return;
  }
  if (target.matches('[data-draft]')) {
    setDraftPath(target.dataset.draft, target.value);
    if (target.dataset.draft === 'triggerType' || /\.keyboard$/.test(target.dataset.draft)) renderShell();
  }
});

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action], [data-page]');
  if (!target) return;
  const action = target.dataset.action;
  const page = target.dataset.page;
  try {
    if (page) { setPage(page); return; }
    if (action === 'logout') {
      await api('/api/logout', { method: 'POST' });
      state.authenticated = false; state.profile = null; state.modal = null; renderLogin(); return;
    }
    if (action === 'new-bot') { showNewBotModal(); return; }
    if (action === 'close-modal' || action === 'backdrop' && target === event.target) { state.modal = null; renderModal(); return; }
    if (action === 'close-profile') { state.profile = null; renderModal(); return; }
    if (action === 'edit-bot') { const bot = state.bots.find((item) => item.id === target.dataset.id); if (bot) showEditBotModal(bot); return; }
    if (action === 'sync-webhook') {
      target.disabled = true;
      const result = await api(`/api/bots/${encodeURIComponent(target.dataset.id)}/webhook/sync`, { method: 'POST', body: '{}' });
      showToast(result.bot.webhookStatus === 'active' ? 'وب‌هوک بله وصل شد.' : 'وضعیت وب‌هوک به‌روزرسانی شد.');
      await loadData(); return;
    }
    if (action === 'delete-bot') {
      const bot = state.bots.find((item) => item.id === target.dataset.id);
      if (!bot || !window.confirm(`ربات «${bot.name}» و تمام کاربران، جریان‌ها و گزارش‌های آن حذف شود؟`)) return;
      await api(`/api/bots/${encodeURIComponent(bot.id)}`, { method: 'DELETE' });
      if (state.selectedBotId === bot.id) { state.selectedBotId = ''; localStorage.removeItem('bale-selected-bot'); }
      showToast('ربات و اطلاعات وابستهٔ آن حذف شد.'); await loadData(); return;
    }
    if (action === 'new-flow') {
      if (!state.selectedBotId) { showToast('ابتدا یک ربات از بالای صفحه انتخاب کنید.', true); return; }
      state.editingFlowId = null; state.flowDraft = defaultDraft(); renderShell(); return;
    }
    if (action === 'close-flow') { resetDraft(); renderShell(); return; }
    if (action === 'select-flow') {
      const flow = state.flows.find((item) => item.id === target.dataset.id);
      if (flow) { state.editingFlowId = flow.id; state.flowDraft = structuredClone({ name: flow.name, triggerType: flow.triggerType, triggerValue: flow.triggerValue, nodes: flow.nodes }); renderShell(); }
      return;
    }
    if (action === 'add-node') {
      state.flowDraft.nodes.push({ type: 'message', text: '', keyboard: 'none', buttons: [], next: null }); renderShell(); return;
    }
    if (action === 'remove-node') {
      if (state.flowDraft.nodes.length <= 1) return showToast('هر جریان باید دست‌کم یک گام داشته باشد.', true);
      state.flowDraft.nodes.splice(Number(target.dataset.node), 1);
      state.flowDraft.nodes.forEach((node) => {
        const fix = (value) => value === null || value === undefined ? null : value > Number(target.dataset.node) ? value - 1 : value === Number(target.dataset.node) ? null : value;
        if ('next' in node) node.next = fix(node.next);
        if (node.type === 'condition') { node.yes = fix(node.yes) ?? 0; node.no = fix(node.no) ?? 0; }
        if (node.buttons) node.buttons = node.buttons.map((button) => button.action === 'next' ? { ...button, target: fix(button.target) ?? 0 } : button);
      });
      renderShell(); return;
    }
    if (action === 'move-node') {
      const index = Number(target.dataset.node); const nextIndex = index + (target.dataset.direction === 'up' ? -1 : 1);
      if (nextIndex < 0 || nextIndex >= state.flowDraft.nodes.length) return;
      [state.flowDraft.nodes[index], state.flowDraft.nodes[nextIndex]] = [state.flowDraft.nodes[nextIndex], state.flowDraft.nodes[index]];
      const remap = (value) => value === index ? nextIndex : value === nextIndex ? index : value;
      state.flowDraft.nodes.forEach((node) => {
        if (node.next !== null && node.next !== undefined) node.next = remap(node.next);
        if (node.type === 'condition') { node.yes = remap(node.yes); node.no = remap(node.no); }
        if (node.buttons) node.buttons = node.buttons.map((button) => button.action === 'next' ? { ...button, target: remap(button.target) } : button);
      });
      renderShell(); return;
    }
    if (action === 'add-button') {
      const node = state.flowDraft.nodes[Number(target.dataset.node)];
      if (node.buttons.length >= 8) return showToast('هر پیام حداکثر ۸ دکمه دارد.', true);
      node.buttons.push({ label: '', action: 'next', target: Math.min(Number(target.dataset.node) + 1, state.flowDraft.nodes.length - 1) }); renderShell(); return;
    }
    if (action === 'remove-button') {
      state.flowDraft.nodes[Number(target.dataset.node)].buttons.splice(Number(target.dataset.button), 1); renderShell(); return;
    }
    if (action === 'button-action') return;
    if (action === 'node-type') return;
    if (action === 'toggle-flow') {
      const flow = state.flows.find((item) => item.id === target.dataset.id);
      if (flow) { await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/flows/${encodeURIComponent(flow.id)}/status`, { method: 'PATCH', body: JSON.stringify({ enabled: !flow.enabled }) }); await loadPageData(); renderShell(); }
      return;
    }
    if (action === 'delete-flow') {
      const flow = state.flows.find((item) => item.id === target.dataset.id);
      if (!flow || !window.confirm(`جریان «${flow.name}» حذف شود؟`)) return;
      await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/flows/${encodeURIComponent(flow.id)}`, { method: 'DELETE' });
      if (state.editingFlowId === flow.id) resetDraft(); await loadPageData(); renderShell(); showToast('جریان حذف شد.'); return;
    }
    if (action === 'open-user') { await openProfile(target.dataset.userId); return; }
    if (action === 'search-users') {
      state.userQuery = document.querySelector('#user-search')?.value.trim() || '';
      state.users = (await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/users?q=${encodeURIComponent(state.userQuery)}`)).users;
      renderShell(); return;
    }
    if (action === 'reset-flow') {
      await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/users/${encodeURIComponent(target.dataset.userId)}/reset-flow`, { method: 'POST', body: '{}' });
      showToast('وضعیت جریان کاربر پاک شد.'); return;
    }
    if (action === 'refresh') { await loadPageData(); renderShell(); showToast('گزارش تازه شد.'); return; }
  } catch (error) { showToast(error.message, true); }
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (target.matches('[data-action="node-type"]') && state.flowDraft) {
    const index = Number(target.dataset.node);
    const defaults = {
      message: { type: 'message', text: '', keyboard: 'none', buttons: [], next: null },
      input: { type: 'input', prompt: '', key: 'answer', next: null },
      condition: { type: 'condition', mode: 'equals', value: '', yes: Math.min(index + 1, state.flowDraft.nodes.length - 1), no: Math.min(index + 1, state.flowDraft.nodes.length - 1) }
    };
    state.flowDraft.nodes[index] = defaults[target.value]; renderShell();
  }
  if (target.matches('[data-action="button-action"]') && state.flowDraft) {
    const button = state.flowDraft.nodes[Number(target.dataset.node)].buttons[Number(target.dataset.button)];
    button.action = target.value;
    if (target.value === 'url') delete button.target;
    else { delete button.url; button.target = Math.min(Number(target.dataset.node) + 1, state.flowDraft.nodes.length - 1); }
    renderShell();
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  event.preventDefault();
  try {
    if (form.id === 'login-form') {
      const data = Object.fromEntries(new FormData(form));
      await api('/api/login', { method: 'POST', body: JSON.stringify(data) });
      state.authenticated = true;
      const session = await api('/api/session'); state.username = session.username;
      await loadData(); return;
    }
    if (form.id === 'bot-form') {
      const data = Object.fromEntries(new FormData(form));
      const result = await api('/api/bots', { method: 'POST', body: JSON.stringify(data) });
      state.modal = null;
      showToast(result.bot.webhookStatus === 'active' ? 'ربات تأیید و وب‌هوک تنظیم شد.' : 'ربات اضافه شد؛ برای دریافت پیام‌ها وب‌هوک را تنظیم کنید.');
      state.selectedBotId = result.bot.id; localStorage.setItem('bale-selected-bot', result.bot.id);
      await loadData(); return;
    }
    if (form.id === 'edit-bot-form') {
      const data = Object.fromEntries(new FormData(form));
      await api(`/api/bots/${encodeURIComponent(form.dataset.id)}`, { method: 'PATCH', body: JSON.stringify(data) });
      state.modal = null; showToast('نام ربات به‌روزرسانی شد.'); await loadData(); return;
    }
    if (form.id === 'flow-form') {
      const url = state.editingFlowId
        ? `/api/bots/${encodeURIComponent(state.selectedBotId)}/flows/${encodeURIComponent(state.editingFlowId)}`
        : `/api/bots/${encodeURIComponent(state.selectedBotId)}/flows`;
      await api(url, { method: state.editingFlowId ? 'PUT' : 'POST', body: JSON.stringify(state.flowDraft) });
      showToast('جریان ذخیره شد.');
      if (!state.editingFlowId) resetDraft();
      await loadPageData(); renderShell(); return;
    }
    if (form.id === 'message-form') {
      const userId = form.dataset.userId;
      const data = Object.fromEntries(new FormData(form));
      await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/users/${encodeURIComponent(userId)}/messages`, { method: 'POST', body: JSON.stringify(data) });
      showToast('API بله درخواست ارسال را پذیرفت.');
      state.profile = (await api(`/api/bots/${encodeURIComponent(state.selectedBotId)}/users/${encodeURIComponent(userId)}`)); renderModal(); return;
    }
  } catch (error) {
    if (form.id === 'login-form') renderLogin(error.message);
    else showToast(error.message, true);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.profile) { state.profile = null; renderModal(); }
    else if (state.modal) { state.modal = null; renderModal(); }
    else if (state.flowDraft) { resetDraft(); renderShell(); }
  }
});

boot();

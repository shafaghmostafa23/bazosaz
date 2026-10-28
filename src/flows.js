const MAX_FLOW_NODES = 30;
const MAX_BUTTONS = 8;

const isText = (value, min = 1, max = 4000) => typeof value === 'string' && value.trim().length >= min && value.length <= max;
const isIndex = (value, size) => Number.isInteger(value) && value >= 0 && value < size;

export function validateFlow(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('ساختار جریان معتبر نیست.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!isText(name, 2, 64)) throw new Error('نام جریان باید بین ۲ تا ۶۴ نویسه باشد.');
  const triggerType = input.triggerType;
  if (!['start', 'keyword'].includes(triggerType)) throw new Error('نوع شروع جریان معتبر نیست.');
  const triggerValue = triggerType === 'start' ? '' : (typeof input.triggerValue === 'string' ? input.triggerValue.trim() : '');
  if (triggerType === 'keyword' && !isText(triggerValue, 1, 80)) throw new Error('برای شروع با واژه، متن آغاز لازم است.');
  if (!Array.isArray(input.nodes) || input.nodes.length < 1 || input.nodes.length > MAX_FLOW_NODES) {
    throw new Error(`هر جریان باید بین ۱ تا ${MAX_FLOW_NODES} گام داشته باشد.`);
  }

  const nodes = input.nodes.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`گام ${index + 1} معتبر نیست.`);
    if (raw.type === 'message') {
      if (!isText(raw.text)) throw new Error(`متن پیام گام ${index + 1} باید بین ۱ تا ۴۰۰۰ نویسه باشد.`);
      const keyboard = raw.keyboard || 'none';
      if (!['none', 'inline', 'reply'].includes(keyboard)) throw new Error(`نوع دکمه‌های گام ${index + 1} معتبر نیست.`);
      const buttons = raw.buttons ?? [];
      if (!Array.isArray(buttons) || buttons.length > MAX_BUTTONS) throw new Error(`هر پیام حداکثر ${MAX_BUTTONS} دکمه دارد.`);
      if (keyboard === 'none' && buttons.length) throw new Error('برای نمایش دکمه‌ها نوع صفحه‌کلید را انتخاب کنید.');
      const normalizedButtons = buttons.map((button, buttonIndex) => {
        if (!button || typeof button !== 'object' || !isText(button.label, 1, 64)) throw new Error(`عنوان دکمه ${buttonIndex + 1} معتبر نیست.`);
        if (button.action === 'next') {
          if (!isIndex(button.target, input.nodes.length)) throw new Error(`مقصد دکمه ${buttonIndex + 1} معتبر نیست.`);
          return { label: button.label.trim(), action: 'next', target: button.target };
        }
        if (button.action === 'url' && keyboard === 'inline') {
          if (typeof button.url !== 'string' || button.url.length > 2048) throw new Error(`پیوند دکمه ${buttonIndex + 1} معتبر نیست.`);
          let url;
          try { url = new URL(button.url); } catch { throw new Error(`پیوند دکمه ${buttonIndex + 1} معتبر نیست.`); }
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('پیوند دکمه باید یک نشانی http یا https معتبر و بدون نام کاربری یا گذرواژه باشد.');
          return { label: button.label.trim(), action: 'url', url: url.toString() };
        }
        throw new Error(`عمل دکمه ${buttonIndex + 1} معتبر نیست.`);
      });
      return { type: 'message', text: raw.text.trim(), keyboard, buttons: normalizedButtons, next: raw.next === null || raw.next === undefined || raw.next === '' ? null : raw.next };
    }
    if (raw.type === 'condition') {
      if (!['equals', 'contains'].includes(raw.mode) || !isText(raw.value, 1, 250)) throw new Error(`شرط گام ${index + 1} کامل نیست.`);
      if (!isIndex(raw.yes, input.nodes.length) || !isIndex(raw.no, input.nodes.length)) throw new Error(`مسیرهای شرط گام ${index + 1} معتبر نیستند.`);
      return { type: 'condition', mode: raw.mode, value: raw.value.trim(), yes: raw.yes, no: raw.no };
    }
    if (raw.type === 'input') {
      if (!isText(raw.prompt, 1, 1000)) throw new Error(`متن درخواست گام ${index + 1} باید بین ۱ تا ۱۰۰۰ نویسه باشد.`);
      if (typeof raw.key !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(raw.key)) throw new Error(`نام فیلد گام ${index + 1} باید با حرف لاتین شروع شود و فقط حروف، عدد و زیرخط داشته باشد.`);
      return { type: 'input', prompt: raw.prompt.trim(), key: raw.key, next: raw.next === null || raw.next === undefined || raw.next === '' ? null : raw.next };
    }
    throw new Error(`نوع گام ${index + 1} پشتیبانی نمی‌شود.`);
  });

  nodes.forEach((node, index) => {
    if ((node.type === 'message' || node.type === 'input') && node.next !== null && !isIndex(node.next, nodes.length)) {
      throw new Error(`گام بعدی ${index + 1} معتبر نیست.`);
    }
    if (node.type === 'condition' && (node.yes === index || node.no === index)) {
      throw new Error(`شرط گام ${index + 1} نمی‌تواند دوباره به خودش برگردد.`);
    }
  });
  for (let start = 0; start < nodes.length; start += 1) {
    if (nodes[start].type !== 'condition') continue;
    const pending = [nodes[start].yes, nodes[start].no];
    const visited = new Set([start]);
    while (pending.length) {
      const target = pending.pop();
      if (nodes[target]?.type !== 'condition') continue;
      if (visited.has(target)) throw new Error('شرط‌ها نمی‌توانند بدون پیام یا پاسخ کاربر یک دور بسته بسازند.');
      visited.add(target);
      pending.push(nodes[target].yes, nodes[target].no);
    }
  }
  return { name, triggerType, triggerValue, nodes };
}

export function buildReplyMarkup(flowId, node) {
  if (!node.buttons?.length || node.keyboard === 'none') return undefined;
  if (node.keyboard === 'reply') return { keyboard: node.buttons.map((button) => [{ text: button.label }]), resize_keyboard: true };
  return {
    inline_keyboard: node.buttons.map((button) => [{
      text: button.label,
      ...(button.action === 'url' ? { url: button.url } : { callback_data: `f:${flowId}:${button.target}` })
    }])
  };
}

export function conditionMatches(node, inputText) {
  const value = String(inputText ?? '').trim().toLocaleLowerCase();
  const expected = node.value.trim().toLocaleLowerCase();
  return node.mode === 'equals' ? value === expected : value.includes(expected);
}

export function renderVariables(template, user, variables = {}) {
  const values = {
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    username: user.username || '',
    user_id: user.bale_user_id || '',
    ...variables
  };
  return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (match, key) => String(values[key] ?? ''));
}

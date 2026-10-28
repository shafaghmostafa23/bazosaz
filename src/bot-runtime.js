import { answerCallbackQuery, sendMessage } from './bale.js';
import { buildReplyMarkup, conditionMatches, renderVariables } from './flows.js';

const isoNow = () => new Date().toISOString();

function event(db, botId, userId, type, summary, details = {}) {
  db.prepare('INSERT INTO events (bot_id, bale_user_id, event_type, summary, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(botId, userId ?? null, type, summary, JSON.stringify(details), isoNow());
}

function logMessage(db, { botId, userId, direction, status, method, text = '', error = null, providerMessageId = null }) {
  db.prepare(`INSERT INTO message_logs (bot_id, bale_user_id, direction, status, method, text, error_message, provider_message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(botId, userId ?? null, direction, status, method, String(text).slice(0, 4000), error, providerMessageId, isoNow());
}

function upsertUser(db, botId, from, chatId, text = '') {
  const userId = String(from.id);
  const now = isoNow();
  db.prepare(`INSERT INTO bot_users
      (bot_id, bale_user_id, chat_id, first_name, last_name, username, language_code, last_message, first_seen, last_seen, message_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(bot_id, bale_user_id) DO UPDATE SET
      chat_id=excluded.chat_id, first_name=excluded.first_name, last_name=excluded.last_name,
      username=excluded.username, language_code=excluded.language_code,
      last_message=excluded.last_message, last_seen=excluded.last_seen,
      message_count=bot_users.message_count + 1`)
    .run(botId, userId, String(chatId), from.first_name || '', from.last_name || '', from.username || '', from.language_code || '', String(text).slice(0, 4000), now, now);
  return db.prepare('SELECT * FROM bot_users WHERE bot_id=? AND bale_user_id=?').get(botId, userId);
}

async function sendFlowMessage(db, bot, user, flow, node) {
  const token = bot.token;
  const variables = JSON.parse(user.variables_json || '{}');
  const text = renderVariables(node.text ?? node.prompt, user, variables);
  const payload = { chat_id: user.chat_id, text };
  const replyMarkup = node.type === 'message' ? buildReplyMarkup(flow.id, node) : undefined;
  if (replyMarkup) payload.reply_markup = replyMarkup;
  try {
    const result = await sendMessage(token, payload);
    logMessage(db, { botId: bot.id, userId: user.bale_user_id, direction: 'outbound', status: 'accepted', method: 'sendMessage', text, providerMessageId: result?.message_id ? String(result.message_id) : null });
    event(db, bot.id, user.bale_user_id, 'message_accepted', 'پیام به API بله فرستاده شد', { flowId: flow.id, text });
    return true;
  } catch (error) {
    logMessage(db, { botId: bot.id, userId: user.bale_user_id, direction: 'outbound', status: 'failed', method: 'sendMessage', text, error: error.message });
    event(db, bot.id, user.bale_user_id, 'message_failed', 'ارسال پیام با خطا روبه‌رو شد', { flowId: flow.id, error: error.message });
    return false;
  }
}

function putConversation(db, botId, userId, flowId, nodeIndex) {
  db.prepare(`INSERT INTO conversations (bot_id, bale_user_id, flow_id, node_index, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(bot_id, bale_user_id) DO UPDATE SET flow_id=excluded.flow_id, node_index=excluded.node_index, updated_at=excluded.updated_at`)
    .run(botId, userId, flowId, nodeIndex, isoNow());
}

async function runFlow(db, bot, userId, flow, startIndex, inputText = '') {
  const user = db.prepare('SELECT * FROM bot_users WHERE bot_id=? AND bale_user_id=?').get(bot.id, userId);
  if (!user) return;
  const nodes = JSON.parse(flow.nodes_json);
  let index = startIndex;
  let hops = 0;
  while (index !== null && index !== undefined && hops < nodes.length * 2 + 2) {
    hops += 1;
    const node = nodes[index];
    if (!node) break;
    if (node.type === 'condition') {
      const matched = conditionMatches(node, inputText);
      event(db, bot.id, userId, 'condition_checked', matched ? 'شرط برقرار شد' : 'شرط برقرار نشد', { flowId: flow.id, mode: node.mode });
      index = matched ? node.yes : node.no;
      continue;
    }
    if (node.type === 'input') {
      const sent = await sendFlowMessage(db, bot, user, flow, node);
      if (sent) putConversation(db, bot.id, userId, flow.id, index);
      return;
    }
    const sent = await sendFlowMessage(db, bot, user, flow, node);
    if (!sent) return;
    event(db, bot.id, userId, 'flow_step', `گام «${flow.name}» اجرا شد`, { flowId: flow.id, nodeIndex: index });
    putConversation(db, bot.id, userId, flow.id, index);
    return;
  }
  db.prepare('DELETE FROM conversations WHERE bot_id=? AND bale_user_id=?').run(bot.id, userId);
  event(db, bot.id, userId, 'flow_completed', `جریان «${flow.name}» به پایان رسید`, { flowId: flow.id });
}

function findTriggerFlow(db, botId, inputText) {
  const trimmed = inputText.trim();
  if (/^\/start(?:\s|$)/i.test(trimmed)) {
    return db.prepare("SELECT * FROM flows WHERE bot_id=? AND enabled=1 AND trigger_type='start' LIMIT 1").get(botId);
  }
  return db.prepare("SELECT * FROM flows WHERE bot_id=? AND enabled=1 AND trigger_type='keyword' ORDER BY length(trigger_value) DESC")
    .all(botId)
    .find((flow) => flow.trigger_value.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase());
}

async function handleText(db, bot, update) {
  const message = update.message;
  const from = message?.from;
  if (!from?.id || !message.chat?.id || message.chat.type !== 'private' || typeof message.text !== 'string') return;
  const text = message.text.slice(0, 4000);
  const user = upsertUser(db, bot.id, from, message.chat.id, text);
  logMessage(db, { botId: bot.id, userId: user.bale_user_id, direction: 'inbound', status: 'received', method: 'message', text });
  event(db, bot.id, user.bale_user_id, 'message_received', 'پیام متنی دریافت شد', { text });

  const conversation = db.prepare('SELECT * FROM conversations WHERE bot_id=? AND bale_user_id=?').get(bot.id, user.bale_user_id);
  let activeFlow = conversation ? db.prepare('SELECT * FROM flows WHERE id=? AND bot_id=? AND enabled=1').get(conversation.flow_id, bot.id) : null;
  if (conversation && !activeFlow) {
    db.prepare('DELETE FROM conversations WHERE bot_id=? AND bale_user_id=?').run(bot.id, user.bale_user_id);
  }
  const activeNode = activeFlow ? JSON.parse(activeFlow.nodes_json)[conversation.node_index] : null;
  const isReplyKeyboardChoice = activeNode?.type === 'message' && activeNode.keyboard === 'reply'
    && activeNode.buttons.some((button) => button.label === text && button.action === 'next');
  const trigger = findTriggerFlow(db, bot.id, text);
  const isStartCommand = /^\/start(?:\s|$)/i.test(text.trim());
  if (trigger && (isStartCommand || !isReplyKeyboardChoice)) {
    event(db, bot.id, user.bale_user_id, 'flow_started', `جریان «${trigger.name}» شروع شد`, { flowId: trigger.id });
    await runFlow(db, bot, user.bale_user_id, trigger, 0, text);
    return;
  }
  if (!conversation || !activeFlow) return;
  const flow = activeFlow;
  const node = JSON.parse(flow.nodes_json)[conversation.node_index];
  let nextIndex = null;
  if (node?.type === 'input') {
    const vars = JSON.parse(user.variables_json || '{}');
    vars[node.key] = text.slice(0, 1000);
    db.prepare('UPDATE bot_users SET variables_json=? WHERE bot_id=? AND bale_user_id=?').run(JSON.stringify(vars), bot.id, user.bale_user_id);
    event(db, bot.id, user.bale_user_id, 'input_captured', `پاسخ فیلد «${node.key}» ذخیره شد`, { flowId: flow.id, key: node.key });
    nextIndex = node.next;
  } else if (node?.type === 'message') {
    const replyChoice = node.keyboard === 'reply' ? node.buttons.find((button) => button.label === text && button.action === 'next') : null;
    nextIndex = replyChoice ? replyChoice.target : node.next;
  }
  if (nextIndex === null || nextIndex === undefined) {
    db.prepare('DELETE FROM conversations WHERE bot_id=? AND bale_user_id=?').run(bot.id, user.bale_user_id);
    event(db, bot.id, user.bale_user_id, 'flow_completed', `جریان «${flow.name}» به پایان رسید`, { flowId: flow.id });
    return;
  }
  await runFlow(db, bot, user.bale_user_id, flow, nextIndex, text);
}

async function handleCallback(db, bot, update) {
  const query = update.callback_query;
  if (!query?.id || !query.from?.id) return;
  try { await answerCallbackQuery(bot.token, { callback_query_id: query.id }); } catch { /* Older Bale clients may not support this method. */ }
  const user = db.prepare('SELECT * FROM bot_users WHERE bot_id=? AND bale_user_id=?').get(bot.id, String(query.from.id));
  const match = /^f:([0-9a-f-]{36}):(\d{1,2})$/i.exec(query.data || '');
  if (!user || !match) {
    if (user) event(db, bot.id, user.bale_user_id, 'callback_received', 'دکمه اینلاین دریافت شد', {});
    return;
  }
  const flow = db.prepare('SELECT * FROM flows WHERE id=? AND bot_id=? AND enabled=1').get(match[1], bot.id);
  const target = Number(match[2]);
  if (!flow || !Number.isInteger(target) || target >= JSON.parse(flow.nodes_json).length) return;
  event(db, bot.id, user.bale_user_id, 'callback_received', 'دکمه اینلاین انتخاب شد', { flowId: flow.id, nodeIndex: target });
  await runFlow(db, bot, user.bale_user_id, flow, target);
}

export async function processBaleUpdate(db, bot, update) {
  if (update?.callback_query) return handleCallback(db, bot, update);
  if (update?.message) return handleText(db, bot, update);
}

export function recordApiEvent(db, botId, type, summary, details = {}) {
  event(db, botId, null, type, summary, details);
}

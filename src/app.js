import express from 'express';
import helmet from 'helmet';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config.js';
import { answerCallbackQuery, BaleApiError, callBale, deleteWebhook, getMe, sendMessage, setWebhook } from './bale.js';
import { decryptSecret, encryptSecret, hashSession, hashWebhookSecret, newRandomSecret, passwordMatches } from './crypto.js';
import { validateFlow } from './flows.js';
import { processBaleUpdate, recordApiEvent } from './bot-runtime.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(projectRoot, 'public');
const SESSION_COOKIE = 'bale_admin';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const loginAttempts = new Map();
const now = () => new Date().toISOString();
const parseJson = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };

function cookieValue(req, name) {
  const cookies = (req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(value.join('=')); }
      catch { return null; }
    }
  }
  return null;
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.nodeEnv === 'production' ? '; Secure' : ''}`);
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}${config.nodeEnv === 'production' ? '; Secure' : ''}`);
}

function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return res.status(403).json({ error: 'درخواست از مبدأ مجاز دریافت نشد.' });
  try {
    const parsed = new URL(origin);
    if (parsed.host !== req.get('host') || !['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(403).json({ error: 'مبدأ درخواست معتبر نیست.' });
    }
  } catch {
    return res.status(403).json({ error: 'مبدأ درخواست معتبر نیست.' });
  }
  return next();
}

function requireAdmin(db, req, res, next) {
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token || token.length < 32) return res.status(401).json({ error: 'ابتدا وارد پنل شوید.' });
  const session = db.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash=?').get(hashSession(token));
  if (!session || session.expires_at <= now()) {
    if (session) db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hashSession(token));
    clearSessionCookie(res);
    return res.status(401).json({ error: 'نشست شما تمام شده است. دوباره وارد شوید.' });
  }
  return next();
}

function getBotRow(db, botId) {
  return db.prepare('SELECT * FROM bots WHERE id=?').get(botId);
}

function botWebhookUrl(row) {
  if (!config.appBaseUrl) return null;
  const secret = decryptSecret(row.webhook_secret_encrypted);
  return `${config.appBaseUrl}/webhooks/bale/${secret}`;
}

function publicBot(row) {
  let webhookUrl = null;
  try { webhookUrl = botWebhookUrl(row); } catch { /* A damaged encrypted secret is reported through the webhook status. */ }
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    baleUserId: row.bale_user_id,
    webhookStatus: row.webhook_status,
    webhookError: row.webhook_error,
    webhookUrl,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tokenConfigured: true
  };
}

function requireBot(db, req, res) {
  const row = getBotRow(db, req.params.botId);
  if (!row) {
    res.status(404).json({ error: 'ربات پیدا نشد.' });
    return null;
  }
  return row;
}

function logManualMessage(db, botId, userId, text, status, error, messageId) {
  db.prepare(`INSERT INTO message_logs (bot_id, bale_user_id, direction, status, method, text, error_message, provider_message_id, created_at)
    VALUES (?, ?, 'outbound', ?, 'sendMessage', ?, ?, ?, ?)`)
    .run(botId, userId, status, text, error, messageId, now());
}

async function registerWebhook(db, row) {
  if (!config.appBaseUrl) throw new Error('برای ثبت وب‌هوک، APP_BASE_URL با آدرس HTTPS عمومی را تنظیم کنید.');
  const token = decryptSecret(row.token_encrypted);
  await setWebhook(token, botWebhookUrl(row));
  db.prepare("UPDATE bots SET webhook_status='active', webhook_error=NULL, updated_at=? WHERE id=?").run(now(), row.id);
  recordApiEvent(db, row.id, 'webhook_active', 'وب‌هوک بله به این سامانه وصل شد');
}

function safeLike(value) {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginResourcePolicy: { policy: 'same-origin' }
  }));
  app.use(express.json({ limit: '1mb', strict: true }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/api/session', (req, res) => {
    const token = cookieValue(req, SESSION_COOKIE);
    const session = token ? db.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash=?').get(hashSession(token)) : null;
    if (!session || session.expires_at <= now()) {
      if (session) db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hashSession(token));
      return res.json({ authenticated: false });
    }
    return res.json({ authenticated: true, username: config.adminUsername, expiresAt: session.expires_at });
  });

  app.post('/api/login', requireSameOrigin, (req, res) => {
    const address = req.ip || req.socket.remoteAddress || 'unknown';
    const attempt = loginAttempts.get(address) || { count: 0, start: Date.now() };
    if (Date.now() - attempt.start > 15 * 60 * 1000) { attempt.count = 0; attempt.start = Date.now(); }
    if (attempt.count >= 10) return res.status(429).json({ error: 'تلاش‌های ورود زیاد است. چند دقیقه دیگر دوباره امتحان کنید.' });
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const usernameOk = username.length === config.adminUsername.length && timingSafeEqual(Buffer.from(username), Buffer.from(config.adminUsername));
    const passwordOk = password.length <= 1024 && passwordMatches(password);
    if (!usernameOk || !passwordOk) {
      attempt.count += 1;
      loginAttempts.set(address, attempt);
      return res.status(401).json({ error: 'نام کاربری یا گذرواژه درست نیست.' });
    }
    loginAttempts.delete(address);
    const token = newRandomSecret();
    const createdAt = now();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
    db.prepare('INSERT INTO admin_sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)').run(hashSession(token), expiresAt, createdAt);
    setSessionCookie(res, token);
    return res.json({ authenticated: true, username: config.adminUsername, expiresAt });
  });

  app.post('/api/logout', requireSameOrigin, (req, res) => {
    const token = cookieValue(req, SESSION_COOKIE);
    if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hashSession(token));
    clearSessionCookie(res);
    return res.json({ authenticated: false });
  });

  app.post('/webhooks/bale/:secret', async (req, res) => {
    const secretHash = hashWebhookSecret(req.params.secret || '');
    const row = db.prepare('SELECT * FROM bots WHERE webhook_secret_hash=?').get(secretHash);
    if (!row || !req.body || typeof req.body !== 'object') return res.status(404).json({ ok: false });
    const updateId = req.body.update_id;
    if (updateId === undefined || updateId === null) return res.status(400).json({ ok: false });
    const key = String(updateId);
    const existing = db.prepare('SELECT status, received_at FROM webhook_updates WHERE bot_id=? AND update_id=?').get(row.id, key);
    if (existing?.status === 'done') return res.json({ ok: true });
    if (existing?.status === 'processing' && Date.now() - Date.parse(existing.received_at) < 120000) return res.json({ ok: true });
    db.prepare('DELETE FROM webhook_updates WHERE bot_id=? AND update_id=?').run(row.id, key);
    db.prepare("INSERT INTO webhook_updates (bot_id, update_id, status, received_at) VALUES (?, ?, 'processing', ?)").run(row.id, key, now());
    try {
      const bot = { id: row.id, token: decryptSecret(row.token_encrypted) };
      await processBaleUpdate(db, bot, req.body);
      db.prepare("UPDATE webhook_updates SET status='done', received_at=? WHERE bot_id=? AND update_id=?").run(now(), row.id, key);
      return res.json({ ok: true });
    } catch {
      db.prepare('DELETE FROM webhook_updates WHERE bot_id=? AND update_id=?').run(row.id, key);
      return res.status(500).json({ ok: false });
    }
  });

  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return requireSameOrigin(req, res, next);
    return next();
  });
  app.use('/api', (req, res, next) => requireAdmin(db, req, res, next));

  app.get('/api/dashboard', (req, res) => {
    const botId = typeof req.query.botId === 'string' ? req.query.botId : null;
    if (botId && !getBotRow(db, botId)) return res.status(404).json({ error: 'ربات پیدا نشد.' });
    const args = botId ? [botId] : [];
    const where = botId ? 'WHERE bot_id=?' : '';
    const count = (table, condition = '') => {
      const clauses = [];
      if (botId) clauses.push('bot_id=?');
      if (condition) clauses.push(condition);
      return db.prepare(`SELECT COUNT(*) AS count FROM ${table}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}`).get(...args).count;
    };
    const bots = db.prepare('SELECT id, name, username, webhook_status FROM bots ORDER BY created_at DESC').all();
    const events = db.prepare(`SELECT e.*, u.first_name, u.last_name, u.username FROM events e
      LEFT JOIN bot_users u ON u.bot_id=e.bot_id AND u.bale_user_id=e.bale_user_id
      ${botId ? 'WHERE e.bot_id=?' : ''} ORDER BY e.created_at DESC LIMIT 10`).all(...args);
    return res.json({
      bots,
      stats: {
        users: count('bot_users'),
        flows: count('flows', 'enabled=1'),
        acceptedMessages: db.prepare(`SELECT COUNT(*) AS count FROM message_logs ${where} ${where ? 'AND' : 'WHERE'} direction='outbound' AND status='accepted'`).get(...args).count,
        errors: db.prepare(`SELECT COUNT(*) AS count FROM message_logs ${where} ${where ? 'AND' : 'WHERE'} status='failed'`).get(...args).count
      },
      events
    });
  });

  app.get('/api/bots', (_req, res) => res.json({ bots: db.prepare('SELECT * FROM bots ORDER BY created_at DESC').all().map(publicBot) }));

  app.post('/api/bots', async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (name.length < 2 || name.length > 64) return res.status(400).json({ error: 'نام ربات باید بین ۲ تا ۶۴ نویسه باشد.' });
    if (token.length < 20 || token.length > 512 || /\s/.test(token)) return res.status(400).json({ error: 'توکن بله معتبر نیست.' });
    let identity;
    try { identity = await getMe(token); }
    catch (error) { return res.status(400).json({ error: `توکن از بله تأیید نشد: ${error.message}` }); }
    if (!identity?.is_bot || identity.id === undefined || !identity.username) return res.status(400).json({ error: 'پاسخ getMe هویت یک ربات معتبر را نشان نداد.' });
    if (db.prepare('SELECT 1 FROM bots WHERE bale_user_id=?').get(String(identity.id))) return res.status(409).json({ error: 'این ربات قبلاً به پنل اضافه شده است.' });
    const id = randomUUID();
    const secret = newRandomSecret();
    const createdAt = now();
    db.prepare(`INSERT INTO bots (id, name, username, bale_user_id, token_encrypted, webhook_secret_encrypted,
      webhook_secret_hash, webhook_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(id, name, identity.username, String(identity.id), encryptSecret(token), encryptSecret(secret), hashWebhookSecret(secret), createdAt, createdAt);
    let row = getBotRow(db, id);
    if (config.appBaseUrl) {
      try { await registerWebhook(db, row); }
      catch (error) {
        db.prepare("UPDATE bots SET webhook_status='error', webhook_error=?, updated_at=? WHERE id=?").run(error.message, now(), id);
      }
      row = getBotRow(db, id);
    }
    recordApiEvent(db, id, 'bot_added', `ربات @${identity.username} به پنل اضافه شد`);
    return res.status(201).json({ bot: publicBot(row) });
  });

  app.patch('/api/bots/:botId', (req, res) => {
    const row = requireBot(db, req, res);
    if (!row) return;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (name.length < 2 || name.length > 64) return res.status(400).json({ error: 'نام ربات باید بین ۲ تا ۶۴ نویسه باشد.' });
    db.prepare('UPDATE bots SET name=?, updated_at=? WHERE id=?').run(name, now(), row.id);
    return res.json({ bot: publicBot(getBotRow(db, row.id)) });
  });

  app.post('/api/bots/:botId/webhook/sync', async (req, res) => {
    const row = requireBot(db, req, res);
    if (!row) return;
    try {
      await registerWebhook(db, row);
      return res.json({ bot: publicBot(getBotRow(db, row.id)) });
    } catch (error) {
      db.prepare("UPDATE bots SET webhook_status='error', webhook_error=?, updated_at=? WHERE id=?").run(error.message, now(), row.id);
      return res.status(502).json({ error: error.message, bot: publicBot(getBotRow(db, row.id)) });
    }
  });

  app.delete('/api/bots/:botId', async (req, res) => {
    const row = requireBot(db, req, res);
    if (!row) return;
    if (row.webhook_status === 'active') {
      try { await deleteWebhook(decryptSecret(row.token_encrypted)); }
      catch (error) { return res.status(502).json({ error: `وب‌هوک از بله جدا نشد و داده‌ها نگه داشته شدند: ${error.message}` }); }
    }
    db.prepare('DELETE FROM bots WHERE id=?').run(row.id);
    return res.json({ deleted: true });
  });

  app.get('/api/bots/:botId/flows', (req, res) => {
    const row = requireBot(db, req, res);
    if (!row) return;
    const flows = db.prepare('SELECT * FROM flows WHERE bot_id=? ORDER BY created_at DESC').all(row.id).map((flow) => ({
      id: flow.id, name: flow.name, triggerType: flow.trigger_type, triggerValue: flow.trigger_value,
      nodes: parseJson(flow.nodes_json, []), enabled: Boolean(flow.enabled), createdAt: flow.created_at, updatedAt: flow.updated_at
    }));
    return res.json({ flows });
  });

  app.post('/api/bots/:botId/flows', (req, res) => {
    const row = requireBot(db, req, res);
    if (!row) return;
    let flow;
    try { flow = validateFlow(req.body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const id = randomUUID();
    const timestamp = now();
    try {
      db.prepare(`INSERT INTO flows (id, bot_id, name, trigger_type, trigger_value, nodes_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, row.id, flow.name, flow.triggerType, flow.triggerValue, JSON.stringify(flow.nodes), timestamp, timestamp);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'این جریان شروع یکسانی با جریان دیگری دارد.' });
      throw error;
    }
    return res.status(201).json({ flow: { id, ...flow, enabled: true, createdAt: timestamp, updatedAt: timestamp } });
  });

  app.put('/api/bots/:botId/flows/:flowId', (req, res) => {
    const row = requireBot(db, req, res);
    if (!row) return;
    const existing = db.prepare('SELECT * FROM flows WHERE id=? AND bot_id=?').get(req.params.flowId, row.id);
    if (!existing) return res.status(404).json({ error: 'جریان پیدا نشد.' });
    let flow;
    try { flow = validateFlow(req.body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try {
      db.prepare(`UPDATE flows SET name=?, trigger_type=?, trigger_value=?, nodes_json=?, updated_at=? WHERE id=? AND bot_id=?`)
        .run(flow.name, flow.triggerType, flow.triggerValue, JSON.stringify(flow.nodes), now(), existing.id, row.id);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'این جریان شروع یکسانی با جریان دیگری دارد.' });
      throw error;
    }
    return res.json({ flow: { id: existing.id, ...flow, enabled: Boolean(existing.enabled), updatedAt: now() } });
  });

  app.patch('/api/bots/:botId/flows/:flowId/status', (req, res) => {
    const row = requireBot(db, req, res);
    if (!row) return;
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'وضعیت جریان معتبر نیست.' });
    const result = db.prepare('UPDATE flows SET enabled=?, updated_at=? WHERE id=? AND bot_id=?').run(req.body.enabled ? 1 : 0, now(), req.params.flowId, row.id);
    if (!result.changes) return res.status(404).json({ error: 'جریان پیدا نشد.' });
    return res.json({ enabled: req.body.enabled });
  });

  app.delete('/api/bots/:botId/flows/:flowId', (req, res) => {
    const row = requireBot(db, req, res);
    if (!row) return;
    const result = db.prepare('DELETE FROM flows WHERE id=? AND bot_id=?').run(req.params.flowId, row.id);
    if (!result.changes) return res.status(404).json({ error: 'جریان پیدا نشد.' });
    return res.json({ deleted: true });
  });

  app.get('/api/bots/:botId/users', (req, res) => {
    const row = requireBot(db, req, res);
    if (!row) return;
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '100', 10) || 100, 1), 200);
    const users = query
      ? db.prepare(`SELECT * FROM bot_users WHERE bot_id=? AND (first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' OR bale_user_id LIKE ?)
        ORDER BY last_seen DESC LIMIT ?`).all(row.id, safeLike(query), safeLike(query), safeLike(query), safeLike(query), limit)
      : db.prepare('SELECT * FROM bot_users WHERE bot_id=? ORDER BY last_seen DESC LIMIT ?').all(row.id, limit);
    return res.json({ users: users.map((user) => ({
      id: user.bale_user_id, chatId: user.chat_id, firstName: user.first_name, lastName: user.last_name,
      username: user.username, languageCode: user.language_code, lastMessage: user.last_message,
      firstSeen: user.first_seen, lastSeen: user.last_seen, messageCount: user.message_count
    })) });
  });

  app.get('/api/bots/:botId/users/:userId', (req, res) => {
    const row = requireBot(db, req, res);
    if (!row) return;
    const user = db.prepare('SELECT * FROM bot_users WHERE bot_id=? AND bale_user_id=?').get(row.id, req.params.userId);
    if (!user) return res.status(404).json({ error: 'کاربر این ربات پیدا نشد.' });
    const events = db.prepare('SELECT * FROM events WHERE bot_id=? AND bale_user_id=? ORDER BY created_at DESC LIMIT 100').all(row.id, user.bale_user_id);
    const messages = db.prepare('SELECT * FROM message_logs WHERE bot_id=? AND bale_user_id=? ORDER BY created_at DESC LIMIT 100').all(row.id, user.bale_user_id);
    return res.json({
      user: { id: user.bale_user_id, chatId: user.chat_id, firstName: user.first_name, lastName: user.last_name,
        username: user.username, languageCode: user.language_code, lastMessage: user.last_message,
        firstSeen: user.first_seen, lastSeen: user.last_seen, messageCount: user.message_count,
        variables: parseJson(user.variables_json) },
      events: events.map((item) => ({ id: item.id, type: item.event_type, summary: item.summary, details: parseJson(item.details_json), createdAt: item.created_at })),
      messages: messages.map((item) => ({ id: item.id, direction: item.direction, status: item.status, method: item.method,
        text: item.text, error: item.error_message, providerMessageId: item.provider_message_id, createdAt: item.created_at }))
    });
  });

  app.post('/api/bots/:botId/users/:userId/messages', async (req, res) => {
    const row = requireBot(db, req, res);
    if (!row) return;
    const user = db.prepare('SELECT * FROM bot_users WHERE bot_id=? AND bale_user_id=?').get(row.id, req.params.userId);
    if (!user) return res.status(404).json({ error: 'کاربر این ربات پیدا نشد.' });
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 4000) return res.status(400).json({ error: 'متن پیام باید بین ۱ تا ۴۰۰۰ نویسه باشد.' });
    try {
      const result = await sendMessage(decryptSecret(row.token_encrypted), { chat_id: user.chat_id, text });
      logManualMessage(db, row.id, user.bale_user_id, text, 'accepted', null, result?.message_id ? String(result.message_id) : null);
      recordApiEvent(db, row.id, 'message_accepted', `پیام دستی به کاربر ${user.bale_user_id} فرستاده شد`, { userId: user.bale_user_id, text });
      return res.status(202).json({ status: 'accepted' });
    } catch (error) {
      logManualMessage(db, row.id, user.bale_user_id, text, 'failed', error.message, null);
      return res.status(502).json({ error: error.message });
    }
  });

  app.get('/api/bots/:botId/activity', (req, res) => {
    const row = requireBot(db, req, res);
    if (!row) return;
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '100', 10) || 100, 1), 250);
    const events = db.prepare(`SELECT e.*, u.first_name, u.last_name, u.username FROM events e
      LEFT JOIN bot_users u ON u.bot_id=e.bot_id AND u.bale_user_id=e.bale_user_id
      WHERE e.bot_id=? ORDER BY e.created_at DESC LIMIT ?`).all(row.id, limit);
    const messages = db.prepare('SELECT * FROM message_logs WHERE bot_id=? ORDER BY created_at DESC LIMIT ?').all(row.id, limit);
    return res.json({
      events: events.map((item) => ({ id: item.id, userId: item.bale_user_id, userName: [item.first_name, item.last_name].filter(Boolean).join(' ') || item.username || item.bale_user_id,
        type: item.event_type, summary: item.summary, details: parseJson(item.details_json), createdAt: item.created_at })),
      messages: messages.map((item) => ({ id: item.id, userId: item.bale_user_id, direction: item.direction, status: item.status,
        method: item.method, text: item.text, error: item.error_message, createdAt: item.created_at }))
    });
  });

  app.post('/api/bots/:botId/users/:userId/reset-flow', (req, res) => {
    const row = requireBot(db, req, res);
    if (!row) return;
    db.prepare('DELETE FROM conversations WHERE bot_id=? AND bale_user_id=?').run(row.id, req.params.userId);
    recordApiEvent(db, row.id, 'conversation_reset', `وضعیت جریان کاربر ${req.params.userId} پاک شد`, { userId: req.params.userId });
    return res.json({ reset: true });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'مسیر API پیدا نشد.' }));
  app.use(express.static(publicDir, { index: false, etag: true, maxAge: config.nodeEnv === 'production' ? '1h' : 0 }));
  app.get('*path', async (_req, res, next) => {
    try { return res.type('html').send(await readFile(path.join(publicDir, 'index.html'), 'utf8')); }
    catch (error) { return next(error); }
  });

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'بدنه درخواست JSON معتبر نیست.' });
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'حجم درخواست بیش از حد مجاز است.' });
    if (error instanceof BaleApiError) return res.status(error.status).json({ error: error.message });
    console.error('Request failed:', error?.message || 'unknown error');
    return res.status(500).json({ error: 'خطای داخلی رخ داد.' });
  });
  return app;
}

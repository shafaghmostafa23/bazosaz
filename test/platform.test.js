import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.ADMIN_USERNAME = 'test-admin';
process.env.ADMIN_PASSWORD = 'a-long-test-password';
process.env.SESSION_SECRET = 'test-session-secret-that-is-at-least-32-characters';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_PATH = './data/test.sqlite';
delete process.env.APP_BASE_URL;

const [{ openDatabase }, { createApp }, { encryptSecret, decryptSecret, hashWebhookSecret }, flowUtils] = await Promise.all([
  import('../src/db.js'), import('../src/app.js'), import('../src/crypto.js'), import('../src/flows.js')
]);

test('secret encryption, flow validation, and keyboard rendering', () => {
  const secret = '123456789:private-token-value';
  const encrypted = encryptSecret(secret);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptSecret(encrypted), secret);
  assert.equal(hashWebhookSecret('secret').length, 64);

  const flow = flowUtils.validateFlow({
    name: 'خوش‌آمدگویی',
    triggerType: 'start',
    triggerValue: '',
    nodes: [
      { type: 'message', text: 'سلام', keyboard: 'inline', next: null, buttons: [
        { label: 'ادامه', action: 'next', target: 1 },
        { label: 'وب‌سایت', action: 'url', url: 'https://example.com' }
      ] },
      { type: 'input', prompt: 'نام شما چیست؟', key: 'name', next: null }
    ]
  });
  assert.equal(flow.nodes.length, 2);
  assert.deepEqual(flowUtils.buildReplyMarkup('00000000-0000-4000-8000-000000000000', flow.nodes[0]), {
    inline_keyboard: [[{ text: 'ادامه', callback_data: 'f:00000000-0000-4000-8000-000000000000:1' }], [{ text: 'وب‌سایت', url: 'https://example.com/' }]]
  });
  assert.equal(flowUtils.conditionMatches({ mode: 'contains', value: 'بلی' }, 'بله، بلی'), true);
  assert.equal(flowUtils.renderVariables('سلام {{first_name}} {{city}}', { first_name: 'مینا' }, { city: 'تهران' }), 'سلام مینا تهران');
  assert.throws(() => flowUtils.validateFlow({ name: 'bad', triggerType: 'keyword', triggerValue: 'سلام', nodes: [{ type: 'message', text: 'ok', keyboard: 'inline', buttons: [{ label: 'x', action: 'url', url: 'javascript:alert(1)' }] }] }));
  assert.throws(() => flowUtils.validateFlow({ name: 'دور شرط', triggerType: 'start', nodes: [{ type: 'condition', mode: 'equals', value: 'بله', yes: 0, no: 0 }] }));
});

test('API requires an admin session and keeps bot data scoped by bot', async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'bale-platform-test-'));
  const db = openDatabase(path.join(directory, 'test.sqlite'));
  const server = createApp(db).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const get = (url, cookie = '') => fetch(`${origin}${url}`, { headers: cookie ? { cookie } : {} });
  const post = (url, cookie, body, method = 'POST') => fetch(`${origin}${url}`, {
    method,
    headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /lang="fa" dir="rtl"/);
  assert.equal((await get('/app.js')).status, 200);
  assert.equal((await get('/api/bots')).status, 401);
  assert.equal((await fetch(`${origin}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test-admin', password: 'a-long-test-password' }) })).status, 403);
  const login = await post('/api/login', '', { username: 'test-admin', password: 'a-long-test-password' });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await get('/api/dashboard', cookie)).status, 200);

  const botId = randomUUID();
  const otherBotId = randomUUID();
  const timestamp = new Date().toISOString();
  const insertBot = db.prepare(`INSERT INTO bots (id, name, username, bale_user_id, token_encrypted,
    webhook_secret_encrypted, webhook_secret_hash, webhook_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`);
  insertBot.run(botId, 'پشتیبانی', 'help_bot', '10101', encryptSecret('10101:test-token'), encryptSecret('test-secret-1'), hashWebhookSecret('test-secret-1'), timestamp, timestamp);
  insertBot.run(otherBotId, 'فروش', 'sales_bot', '20202', encryptSecret('20202:other-token'), encryptSecret('test-secret-2'), hashWebhookSecret('test-secret-2'), timestamp, timestamp);
  const listedBots = await (await get('/api/bots', cookie)).json();
  assert.equal(JSON.stringify(listedBots).includes('test-token'), false);
  assert.equal(JSON.stringify(listedBots).includes('other-token'), false);

  const webhookUrl = `${origin}/webhooks/bale/test-secret-1`;
  const webhookBody = JSON.stringify({ update_id: 42 });
  const webhook = await fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: webhookBody });
  assert.equal(webhook.status, 200);
  assert.equal((await fetch(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: webhookBody })).status, 200);
  assert.equal(db.prepare('SELECT status FROM webhook_updates WHERE bot_id=? AND update_id=?').get(botId, '42').status, 'done');
  assert.equal((await fetch(`${origin}/webhooks/bale/wrong-secret`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: webhookBody })).status, 404);
  db.prepare(`INSERT INTO bot_users (bot_id, bale_user_id, chat_id, first_name, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`)
    .run(botId, '7001', '7001', 'مینا', timestamp, timestamp, otherBotId, '7001', '7001', 'علی', timestamp, timestamp);

  const dashboard = await (await get('/api/dashboard', cookie)).json();
  assert.equal(dashboard.stats.users, 2);
  const botUsers = await (await get(`/api/bots/${botId}/users`, cookie)).json();
  assert.equal(botUsers.users.length, 1);
  assert.equal(botUsers.users[0].firstName, 'مینا');
  const searchedUsers = await (await get(`/api/bots/${botId}/users?q=${encodeURIComponent('مینا')}`, cookie)).json();
  assert.equal(searchedUsers.users.length, 1);
  assert.equal((await get(`/api/bots/${otherBotId}/users/7001`, cookie)).status, 200);

  const flowBody = {
    name: 'خوش‌آمدگویی', triggerType: 'start', triggerValue: '',
    nodes: [{ type: 'message', text: 'سلام {{first_name}}', keyboard: 'none', buttons: [], next: null }]
  };
  const created = await post(`/api/bots/${botId}/flows`, cookie, flowBody);
  assert.equal(created.status, 201);
  assert.equal((await (await get(`/api/bots/${botId}/flows`, cookie)).json()).flows.length, 1);
  assert.equal((await post(`/api/bots/${otherBotId}/flows`, cookie, flowBody)).status, 201);
  assert.equal((await post(`/api/bots/${botId}/flows`, cookie, flowBody)).status, 409);
  assert.equal((await post(`/api/bots/${botId}/flows`, cookie, { ...flowBody, nodes: [] })).status, 400);
  assert.equal((await get(`/api/bots/${botId}/users/7001`, cookie)).status, 200);
  assert.equal((await get(`/api/bots/${botId}/users/does-not-belong`, cookie)).status, 404);
});

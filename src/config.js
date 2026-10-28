import 'dotenv/config';
import path from 'node:path';

const adminUsername = process.env.ADMIN_USERNAME?.trim();
const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;
const encryptionKey = process.env.ENCRYPTION_KEY;

if (!adminUsername || !adminPassword || !sessionSecret || !encryptionKey) {
  throw new Error('Set ADMIN_USERNAME, ADMIN_PASSWORD, SESSION_SECRET, and ENCRYPTION_KEY in .env before starting.');
}
if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(adminUsername)) throw new Error('ADMIN_USERNAME must be 3–64 ASCII letters, numbers, dots, underscores, or hyphens.');
if (adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) throw new Error('ENCRYPTION_KEY must be 64 hexadecimal characters.');

const baseUrl = process.env.APP_BASE_URL?.trim() || '';
if (baseUrl) {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:') throw new Error('APP_BASE_URL must use HTTPS for Bale webhooks.');
  if (parsed.port && !['443', '88'].includes(parsed.port)) throw new Error('Bale webhooks currently support external ports 443 and 88.');
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('APP_BASE_URL must be the origin only, for example https://bots.example.com.');
}
const port = Number.parseInt(process.env.PORT || '3000', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a number from 1 to 65535.');

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port,
  adminUsername,
  adminPassword,
  sessionSecret,
  encryptionKey: Buffer.from(encryptionKey, 'hex'),
  appBaseUrl: baseUrl.replace(/\/$/, ''),
  databasePath: path.resolve(process.env.DATABASE_PATH || './data/bale-manager.sqlite'),
  trustProxy: process.env.TRUST_PROXY === '1'
});

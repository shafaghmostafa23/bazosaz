import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

export function encryptSecret(plainText) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptSecret(value) {
  const [version, ivValue, tagValue, encryptedValue] = String(value).split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) throw new Error('Stored secret has an unsupported format.');
  const decipher = createDecipheriv('aes-256-gcm', config.encryptionKey, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
}

export const hashSession = (token) => createHmac('sha256', config.sessionSecret).update(token).digest('hex');
export const hashWebhookSecret = (secret) => createHash('sha256').update(secret).digest('hex');
export const newRandomSecret = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function passwordMatches(candidate) {
  const salt = createHmac('sha256', config.sessionSecret).update('admin-password-v1').digest();
  const expected = scryptSync(config.adminPassword, salt, 64);
  const received = scryptSync(candidate, salt, 64);
  return timingSafeEqual(expected, received);
}

// 将平台 key 以网关同款 AES-256-GCM 加密写入 api_keys 表
// 用法：node tools/catalog-builder/add-key.mjs <platform> <key> [label]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DB_PATH, ENV_PATH } from './config.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const [platform, key, label] = process.argv.slice(2);
if (!platform || !key) {
  console.error('用法: node tools/catalog-builder/add-key.mjs <platform> <key> [label]');
  process.exit(1);
}

const env = fs.readFileSync(ENV_PATH, 'utf8').match(/^ENCRYPTION_KEY=([0-9a-fA-F]{64})/m)?.[1];
if (!env) throw new Error('.env 缺少 ENCRYPTION_KEY');
const encKey = Buffer.from(env, 'hex');

const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
const encrypted = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
const authTag = cipher.getAuthTag();

const db = new Database(DB_PATH);
const existing = db.prepare('SELECT id FROM api_keys WHERE platform = ?').get(platform);
if (existing) {
  db.prepare('UPDATE api_keys SET encrypted_key = ?, iv = ?, auth_tag = ?, enabled = 1 WHERE id = ?')
    .run(encrypted.toString('hex'), iv.toString('hex'), authTag.toString('hex'), existing.id);
  console.log(`[${platform}] 已更新现有 key（id=${existing.id}）`);
} else {
  const info = db.prepare('INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)')
    .run(platform, label ?? platform, encrypted.toString('hex'), iv.toString('hex'), authTag.toString('hex'), 'unknown');
  console.log(`[${platform}] 已写入 key（id=${info.lastInsertRowid}）`);
}
const check = db.prepare('SELECT platform, status, enabled FROM api_keys WHERE platform = ?').get(platform);
console.log('  状态:', JSON.stringify(check));
db.close();

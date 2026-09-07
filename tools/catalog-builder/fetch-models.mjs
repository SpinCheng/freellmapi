// 采集各平台最新模型列表（用 freellmapi 数据库里你自己录入的 key）
// 输出：work/fetched.json
// 用法：node tools/catalog-builder/fetch-models.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PROVIDERS, OPENROUTER_PUBLIC_URL, isFreeOnOpenRouter, ENV_PATH, DB_PATH } from './config.mjs';

const require = createRequire(import.meta.url); // 向上解析到仓库根 node_modules
const { SocksProxyAgent } = require('socks-proxy-agent');

// 被墙域名走本地 socks 代理（v2rayN 默认 10808）；可用 CATALOG_PROXY 覆盖或置空禁用
const SOCKS_PROXY = process.env.CATALOG_PROXY !== '' && (process.env.CATALOG_PROXY || 'socks5h://127.0.0.1:10808');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'work');
fs.mkdirSync(WORK, { recursive: true });

// ── 读取 ENCRYPTION_KEY（与 server 同源：仓库根 .env）──
function readEncryptionKey() {
  const env = fs.readFileSync(ENV_PATH, 'utf8');
  const m = env.match(/^ENCRYPTION_KEY=([0-9a-fA-F]{64})/m);
  if (!m) throw new Error('.env 中找不到 ENCRYPTION_KEY');
  return Buffer.from(m[1], 'hex');
}

// ── 从 freellmapi 数据库解密各平台 key（AES-256-GCM，见 server/src/lib/crypto.ts）──
function loadProviderKeys() {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare('SELECT platform, base_url, encrypted_key, iv, auth_tag, enabled FROM api_keys').all();
  db.close();
  const out = {};
  for (const r of rows) {
    if (!r.enabled) continue;
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', readEncryptionKey(), Buffer.from(r.iv, 'hex'), { authTagLength: 16 });
      d.setAuthTag(Buffer.from(r.auth_tag, 'hex'));
      out[r.platform] = { key: d.update(r.encrypted_key, 'hex', 'utf8') + d.final('utf8'), baseUrl: r.base_url || null };
    } catch (e) {
      console.warn(`[keys] ${r.platform} 解密失败：${e.message}`);
    }
  }
  return out;
}

// ── 各风格的 /models 拉取 ──────────────────────────────────────────────
const TIMEOUT_MS = 15_000;

// 直连 fetch 失败（被墙/DNS）时走 socks 代理重试
function viaSocks(url, headers) {
  return new Promise((resolve, reject) => {
    const agent = new SocksProxyAgent(SOCKS_PROXY);
    const mod = url.startsWith('http:') ? http : https;
    const req = mod.get(url, { headers, agent, timeout: TIMEOUT_MS }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

async function rawGet(url, headers = {}, allowProxyRetry = true) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: res.status, text: await res.text(), via: 'direct' };
  } catch (e) {
    if (!allowProxyRetry || !SOCKS_PROXY) throw e;
    const r = await viaSocks(url, headers);
    return { ...r, via: 'socks' };
  }
}

// 拉取并解析 JSON；401/403 且带了鉴权时，去鉴权重试一次（OVH 等匿名端点）
async function fetchJson(url, headers = {}) {
  let r = await rawGet(url, headers);
  if ((r.status === 401 || r.status === 403) && headers.Authorization) {
    const { Authorization, ...noAuth } = headers;
    r = await rawGet(url, noAuth);
  }
  if (r.status === 304) return { __304: true };
  if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status} via ${r.via}`);
  try {
    return JSON.parse(r.text);
  } catch {
    throw new Error(`非 JSON 响应 via ${r.via}: ${r.text.slice(0, 80)}`);
  }
}

async function fetchOpenAIStyle(base, key) {
  const j = await fetchJson(`${base.replace(/\/$/, '')}/models`, { Authorization: `Bearer ${key}` });
  const list = j.data ?? j.models ?? [];
  return list.map((m) => ({
    id: m.id ?? m.name,
    contextLength: m.context_length ?? m.context_window ?? m.max_model_len ?? null,
  })).filter((m) => m.id);
}

async function fetchGoogle(base, key) {
  const j = await fetchJson(`${base}/models?key=${encodeURIComponent(key)}`);
  return (j.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => ({ id: String(m.name).replace(/^models\//, ''), contextLength: m.inputTokenLimit ?? null }));
}

async function fetchCloudflare(key) {
  // key 形如 account_id:token（quirks: cloudflare-key-format）
  const idx = key.indexOf(':');
  const accountId = key.slice(0, idx);
  const token = key.slice(idx + 1);
  const headers = { Authorization: `Bearer ${token}` };
  // OpenAI 兼容端点部分账号不开；官方 search 端点更稳
  let j;
  try {
    j = await fetchJson(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/models`, headers);
    return (j.data ?? []).map((m) => ({ id: m.id, contextLength: null }));
  } catch {
    j = await fetchJson(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?per_page=100`, headers);
    return (j.result ?? []).map((m) => ({ id: m.name ?? m.id, contextLength: null }));
  }
}

async function fetchAIHorde() {
  // AI Horde 自有 API：GET /api/v2/status/models?type=text，匿名 key 即可
  // 响应为数组：[{performance, queued, jobs, eta, type, name, count}]
  const j = await fetchJson('https://aihorde.net/api/v2/status/models?type=text');
  return (Array.isArray(j) ? j : [])
    .filter((m) => !m.type || String(m.type) === 'text')
    .map((m) => ({ id: m.name, contextLength: null }));
}

// ── 主流程 ─────────────────────────────────────────────────────────────
const keys = loadProviderKeys();
const providers = {};
for (const [platform, cfg] of Object.entries(PROVIDERS)) {
  const cred = keys[platform];
  if (!cred) { providers[platform] = { ok: false, skipped: 'no key' }; continue; }
  const base = cred.baseUrl || cfg.base;
  try {
    let models;
    if (cfg.style === 'google') models = await fetchGoogle(base, cred.key);
    else if (cfg.style === 'cloudflare') models = await fetchCloudflare(cred.key);
    else if (cfg.style === 'aihorde') models = await fetchAIHorde();
    else models = await fetchOpenAIStyle(base, cred.key);
    providers[platform] = { ok: true, baseUrl: base, models };
    console.log(`[fetch] ${platform}: ${models.length} 个模型`);
  } catch (e) {
    providers[platform] = { ok: false, error: e.message };
    console.warn(`[fetch] ${platform}: 失败 ${e.message}`);
  }
}

// OpenRouter 公开列表（无需 key，作为跨厂商免费模型情报）
let openrouterPublic = [];
try {
  const j = await fetchJson(OPENROUTER_PUBLIC_URL);
  openrouterPublic = (j.data ?? []).filter(isFreeOnOpenRouter).map((m) => ({
    id: m.id,
    contextLength: m.context_length ?? null,
    vision: (m.architecture?.input_modalities ?? []).includes('image'),
    tools: (m.supported_parameters ?? []).includes('tools'),
    created: m.created ?? null,
    expires: m.expiration_date ?? null,
  }));
  console.log(`[fetch] openrouter 公开免费列表: ${openrouterPublic.length} 个`);
} catch (e) {
  console.warn(`[fetch] openrouter 公开列表失败: ${e.message}`);
}

// ── 账户额度/免费层状态（能查的平台）─────────────────────────────────
// OpenRouter /auth/key：is_free_tier 是权威免费层判定，usage 为累计消费（美元）
const usageInfo = {};
if (keys.openrouter) {
  try {
    const j = await fetchJson('https://openrouter.ai/api/v1/auth/key', { Authorization: `Bearer ${keys.openrouter.key}` });
    const d = j.data ?? {};
    usageInfo.openrouter = {
      isFreeTier: d.is_free_tier === true,
      usage: d.usage ?? null,
      usageDaily: d.usage_daily ?? null,
      usageWeekly: d.usage_weekly ?? null,
      usageMonthly: d.usage_monthly ?? null,
      limit: d.limit ?? null,
      limitRemaining: d.limit_remaining ?? null,
    };
    console.log(`[fetch] openrouter 账户: 免费层=${usageInfo.openrouter.isFreeTier}, 累计消费=$${usageInfo.openrouter.usage}, 今日=$${usageInfo.openrouter.usageDaily}`);
  } catch (e) {
    console.warn(`[fetch] openrouter 用量查询失败: ${e.message}`);
  }
}

const out = { fetchedAt: new Date().toISOString(), providers, openrouterPublic, usageInfo };
fs.writeFileSync(path.join(WORK, 'fetched.json'), JSON.stringify(out, null, 2));
console.log(`\n已写入 work/fetched.json（${Object.values(providers).filter(p => p.ok).length} 个平台成功）`);

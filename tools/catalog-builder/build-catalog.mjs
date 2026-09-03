// 合并采集结果与现有目录 → dist/catalog.json（freellmapi 兼容格式）+ Ed25519 签名
// 基准目录优先取 dist/catalog.json（迭代构建），否则取数据库里已应用的官方快照
// 用法：node tools/catalog-builder/build-catalog.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PROVIDERS, DB_PATH } from './config.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'work');
const DIST = path.join(HERE, 'dist');
const KEYS = path.join(HERE, 'keys');
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

// ── 1. 载入基准目录 ───────────────────────────────────────────────────
let base;
const prevPath = path.join(DIST, 'catalog.json');
if (fs.existsSync(prevPath)) {
  base = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
  console.log(`[base] 使用上次构建 dist/catalog.json v${base.version}`);
} else {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  const raw = db.prepare("SELECT value FROM settings WHERE key='catalog_applied_json'").get()?.value;
  db.close();
  if (!raw) throw new Error('找不到基准目录（dist/catalog.json 与数据库缓存均不存在）');
  base = JSON.parse(raw);
  console.log(`[base] 使用数据库官方快照 v${base.version}`);
}

// ── 2. 载入采集结果 ───────────────────────────────────────────────────
const fetchedPath = path.join(WORK, 'fetched.json');
if (!fs.existsSync(fetchedPath)) throw new Error('先运行 fetch-models.mjs');
const { providers: fetched, openrouterPublic } = JSON.parse(fs.readFileSync(fetchedPath, 'utf8'));

const shortName = (id) => id.replace(':free', '').split('/').pop().toLowerCase();
const baseIds = new Set(base.models.map((m) => `${m.platform}|${m.modelId}`));
const baseShortNames = new Set(base.models.map((m) => shortName(m.modelId)));

const report = { added: [], removed: [], skipped: [] };

// ── 3. 移除：某平台拉取成功、但目录行不在其 /models 里（含宽松短名匹配）──
for (const [platform, res] of Object.entries(fetched)) {
  if (!res.ok || !res.models?.length) continue;
  const liveShort = new Set(res.models.map((m) => shortName(m.id)));
  const before = base.models.length;
  base.models = base.models.filter((m) => {
    if (m.platform !== platform) return true;
    const gone = !res.models.some((x) => x.id === m.modelId) && !liveShort.has(shortName(m.modelId));
    if (gone) report.removed.push(`${platform}/${m.modelId}`);
    return !gone;
  });
  if (base.models.length !== before) console.log(`[prune] ${platform}: 移除 ${before - base.models.length} 个`);
}

// ── 4. 新增 A：OpenRouter 公开免费列表（跨厂商情报，落到 openrouter 平台）──
const orLive = fetched.openrouter?.ok ? new Set(fetched.openrouter.models.map((m) => m.id)) : null;
for (const m of openrouterPublic) {
  if (baseIds.has(`openrouter|${m.id}`) || baseShortNames.has(shortName(m.id))) continue;
  if (orLive && !orLive.has(m.id)) continue; // 自己的 openrouter key 拉不到的不加
  base.models.push({
    platform: 'openrouter',
    modelId: m.id,
    displayName: prettify(m.id),
    intelligenceRank: 5,
    speedRank: 5,
    sizeLabel: 'Free',
    limits: { rpm: 20, rpd: 50, tpm: null, tpd: null },
    monthlyTokenBudget: '',
    contextWindow: m.contextLength,
    enabled: true,
    supportsVision: !!m.vision,
    supportsTools: m.tools !== false,
  });
  baseIds.add(`openrouter|${m.id}`);
  baseShortNames.add(shortName(m.id));
  report.added.push({ via: 'openrouter-public', platform: 'openrouter', modelId: m.id, contextWindow: m.contextLength });
}

// ── 5. 新增 B：各平台自己 /models 里、策略允许自动加的 ────────────────
const orPublicByShort = new Map(openrouterPublic.map((m) => [shortName(m.id), m]));
for (const [platform, res] of Object.entries(fetched)) {
  const cfg = PROVIDERS[platform];
  if (!res.ok || !cfg?.autoAdd || !res.models?.length) continue;
  let n = 0;
  for (const m of res.models) {
    if (cfg.filter && !cfg.filter(m.id)) continue;
    if (baseIds.has(`${platform}|${m.id}`) || baseShortNames.has(shortName(m.id))) continue;
    const orMeta = orPublicByShort.get(shortName(m.id)); // 用 OpenRouter 元数据补上下文/视觉
    base.models.push({
      platform,
      modelId: m.id,
      displayName: prettify(m.id),
      intelligenceRank: 5,
      speedRank: 5,
      sizeLabel: 'Free',
      limits: { rpm: 20, rpd: 200, tpm: null, tpd: null },
      monthlyTokenBudget: '',
      contextWindow: m.contextLength ?? orMeta?.contextLength ?? null,
      enabled: true,
      supportsVision: !!orMeta?.vision,
      supportsTools: true,
    });
    baseIds.add(`${platform}|${m.id}`);
    baseShortNames.add(shortName(m.id));
    report.added.push({ via: 'provider-models', platform, modelId: m.id, contextWindow: m.contextLength ?? orMeta?.contextLength ?? null });
    n++;
  }
  if (n) console.log(`[add] ${platform}: 新增 ${n} 个`);
}

// ── 6. 版本号与元数据 ─────────────────────────────────────────────────
// 规范化：models 表的 NOT NULL 列不允许 null（官方用 "~3M" 之类字符串，未知给空串）
for (const m of base.models) {
  if (m.monthlyTokenBudget == null) m.monthlyTokenBudget = '';
  if (m.sizeLabel == null) m.sizeLabel = '';
  for (const k of ['intelligenceRank', 'speedRank']) {
    if (typeof m[k] !== 'number' || !Number.isFinite(m[k])) m[k] = 5;
  }
  for (const k of ['supportsVision', 'supportsTools', 'enabled']) {
    if (typeof m[k] !== 'boolean') m[k] = false;
  }
  if (!m.limits || typeof m.limits !== 'object') m.limits = { rpm: null, rpd: null, tpm: null, tpd: null };
  if (typeof m.displayName !== 'string' || !m.displayName) m.displayName = m.modelId;
}

const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
let version = today;
if (!(version > String(base.version))) version = `${today}.${Date.now() % 100000}`;
base.version = version;
base.tier = 'monthly'; // 自维护源沿用 monthly 语义（live 需要 fla_ 许可）
base.generatedAt = new Date().toISOString();
base.counts = { models: base.models.length, quirks: base.quirks?.length ?? 0 };

// ── 7. 写出目录并签名 ─────────────────────────────────────────────────
const bytes = Buffer.from(JSON.stringify(base, null, 2), 'utf8');
fs.writeFileSync(path.join(DIST, 'catalog.json'), bytes);

const { privateKey, publicKey } = loadOrCreateKeypair();
const sig = crypto.sign(null, bytes, privateKey).toString('base64');
fs.writeFileSync(path.join(DIST, 'catalog.sig'), sig);
fs.writeFileSync(path.join(DIST, 'version.txt'), version);
fs.writeFileSync(path.join(WORK, 'report.json'), JSON.stringify({ version, ...report }, null, 2));

const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
console.log(`\n[done] v${version} | 模型 ${base.models.length} 个（+${report.added.length} / -${report.removed.length}）`);
console.log(`签名：dist/catalog.sig（${sig.length} chars）`);
console.log(`\n把下面两行追加到仓库根 .env（CATALOG_PUBKEY 若已存在则替换）：\n`);
console.log(`CATALOG_BASE_URL=http://127.0.0.1:3099`);
console.log(`CATALOG_PUBKEY=${pubPem.replace(/\r?\n/g, '\\n')}`);

function loadOrCreateKeypair() {
  const privPath = path.join(KEYS, 'ed25519.pem');
  const pubPath = path.join(KEYS, 'ed25519.pub.pem');
  if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
    return {
      privateKey: crypto.createPrivateKey(fs.readFileSync(privPath, 'utf8')),
      publicKey: crypto.createPublicKey(fs.readFileSync(pubPath, 'utf8')),
    };
  }
  fs.mkdirSync(KEYS, { recursive: true });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
  console.log('[keys] 已生成新的 Ed25519 密钥对（tools/catalog-builder/keys/，勿泄露私钥）');
  return { privateKey, publicKey };
}

function prettify(id) {
  const clean = id.replace(':free', '').split('/').pop();
  return clean.split(/[-_.]/).map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
}

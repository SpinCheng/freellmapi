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

// ── 非对话模型过滤：/models 常混入 embedding/语音/图像/安全类，
//    它们不在 chat/completions 上服务，自动新增时一律拒收
const NON_CHAT = /embed|bge[-/]|m3e|gte[-/]|rerank|whisper|tts|text-to-speech|voice|speech|moderation|guard|diffusion|lyria|veo|imagen|flux|sdxl/i;
function isChatModel(id) {
  return !NON_CHAT.test(id);
}

// ── 3. 移除：某平台拉取成功、但目录行不在其 /models 里（含宽松短名匹配）──
// trustListing:false 的平台（如智谱）列表不完整——免费模型可能仍可调但不在列表，
// 据此删行会误杀，跳过
for (const [platform, res] of Object.entries(fetched)) {
  if (!res.ok || !res.models?.length) continue;
  if (PROVIDERS[platform]?.trustListing === false) continue;
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
  if (!isChatModel(m.id)) continue;
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
    if (!isChatModel(m.id)) continue;
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

// ── 5.5 冒烟对账：两轮独立冒烟都判死的模型行 → 禁用；曾由冒烟禁用且本轮复活 → 恢复 ──
// 保险丝：
//  a) 必须两轮"不同时间"的独立冒烟都死才禁用——限流/付费/超时/502 都不算死：
//     502 是"上游错误"混合桶（含限流级联、代理抖动），只有 400/404/unavailable
//     这类确定性拒绝（模型不在 chat 接口上服务）才足以自动禁用
//  b) 一票否决：任何历史轮次 ok 过的模型名，本轮不禁（近期有存活证据）
//  c) 网络探测 unreachable 的平台，其模型本轮不参与禁用判定（代理故障 ≠ 模型死了）
//  d) 只禁用"有可用 key 的平台"上的行（keyless 平台从未被测过，不下结论）
//  e) 每轮先自愈：恢复上一轮由冒烟禁用的行，再重新判定（防止规则收紧/放宽后状态残留）
const DEAD_STATUS = new Set(['http_400', 'http_404', 'unavailable']);
const SMOKE_FRESH_MS = 7 * 24 * 3600 * 1000;
const smokeStatePath = path.join(WORK, 'smoke-disabled.json');
let smokeDisabled = [];
try { smokeDisabled = JSON.parse(fs.readFileSync(smokeStatePath, 'utf8')); } catch { /* 首次运行为空 */ }

try {
  // 优先从冒烟历史取最近两份不同时间的报告（smoke-report.prev 在 check-models 收尾时
  // 会被当前报告覆盖，紧跟着构建时两者相同，无法作为"第二轮独立样本"）
  const HIST = path.join(WORK, 'smoke-history');
  let cur, prev;
  if (fs.existsSync(HIST)) {
    const archives = fs.readdirSync(HIST).filter((f) => f.endsWith('.json')).sort();
    const loads = archives.slice(-2).map((f) => JSON.parse(fs.readFileSync(path.join(HIST, f), 'utf8')));
    if (loads.length === 2 && loads[0].testedAt !== loads[1].testedAt) { [prev, cur] = loads; }
  }
  if (!cur) {
    cur = JSON.parse(fs.readFileSync(path.join(WORK, 'smoke-report.json'), 'utf8'));
    prev = JSON.parse(fs.readFileSync(path.join(WORK, 'smoke-report.prev.json'), 'utf8'));
  }
  const distinctRun = cur.testedAt !== prev.testedAt;
  const fresh = Date.now() - Date.parse(cur.testedAt) < SMOKE_FRESH_MS;

  const prevBy = new Map(prev.results.map((r) => [r.model, r.status]));
  const deadNames = new Set(cur.results
    .filter((r) => DEAD_STATUS.has(r.status) && DEAD_STATUS.has(prevBy.get(r.model)))
    .map((r) => r.model));
  // 一票否决：任何历史轮次（含当前）ok 过的名字，不准禁用（近期有存活证据）
  const everOk = new Set(cur.results.filter((r) => /^ok/.test(r.status)).map((r) => r.model));
  if (fs.existsSync(HIST)) {
    for (const f of fs.readdirSync(HIST).filter((f) => f.endsWith('.json'))) {
      try {
        const arch = JSON.parse(fs.readFileSync(path.join(HIST, f), 'utf8'));
        for (const r of arch.results ?? []) if (/^ok/.test(r.status)) everOk.add(r.model);
      } catch { /* 单个归档损坏不影响整体 */ }
    }
  }

  // 网络预检：unreachable 的平台豁免
  const { probeNetwork } = await import('./net-probe.mjs');
  const probe = await probeNetwork();
  const unreachable = new Set(probe.filter((r) => r.verdict === 'unreachable').map((r) => r.platform));
  const keyedPlatforms = new Set(Object.entries(fetched).filter(([, v]) => v?.ok).map(([k]) => k));

  // 自愈：先恢复上一轮由冒烟禁用的行，再重新判定（规则收紧/放宽后不留残留状态）
  if (smokeDisabled.length) {
    let restored = 0;
    for (const key of smokeDisabled) {
      const [p, id] = key.split('|');
      const row = base.models.find((m) => m.platform === p && m.modelId === id);
      if (row && !row.enabled) { row.enabled = true; restored++; }
    }
    smokeDisabled = [];
    if (restored) console.log(`[smoke] 自愈：恢复上轮冒烟禁用的 ${restored} 个行，重新判定`);
  }

  if (!fresh) {
    console.log('[smoke] 冒烟报告超过 7 天，跳过禁用判定');
  } else if (!distinctRun) {
    console.log('[smoke] 历史报告与当前为同一次运行——需要两轮独立冒烟才禁用，本轮跳过');
  } else if (deadNames.size) {
    let disabledNow = 0;
    for (const m of base.models) {
      if (!m.enabled) continue;
      if (!deadNames.has(m.modelId) && !deadNames.has(shortName(m.modelId))) continue;
      if (everOk.has(m.modelId) || everOk.has(shortName(m.modelId))) continue;
      if (!keyedPlatforms.has(m.platform) || unreachable.has(m.platform)) continue;
      m.enabled = false;
      smokeDisabled.push(`${m.platform}|${m.modelId}`);
      disabledNow++;
      report.skipped.push(`smoke-dead: ${m.platform}/${m.modelId}`);
    }
    console.log(`[smoke] 连续两轮确定性死行（400/404/unavailable）禁用: ${disabledNow} 个` +
      `（502 仅报告不禁用；${everOk.size} 个历史存活名受一票否决保护）` +
      (unreachable.size ? `；${[...unreachable].join(',')} 网络不可达已豁免` : ''));
  } else {
    console.log('[smoke] 无连续两轮死行，本轮不禁用');
  }
  fs.writeFileSync(smokeStatePath, JSON.stringify(smokeDisabled, null, 2));
} catch (e) {
  console.log(`[smoke] 无冒烟报告可对账（${String(e.message).slice(0, 60)}）`);
}

// ── 5.6 额度规范化：quotas.json（带来源的检索结果）覆盖 limits/monthly ──
// 优先级：models 精确匹配 > patterns 子串匹配 > 平台级 defaults；未收录平台不动
try {
  const quotas = JSON.parse(fs.readFileSync(path.join(HERE, 'quotas.json'), 'utf8'));
  let normalized = 0;
  for (const m of base.models) {
    const q = quotas.platforms?.[m.platform];
    if (!q) continue;
    let limits = q.limits ?? null;
    if (q.models?.[m.modelId]) limits = q.models[m.modelId];
    else if (q.patterns) {
      for (const p of q.patterns) {
        if (!m.modelId.includes(p.contains)) continue;
        if ((p.notContains ?? []).some((n) => m.modelId.includes(n))) continue;
        limits = p.limits;
        break;
      }
    }
    if (limits && typeof limits === 'object') m.limits = { rpm: null, rpd: null, tpm: null, tpd: null, ...limits };
    if (q.monthly !== undefined) m.monthlyTokenBudget = q.monthly;
    normalized++;
  }
  const covered = Object.keys(quotas.platforms ?? {}).filter((p) => base.models.some((m) => m.platform === p));
  console.log(`[quota] 额度规范化: ${covered.length} 个平台 / ${normalized} 个模型行（依据 quotas.json ${quotas.updatedAt}）`);
} catch (e) {
  console.log(`[quota] 无 quotas.json 或解析失败，跳过额度规范化（${String(e.message).slice(0, 50)}）`);
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
// 版本必须严格大于"数据库已应用版本"与基准版本（否则 sync 判 304 不拉取）。
// 用「日期 + T + 当日秒数（补零）」：T 的码位高于 '.'，对任何旧的 ".数字后缀" 格式
// 字典序必胜；补零后同日内的字典序 == 数值序。循环兜底保证严格单调（防时钟回拨）。
let appliedVersion = '';
try {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  appliedVersion = db.prepare("SELECT value FROM settings WHERE key='catalog_applied_version'").get()?.value ?? '';
  db.close();
} catch { /* 数据库不可用时退化为只对比基准 */ }
const secOfDay = String(Math.floor((Date.now() % 86400000) / 1000)).padStart(5, '0');
let version = `${today}T${secOfDay}`;
for (let guard = 0; guard < 1000; guard++) {
  if (version > String(base.version) && version > String(appliedVersion)) break;
  version = `${today}T${String(Number(version.slice(today.length + 1)) + 1).padStart(5, '0')}`;
}
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

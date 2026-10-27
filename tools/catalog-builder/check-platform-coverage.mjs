// 交叉核对：DB 实际平台 vs 四个接入点 + 客户端硬编码平台清单
// 用法: node check-platform-coverage.mjs（只读，随时可跑）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { DB_PATH } from './config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const db = new Database(DB_PATH, { readonly: true });
const q = (sql) => db.prepare(sql).all().map((r) => Object.values(r)[0]).filter(Boolean);

const sets = {
  api_keys: q('SELECT DISTINCT platform FROM api_keys'),
  chat_models: q('SELECT DISTINCT platform FROM models'),
  embeddings: q('SELECT DISTINCT platform FROM embedding_models'),
  media: q('SELECT DISTINCT platform FROM media_models'),
};

// ① client PLATFORMS（shared.tsx）
const shared = fs.readFileSync(path.join(ROOT, 'client/src/components/keys/shared.tsx'), 'utf8');
const block = shared.match(/export const PLATFORMS[\s\S]*?^]/m)[0];
const client = [...block.matchAll(/value: '([a-z0-9_]+)'/g)].map((m) => m[1]);

// ② shared/types.ts Platform 联合（多行带注释，按起始行到 `| 'custom';` 截取）
const types = fs.readFileSync(path.join(ROOT, 'shared/types.ts'), 'utf8');
const unionStart = types.indexOf('export type Platform =');
const unionEnd = types.indexOf("| 'custom';", unionStart);
const union = [...types.slice(unionStart, unionEnd).matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);

// ③ server providers 注册（宽松匹配：文件里出现平台名即可）
const prov = fs.readFileSync(path.join(ROOT, 'server/src/providers/index.ts'), 'utf8');

// ④ catalog config.mjs PROVIDERS
const cfg = fs.readFileSync(path.join(HERE, 'config.mjs'), 'utf8');
const cfgIds = [...cfg.matchAll(/^  ([a-z0-9_]+):\s*\{/gm)].map((m) => m[1]);

// ⑤ 客户端其他硬编码平台数组（routing.ts / PlaygroundPage / media-models / pool-legend）
const extraClientFiles = [
  'client/src/lib/routing.ts',
  'client/src/pages/PlaygroundPage.tsx',
  'client/src/components/media-models.tsx',
];
const extraHits = {};
for (const f of extraClientFiles) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const arrs = [...t.matchAll(/(['"](?:[a-z0-9_]+)['"](?:\s*,\s*['"][a-z0-9_]+['"]){3,})/g)]
    .map((m) => m[1])
    .filter((s) => /openrouter|zhipu|google|groq/.test(s));
  if (arrs.length) extraHits[f] = arrs;
}

console.log('=== DB 平台集 ===');
for (const [k, v] of Object.entries(sets)) console.log(`${k} (${v.length}):`, v.join(', '));
console.log(`\nclient PLATFORMS (${client.length})`);
console.log(`shared/types union (${union.length})`);
console.log(`config.mjs (${cfgIds.length}):`, cfgIds.join(','));
if (Object.keys(extraHits).length) {
  console.log('\n=== 客户端其他疑似平台数组 ===');
  for (const [f, arrs] of Object.entries(extraHits)) console.log(f, '→', arrs.join(' | '));
}

const allDB = [...new Set([].concat(...Object.values(sets)))].sort();
console.log('\n=== 遗漏检查（DB 有但某接入点缺失）===');
let bad = 0;
for (const p of allDB) {
  const miss = [];
  if (!client.includes(p)) miss.push('client.PLATFORMS');
  if (!union.includes(p)) miss.push('shared/types union');
  // 专用 Provider（Google/Zhipu/AIHorde 等）在各自类文件里声明 platform
  //（形态有两种：`platform: 'groq'` 构造参数、`platform: Platform = 'aihorde'` 字段默认值）
  const provDir = path.join(ROOT, 'server/src/providers');
  const hasProvider =
    prov.includes(`'${p}'`) ||
    fs.readdirSync(provDir).some((f) => {
      const t = fs.readFileSync(path.join(provDir, f), 'utf8');
      return t.includes(`'${p}'`);
    });
  if (!hasProvider) miss.push('server/providers?');
  if (!cfgIds.includes(p) && !/aion|nara/.test(p)) miss.push('catalog config.mjs(aionlabs/bynara 映射)');
  if (miss.length) {
    bad++;
    console.log(`${p} → ${miss.join(' + ')}`);
  }
}
if (!bad) console.log('✅ 全覆盖，无遗漏');
db.close();

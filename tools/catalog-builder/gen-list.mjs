// 生成 dist/catalog-list.md（人工可读清单）
// 用法: node gen-list.mjs  —— 读 dist/catalog.json + work/smoke-report.json
// 表结构沿用手工版约定：## 平台（N） / | 模型 | 上下文 | 能力 | 状态 |
// ✅ = 最近一次冒烟 ok；~~删除线~~ + **禁用** = 冒烟对账禁用行
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cat = JSON.parse(fs.readFileSync(path.join(HERE, 'dist', 'catalog.json'), 'utf8'));
let smoke = null;
try {
  smoke = JSON.parse(fs.readFileSync(path.join(HERE, 'work', 'smoke-report.json'), 'utf8'));
} catch { /* 无冒烟报告时跳过 ✅ 标记 */ }

// 冒烟 ok 名单：优先用 routedVia（provider/modelId），退回 model 名
const okSet = new Set();
if (smoke) {
  for (const r of smoke.results || []) {
    if (r.status !== 'ok') continue;
    const rv = r.routedVia || '';
    const id = rv.includes('/') ? rv.split('/').slice(1).join('/') : r.model;
    okSet.add(`${rv.split('/')[0]}|${id}`);
    okSet.add(`*|${r.model}`);
  }
}

const kctx = (n) => (n ? (n >= 1_048_576 ? `${Math.round(n / 1_048_576)}M` : `${Math.round(n / 1024)}K`) : '-');
const cap = (m) => `${m.supportsVision ? '👁' : ''}${m.supportsTools ? '🔧' : ''}` || '';

const groups = new Map();
for (const m of cat.models) {
  if (!groups.has(m.platform)) groups.set(m.platform, []);
  groups.get(m.platform).push(m);
}
const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

const L = [];
L.push(`# 自维护目录清单 v${cat.version}`);
L.push('');
const genDate = (cat.generatedAt || '').slice(0, 10);
L.push(`- 生成时间: ${genDate}`);
const enabled = cat.models.filter((m) => m.enabled).length;
L.push(`- 模型总数: ${cat.models.length}（${sorted.length} 平台；启用 ${enabled}）`);
L.push(`- 另有向量 ${cLen(cat.embeddings)} / 语音转写 ${cLen(cat.transcriptionModels)} / 视频 ${cLen(cat.videoModels)} 行，见文末`);
L.push('- ✅ = 冒烟实测可用（基于 work/smoke-report.json 最新一轮） | ~~删除线~~ = 冒烟对账禁用');
L.push('');
L.push('---');
L.push('');

for (const [platform, models] of sorted) {
  L.push(`## ${platform}（${models.length}）`);
  L.push('');
  L.push('| 模型 | 上下文 | 能力 | 状态 |');
  L.push('|---|---|---|---|');
  models.sort((a, b) => a.modelId.localeCompare(b.modelId));
  for (const m of models) {
    const name = okSet.has(`${platform}|${m.modelId}`) || okSet.has(`*|${m.modelId}`) ? `✅ ${m.modelId}` : m.modelId;
    const status = m.enabled ? '启用' : '**禁用**';
    const row = `| ${m.enabled ? name : `~~${m.modelId}~~`} | ${kctx(m.contextWindow)} | ${cap(m)} | ${status} |`;
    L.push(row);
  }
  L.push('');
}

L.push('## 向量 / 转写模型');
L.push('');
for (const e of cat.embeddings || []) {
  L.push(`- [${e.enabled ? ' ' : 'x'}] ${e.platform}/${e.modelId}（${e.dimensions || '?'} 维）`);
}
for (const t of cat.transcriptionModels || []) {
  L.push(`- [${t.enabled ? ' ' : 'x'}] ${t.platform}/${t.modelId}（转写）`);
}
L.push('');

function cLen(x) {
  return (x || []).length;
}

const out = path.join(HERE, 'dist', 'catalog-list.md');
fs.writeFileSync(out, L.join('\n'), 'utf8');
const okMarks = L.filter((l) => l.startsWith('| ✅ ')).length;
console.log(`已写 ${out}（${cat.models.length} 模型 / ${sorted.length} 平台 / ✅ ${okMarks}）`);

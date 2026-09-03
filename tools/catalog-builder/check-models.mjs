// 模型冒烟测试：对目录里每个模型发一条最小对话请求，实测连通性与付费状态
// 结果：work/smoke-report.json（按状态分类，含实际服务方 X-Routed-Via）
// 用法：node tools/catalog-builder/check-models.mjs [并发数=5]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'work');
fs.mkdirSync(WORK, { recursive: true });

const GW = process.env.GATEWAY_URL || 'http://127.0.0.1:3001';
const KEY = process.env.GATEWAY_KEY || require_key();
function require_key() {
  // 从 .env 之外没有别处存明文统一 key；用环境变量或在下方填入
  throw new Error('请设置 GATEWAY_KEY=<freellmapi-...> 环境变量');
}

const CONCURRENCY = Number(process.argv[2] ?? 5);
const TIMEOUT_MS = 30_000;

const res = await fetch(`${GW}/v1/models`, { headers: { Authorization: `Bearer ${KEY}` } });
if (!res.ok) throw new Error(`拉取模型列表失败 HTTP ${res.status}`);
const { data: models } = await res.json();
const targets = models
  .map((m) => m.id)
  .filter((id) => !['auto', 'fusion'].includes(id));
console.log(`待测模型: ${targets.length} 个（并发 ${CONCURRENCY}）`);

const results = [];
let done = 0;

async function testOne(id) {
  const r = {
    model: id,
    status: 'unknown',
    latencyMs: null,
    routedVia: null,
    error: null,
  };
  const started = Date.now();
  try {
    const resp = await fetch(`${GW}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: id,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 8,
        stream: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    r.latencyMs = Date.now() - started;
    r.routedVia = resp.headers.get('x-routed-via');
    if (resp.ok) {
      r.status = 'ok';
    } else {
      const body = await resp.text();
      let msg = body.slice(0, 200);
      try { msg = JSON.parse(body)?.error?.message?.slice(0, 200) ?? msg; } catch {}
      r.error = msg;
      // 顺序很重要：限流文案常含 "quota"，先判 429 再判付费，避免把限流误报成 paid
      if (/429|rate.?limit/i.test(msg)) r.status = 'rate_limited';
      else if (/out_of_credits|402|payment|insufficient/i.test(msg)) r.status = 'paid';
      else if (/context_length|too large/i.test(msg)) r.status = 'ok_ctx_only'; // 本身可用，8 token 也不影响判定为连通
      else if (/not (be )?found|unknown model|not supported|disabled/i.test(msg)) r.status = 'unavailable';
      else if (/timeout|timed out/i.test(msg)) r.status = 'timeout';
      else r.status = `http_${resp.status}`;
    }
  } catch (e) {
    r.latencyMs = Date.now() - started;
    r.status = e.name === 'TimeoutError' || /timeout/i.test(e.message) ? 'timeout' : 'network_error';
    r.error = String(e.message).slice(0, 120);
  }
  results.push(r);
  done++;
  if (done % 25 === 0) console.log(`  进度 ${done}/${targets.length}`);
}

const queue = [...targets];
const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const id = queue.shift();
    if (id) await testOne(id);
  }
});
await Promise.all(workers);

// 汇总
const by = {};
for (const r of results) by[r.status] = (by[r.status] ?? 0) + 1;
console.log('\n===== 冒烟结果汇总 =====');
for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`${k}: ${v}`);
const okLat = results.filter((r) => r.status === 'ok').map((r) => r.latencyMs).sort((a, b) => a - b);
if (okLat.length) console.log(`成功延迟: p50=${okLat[Math.floor(okLat.length / 2)]}ms p95=${okLat[Math.floor(okLat.length * 0.95)]}ms`);
fs.writeFileSync(path.join(WORK, 'smoke-report.json'), JSON.stringify({ testedAt: new Date().toISOString(), summary: by, results }, null, 2));
console.log('\n明细已写入 work/smoke-report.json');

// 失败清单（速览）
const bad = results.filter((r) => !String(r.status).startsWith('ok'));
console.log(`\n非 ok 状态 ${bad.length} 个（前 20）：`);
bad.slice(0, 20).forEach((r) => console.log(`  [${r.status}] ${r.model} ← ${(r.error ?? '').slice(0, 70)}`));

// 网络可达性探测：从本机直连测各平台端点，失败的再走 socks 代理复测
// 输出：direct（直连可用）/ proxy-required（需代理）/ unreachable（都不通）
// 用法：node tools/catalog-builder/probe-network.mjs [socks地址，默认 socks5h://127.0.0.1:10808，传空串禁用]

import https from 'node:https';
import http from 'node:http';
import { createRequire } from 'node:module';
import { PROVIDERS } from './config.mjs';

const require = createRequire(import.meta.url);
const { SocksProxyAgent } = require('socks-proxy-agent');

// config.mjs 之外的平台端点补全（特殊路径或未纳入采集配置的）
const EXTRA_ENDPOINTS = {
  cloudflare: 'https://api.cloudflare.com/client/v4',
  navy: 'https://api.navy/v1',
  modelscope: 'https://api-inference.modelscope.cn/v1',
  aihorde: 'https://aihorde.net/api',
};

const SOCKS = process.argv[2] !== undefined ? process.argv[2] : 'socks5h://127.0.0.1:10808';

function get(url, agent) {
  return new Promise((resolve) => {
    const mod = url.startsWith('http:') ? http : https;
    const req = mod.get(url, { agent, timeout: 8000, headers: { 'User-Agent': 'probe/1.0' } }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode < 500, status: res.statusCode });
    });
    req.on('error', () => resolve({ ok: false, status: 'ERR' }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 'TIMEOUT' }); });
  });
}

const socks = SOCKS ? new SocksProxyAgent(SOCKS) : null;
const targets = {
  ...Object.fromEntries(Object.entries(PROVIDERS).map(([p, c]) => [p, (c.base || '').replace(/\/$/, '')])),
  ...EXTRA_ENDPOINTS,
};

const rows = [];
for (const [p, base] of Object.entries(targets)) {
  if (!base) continue;
  const direct = await get(base);
  let verdict, detail;
  if (direct.ok) { verdict = 'direct'; detail = `直连 ${direct.status}`; }
  else if (socks) {
    const proxied = await get(base, socks);
    verdict = proxied.ok ? 'proxy-required' : 'unreachable';
    detail = `直连 ${direct.status} → 代理 ${proxied.status}`;
  } else { verdict = 'unreachable'; detail = `直连 ${direct.status}`; }
  rows.push({ platform: p, verdict, detail });
}

const icon = { direct: '✅ 直连', 'proxy-required': '🪜 需代理', unreachable: '❌ 都不通' };
console.log(`探测时间: ${new Date().toISOString()}  代理: ${SOCKS || '(禁用)'}\n`);
for (const r of rows.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.platform.localeCompare(b.platform))) {
  console.log(`${icon[r.verdict].padEnd(10)} ${r.platform.padEnd(14)} ${r.detail}`);
}
const need = rows.filter((r) => r.verdict === 'proxy-required').map((r) => r.platform);
console.log(`\n需代理平台: ${need.join(', ') || '（无）'}`);

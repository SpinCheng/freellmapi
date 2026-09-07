// 网络可达性探测（共享模块）：build-catalog 的冒烟对账与 probe-network CLI 共用
// verdict: direct（直连可用）/ proxy-required（直连不通、代理可达）/ unreachable（都不通）

import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import { PROVIDERS } from './config.mjs';

const require = createRequire(import.meta.url);
const { SocksProxyAgent } = require('socks-proxy-agent');

// config.mjs 之外的平台端点补全（特殊路径或未纳入采集配置的）
export const EXTRA_ENDPOINTS = {
  cloudflare: 'https://api.cloudflare.com/client/v4',
  navy: 'https://api.navy/v1',
  modelscope: 'https://api-inference.modelscope.cn/v1',
  aihorde: 'https://aihorde.net/api',
};

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

/** 探测所有平台端点。socksUrl 传空串禁用代理复测。返回 [{platform, verdict, detail}] */
export async function probeNetwork(socksUrl = 'socks5h://127.0.0.1:10808') {
  const socks = socksUrl ? new SocksProxyAgent(socksUrl) : null;
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
  return rows;
}

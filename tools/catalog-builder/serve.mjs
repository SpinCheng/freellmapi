// 自维护目录源服务：实现 freellmapi catalog-sync 所需的 /v1/latest 协议
// - GET /v1/latest?since=X ：since >= 当前版本 → 304；否则 200 + JSON + x-catalog-signature 头
// - GET /healthz
// 用法：node tools/catalog-builder/serve.mjs [port]   （默认 3099，绑定 127.0.0.1）

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, 'dist');
const PORT = Number(process.argv[2] ?? process.env.CATALOG_SERVE_PORT ?? 3099);

function readCatalog() {
  const json = fs.readFileSync(path.join(DIST, 'catalog.json'));
  let sig;
  try { sig = fs.readFileSync(path.join(DIST, 'catalog.sig'), 'utf8').trim(); } catch { sig = ''; }
  return { json, sig, version: JSON.parse(json.toString('utf8')).version };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (url.pathname !== '/v1/latest') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  let cat;
  try { cat = readCatalog(); } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(`catalog not built: ${e.message}`);
    return;
  }
  const since = url.searchParams.get('since');
  // 版本号为日期字符串，字典序即时间序；since 不落后才回 304
  if (since && String(since) >= String(cat.version)) {
    res.writeHead(304);
    res.end();
    console.log(`[${new Date().toISOString()}] since=${since} → 304`);
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/json',
    'x-catalog-signature': cat.sig,
    'x-catalog-version': cat.version,
  });
  res.end(cat.json);
  console.log(`[${new Date().toISOString()}] since=${since ?? '-'} → 200 v${cat.version} (${cat.json.length} bytes)`);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[catalog-serve] http://127.0.0.1:${PORT}/v1/latest （Ctrl+C 停止）`);
});

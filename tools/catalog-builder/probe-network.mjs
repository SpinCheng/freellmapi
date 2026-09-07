// 网络可达性探测 CLI：从本机直连测各平台端点，失败的再走 socks 代理复测
// 输出：direct（直连可用）/ proxy-required（需代理）/ unreachable（都不通）
// 用法：node tools/catalog-builder/probe-network.mjs [socks地址，默认 socks5h://127.0.0.1:10808，传空串禁用]

import { probeNetwork } from './net-probe.mjs';

const SOCKS = process.argv[2] !== undefined ? process.argv[2] : 'socks5h://127.0.0.1:10808';
const rows = await probeNetwork(SOCKS);

const icon = { direct: '✅ 直连', 'proxy-required': '🪜 需代理', unreachable: '❌ 都不通' };
console.log(`探测时间: ${new Date().toISOString()}  代理: ${SOCKS || '(禁用)'}\n`);
for (const r of rows.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.platform.localeCompare(b.platform))) {
  console.log(`${icon[r.verdict].padEnd(10)} ${r.platform.padEnd(14)} ${r.detail}`);
}
const need = rows.filter((r) => r.verdict === 'proxy-required').map((r) => r.platform);
console.log(`\n需代理平台: ${need.join(', ') || '（无）'}`);

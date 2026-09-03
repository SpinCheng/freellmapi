// 一次性修复 .env 中 CATALOG_* 配置（确保 PEM 以字面量 \n 转义存储）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envPath = path.join(ROOT, '.env');
const pemPath = path.join(ROOT, 'tools/catalog-builder/keys/ed25519.pub.pem');

let env = fs.readFileSync(envPath, 'utf8');
// 移除历史上任何 CATALOG_ 开头的行（含被折成多行的坏块）
env = env
  .split('\n')
  .filter((line) => !/^CATALOG_(BASE_URL|PUBKEY)/.test(line))
  .join('\n')
  .replace(/\n+$/, '\n');

const pem = fs.readFileSync(pemPath, 'utf8').trim();
const escaped = pem.split(/\r?\n/).join('\\n'); // 字面量 反斜杠+n
env += '# ── 自维护目录源（tools/catalog-builder）──\n';
env += 'CATALOG_BASE_URL=http://127.0.0.1:3099\n';
env += 'CATALOG_PUBKEY=' + escaped + '\n';
fs.writeFileSync(envPath, env);
console.log('已写入。末 3 行：');
console.log(env.split('\n').slice(-3).join('\n'));

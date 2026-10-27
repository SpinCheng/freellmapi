// 同步命名链 auto:1m：把当前"可路由 且 上下文≥1M"的模型增量加入链
// 目录刷新后运行（已纳入目录更新流程）；只增不删不动顺序——
// 退出由路由实时 join 处理（目录禁用/删除的行自动失效），顺序保留手工调整
// 用法: node tools/catalog-builder/sync-1m-chain.mjs [--dry]
import { DB_PATH } from './config.mjs';
import Database from 'better-sqlite3';

const dry = process.argv.includes('--dry');
const db = new Database(DB_PATH);

// 无 key 也可匿名调用的平台；死免费层/无 key 平台排除
const KEYLESS_OK = new Set(['kilo', 'ovh', 'aihorde']);
const EXCLUDE_PLATFORMS = new Set(['huggingface', 'cerebras', 'navy', 'cohere']);
// 模型级排除：目录行还在但实测/已知不可用的（antigravity 系稳定 400）
const EXCLUDE_MODELS = /^antigravity/;

const chain = db.prepare("SELECT id FROM profiles WHERE LOWER(name)='1m'").get();
if (!chain) throw new Error("链 '1m' 不存在（先在仪表盘 Fallback 页创建）");

const keyed = new Set(db.prepare('SELECT DISTINCT platform FROM api_keys WHERE enabled=1').all().map(r => r.platform));
const candidates = db.prepare(`
  SELECT id, platform, model_id FROM models
  WHERE enabled=1 AND context_window >= 1048576
`).all().filter(r =>
  (keyed.has(r.platform) || KEYLESS_OK.has(r.platform))
  && !EXCLUDE_PLATFORMS.has(r.platform)
  && !EXCLUDE_MODELS.test(r.model_id));

const existing = new Set(
  db.prepare('SELECT model_db_id FROM profile_models WHERE profile_id=?').all(chain.id).map(r => r.model_db_id));
let pri = db.prepare('SELECT COALESCE(MAX(priority),-1) m FROM profile_models WHERE profile_id=?').get(chain.id).m;

const adds = candidates.filter(r => !existing.has(r.id));
if (!dry) {
  const ins = db.prepare('INSERT INTO profile_models (profile_id, model_db_id, priority, enabled) VALUES (?,?,?,1)');
  for (const r of adds) ins.run(chain.id, r.id, ++pri);
}
console.log(`[sync-1m] ${dry ? '[dry] ' : ''}新增 ${adds.length} 个，链内共 ${existing.size + adds.length} 个`);
for (const r of adds) console.log('  +', r.platform + '/' + r.model_id);
db.close();

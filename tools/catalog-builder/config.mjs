// catalog-builder 配置：平台端点映射 + 采集策略
// 端点来源：server/src/providers/index.ts（保持与其同步）

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../..');
export const DB_PATH = path.join(REPO_ROOT, 'server', 'data', 'freeapi.db');
export const ENV_PATH = path.join(REPO_ROOT, '.env');

// style: openai = GET {base}/models, Bearer
// style: google  = GET {base}/models?key=
// style: cloudflare = GET accounts/{id}/ai/v1/models（key 为 account:token）
// autoAdd: 发现的新模型是否自动进目录（免费层原生平台 = true；
//          混合付费平台用 filter 限定，如 :free 后缀）
// 审计结论（2026-09-03）：/models 不区分免费/付费的平台必须用 filter 收紧——
// huggingface 全量是付费路由（autoAdd: false，只保留官方目录行）；
// zhipu 只收 flash/free 系；opencode 只收 -free 后缀（其 Claude 系列为付费）。
export const PROVIDERS = {
  google:      { base: 'https://generativelanguage.googleapis.com/v1beta', style: 'google', autoAdd: true },
  groq:        { base: 'https://api.groq.com/openai/v1', style: 'openai', autoAdd: true },
  cerebras:    { base: 'https://api.cerebras.ai/v1', style: 'openai', autoAdd: true },
  mistral:     { base: 'https://api.mistral.ai/v1', style: 'openai', autoAdd: true },
  openrouter:  { base: 'https://openrouter.ai/api/v1', style: 'openai', autoAdd: true, filter: (id) => id.endsWith(':free') },
  github:      { base: 'https://models.github.ai/inference', style: 'openai', autoAdd: true },
  nvidia:      { base: 'https://integrate.api.nvidia.com/v1', style: 'openai', autoAdd: true },
  huggingface: { base: 'https://router.huggingface.co/v1', style: 'openai', autoAdd: false },
  ollama:      { base: 'https://ollama.com/v1', style: 'openai', autoAdd: true },
  kilo:        { base: 'https://api.kilo.ai/api/gateway/v1', style: 'openai', autoAdd: true, filter: (id) => /free/i.test(id) },
  llm7:        { base: 'https://api.llm7.io/v1', style: 'openai', autoAdd: true },
  opencode:    { base: 'https://opencode.ai/zen/v1', style: 'openai', autoAdd: true, filter: (id) => /free/i.test(id) },
  ovh:         { base: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', style: 'openai', autoAdd: true },
  agnes:       { base: 'https://apihub.agnes-ai.com/v1', style: 'openai', autoAdd: true },
  reka:        { base: 'https://api.reka.ai/v1', style: 'openai', autoAdd: false },
  siliconflow: { base: 'https://api.siliconflow.com/v1', style: 'openai', autoAdd: true, filter: (id) => /free/i.test(id) },
  routeway:    { base: 'https://api.routeway.ai/v1', style: 'openai', autoAdd: true, filter: (id) => /free/i.test(id) },
  bazaarlink:  { base: 'https://bazaarlink.ai/api/v1', style: 'openai', autoAdd: true, filter: (id) => /free/i.test(id) },
  ainative:    { base: 'https://api.ainative.studio/api/v1', style: 'openai', autoAdd: true },
  aionlabs:    { base: 'https://api.aionlabs.ai/v1', style: 'openai', autoAdd: false },
  requesty:    { base: 'https://router.requesty.ai/v1', style: 'openai', autoAdd: false },
  bynara:      { base: 'https://router.bynara.id/v1', style: 'openai', autoAdd: false },
  sealion:     { base: 'https://api.sea-lion.ai/v1', style: 'openai', autoAdd: false },
  orcarouter:  { base: 'https://api.orcarouter.ai/v1', style: 'openai', autoAdd: false },
  unorouter:   { base: 'https://api.unorouter.com/v1', style: 'openai', autoAdd: false },
  xkiro:       { base: 'https://api.xkiro.com/v1', style: 'openai', autoAdd: false },
  zhipu:       { base: 'https://open.bigmodel.cn/api/paas/v4', style: 'openai', autoAdd: true, filter: (id) => /flash|free/i.test(id) },
  cohere:      { base: 'https://api.cohere.ai/compatibility/v1', style: 'openai', autoAdd: true },
  cloudflare:  { style: 'cloudflare', autoAdd: true },
};

export const OPENROUTER_PUBLIC_URL = 'https://openrouter.ai/api/v1/models';

export function isFreeOnOpenRouter(m) {
  return Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0;
}

# 网络访问说明：哪些平台/模型需要代理

> 探测时间：2026-09-04 ｜ 探测方法：`node tools/catalog-builder/probe-network.mjs`（直连 8s 超时 → socks 复测）
> 结论具有时效性——网络环境变化后请复跑探测脚本更新本文档。

## 结论速览

| 分类 | 平台 | 说明 |
|---|---|---|
| 🪜 **需要代理** | google、huggingface、mistral | 直连超时，走 socks 代理后可达 |
| 🏠 **国内直连**（不走代理更快） | zhipu、siliconflow、modelscope | 域名在国内，走代理反而绕路 |
| ✅ **直连可达** | openrouter、groq、cerebras、nvidia、github、ovh、kilo、opencode、cloudflare、navy、aihorde、cohere、reka、requesty、ollama、llm7、agnes、ainative、aionlabs、bazaarlink、bynara、orcarouter、routeway、sealion、unorouter、xkiro | 直连即可 |

## 网关侧现状

freellmapi 已在仪表盘配置全局 socks 代理（`socks5://127.0.0.1:10808`，v2rayN），
因此**所有平台的模型当前都可调用**——被墙平台经代理出站，代价是延迟略高。

可选优化：让国内域名（bigmodel.cn / siliconflow.com / modelscope.cn）直连、
其余走代理的分流规则，可降低智谱/硅基/魔搭的延迟。

## 需代理平台的模型清单（共 69 个）

网络可达性按平台域名判定：同一平台的全部模型共用一个端点，可达性一致。

### google（32 个）

- antigravity-preview-05-2026
- deep-research-max-preview-04-2026
- deep-research-preview-04-2026
- deep-research-pro-preview-12-2025
- gemini-2.5-computer-use-preview-10-2025
- gemini-2.5-flash
- gemini-2.5-flash-lite
- gemini-2.5-pro
- gemini-3-flash-preview
- gemini-3-pro-image
- gemini-3-pro-image-preview
- gemini-3.1-flash-image-preview
- gemini-3.1-flash-lite
- gemini-3.1-flash-lite-preview
- gemini-3.1-pro-preview
- gemini-3.1-pro-preview-customtools
- gemini-3.5-flash
- gemini-3.5-flash-lite
- gemini-3.5-transcribe
- gemini-3.6-flash
- gemini-3.7-flash
- gemini-3.8-flash
- gemini-flash-latest
- gemini-flash-latest-high-res-exp
- gemini-flash-lite-latest
- gemini-omni-1.1-flash
- gemini-omni-flash-preview
- gemini-pro-latest
- gemini-robotics-er-2-preview
- gemma-4-26b-a4b-it
- gemma-4-31b-it
- nano-banana-pro-preview

### huggingface（24 个）

- MiniMaxAI/MiniMax-M3
- Qwen/Qwen3-Coder-480B-A35B-Instruct
- Qwen/Qwen3-Coder-Next
- Qwen/Qwen3-VL-235B-A22B-Instruct
- Qwen/Qwen3.5-397B-A17B
- Qwen/Qwen3.5-9B
- Qwen/Qwen3.6-27B
- Qwen/Qwen3.6-35B-A3B
- deepseek-ai/DeepSeek-R1
- deepseek-ai/DeepSeek-V3.2
- deepseek-ai/DeepSeek-V4-Flash
- deepseek-ai/DeepSeek-V4-Pro
- google/gemma-4-31B-it
- meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8
- moonshotai/Kimi-K2.6
- moonshotai/Kimi-K2.7-Code
- moonshotai/Kimi-K3
- openai/gpt-oss-120b
- swiss-ai/Apertus-v1.5-70B
- swiss-ai/Apertus-v1.5-8B
- tencent/Hy3
- thinkingmachines/Inkling
- zai-org/GLM-4.5
- zai-org/GLM-5.2

### mistral（13 个）

- codestral-latest
- devstral-latest
- devstral-medium-latest
- magistral-medium-latest
- magistral-small-latest
- ministral-14b-latest
- ministral-8b-latest
- mistral-code-agent-latest
- mistral-code-latest
- mistral-large-latest
- mistral-medium-latest
- mistral-small-latest
- mistral-vibe-cli-fast

----

## 复测方法

```bash
node tools/catalog-builder/probe-network.mjs              # 默认探测 socks5://127.0.0.1:10808
node tools/catalog-builder/probe-network.mjs ""           # 只测直连
node tools/catalog-builder/probe-network.mjs socks5h://HOST:PORT  # 指定代理
```

# catalog-builder — 自维护免费模型目录

脱离 freellmapi.co 官方目录源，自己采集、构建、签名、发布模型目录。
产出的 `dist/catalog.json` 与官方目录格式完全兼容，经 `serve.mjs` 发布后，
路由器按原有 catalog-sync 协议（12 小时一轮）自动拉取应用。

## 组成

| 文件 | 作用 |
|---|---|
| `config.mjs` | 平台端点映射与采集策略（端点与 `server/src/providers/index.ts` 保持同步） |
| `fetch-models.mjs` | 用 freellmapi 数据库里你录入的 key 逐平台拉 `/models`；另拉 OpenRouter 公开免费列表（无需 key） |
| `build-catalog.mjs` | 以现有目录为基准合并增删 → `dist/catalog.json`；生成/复用 Ed25519 密钥并签名 → `dist/catalog.sig` |
| `serve.mjs` | 目录源服务：`GET /v1/latest?since=X`（304 / 200+`x-catalog-signature`） |

## 日常维护流程

```bash
node tools/catalog-builder/fetch-models.mjs    # 1. 采集（写 work/fetched.json）
node tools/catalog-builder/build-catalog.mjs   # 2. 构建+签名（打印需要配置的 .env 行）
node tools/catalog-builder/serve.mjs           # 3. 启动目录源（:3099，可常驻）
```

首次构建后，把 build 输出的两行追加到仓库根 `.env`：

```
CATALOG_BASE_URL=http://127.0.0.1:3099
CATALOG_PUBKEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
```

然后重启 freellmapi，日志出现 `[catalog-sync] applied monthly v<新版本>` 即接入成功。

## 目录发现规则（build-catalog.mjs）

- **新增**：OpenRouter 公开免费列表（prompt+completion 均为 0）落到 `openrouter` 平台；
  各平台自己 `/models` 的新模型按 `config.mjs` 的 `autoAdd`/`filter` 策略落库
  （混合付费平台只收 `:free` 后缀或名字含 free 的）
- **移除**：某平台拉取成功、但目录行已不在其 `/models` 中（含短名宽松匹配，容忍厂商改前缀）
- **保留**：quirks、embeddings、media 等非 chat 分类原样透传；已有模型行的排名与参数不动
- **新模型默认值**：rank 5/5、RPM 20 / RPD 200（保守起步，路由器的实测速度回写会自我修正）
- 上下文窗口优先取平台 `/models` 返回，其次 OpenRouter 元数据，都没有则留空

## 部署到云端（可选）

`dist/catalog.json` 与 `dist/catalog.sig` 可提交进仓库留档，但注意：
**签名必须通过 `x-catalog-signature` 响应头交付**，静态文件托管（如 GitHub Raw）
无法自定义响应头。可选方案：

- 任意 Node 宿主直接跑 `serve.mjs`（零依赖，单文件）
- Cloudflare Workers / Vercel Edge Function 十几行即可：读仓库里的 catalog.json+sig，
  按协议返回（注意返回的 body 字节必须与签名时的字节完全一致）
- 自建 VPS + systemd 常驻 serve.mjs

部署后把 `.env` 的 `CATALOG_BASE_URL` 指向云端地址即可，多台路由器共用一个源。

## 安全

- `keys/`（Ed25519 私钥）与 `work/` 已 gitignore；私钥泄露 = 他人可冒充你的目录源
- 目录源只下发模型元数据，不接触 prompt、补全或任何平台密钥
- 各平台 API key 始终只存在 freellmapi 的加密数据库中，本工具仅在采集时解密使用、不落盘

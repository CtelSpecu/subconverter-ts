# subconverter-worker

> **TypeScript + Cloudflare Workers** 完整移植 `tindy2013/subconverter` `v0.9.0`（`~18.6k` LOC C++）——订阅转换器 + **管理面板**，`wrangler 4` 一键部署。

**Demo Worker:** `https://subconverter-worker.churnie.workers.dev`  
**Demo Dashboard:** `https://subconverter-worker.churnie.workers.dev/dashboard`  
**Spec:** [`spec.md`](./spec.md) → [`docs/spec.md`](./docs/spec.md)（TS）· [`docs/spec-cpp.md`](./docs/spec-cpp.md)（C++ 审计）  
**Docs:** [`docs/architecture.md`](./docs/architecture.md) · [`docs/development.md`](./docs/development.md) · [`docs/deployment.md`](./docs/deployment.md)  
**Backup C++:** `backup/master` / `backup/cpp-legacy`（`a0d4eab`）

## 功能

- **输入**：`ss`/`ssr`/`vmess`(5 形态)/`trojan`(ws)/`hysteria2`/`anytls`/`socks`/`tg://http`/`clash yaml`/`surge ini`/`base64` 订阅，`|` 多源、`tag:` 分组、`data:` 内联
- **输出**：`clash`/`clashr`/`surge`(ver 2/3/4)/`surfboard`/`mellow`/`ss`/`ssr`/`v2ray`/`trojan`/`mixed`/`quan`/`quanx`/`loon`/`ssd`/`singbox`（13 目标，`proxyTo*` 全实现）
- **管线**（顺序即契约，`spec.md §7`）：`per-sub include/exclude` → `insert 合并` → `filter_script` → `group 覆盖` → `remove_emoji→rename→add_emoji→sort` → `dispatch`
- **规则**：`rulesetToClash/Surge/SingBox`，`GROUP` 占位（`[]DIRECT`/`!!GROUP`/`script:`），`maxAllowedRulesets 64`/`maxAllowedRules 32768`
- **服务**：`GET /` `GET /version` `GET|HEAD /sub` `GET /sub2clashr` `GET /surge2clash` `GET /refreshrules` `GET /readconf` `POST /updateconf` `GET /flushcache` `GET /render` `OPTIONS` 预检，`CORS *`，`SubConverter-Request` 循环防护
- **面板**：`/dashboard` 9 页（`auth/generate/domains/acl/limits/logs/cache/config/debug`），`shadcn/ui` + `Tailwind` + `Vite/React`，`scandinavian` 克制视觉，`D1` 日志（`180d` 可配）+ `KV` 限流/名单/缓存

## 面板

- **路由** `/dashboard` → 重定向 `/generate`（已登录）/`/auth`（未登录），侧栏 240px + 顶栏 48px
- **鉴权** 单密钥 `DASHBOARD_TOKEN`（`wrangler secret`），`Authorization: Bearer`，`401→/auth`
- **白名单** `FRONTEND_ALLOWLIST`（`,` 分隔），空即放行（`ACAO *`），非空严格 `403`，`Vary: Origin`，`blocked_by_allowlist` 入日志
- **构建** `dashboard/` → `vite build --outDir ../assets/dashboard`，`wrangler [assets]` 托管，`not_found_handling = "single-page-application"`

## 快速开始

```bash
git clone https://github.com/CtelSpecu/subconverter-ts.git
cd subconverter-ts
npm install
npm --prefix dashboard install

cp .env.example .env
cp .env.example .dev.vars
# 编辑 .env / .dev.vars，填入 DASHBOARD_TOKEN 等（见下「配置」）

# 本地开发（http://127.0.0.1:8787）
npx wrangler dev --local

# 类型检查 / lint
npx tsc --noEmit
npx eslint src --ext .ts

# 单元
npx vitest run

# 端到端（需 C++ Docker + http mocks + Worker）
python3 -m http.server 8000 --directory test/mocks &
docker run -d --name subconverter-cpp -p 25500:25500 tindy2013/subconverter:latest
node test/run-final.mjs   # 57/57

# 部署
npx wrangler deploy
# → https://subconverter-worker.<account>.workers.dev
```

## API

### `GET /sub`

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `target` | enum | ✓ | `clash`/`clashr`/`surge`/`surfboard`/`mellow`/`ss`/`ssr`/`v2ray`/`trojan`/`mixed`/`quan`/`quanx`/`loon`/`ssd`/`singbox`，`auto` 按 UA 归一 |
| `url` | string | ✓ | 订阅 URL，`|` 多源，`tag:name,url`，`data:` 内联 |
| `ver` | `2\|3\|4` |  | Surge 版本，默认 `3` |
| `config` | string |  | 外部配置 URL |
| `include`/`exclude` | regex |  | `regFind` 语义，`|`/`\`` 分隔 |
| `emoji`/`append_type`/`tfo`/`udp`/`scv`/`fdn`/`sort`/`expand`/`classic`/`append_info`/`list` | tribool | 三态 `true/false/undef` |
| `filename`/`interval`/`strict`/`group`/`token` |  |  | 见 `spec.md §3.2` 全表 30+ 参数 |

```bash
# 单链转 clash
curl -G "http://127.0.0.1:8787/sub" \
  --data-urlencode "target=clash" \
  --data-urlencode "url=ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@1.2.3.4:443#Test"

# 多源 via http mocks
curl -G "http://127.0.0.1:8787/sub" \
  --data-urlencode "target=surge" --data-urlencode "ver=4" \
  --data-urlencode "url=http://127.0.0.1:8000/mixed-basic.txt"

# data: 内联（Worker 特有，C++ 不支持）
curl -G "http://127.0.0.1:8787/sub" \
  --data-urlencode "target=clash" \
  --data-urlencode "url=data:text/plain;base64,$(printf %s "ss://..." | base64 -w0)"
```

响应头：`Server: subconverter/v0.9.0` `Access-Control-Allow-Origin: *` `Subscription-Userinfo` `profile-update-interval` `Content-Disposition`，Surge 类前置 `#!MANAGED-CONFIG ...`。

### 其他路由

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/` | 健康 |
| `GET` | `/version` | `v0.9.0` |
| `HEAD` | `/sub` | 同 GET 去 body |
| `GET` | `/sub2clashr` | `target=clashr` 快捷 |
| `GET` | `/surge2clash` | Surge 文本 → Clash |
| `GET` | `/flushcache` | 清 `Map` 缓存 |
| `GET` | `/refreshrules` | 刷新 (stub) |
| `OPTIONS` | `*` | `Allow-Methods` |

`api_mode=true`（默认）下 `/get`/`/getlocal` 不实现（SSRF 防护）。

## 配置

`src/handler/settings.ts` `buildSettings(env)` 默认见 `spec.md Appendix C`，`env` 覆盖（优先 `.env` / `.dev.vars`，生产用 `wrangler secret`）：

| `.env` / `wrangler.toml` / `env` | 对应 `pref` | 说明 |
|--------------------------|-------------|------|
| `API_MODE` | `api_mode` | `true` 则鉴权 |
| `API_TOKEN` | `api_access_token` | `wrangler secret put API_TOKEN` |
| `DASHBOARD_TOKEN` | — | 面板单密钥（`wrangler secret put DASHBOARD_TOKEN`） |
| `FRONTEND_ALLOWLIST` | — | `,` 分隔，空即 `*`，见 `spec_ui §6.2` |
| `DEFAULT_URL` | `default_url` | 默认订阅 |
| `MANAGED_PREFIX` | `managed_config_prefix` |  |

示例见 [`.env.example`](./.env.example)：

```bash
cp .env.example .env
cp .env.example .dev.vars
# 编辑 DASHBOARD_TOKEN 等
```

`http://172.17.0.1:8000` (Docker) / `http://127.0.0.1:8000` (host) 双 HOST 用于 `test/mocks`。

## 项目结构

```
.
├── spec.md                 # 重定向到 docs/spec.md（TS）· docs/spec-cpp.md（C++ 审计）
├── docs/                   # 架构/开发/部署/spec（TS）· spec-cpp.md（C++）
│   ├── architecture.md     # 系统图 · 模块表 · 数据流 · 存储
│   ├── development.md      # 环境/脚本/mock/约定
│   ├── deployment.md       # wrangler/KV/D1/回滚
│   ├── spec.md             # TS 规范（28 节，无 C++ file:line）
│   └── spec-cpp.md         # C++ 审计（68K，file:line）
├── wrangler.toml           # name/main/vars + [assets] dashboard + KV_ADMIN/CACHE + D1 DB_LOGS
├── schema.sql              # D1 logs 表（180d）
├── .env.example            # 全部 env 示例（DASHBOARD_TOKEN 等）
├── dashboard/              # Vite+React+shadcn 面板 → assets/dashboard
│   ├── src/pages/          # auth/generate/domains/acl/limits/logs/cache/config/debug (9)
│   └── vite.config.ts      # outDir ../assets/dashboard
├── src/
│   ├── index.ts            # fetch → allowlist/auth → 7 步管线 → dispatch + /dashboard/api/* + scheduled
│   ├── types.ts            # Proxy / Settings + Dashboard 类型
│   ├── utils/              # base64, md5, regexp, tribool, ini_reader, network
│   ├── parser/             # subparser + infoparser
│   ├── pipeline/           # filter, nodemanip
│   ├── generator/          # subexport(13) + ruleconvert
│   ├── handler/            # webget + settings + dashboard (7 组)
│   └── assets/base/all_base.tpl
└── test/
    ├── mocks/              # 12 文件
    ├── run-final.mjs       # 57 项端到端
    ├── unit.test.ts        # 20 单元
    └── REPORT.md

```

## 测试

```bash
npx tsc --noEmit            # 0
npx eslint src --ext .ts    # 0
npx vitest run              # 20/20
node test/run-final.mjs     # 57/57 (C++ 15 + TS local 19 + TS remote 6 + parity 2)
```

详见 `test/REPORT.md`（已知差异表：`http://10.0.0.1:8080` 的 `isLink` 超时 → `tg://http` 规避；`data:` 仅 TS；`exclude` PCRE 语义放宽）。

## 部署

```bash
npx wrangler deploy --dry-run  # 235 KiB / gzip 48 KiB
npx wrangler deploy            # → https://subconverter-worker.<account>.workers.dev
```

`wrangler.toml` `compatibility_date 2024-01-01` + `nodejs_compat`，`observability.enabled true`。

## 分支

| 分支 | 指向 | 说明 |
|------|------|------|
| `master` | `a58d56b` | TS Worker（当前主分支） |
| `feat/workers-migration` | `a58d56b` | 同 master |
| `backup/master` | `a0d4eab` | C++ 原仓备份 |
| `backup/cpp-legacy` | `a0d4eab` | 同上 |
| `origin/master` (C++ 归档) | 远端已强制更新为 TS | 需回滚：`git push origin backup/master:master --force` |

## 已知限制

- `vless`/`tuic`/`juicity`/`hysteria1://` 作为输入链接不支持（`ProxyType` 无，`explode` 返回 `Unknown` 静默丢弃，与 C++ 一致）
- `maxAllowedDownloadSize` 1 MiB / `subrequest 50` / `Cache API` vs `KV 60s` 下限见 `spec.md §19`

## 许可证

同原仓 `LICENSE`（AGPL-3.0 衍生，见 `spec.md`）。

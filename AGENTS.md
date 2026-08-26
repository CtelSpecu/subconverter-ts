# AGENTS — subconverter-worker + dashboard

> **Scope** 本文件为 `subconverter-ts` 仓库（`master` 为 TS Worker + Dashboard，`spec.md` → `docs/spec.md` TS）协作契约。

## 1. 项目与分支

- **主分支** `master` → TypeScript Worker + Dashboard（`src/` + `dashboard/` → `assets/dashboard`）
- **备份** `backup/master` / `backup/cpp-legacy` → 原 C++ `tindy2013/subconverter v0.9.0`（`a0d4eab`）
- **历史** `feat/workers-migration` 同 `master`，`backup/*` 永不 force
- **面板** 无独立分支，`dashboard/` 与 `src/` 同在 `master`

## 2. 事实来源

- `spec.md` → `docs/spec.md`（TS，28 节，无 C++ file:line）为唯一事实来源；`docs/spec-cpp.md` 为 C++ 审计归档（68K）；`docs/architecture.md`/`development.md`/`deployment.md` 为架构/开发/部署
- `test/mocks/` 为 mock 订阅事实来源，`test/mocks/generate.mjs` 重建；`test/REPORT.md` 为对比报告
- `src/types.ts` 为数据模型事实来源（`Proxy`/`Settings`/`Dashboard`）；`dashboard/src/pages/*` 为面板事实来源（9 页）

## 3. 架构

```
src/index.ts (fetch → allowlist/auth → 7 步管线 → dispatch + /dashboard/api/* + scheduled)
  ├─ parser/subparser (ss/ssr/vmess/trojan/hy2/anytls/socks/http/clash/surge) + infoparser
  ├─ pipeline/filter + nodemanip (applyMatcher/groupGenerate/rename/emoji/sort)
  ├─ generator/subexport (13 目标) + ruleconvert
  ├─ handler/webget (fetch+Map cache+data:) + settings (env → Settings) + dashboard (7 组, KV/D1)
  └─ assets/dashboard (Vite+React+shadcn, 9 页, scandinavian)
dashboard/ → src/pages (auth/generate/domains/acl/limits/logs/cache/config/debug) → vite build → assets/dashboard
test/ → mocks (12) + run-final.mjs (57) + unit.test.ts (20, vitest)
docs/ → architecture/development/deployment/spec(+spec-cpp)
```
## 4. 变更要求

- **契约先行**：改 `src/index.ts` 的 7 步顺序/allowlist/auth、`applyMatcher` 前缀、`regFind` 语义需先更新 `docs/spec.md` 并开 ADR
- **小步提交**：`feat:`/`fix:`/`test:`/`docs:`，Lore 格式，`--force` 仅用于备份切换；**禁止擅自提交**，需用户显式允许后 `push`
- **面板**：`dashboard/` 9 页按 `spec_ui.md` 9 节实现，`shadcn/ui` 仅复用源码（`dashboard/src/components/ui`），`8px` 半径/`alpha-black`/`Geist` 锁定，`dashboard/` 构建产物 `assets/dashboard` 由 `wrangler [assets]` 托管
- **优雅降级**：`isLink` 超时/`data:` Invalid 同前；新增 `http` mock 需双 HOST 验证
- **无文件系统**：`fileExist/fileGet` → `fetch`/`Map`，`/get` 不实现；面板静态由 `[assets]` 托管

## 5. 工具链

```bash
npx tsc --noEmit          # 必须 0
npx eslint src --ext .ts  # 必须 0
npx vitest run            # 20/20
node test/run-final.mjs   # 57/57 (需 http mocks + Docker C++ + Worker)
npm --prefix dashboard run build  # → assets/dashboard (716k js)
npx wrangler deploy --dry-run     # 48 KiB gzip

# 本地（面板+Worker）
python3 -m http.server 8000 --directory test/mocks &
docker run -d --name subconverter-cpp -p 25500:25500 tindy2013/subconverter:latest
npx wrangler dev --port 8787 --local  # 8787 + 5173 vite proxy
# dashboard 单独
npm --prefix dashboard run dev        # 5173 → proxy /sub,/dashboard/api → 8787
```

- **Node** `22.19.0` + `wrangler 4.126` + `compatibility_date 2024-01-01` + `nodejs_compat`
- **依赖** `js-yaml`, `spark-md5`，其余零依赖

## 6. 测试

- **Mock** `test/mocks/generate.mjs` → 12 文件，`mixed-basic.txt` 5 节点（无 `http://` 避免 `isLink` 超时）
- **C++** `direct |`（`ss://...|vmess://...`），`http://172.17.0.1:8000` 仅对 `clash.yaml`/`surge.ini`，`data:` 仅 TS
- **TS 本地** `http://127.0.0.1:8000` 全 15 目标 + `include/exclude` + `data:` + `large 20`
- **远端** `curl` 绕过 `http_proxy`，`status 0` 放宽为 `WARNING`
- 新增协议/目标需同步更新 `mocks/generate.mjs` + `run-final.mjs` 的 `targets` 列表 + `unit.test.ts`

## 7. 部署

- `wrangler.toml` `name = "subconverter-worker"`，`env.API_MODE/API_TOKEN/MANAGED_PREFIX/DEFAULT_URL`
- `API_TOKEN` 必须 `wrangler secret put API_TOKEN`，禁止 `vars` 明文
- 敏感 `updateconf`/`flushcache` 鉴权差异见 `spec.md §3.3`，逐测覆盖

## 8. 常见陷阱

- `|` 在 `url` 中需 `%7C`（`encodeURIComponent`），`#` 需 `%23`，否则截断为 fragment
- `|=` 在 `Cargo.toml`/`package.json` 非法，需 `=` 精确
- `ss://` 的 `==` 需保留，`urlSafeBase64` 需 `+→-`/`/→_`/`=` trim
- `fetch` 8s `AbortSignal` 超时对 `quan` 等规则拉取不足，需 `curl` 或放宽

## 9. 交付

- `master` 推送前必须 `npx tsc --noEmit && npx eslint src --ext .ts && npx vitest run && timeout 90 node test/run-final.mjs` 全绿
- `test/REPORT.md` 与 `spec.md` 同步更新
- 大文件（`mixed-large.txt` 20 节点）仅用于压力，不入 `git LFS`

---

> 本文件随 `master` 演进；与 `spec.md` 冲突时以 `spec.md` 为准，工具链冲突以本文件为准。

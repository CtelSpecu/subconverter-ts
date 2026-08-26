# subconverter C++ 后端全量审计与 TypeScript Workers 迁移规范

> **Project** `subconverter-ts/` · **Source** tindy2013/subconverter `v0.9.0`（C++，非 Go）
> **Code size** `~18605` 行 src/ + 985 行 INIReader header-only · **CMake** 3.10+ · **Audit time** 2026-08-26
> **Target** TypeScript + Cloudflare Workers（wrangler2, Modules 格式）→ `subconverter-worker/`
> 本文档是**唯一迁移事实来源** (Single Source of Truth)。所有后续实现、审查、测试以此为依据；与代码不一致时以源码 `file:line` 为准。

---

## 目录

1. [项目概述与范围勘误](#1-项目概述与范围勘误)
2. [架构总览](#2-架构总览)
3. [HTTP API 契约](#3-http-api-契约)
   - 3.1 路由表 · 3.2 /sub 参数手册 · 3.3 认证 · 3.4 响应头与 CORS · 3.5 重定向/静态文件
4. [核心数据模型](#4-核心数据模型)
5. [订阅解析](#5-订阅解析)
   - 5.1 分发 · 5.2 单链接协议细节（含已知缺陷） · 5.3 配置嗅探与 explodeSub 链
6. [流量/到期信息提取](#6-流量到期信息提取)
7. [转换管线（顺序是契约）](#7-转换管线顺序是契约)
8. [输出目标矩阵](#8-输出目标矩阵)
9. [代理组规则匹配语义](#9-代理组规则匹配语义)
10. [规则与规则集系统](#10-规则与规则集系统)
11. [Clash YAML 细节](#11-clash-yaml-细节)
12. [Surge / Surfboard / Loon / Quan(X) / Mellow / SingBox 细节](#12-surge-surfboard-loon-quanx-mellow-singbox-细节)
13. [配置系统](#13-配置系统)
14. [INIReader 语义](#14-inireader-语义)
15. [模板引擎 inja / jinja2cpp](#15-模板引擎-inja--jinja2cpp)
16. [脚本与定时任务](#16-脚本与定时任务quickjs--cron)
17. [网络、缓存与上传](#17-网络缓存与上传)
18. [已识别的代码缺陷与静默行为](#18-已识别的代码缺陷与静默行为)
19. [Cloudflare Workers 运行环境约束](#19-cloudflare-workers-运行环境约束)
20. [迁移架构设计](#20-迁移架构设计)
21. [模块映射与可移植性矩阵](#21-模块映射与可移植性矩阵)
22. [兼容性风险清单](#22-兼容性风险清单)
23. [TS 项目骨架与技术选型](#23-ts-项目骨架与技术选型)
24. [行为等价策略（黄金文件）](#24-行为等价策略黄金文件)
25. [安全与操控面](#25-安全与操控面)
26. [分阶段实施计划](#26-分阶段实施计划)
27. [端到端验证清单](#27-端到端验证清单)
28. [附录：配置键速查 · 路由状态码 · 关键常量](#28-附录)

---

## 1. 项目概述与范围勘误

- 入口：`src/main.cpp`，版本 `src/version.h:4` → `v0.9.0`。
- 用户描述"Go 编写"与事实不符：**实为 C++**（`CMakeLists.txt:1`，依赖 libcurl / yaml-cpp / PCRE2 / QuickJS / RapidJSON / toml11 / cpp-httplib）。
- 功能本质：**订阅转换器**——将任意来源的代理节点订阅（SS/SSR/VMess/Trojan/Hysteria2/AnyTLS/SOCKS/HTTP/... 以及 Clash YAML、Surge INI、Quantumult 行内格式的混合文本）转换为 13+ 目标客户端配置（Clash/Surge/Surfboard/Mellow/SSSub/单链接/Quantumult/QuanX/Loon/SSD/SingBox 等），支持远程规则集、自定义代理组、节点过滤/重命名/emoji/排序、脚本过滤、Managed Config、Gist 自动上传、批量生成（`generate.ini`）、动态别名、模板渲染。
- **全量迁移**含：所有解析器、所有导出器、全部管线语义（过滤→重命名→emoji→排序→去重→组匹配→渲染）、配置三格式（INI/TOML/YAML）、外部配置覆盖、inja 模板、脚本钩子暴露、缓存、上传——并部署到 **Workers**。不可因"Workers 无文件系统"而静默丢弃语义，需显式映射到 KV/R2/Cache/assets 并在 spec 中记录每个映射。
- 原仓自带 `base/` 模板与规则样板（`base/config/*`、`base/rules/*`、`base/snippets/*`、`base/*.ini/*.toml/*.yml`、`base/profiles/`），`scripts/` 与 `cmake/` 为构建辅助，本次不迁移。

---

## 2. 架构总览

```
main.cpp (startup, route table, PORT env, signal handling, cron every 200ms)
  └─ settings.cpp (readConf: INI/TOML/YAML 三路 → global Settings 单例)
       ├─ ini_reader.h / toml11 / yaml-cpp
       ├─ importItems / refreshRulesets (ruleset 预取，shared_future)
       └─ global.{customProxyGroups, customRulesets, include/exclude, emojis/renames, templateVars, basePath, cache TTLs}

WebServer(httplib)  ── Request{method,url,argument(multimap),headers(postdata)}
  ├─ pre-routing: SubConverter-Request 循环检测, Server/ACAO/X-Client-IP, Basic auth (死码), OPTIONS 预检
  └─ handler/interfaces.cpp
       ├─ subconverter()     ← /sub, /sub2clashr, /surge2clash 核心管线
       ├─ getRuleset()       ← 内部 RULE-SET 提供（clash/quanx/surge 分 type）
       ├─ simpleGenerator()  ← -g 生成器模式
       ├─ getProfile()/updateconf/readconf/refreshrules/flushcache/version/aliases
       └─ renderTemplate()   ← /render

parser/ ── explode* + explodeSub/explodeConfContent + infoparser
generator/config/ ── subexport(N×proxyToXxx) + ruleconvert(rulesetToXxx) + nodemanip(addNodes, filterNodes, preprocessNodes, groupGenerate)
generator/template/ ── inja 渲染（clash/surge 各 target base 模板，external config 预渲染，/render, renderClashScript）
handler/ ── webget(fetch+caching+data:URI), upload(Gist), multithread(async), settings
utils/ ── base64, md5, urlencode, string, regexp(jpcre2), tribool, logger, file, network, yamlcpp_extra/rapidjson_extra/...
script/ ── QuickJS (script_quickjs), Cron(libcron), duktape(死码)
server/ ── webserver_httplib(生效) / webserver_libevent(备选，CMake 已注释)
```

**关键事实**：`webserver_libevent.cpp` 在 `CMakeLists.txt:49-50,70-73` 被注释，实际生效为 `webserver_httplib.cpp`。`BUILD_STATIC_LIBRARY`（`CMakeLists.txt:119-156`）以 `-DNO_JS_RUNTIME -DNO_WEBGET` 编译 `wrapper.cpp` 桩（供移动端静态库）。

---

## 3. HTTP API 契约

### 3.1 路由表（`src/main.cpp:181-289` 精确注册）

| Method | Path | Content-Type | Handler | 说明 |
|--------|------|--------------|---------|------|
| GET | `/` | text/plain | inline lambda | 健康检查，返回空串 |
| GET | `/version` | text/plain | inline lambda | 返回 `VERSION` (`src/version.h:4`) |
| GET | `/refreshrules` | text/plain | lambda → `refreshRulesets` | token 校验（非空才比对），拉取所有 ruleset |
| GET | `/readconf` | text/plain | lambda | token 校验（非空才比对），返回 `pref` 文件原文 |
| POST | `/updateconf` | text/plain | lambda | token 校验；`postdata` 覆盖 `pref` 文件并 `readConf()` 重载 |
| GET | `/flushcache` | text/plain | lambda | `token` 必比对（空 token 时空串可通过，注意），`flushCache()` 清 `cache/` |
| GET/HEAD | `/sub` | text/plain;charset=utf-8 | `subconverter` | 主转换 |
| GET | `/sub2clashr` | text/plain;charset=utf-8 | `simpleToClashR` | 快捷：`target=clashr` |
| GET | `/surge2clash` | text/plain;charset=utf-8 | `surgeConfToClash` | Surge 文本 → Clash |
| GET | `/render` | （模板决定） | `renderTemplate` → `render_template` | path 必须在 `templatePath` 内，注入 request 参数 |
| GET | `alias` | 302 | `append_redirect` | `pref [aliases] uri=target` 逐条注册（`settings.cpp:995-1002`） |
| GET | `/get` | 任意 MIME | `webserver` 静态 | 仅 `!APIMode`，读本地任意文件（`main.cpp:278-285`，**Workers 禁止**） |
| GET | `/getlocal` | 任意 MIME | 同上 | 仅 `!APIMode`，**Workers 禁止** |
| （静态） | `/*` | MIME 自动 | `set_mount_point("/", serve_file_root)` | 仅 `serve_file_root` 非空时，`settings.cpp:1018-1019` |

- 404：未匹配任何 `responses` 列表的请求（`webserver_httplib.cpp:292-295`）。
- 500：处理器抛异常由 `exception handler` 返回 `Exception: type - what`（`webserver_httplib.cpp:194-218`）。
- 循环防护：请求头含 `SubConverter-Request` 立返 500（`webserver_httplib.cpp:149-154`）。
- `CPPHTTPLIB_REQUEST_URI_MAX_LENGTH = 16384`（`webserver_httplib.cpp:5`），Workers 侧 URL 长度限制由平台决定，应在路由层校验并返回 414。

### 3.2 /sub 参数手册（`src/handler/interfaces.cpp:307-354, 560-600`）

`getUrlArg(argument, name)` 从 `Request.argument`（`string_multimap`）取首值；`urlSafeBase64Decode` 仅用于 `groups`/`ruleset` 两个参数。`argument` 的合并在 `ResponseCallback` 填 `argument` 时保留重复键（`equal_range` 迭代），`merge_values` 用 `&` 连接同名值（`interfaces.cpp:1210-1235`，对 `url`/`group` 等多值参数有影响）。

| 参数 | 类型 | 默认 | 说明 | 绑定 |
|------|------|------|------|------|
| `target` | enum | —（必填） | 见 §8。`auto` 时 `matchUserAgent` 按 UA 归一化 + 推断 `new_name`/`ver` | `argTarget`, `argClashNewField`, `intSurgeVer` |
| `url` | string | `global.defaultUrls` | 订阅 URL，`\|` 分隔多条；支持 `tag:name,url` 前缀、`script:path,args`（需 authorized）、`nullnode` 占位、`data:` 内联、`surge:///install-config?url=` 解包 | `argUrl` |
| `ver` | `2\|3\|4` | `3` | Surge 版本；空→3；影响规则表 + `surge_ver` 传入导出器 | `argSurgeVer` |
| `config` | string | `global.defaultExtConfig` | 外部配置（本地路径或 URL），见 §13 外部配置语义；nodelist 模式忽略 | `argExternalConfig` |
| `include` | rs | 空 | 包含正则（`\|`/`\`` 分隔，内部正则，见 `chkIgnore`）。非空时“任一命中才保留” | `argIncludeRemark` |
| `exclude` | rs | 空 | 排除正则；任一命中即剔除。请求侧先 `regValid` 校验，非法整请求 400 | `argExcludeRemark` |
| `groups` | urlB64 | 空 | 自定义代理组覆盖（Base64 后的文本：`@` 分隔，`@` 内 `'` 分隔 Name/type/rule…/url/interval） | `argCustomGroups` |
| `ruleset` | urlB64 | 空 | 自定义规则集覆盖（同上 Base64） | `argCustomRulesets` |
| `group` | string | 空 | `\|` 分隔的自定义分组名，大小写不敏感映射到 `x.Group` 覆盖 | `argGroupName` |
| `emoji` / `add_emoji` | tribool | `global.addEmoji` | 是否对节点前置 emoji；`add_emoji` 别名旧 `remove_emoji` 反向语义见 `ext.add_emoji.define(argRemoveEmoji)` | 映射到 `ext.add_emoji` + `ext.emoji_array` |
| `remove_emoji` | tribool | — | `ext.add_emoji.define(argRemoveEmoji)`（取反存 `add_emoji`） | — |
| `append_type` | tribool | `global.appendType` | 节点名前置 `[SS]` 等类型标签 | `ext.append_proxy_type` |
| `tfo` | tribool | `global.TFOFlag` | TCP Fast Open | `ext.tfo` |
| `udp` | tribool | `global.UDPFlag` | UDP 转发（仅产生参数；Surge/Loon 等条件写入） | `ext.udp` |
| `scv` | tribool | `global.skipCertVerify` | 跳过证书校验（QuanX 取反写 `tls-verification=false`） | `ext.skip_cert_verify` |
| `tls13` | tribool | `global.TLS13Flag` | TLS 1.3 | `ext.tls13` |
| `fdn` | tribool | `global.filterDeprecated` | 过滤已废弃加密/协议（SS chacha20 等） | `ext.filter_deprecated` |
| `list` | tribool | — | 输出为 Node List（仅代理列表，不含规则）。`true` 时取 YAML 重载结果 | `ext.nodelist` |
| `sort` | tribool | `global.enableSort` | 按 Remark 字典序 `stable_sort`；`sort_script` 存在时优先走 JS compare | `ext.sort_flag` |
| `sort_script` | tribool | `!sortScript.empty()` | 是否启用 JS 排序（`global.sortScript` 内联或 `path:`） | `ext.sort_script` |
| `expand` | tribool | — | Clash 展开：`false` → `clash_new_field_name=true` 且禁用 script；`true`(默认) 时 script 禁用 | 特殊见 `interfaces.cpp:426-430` |
| `script` | tribool | — | 切换 Clash Script 模式（`ext.clash_script`）；与 `expand=false` 互斥 | `ext.clash_script` |
| `classic` | tribool | — | Clash Classical 规则集模式（`ext.clash_classical_ruleset`） | — |
| `insert` | tribool | `global.enableInsert` | 是否合并 `insert_url` 订阅 | `argEnableInsert` |
| `prepend` | tribool | `global.prependInsert` | insert 节点前置 | `ext.prepend_insert`（实际在 `interfaces.cpp:674-683` 合并时生效） |
| `new_name` | tribool | `global.clashUseNewField` | Clash 新字段名（`ws-opts` vs `ws-path` 等） | `ext.clash_new_field_name` |
| `insert` (别名) | tribool | — | 已列 | — |
| `filename` | string | 空 | `Content-Disposition` 文件名 | `argFilename` |
| `interval` | int | `global.updateInterval` | `profile-update-interval` 小时（`interval/3600`） | `interval` |
| `strict` | boolStr | `global.updateStrict` | Surge Managed Config strict | `strict` |
| `dev_id` | string | `global.quanXDevID` | QuanX `server_check` device id | `ext.quanx_dev_id` |
| `filter_script` | string | `global.filterScript` | JS 节点过滤（`filter(node)→bool`），仅 authorized | `argFilterScript` |
| `rename` | string | — | 仅 Surge 相关路径读取（`interfaces.cpp` 内局部），常规重命名走外部配置/`[node_pref] rename_node` | — |
| `append_info` | tribool | `global.appendUserinfo` (default true) | 是否回传 `Subscription-UserInfo` 头 | `argAppendUserinfo` |
| `upload` | tribool | false | 上传生成结果到 Gist | `argUpload` |
| `upload_path` | string | 空 | Gist 中的文件名 | `argUploadPath` |
| `token` | string | — | API 鉴权；仅 `APIMode` 生效 | `authorized` |
| `profile_data` | string | — | Managed Config 覆盖前缀（Base64 解码后） | `interfaces.cpp:754` |

- **tribool** 三态：`undef / true / false`（`src/utils/tribool.h`），`ext.x.define(arg).define(global)` 为"参数优先，空则回落全局"的优先级链。
- **简单订阅判定** `lSimpleSubscription` (`interfaces.cpp:313-325`)：`ss/ssd/ssr/sssub/v2ray/trojan/mixed` 为简单目标（不加载 ruleset/组基）；其余为复杂目标。
- 缺少 `url` 且无 `insert_urls` 时 400；`target` 非法 400（`interfaces.cpp:320-325,368-373`）。
- 正则黑名单：若 `include`/`exclude` 原串命中 `gRegexBlacklist` 直接 400（`interfaces.cpp:360`）。

### 3.3 认证

| 面 | 默认 | 逻辑 |
|----|------|------|
| `api_mode` (h:28 默认 `true`) | `true` | `false` 时开放 `/get`、`/getlocal`（SSRF/LFI，**Workers 必须不实现**） |
| `api_access_token` | `password`（`pref.example.ini:6`，`main.cpp:170-175` 可被 `API_TOKEN` 环境变量覆盖） | `/refreshrules`、`/readconf`、`/updateconf` 仅 `token` 非空时比对；`/flushcache` **无条件**比对（空 token 空串可通过，注意）；`/sub` 的 `authorized` 仅影响脚本与文件访问 |
| `getprofile` | — | `name`、`token` 均必填缺一 403；单 profile 且该 profile `[Profile]` 含 `profile_token` 时用之校验并将内部 token 替换为 `global.accessToken`，否则与 `global.accessToken` 比对（`interfaces.cpp:1242-1303`） |
| `Basic auth` | 未接线 | `webserver.h:62-63` 字段存在但无配置读取路径，死代码 |
| 覆盖环境变量 | — | `API_MODE` / `MANAGED_PREFIX` / `API_TOKEN` / `PORT`（`main.cpp:170-175,295-297`） |

### 3.4 响应头与 CORS

| 头 | 触发条件 | 值 | 位置 |
|----|---------|----|------|
| `Server` | 全部 | `subconverter/v0.9.0 cURL/<libcurl>` | `webserver_httplib.cpp:155` |
| `Access-Control-Allow-Origin` | 全部 | `*` | `webserver_httplib.cpp:173` |
| `Access-Control-Allow-Headers` | 全部/预检 | 回显 `Access-Control-Request-Headers`；预检另设 `Allow-Methods` 为该 path 已注册方法、`Allow-Headers: Content-Type,Authorization` | `webserver_httplib.cpp:134-172` |
| `X-Client-IP` | 全部 | 客户端地址 | `webserver_httplib.cpp:168` |
| `Subscription-Userinfo` | `subInfo≠∅ && append_info.get(true)` | `upload=0; download=<used>; total=<total>; [expire=<ts>;]`（由 `infoparser` 提取） | `interfaces.cpp:668-669` |
| `profile-update-interval` | `target ∈ {clash,clashr}` 或 `/surge2clash` | `interval/3600` | `interfaces.cpp:765,1204` |
| `Content-Disposition` | `filename≠∅` | `attachment; filename="…"; filename*=utf-8''<urlenc>` | `interfaces.cpp:960-961` |
| `#!MANAGED-CONFIG <url> interval=N strict=…` | Surge/Surfboard 且 `write_managed_config && prefix≠∅` | 前置到响应体首行（非头） | `interfaces.cpp:808-810,825-827` |

- CORS 预检：`OPTIONS .*` 通配聚合该 path 的允许方法返回 200，否则 404（`webserver_httplib.cpp:119-142`）。
- `Profile-Web-Page-Url` **本 fork 未实现**（仅 upstream 新版有），勿前端依赖。

### 3.5 重定向与静态文件

- 别名重定向：`pref [aliases] uri=target` 每项注册 `GET uri → 302 Location: target`（`settings.cpp:995-1002`），参数合并见 `merge_values`。
- 静态目录：`serve_file_root` 非空时 `set_mount_point("/", serve_file_root)`（`settings.cpp:1018-1019`）；Workers 侧改为静态资源绑定或 Pages。

---

## 4. 核心数据模型

### 4.1 Proxy（`src/parser/config/proxy.h:12-27` + 各 explode 赋值）

```
Type              : SSR/SS/VMess/Socks5/Http/Https/Trojan/Snell/WireGuard/Hysteria/Hysteria2/AnyTLS/Unknown
Group / GroupId  : 订阅分组名 / 归属订阅序号（insert 组为负，见 §7）
Remark           : 节点显示名（去 emoji 前置、trim、重命名后的最终名）
Hostname / Port  : 主机 / 端口（int，0/-1 为非法）
UDP / TFO / AllowInsecure(scv) / TLS13 : bool/tribool 逐节点覆写
Id / GroupId     : 全局递增 Id、Group 序号
ProxyMethod/Password/EncryptMethod/Protocol/ProtocolParam/OBFS/OBFSParam
HostName/Path/TLSSecure/QUICSecure/QUICSecret/AlterId/Cipher
Sni/ALPN/Certificate/Ca/CaStr/Up/Down/Ports/Obfs/ObfsParam
PublicKey/PrivateKey/DNS/MTU/PreskaredKey/IP/IPv6  (WireGuard)
Plugin / PlugInfo (SS 插件)
UnderlyingProxy / TransferProtocol / FakeType ... 等传输层字段（见各 explode 赋值）
```

### 4.2 ProxyGroupConfig（`src/config/proxygroup.h:6-52`）

```ts
type ProxyGroupType = 'Select'|'URLTest'|'Fallback'|'LoadBalance'|'Relay'|'SSID'|'Smart';
BalanceStrategy = 'ConsistentHashing'|'RoundRobin';
ProxyGroupConfig {
  Name: string; Proxies: string[];        // 规则（GROUP 前缀/正则/script）或 provider
  UsingProvider?: string[];               // !!PROVIDER=a,b
  Url?: string; Interval?: number; Timeout?: number; Tolerance?: number;
  Strategy?: BalanceStrategy; Lazy?: bool; DisableUdl?: bool;
  Persistent?: bool; EvaluateBeforeUse?: bool;
}
```

INI 绑定 `INIBinding::from<ProxyGroupConfig>`（`src/config/binding.h:197-263`）： `` ` `` 分隔，`<3` 段丢弃；`url-test/fallback/load-balance` 需 `≥5` 段且尾两段为 url 与 `interval[,timeout[,tolerance]]`（`binding.h:240-247`）；`!!PROVIDER=` 入 `UsingProvider`。TOML 同语义。

### 4.3 RulesetConfig（`src/config/ruleset.h:15-25` + `binding.h:92-141,267-306`）

```
Group, Url (带类型前缀 surge:/quanx:/clash-domain:/clash-ipcidr:/clash-classic: 的受限 URL，或 inline '[]Rule'), Interval=86400
```

TOML/INI 将类型词转 url 前缀；INI inline `group,[]Rule` 形式（`binding.h:288-294`），`!!import:` 支持。

### 4.4 RegexMatchConfig（`src/config/regmatch.h:6-11` + `binding.h:143-161,333-355`）

```
Match: 正则（对 Remark/Group/GroupID/Type/Port/Server 前缀匹配见 §9）
Replace: 替换模板（jpcre2 表达式求值，'gEx' 需核对）
Script:  QuickJS 脚本路径/内联（rename/emoji/script 组三种位置）
三选二：match+emoji|replace 或 script；INI 以分隔符（@ 或 ,）切分
```

### 4.5 extra_settings（`src/generator/config/subexport.h:18-59`）

`enable_rule_generator, overwrite_original_rules, rename_array, emoji_array, add_emoji, remove_emoji, append_proxy_type, nodelist, sort_flag, filter_deprecated, clash_new_field_name, clash_script, surge_ssr_path, managed_config_prefix, quanx_dev_id, tfo/udp/skip_cert_verify/tls13(tribool), clash_classical_ruleset, sort_script, clash_proxies_style/clash_proxy_groups_style(flow|block|compact), clash_script, authorized, js_runtime/js_context(Workers 删除)`。TS 版 `ExportOptions` 的直接蓝本。

### 4.6 Limits（`src/config/def.h`, `settings.h:33,63,66`）

```
maxAllowedRulesets = 64   // 外部配置 ruleset 条数上限（超限整配置拒绝）
maxAllowedRules    = 32768// 生成时规则行硬上限（所有 rulesetTo* 循环内 break）
maxAllowedDownloadSize = 1 MiB（可配）
maxAllowedRulesets/Rules = 0 表示无限制（struct 默认 64/32768，手动改 0 解限）
cacheSubscription=60s / cacheConfig=300s / cacheRuleset=21600s（cache 进程内 TTL，见 §17）
enableCache=false 时三者置 0
```

---

## 5. 订阅解析

### 5.1 分发（`src/parser/subparser.cpp:2577-2599`）

`explode(link, node)` 按前缀路由（`startsWith` 除 `hy2|hysteria2` 用 `strFind` 全文匹配）：

- `ssr://` → `explodeSSR`
- `vmess://|vmess1://` → `explodeVmess`（内部再分 Shadowrocket/Std/Kitsunebi/Quan）
- `ss://` → `explodeSS`（含 SIP002 明文 / 整体 base64 双形态）
- `socks://|t.me/socks|tg://socks` → `explodeSocks`
- `t.me/http|tg://http` → `explodeHTTP` (Telegram 风格 Http)
- `Netch://` → `explodeNetch`
- `trojan://` → `explodeTrojan`
- `hysteria2|hy2://`（全文匹配） → `explodeHysteria2`
- `anytls://` → `explodeAnyTLS`
- 兜底 `isLink(http/https/data:)` → `explodeHTTPSub`（任意 URL 的 Http 节点）；否则 Unknown

无链接格式（仅通过 Clash YAML / Surge INI 入口）：
- `explodeClash:1326/1317` 解析 `proxies:` / `Proxy:` 段 → SS/VMess/SSR/SOCKS/HTTP/Trojan/Snell/WireGuard/Hysteria1/2/AnyTLS
- `explodeSurge:2036/1993` 解析 Surge INI 行 `remark = type,args...` → 同上 + `custom/.../wireguard/anytls`

**不支持作为输入链接**：`vless`、`tuic`、`juicity`、`hysteria1://`（全 src 无对应解析；`ProxyType` 枚举亦无，见 `parser/config/proxy.h:12-27`）。这些类型仅在 Clash 输入侧可能出现，不可作为订阅链接解析目标，迁移时标记为不支持输入并文档化。

公共 `commonConstruct:28-40` 统一填 `Type/Group/Remark/Hostname/Port/UDP/TFO/scv/TLS13`，`Port=to_int(...)`，`0` 视为非法。

### 5.2 单链接协议细节

**VMess** (`:42-64,274-342,1409-1532,2233-2301,1861-1926`)

- 空 `uuid` 默认全零 `00000000-0000-0000-0000-000000000000`。
- `net` 默认 `tcp`；`quic` 时 `host/path → QUICSecure/QUICSecret`，否则 `Host` 空且 `add` 非 IP 时回退 `add`，`Path` 默认 `/`；`TLSSecure=(tls=="tls")`。
- `explodeVmess:274-342` 分发：`b64?query`→Shadowrocket、`*@*`→Std、 `vmess1://…?`→Kitsunebi、含 `" = "` → Quan，否则 b64 JSON；`v2` 才有 `path`，`v1` 以 `;` 存 `host;path`；`port==0` 丢弃。catch 抛 `explodeVmessConf:430`。
- `explodeStdVMess:1409-1450` 正则要求小写 hex UUID；`net ∈ {tcp,kcp,ws,http,quic}`（`kcp` 含 `http→type`），`aid` 数字。
- Shadowrocket `1452-1494`：`b64(cipher:id@add:port)+query`，`obfs=websocket→ws`，`tls=1→tls`。
- Kitsunebi `1496-1532`：`id@add:port(/path)`，`tls=true`。
- Surge4 `1861-1926`：`username→uuid`，`ws/tls/ws-path/obfs-host/ws-headers("h:v|h:v" 取 Host/Edge)/tls13/vmess-aead(true→aid="0")`。
- QX 行内 `2233-2301`：`method→cipher`，`obfs=ws/over-tls/wss`，`aead(true→aid="0"` 缺 `break` 无害)。
- Netch `1013-1113` 按 `Type` 分派各协议。

**SSR** (`:66-75,686-785, :20,2486`)

- `explodeSSR:686-721`：`b64(host:port:protocol:method:obfs:b64(pass))[/?remarks&group&...均b64]`；**启发式**：`method∈ss_ciphers ∧ obfs∈{∅,plain} ∧ protocol∈{∅,origin}` → 当普通 SS，否则 SSR。
- `explodeSSRConf:723-785` libev 单配置（`local_port+local_address`）与 `configs[]`。**已知缺陷**：`password` 未从 JSON 读出即传入构造。

**SS** (`:492-684,1190-1258,1718-2232`)

- `explodeSS:492-534`：剥 `ss://`、`/?→?`、`#fragment=urlDecode`，`plugin(;` 拆 `plugin/pluginopts)`、`group(b64)`。**歧义启发**：有 `@` 时明文匹配 `secret@server:port` 后对 `secret` 做 `urlSafeBase64Decode(method:password)`——仅 SIP002 base64 userinfo，解码失败静默丢弃；无 `@` 整体 b64 后 `method:password@server:port`。`port==0` 丢。
- `explodeSSD:536-610`：`ssd:// b64(JSON)`，`servers` 数组或对象（map 名作索引）；顶层 `port/encryption/password/plugin` 为默认。
- `explodeSSAndroid:612-647` 裸 `{nodes:[…]}`。
- `explodeSSConf:649-684` version+servers；**QUIRK** `:666-671` `ps` 回退 `server:port` 在 `server` 赋值前且循环外残留上迭代值。
- Clash SS `1190-1258`：三形态 plugin（`obfs`/`v2ray-plugin`/`plugin-opts` 平铺），拼 `obfs-local "obfs=m[;host]"` / v2ray-plugin `mode/tls/mux/host/path`；`AEAD_CHACHA20_POLY1305→chacha20-ietf-poly1305`，`AEAD_ 去前缀+_→-`。

**Trojan** (`:892-944,1296-1315,1956-1991,2302-2348`)

- `sni/peer→host`；WS 两套：`ws=1+wspath` 或 v2rayN `type=ws+path(%2F开头 urlDecode)`；`TLSSecure` 恒 `true`。
- Clash Surge QX 各有细微差异（见审计块，TS 需按目标分支单独回归）。

**Hysteria2/Hysteria1** (`:135-210,1338-1391,1585-1594`)

- 链接 `hy2|hysteria2://` 归一化、authority 含 `:` 才进 Std；两形态 `pass@host:port` 或 `host:port+?password=`。
- query：`insecure→scv`、`up/down`（含 `bps` 后缀则直存否则 `Mbps×10⁶`）、`alpn`（注释称非官方）、`obfs/obfs-password`（别名 `obfsParam`）、`sni/pinSHA256→fingerprint`；`ports` 复用 `port`。
- Clash：`password 空回退 auth`、`alpn[0]`；Hysteria1 仅 Clash `1338-1368`，`construct:135-210` 的 `TLSSecure` 恒 `true`。

**Socks/HTTP/Snell/WireGuard/AnyTLS**（见 ParserAudit "Socks/HTTP/..." 段，含每种格式的端口/用户名/tls 判定、Snell `psk/obfs/version`、WireGuard `parsePeers:1628-1660` 的 `peer(...)` 语法）。

### 5.3 配置嗅探与 explodeSub 链（`subparser.cpp:2530-2665`）

- `explodeConfContent:2530-2575` 魔法子串嗅探→ `ssconf/ssrconf/vmessconf/ssandroid/sstap/netch/surge`；默认 `explodeSub`。
- `explodeConf` `nodemanip.cpp:24-28` = `fileGet + explodeConfContent`。
- `explodeSub:2601-2665` 顺序：
  1. `ssd://` → `explodeSSD`
  2. regex `"?(Proxy|proxies)"?:` 截取 proxies 段后 `Load YAML → explodeClash`（YAML 异常 `2632` rethrow）
  3. 失败再 `explodeSurge`
  4. 仍失败 `b64` 解码后再试带 `vmess|shadowsocks|http|trojan` 行的 Surge
  5. 最后按分隔符拆行逐条 `explode()`——分隔符启发：`\n` 计数≥1 用 `\n`，否则 `\r`，否则 ` `（`:2651`）；`Type==Unknown` 静默跳过。

- `explodeHTTPSub` 是任意 `isLink` 的最终兜底（`:2597-2598`）。

错误策略：解析失败大多 `return` 留 Unknown 由上层过滤；仅 V2Ray conf 与 Clash YAML 异常会向上 rethrow（`nodemanip.cpp:163` 返回 `-1`，上层 `skip_failed_links` 决定 skip/400）。

---

## 6. 流量/到期信息提取

- `getSubInfoFromHeader:71-84` regex `(?i:Subscription-UserInfo): (.*?)\\s*?$`。
- `dateStringToTimestamp:38-69`：`left=Nd`→剩余秒加当前时间；否则 `"Y:M:D:h:m:s"` 六段 `split ':'`→`mktime`，段数≠6 返 `0`。
- `streamToInt:13-31` 单位 `B/KB/MB/GB/TB/PB/EB ×1024`。
- `getSubInfoFromNodes:86-178` 首条命中即采纳（`regMatch+regReplace` 替换结果≠原文才算命中），按 URL 参数解析 `total/used/left`（含百分比推算、`left>total→0`），输出 `upload=0; download=used; total=T;[ expire=E;]`（`upload` 合并进 `download`）。
- `getSubInfoFromSSD:180-198` `ssd://` b64 JSON 的 `traffic_used/traffic_total(GB×10²⁴)`、`expiry "(\\d+)-(\\d+)-(\\d+) (.*)" → "$1:$2:$3:$4"` 转 timestamp。
- **调用点** `nodemanip.cpp:170-176/203-208`：优先级 `SSD > Header > 节点备注正则`。

用户配置流：`[userinfo] stream_rule / time_rule` 重复键 `正则|新格式`，TS 侧为 `{match, replace}[]`（`settings.cpp:900-919`，YAML/TOML 同义）。

---

## 7. 转换管线（顺序是契约）

（`src/handler/interfaces.cpp:616-736` + `src/generator/config/nodemanip.cpp`）

1. `insert` urls 先解析（`groupID=-1` 递减 `616-639`），主 `urls groupID=0` 递增 `640-661`，每条 `addNodes(link, allNodes, groupID, parse_set)`。
2. `addNodes` 内下载/解析后**立即**对该订阅做 `filterNodes(exclude/include)`（`nodemanip.cpp:183,215`）并赋 `Id/GroupId`（`:285-286`）。
3. `insert_nodes` 按 `prependInsert` 前/后合并进 `nodes`（`:674-683`）。
4. JS `filter_script`（仅 `authorized`）：`nodes.erase(remove_if(filter))`（`:715-727`）。
5. 自定义 `group` 名覆盖 `x.Group`（`:731-733`）。
6. `preprocessNodes(nodes, ext)`（`:736; nodemanip.cpp:466-515`）：对每节点 `remove_emoji→trim(:470-471) → nodeRename(逐条 applyMatcher+regReplace，空结果回退原名:403-407) → add_emoji(首命中即 `emoji remark` 前置:458-461)`；之后若 `sort_flag`：`sort_script(JS compare, stable_sort)` 失败则按 Remark 字典序 `stable_sort`（`:479-514`）。
7. 按 `target` dispatch 到各 `proxyToXxx`；每个导出器内再 `append_proxy_type` 前缀（`[SS] `）与 `processRemark`（`=`→`-`，含逗号时 Surge `proc_comma=true` 加引号，Clash/SingBox `false`，重名加 ` N` 后缀 `:186-193`）。

**无全局去重**；去重仅组内 `filtered_nodelist`（`subexport.cpp:226`）与 `processRemark` **重名**消解。

`chkIgnore` 语义（`nodemanip.cpp:233-269`）：`exclude` 任一命中即剔；`include` 非空时任一命中才留。`applyMatcher` 前缀（`subexport.cpp:115-169`）：`!!GROUP=/!!GROUPID=/!!INSERT=/!!TYPE=/!!PORT=/!!SERVER=`，其余对 Remark 的纯正则。`!!INSERT=` 匹配 `GroupId<0` 的 insert 组。`matchRange 'N|A-B|!N|!A-B|N-|N+'` 见 `:64-113`。

---

## 8. 输出目标矩阵

Dispatch 在 `handler/interfaces.cpp:760-958`；`lSimpleSubscription` 决定是否跳过 base/ruleset。

| target | 构建器 | 备注 |
|--------|--------|------|
| `clash` / `clashr` | `proxyToClash(nodes, base, clashR?)` `subexport.cpp:693`（内调 `232` 的 YAML 版）；nodelist 走 YAML 重载 `767-771` | `clashr=true` 输出 SSR 兼容字段 `protocolparam/obfsparam`（`:391-400`） |
| `surge`（`ver=2/3/4`） | `proxyToSurge(…, ver, ext)` `:765` | `MANAGED-CONFIG` 头注入 `808-810` |
| `surfboard` | `proxyToSurge(…, -3, ext)` `821` | = Surfboard，规则集走 `SurfRuleTypes` 过滤 `ruleconvert.cpp:427-430` |
| `mellow` | `proxyToMellow` `:1826/:1841` | INI `Endpoint/EndpointGroup` |
| `sssub` | `proxyToSSSub` `:1174` | SIP008 JSON |
| `ss / ssr / v2ray / trojan` | `proxyToSingle(types=1/2/4/8)` `:1093` | 位掩码 `SS=1 SSR=2 VMess=4 Trojan=8 :1095` |
| `mixed` | `proxyToSingle(15)` `880` | 全四类，`base64` 编码（`:1171`） |
| `quan` | `proxyToQuan` `:1227/:1251` | `rulesetToSurge(…,-2)→[TCP]` `:274-276` |
| `quanx` | `proxyToQuanX` `:1453/:1484` | `rulesetToSurge(…,-1)→filter_local` `:271-273`；nodelist 返回 `server_local` 原文不 b64 |
| `loon` | `proxyToLoon` `:1981` | `rulesetToSurge(…,-4)→Remote Rule` `:289-291` |
| `ssd` | `proxyToSSD` `:1727` | ``ssd://``+`b64(JSON)` `:1823`，含 `traffic_used/total/expiry :1745-1763` |
| `singbox` | `proxyToSingBox` `:2631/:2326` | `rulesetToSingBox :520` |

非法 `target` 返 400 `Invalid target!`（`:319`）。

---

## 9. 代理组规则匹配语义

**ProxyGroupType**（`config/proxygroup.h:6-15`）：`Select/URLTest/Fallback/LoadBalance/Relay/SSID/Smart`；`Smart` 在 Clash 输出时转为 `url-test`（`subexport.cpp:611-612`）。

**`GROUP` 占位与展开** `groupGenerate`（`subexport.cpp:196-230`）

- `[]NAME` 字面量（`[]DIRECT` 等）`:199-202`
- `script:path` （`authorized`）JS 过滤返名单 `:204-221`
- 其余 `applyMatcher + regFind(Remark)` 去重 `:222-229`
- `add_direct=false` 时 `[]` 不展开（仅 Mellow `false`  `:1946`）

**各目标组差异**（ExportAudit §3，`subexport.cpp:605-672,1013-2612`）：

- Clash `605-672`：`Smart→url-test`；`LoadBalance` 加 `strategy`；`lazy`/`url/interval/tolerance` 仅 `>0` 写；`disable-udp`；`UsingProvider` → `use` 且此时空 `proxies` 不补 `DIRECT`，否则空补 `DIRECT`；同名替换 base 中已有组。
- Surge `1013-1085`：SSID `ssid,default=X,…`；`LoadBalance` 仅 `ver≥1` 或 `-3`；单 `direct/reject/...` 成员写 `Proxy` 段；`url/interval/.../evaluate-before-use`；继承 `icon-url`。
- Quan/QuanX/Loon/Mellow/SingBox 各有静态/可用性/轮询/或门类型的映射与空组回退、全量回退语义（见审计原段）。

---

## 10. 规则与规则集系统

**类型**（`generator/config/ruleconvert.h:13-20`）：`RULESET_SURGE/QUANX/CLASH_DOMAIN/CLASH_IPCIDR/CLASH_CLASSICAL`，`RulesetContent{group,path,path_typed, type, content(shared_future), interval}`。

**URL 前缀**（`settings.cpp:22-23`）：`clash-domain:/clash-ipcidr:/clash-classic:/quanx:/surge:` 剥前缀定 `type`；`[]` inline 规则 `:260-265`。经 `fetchFileAsync(url, proxy, cacheRuleset, true, async)` `:277`。

**限制**同 §4.6。缓存 TTL `cacheRuleset=21600s`。`!` 映射见 `convertRuleset:20-96`：QuanX `host→DOMAIN, ip6-cidr→IP-CIDR6, no-resolve`；Clash payload YAML 剥头；SURGE 原样。

**Clash** `rulesetToClash(:125-257)`：`[]` 的 `FINAL→MATCH`，白名单 `ClashRuleTypes`（`DOMAIN/SUFFIX/KEYWORD/IP-CIDR/GEOIP/MATCH/FINAL + IP-CIDR6/SRC-PORT/DST-PORT/PROCESS-NAME`），`transformRuleToCommon` 拼 `type,value,group[,flag]`。`Str` 版把 `\\nRule:\\n…` 文本拼在 YAML Dump 后（`subexport.cpp:735-736` 避二次序列化）。`clash_script` 时走 `renderClashScript(templates.cpp:310)`。

**Surge 系** `rulesetToSurge(:259-471)`：`0=Mellow RoutingRule, -1=QuanX filter_local, -2=Quan TCP, else=Rule`；远程提供式 `>2 且 prefix` 时 `RULE-SET,prefix/getruleset?type=1&url=<b64(typed)>,group`、`-1→filter_remote`、`-4→Remote Rule`；`-1/-2` 仅留 QuanX 类型且 `no-resolve-only`。

**SingBox** `rulesetToSingBox(:520-606)`：前置 `dns-out`，可插 Global/Direct，`AppendToArray` 同组聚合 `FINAL→route.final`。

---

## 11. Clash YAML 细节（`subexport.cpp:232-691`）

- 样式 `clash_proxies_style / clash_proxy_groups_style ∈ {block,flow,compact}`（`:238-262`，单代理默认 Flow `:579-582`）。
- 公共键 `name/server(port→to_int)/port`；`udp` 仅非 Snell 且 `true` 才写；`tfo` 定义才写；`skip-cert-verify = ext.skip_cert_verify.define(x.AllowInsecure)` 各类型内按定义写。
- SS `286-314`：`filter_deprecated∧cipher==chacha20→drop`；`plugin` 三态：`simple-obfs→obfs(mux-bool)、v2ray-plugin→tls/mux`；SS `filter_deprecated` 时 `cipher∈clash_ssr_ciphers:31 / protocol∈clashr_protocols:29 / obfs∈clashr_obfs:30` 校验。
- VMess `315-371`：`ws-opts / ws-path+ws-headers` 由 `clash_new_field_name` 切换；`http-opts/h2-opts/grpc-opts`。
- SSR `372-401`：同校验，`cipher none→dummy`，`clashR` 分支键名差异。
- Trojan/Snell/WireGuard/Hysteria(1/2)/AnyTLS 各键清单见 ExportAudit §5。
- nodelist 仅 `{proxies:[…]}`。

---

## 12. Surge / Surfboard / Loon / Quan(X) / Mellow / SingBox 细节

（见 ExportAudit §6 与 ConfigAudit 规则节，抽要点）

- Surge Proxy 段首条恒 `DIRECT = direct`（`:789-791`），`surge_ver==-3` 兼容 Surfboard 的 `ss encrypt-method` 新写法。
- VMess/SSR 仅 `ver≥4/-3` 与 `surge_ssr_path` 存在时输出对应外置行；SSR `addresses=` 依赖 `resolve_hostname` 的同步 `hostname→IP`（Workers 改 DoH 或省略）。
- WireGuard Surge 为独立 `WireGuard <hash>` 段集合（含 `generatePeer:744-763` 的 `public-key/endpoint/client-id/allowed-ips`）。
- Loon 的 `tfo/udp` 仅 `ext.true` 才写（与其余目标的 tribool 合并语义不同）。
- SingBox `singbox_add_clash_modes` 时追加 `GLOBAL` selector。

---

## 13. 配置系统

### 13.1 pref 探测与格式

`main.cpp:122-142`：优先级 `pref.toml(vision 键) > pref.yml(有 common:) > pref.ini`，均缺失则从 `pref.example.{toml,yml,ini}` 拷贝；`CLI -f` 覆盖，`-g/--gen` 进生成器模式（`main.cpp:61-91`）。

### 13.2 INI 键清单（按段，`pref.example.ini` 行号，TS 需逐条等价）

**[common] 1-77**

| 键 | 默认 | 绑定 |
|----|------|------|
| `api_mode` | `false` | `settings.cpp:835` → `global.APIMode(h:28)` |
| `api_access_token` | 空 | `:836` |
| `default_url` | 空 | `:837` |
| `enable_insert` | `true` | `:838` |
| `insert_url` | 空 | `:839` |
| `prepend_insert_url` | `true` | `:840` |
| `exclude_remarks/include_remarks` | 空 | `:841-844` 重复键数组 |
| `enable_filter/filter_script` | `false/空` | `:845` |
| `default_external_config` | 空 | `:856` |
| `base_path` | `base` | `:846` |
| `clash/surge/.../singbox_rule_base` ×9 | `base/all_base.tpl` | `:847-855` |
| `proxy_config/proxy_ruleset/proxy_subscription` | `SYSTEM/SYSTEM/NONE` | `:858-860` |
| `append_proxy_type` | `false` | `:857` |
| `reload_conf_on_request` | `false` | `:861`（触发条件 `interfaces.cpp:327` 还需 `!APIMode||CFW`） |

**[userinfo] 79-95** `stream_rule/time_rule` 重复 `正则|新格式` → `safe_set_streams/times` `:900-919`。

**[node_pref] 97-132** `udp_flag/tfo/skip_cert_verify/tls13(tribool :878-881)`、 `sort_flag(false)/sort_script/filter_deprecated/append_sub_userinfo/clash_use_new_field_name/clash_proxies_style(flow)/clash_proxy_groups_style(block)/singbox_add_clash_modes(true)` `:882-889`、 `rename_node` 重复 `Search@Replace / !!script:` `:890-897`。

**[managed_config] 134-149** `write_managed_config(true)/managed_config_prefix(http://127.0.0.1:25500)/config_update_interval(86400)/config_update_strict(false)/quanx_device_id :922-926`。

**[surge_external_proxy] 151-153** `surge_ssr_path/resolve_hostname(true) :866-867`。

**[emojis] 155-167** `add_emoji/remove_old_emoji :929-930`、 `rule` 重复 `正则,emoji :931-938`。

**[rulesets]/[ruleset] 169-195** `enabled(true)→enableRuleGen`，`overwrite_original_rules/update_ruleset_on_request :947-948`；`ruleset/surge_ruleset` 重复 `Group[,type:]URL[,interval] / Group,[]Rule`（`RulesetTypes :22-23`）。

**[proxy_groups]/[clash_proxy_group] 197-224** `custom_proxy_group` 重复 `` `Name```select```rules```url```interval…`` ``；含 `[]GROUP / !!GROUPID / !!PROVIDER / script:`。

**[template] 226-238** `template_path=templates :983`，余项进 `global.templateVars(+managed_config_prefix) :984-993`，模板内 `{{global.clash.http_port}}` dot-path→JSON pointer。

**[aliases] 240-259** `uri=target` → `append_redirect`。

**[tasks] 261-264** `task` 重复 `Name:```:Cron:```:JS_Path:```:Timeout` → `CronTaskConfigs+refresh_schedule :1004-1013`。

**[server] 266-274** `listen(0.0.0.0)/port(25500)/serve_file_root :1015-1019`；`PORT` env 可覆盖（`main.cpp:295-297`）。

**[advanced] 276-290** `log_level/print_debug_info/max_pending_connections/max_concurrent_threads(=2)/max_allowed_{rulesets,rules,download_size}/enable_cache/cache_{subscription(60),config(300),ruleset(21600)}/serve_cache_on_fetch_fail/script_clean_context/async_fetch_ruleset/skip_failed_links :1021-1072`。

YAML/TOML 的容器差异见 ConfigAudit `toml_yml_notes`（`[[array-of-tables]]`、`top version=1` 等）。

### 13.3 外部配置（`?config=`）

加载：空→`global.defaultExtConfig`；`fetchFile` 后先 inja 渲染，失败原文（`settings.cpp:1206-1208`）；格式探测 `YAML(含[custom])→TOML(version)→INI(散行归 [custom], isolated_section正：1228-1236)`。

可覆盖项（`[custom]` 隐式段，`settings.cpp:1239-1301` / `interfaces.cpp:443-487`）：

| 键 | 生效目标 | 备注 |
|----|---------|------|
| `custom_proxy_group`（前缀匹配多条） | `lCustomProxyGroups` 整体替换（非空才） | `settings.cpp:1241-1245` |
| `ruleset/surge_ruleset` | `lCustomRulesets`，受 `maxAllowedRulesets`约束超限 `-1` 整配失败 | `1246-1258` |
| `*_rule_base ×9` | 各 `lXxxBase`，经 `checkExternalBase`：URL 或 `basePath` 内存在才生效 | `1260-1268, interfaces.cpp:296-299` |
| `enable_rule_generator / overwrite_original_rules` | `ext.*` 无条件覆盖 | `1270-1271` |
| `rename(@分隔)` | `ext.rename_array` 非空替换否则回落 `safe_get_renames()` | `1273-1279, interfaces.cpp:476,530` |
| `emoji(,分隔)+add_emoji/remove_old_emoji(tribool)` | `ext.emoji_array/add_emoji` | `1280-1288` |
| `include_remarks/exclude_remarks` | `lInclude/lExclude` 非空替换 | `1289-1292` |
| `[template] 全部` | `tpl_args.local_vars` | `1294-1301` |

外部 config 不能覆盖 `api_mode/managed_config` 等服务器级项；`nodelist` 模式跳过 base/ruleset/groups 覆盖（`interfaces.cpp:454-475`）；请求参数 `ruleset=/groups=` 的 `@` 分隔在无外部 config 时生效。

---

## 14. INIReader 语义（`src/utils/ini_reader/ini_reader.h` 985 行 header-only）

- `map<section, multimap<key,value>> + section_order`；重复 key = 数组（`multimap` 按 `less` 排序，非文件序——同 `key` 多值的相对次序由插入稳定度保证，跨 `key` 非文件序）。
- 去 BOM、`;/#//` 注释、`processEscapeChar`（`\\n/\\r/\\t`）、`store_any_line({NONAME})`、`store_isolated_line+isolated_section='custom'`、`direct_save_sections`、`allow_dup_section_titles`（`pref.ini` 用 merge）。
- 段重复：`allow_dup_section_titles=true` 时合并，否则 `DUPLICATE`。
- **数组即重复 key**，读 `get_all()` 前缀收集全部值（`503-519`）。
- **无 `${xxx}` 插值、无 include 指令、无多行值**；复用靠 `!!import:`（`settings.cpp:25-70 importItems`：逐行剔注释，支持本地与 URL `webGet+cacheConfig`）。
- 写回按 `section_order`，`{NONAME}` 不带 `key=`；提供 `set/erase/rename_section` 等（`gistconf` 回写用）。

Workers 侧：`Map<string,string[]>`，逐条复刻 BOM/转义/isolated/前缀 `get_all`/`prefix_exist`、`allow_dup`、错误码（可简化为异常）。

---

## 15. 模板引擎 inja / jinja2cpp

- 双实现，默认 **inja**（`generator/template/templates.cpp:80-259`），备选 `template_jinja2.cpp:18-46`（仅三作用域+`fetch/replace`）。
- `render_template(content, template_args, output, include_scope='templates')`：`template_args{global_vars,request_params,local_vars,node_list}`（`templates.h:10-16`），dot-path 键→JSON pointer 嵌套（`templates.cpp:26-38`，`{{global.clash.http_port}}`）。
- 回调（inja）：`UrlEncode/UrlDecode/trim/trim_of/find(re)/replace(re,set/split/append/getLink/startsWith/endsWith/or/and/bool/string/fetch(url)=webGet`（`templates.cpp:111-225`），`trim_blocks+lstrip_blocks`，行前缀 `#~#`。
- include 安全：`canonical` 后要求落于 `include_scope` 内越界抛 `FileError`（`228-243`），`fileGet` 读取。
- 使用端：
  - `/sub` 每目标的 `rule_base` 内容先 `render_template` 再 `proxyToXxx`（`interfaces.cpp:774,798,816,832,845,888,904,920,942`），`tpl_args={global=global.templateVars, request=query(含 token 剔除), local=外部[template]}`（`400-402`），外部 config 预渲染在 `loadExternalConfig:1207`。
  - `/render?path=` 校验 `startsWith(templatePath) && fileExist` 否则 404（`1542-1546`）。
  - `renderClashScript(templates.cpp:310-571)`：`clash_script=true` 时把规则集编译进 `yamlnode['script']['code']` 的 Python 脚本（`script.code :560`），`clash` 规则集生成 `rule-providers`（`prefix/getruleset?type=…&url=<urlsafe-b64>` `:499,514,527`）。
  - `generate.ini`（`-g` 模式）每个 `section`→artifact：`path` 必需；`profile=` 走 `getProfile`；`direct=true` 直接 `fetchFile` 写 BOM；否则按 `kvs→/sub` 参数调 `subconverter` 批写。
  - `gistconf.ini` 状态见 §17。

---

## 16. 脚本与定时任务（QuickJS / cron）

**TS 结论先行：QuickJS 引擎删除；Workers 本身即 JS 运行时。最大破坏点：同步 `fetch`→异步、custom `Request/Response` 类与文件系统 `require` shim 需重设计。**

- 暴露 API（`script_quickjs.cpp:504-526`）：同步 `fetch`、`Request{method,url,data,proxy,headers,cookies}` / `Response{code,data,cookies,headers}` / `Headers{headers,append,parse}`、`atob(=encode!) / btoa(=decode!)`（命名与标准相反）、`time() / sleep(ms,阻塞) / msgbox(Win) / getUrlArg / fileGet / fileWrite / geoip(api.ip.sb:383-386)`、`std/os`（`std.loadFile/std.getenv/os.stat/os.realpath`）+ `require()` shim、双向 `Proxy` 类（`:459-503`）。
- 触发点：
  1. 订阅 `script:path,arg… → parse(arg…)`（`nodemanip.cpp:53-91`）
  2. 重命名 `!!script:`（`:380-401`）
  3. emoji 脚本（`:432-456`）
  4. `sort_script` compare（`:481-508`）
  5. `filter_script` 过滤（`interfaces.cpp:684-694`，仅 authorized）
  6. 代理组 `script:` 返名单（`subexport.cpp:204-221`）
  7. cron 脚本（`cron.cpp:35-72`，`cronexp+path+timeout`，`fetchFile` 后整段 `eval`，`JS_SetInterruptHandler` 超时轮询）
  8. `&script=` 仅切换 Clash Script 输出格式（`templates.cpp:559`，服务端不执行）
- 上下文复用：`script_clean_context` 决定是否每次新建 Runtime（`script_quickjs.h:209-226`）。
- `duktape`（`script.cpp/script_duktape.h`）未进 CMake，死码。

Workers 映射：各 `script:` 钩子改为**直接 JS 函数**（`authorized` 门控保留）；cron 改 **Cron Triggers**；代理组 `script:` 改 `module import`；`fetch` 异步化需把调用链全异步（见 §22）。

---

## 17. 网络、缓存与上传

### webGet（`handler/webget.cpp:300-365`）

- curl 单句柄：跟随 ≤20、关闭 SSL 校验、总超时 15s、`MAXFILESIZE=maxAllowedDownloadSize+进度中断`、cookie 引擎、UA 仅无头时 `subconverter/<ver> cURL/<ver>`、恒 `Content-Type:application/json` 与 `SubConverter-Request/Version` 头、代理 `CURLOPT_PROXY`（`cors:` 前缀为 CORS 代理）、非 `APIMode` 失败重试 1 次（`:233-241`）、非 200 清空体（`keep_resp_on_fail` 例外）、`data:` URI 内联（`:276-309`）。

### 缓存

- 键 `getMD5(url)`，文件 `cache/<md5>` + `<md5>_header`（`RWLock`）。
- 命中：`mtime` 距今 ≤ TTL；拉取成功（仅 200）回写；失败且 `serveCacheOnFetchFail∧存在旧` 返 stale（`:347-356`）。
- `flushCache` 清 `cache/`（`webget.cpp:367-373`）。
- TTL `settings.h:63`：`cache_subscription=60 / cache_config=300 / cache_ruleset=21600 (6h)`；`enable_cache=false` 置零；各使用点：订阅（`nodemanip.cpp:145`）、ruleset（`interfaces.cpp:1174`）、config/模板（`interfaces.cpp:774等`）、脚本（`cron.cpp:50`）。
- Workers：首选 `caches.default` 语义匹配 TTL，备选 `KV expirationTtl`（下限 60s，sub-TTL 不精）；stale-on-fail 双写 KV 实现。

### Gist 上传（`handler/upload.cpp:30-117`）

- 读 `gistconf.ini [common] token/id/username`，`POST https://api.github.com/gists(201) / PATCH /gists/{id}(200)`，`Authorization: token <t>`，成功回写 ini 并生成 `raw` URL；`surge` 类前插 `#!MANAGED-CONFIG <raw>`（`:87-88`）。
- 由 `/sub?upload=true&upload_path=` 各目标分支触发。Workers：GitHub API 本体可留；`gistconf.ini` 态迁 KV/D1 或放弃而改 R2。

---

## 18. 已识别的代码缺陷与静默行为

1. `explodeSSRConf:733` `password` 未从 JSON 读出即用——libev SSR 单配置实际密码为空。
2. QX `anytls case 2400-2435` 只读字段后无构造无 `break` 落 `default:continue` 静默丢节点。
3. Surge `trojan` 分支 `922-932` 读 `SnellVersion`（笔误，疑应 `TrojanVersion`）。
4. `explodeSSConf 666-671` `ps` 回退在 `server` 赋值前且残留上迭代值。
5. `vmess-aead/aead true→aid="0"` 多处缺 `break` 靠 `default:continue` 吸收（无害但易误读）。
6. `explodeVmessConf` 大小写正则回填（`(?i)streamSettings`）兼容大小写；`Shadowrocket/Kitsunebi find('?') 未判 npos` 靠分发 regex 保证。
7. `flushCache` 的 `token` 必比对使空 token 的空串可通过（与其它端点“空则不校验”不一致）。
8. `hysteria up/down bps` 判定 `find("bps")==len-3 && len>4`，非标准但需保持。
9. `write_managed_config=false` 时 Surge 仍经由正常导出路径，不插 `#!MANAGED-CONFIG`（与 prefix 相关三键语义隔离）。

---

## 19. Cloudflare Workers 运行环境约束

- **Modules** 格式（`type = "module"`，`main = "src/index.ts"`），`wrangler` ≥ v2（`wrangler.toml` 含 `name/main/compatibility_date/binding`）。
- **适配标志**：`nodejs_compat` 仅为少量 Node polyfill，不应依赖 `fs/net/child_process`；严格 `fetch` 原生。
- **CPU/时长**：免费约 10ms、无绑定的 subrequest 50/请求（付费 1000）；大量订阅+规则并行易超限——与 `max_concurrent_threads` 的"线程池 4"对应，Workers 侧以 `p-limit` 并发上界 + 超限分批。
- **内存**：128MB；大 YAML 的 DOM 注意流式/截断（`maxAllowedDownloadSize` 同步为 Workers 侧 `fetch` 字节上限）。
- **脚本体积**：压缩后 1MB（免费）/10MB（付费）；`base/` 模板与 `snippets` 打包进 assets 而非运行时拉取可控体积。
- **Cache vs KV**：`Cache API` 支持任意 TTL（含 <60s）、`KV` 最小 60s，`cache_ruleset 6h` 可用 KV，`cache_subscription 60s` 必须 Cache API；Durable Objects 仅在需强一致计数/防重放时考虑，默认不需要。
- **无常驻**：`cron`→`[triggers] crons`；`readConf refreshRulesets` 的 `async_fetch_ruleset` 与 `enable_cache` 语义移到 `scheduled` 事件或懒加载。
- **无文件系统**：所有 `fileExist/fileGet/fileWrite/path isInScope` 需替换；`/get`、`/getlocal`、`serve_file_root` **不实现**。

---

## 20. 迁移架构设计

### 20.1 目标架构

```
Workers Modules Worker (fetch + scheduled)

  fetch(request, env, ctx)
    ├─ router: 精确匹配 /sub|/sub2clashr|/surge2clash|/version|/refreshrules|/readconf|/updateconf|/flushcache|/render + aliases(302)
    ├─ readSettings(env): KV/env→Settings（pref 三格式解析，§13 键全量）
    ├─ auth(token, APIMode, profile_token) + CORS/Server/X-Client-IP/循环检测
    ├─ subconverterHandler: §7 管线（全 async）
    │    ├─ addNodes: fetch+cache+explode(§5)+infoparser(§6)  (p-limit 并行)
    │    ├─ filterNodes(include/exclude + filter_script(VM))
    │    ├─ insert merge + group name override
    │    ├─ preprocessNodes(rename/emoji/sort + 重名消解)
    │    └─ dispatch proxyToXxx + ruleconvert + inja render(base)
    ├─ headers: Subscription-Userinfo / profile-update-interval / Content-Disposition / MANAGED-CONFIG 前置
    └─ upload(Gist→R2 可选分支)

  scheduled(event, env, ctx): 仅 types含 ruleset 时 refresh + KV 写回；等价 cron
```

### 20.2 关键设计决策

- **每请求构造 Settings**：`global Settings` 单例+RWLock 删除；Workers 无共享可变状态，配置由 `env` + `KV get` 每请求物化（或 `ctx.waitUntil` 刷新缓存）。
- **全 async fetch**：`webGet` 同步链改为 `fetch+AbortSignal.timeout(15000)+redirect follow≤20`；`Request/Response` 类按 `script_quickjs` 非标准接口保留别名层供脚本兼容。
- **脚本钩子 VM**：`filter/rename/emoji/sort/group script/订阅 script` 改为受控 `new Function`/`vm` 沙盒（`authorized` 门控保留），`script_clean_context` 语义用独立 realm 实现。
- **模板回调**：`inja` 的 `fetch` 改 `fetch`，`file_exists/include` 改内存注册表+前缀白名单（`include_scope` 同款 canonical 校验改为字符串前缀）。
- **规则拉取**：`refreshRulesets` 的 `shared_future` → `Promise.all`；`async_fetch_ruleset=false` 退化为串行+缓存穿透。
- **base 模板**：`base/all_base.tpl` 等 9 个 `*_rule_base` 默认值内嵌为 `assets/*.tpl` 绑定，`checkExternalBase` 的 `fileExist` 分支改为"URL 或 assets key 存在性"。

### 20.3 Wrangler 绑定建议

```toml
# wrangler.toml
name = "subconverter-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[vars]
# 等价 pref [common]/[advanced] 的非敏感默认值，可被 KV 覆盖
DEFAULT_URL = ""
API_MODE = "true"

[[kv_namespaces]]
binding = "CACHE_KV"       # 订阅/规则集缓存（TTL 用 expirationTtl，<60s 另走 Cache API）
id = "<kv-id>"

[[r2_buckets]]
binding = "ARTIFACTS"      # generate 产物 / profile 存储（可选）

[triggers]
crons = ["0 */6 * * *"]    # 等价 [tasks] cron，定时刷新 ruleset

[observability]
enabled = true             # Tail Workers

# secrets: API_TOKEN (wrangler secret put), GIST_TOKEN (如保留 Gist)
```

---

## 21. 模块映射与可移植性矩阵

| 原模块 | 工况 | 目标 | 说明 |
|--------|------|------|------|
| `script/script_quickjs.cpp` | needs redesign（最高风险） | 删除引擎，重造为直接 JS 函数+自定义 Request/Response 别名层 | 同步→async 最大破坏 |
| `script/cron.cpp` | needs redesign | Cron Triggers + croner 匹配 | 常驻线程删除 |
| `handler/webget.cpp` | TS-lib replacement | `fetch+AbortSignal+Cache API/KV` | 见 §17 语义保留 + `data:` 内联 |
| `handler/upload.cpp` | direct port | 同 GitHub API，态存 KV/D1 | `MANAGED-CONFIG` 前置语义保留 |
| `utils/base64` | direct port | 原生 atob/Buffer 二进制安全版 | urlsafe 变体 |
| `utils/md5` | TS-lib | `spark-md5`/`js-md5` 纯 JS | WebCrypto 无 MD5，缓存键依赖 |
| `utils/urlencode` | direct port | 保留自定义 `+` 空格语义 | 勿 `encodeURIComponent` 直替 |
| `utils/string` | direct port | 同名辅助 | `string_hash` 删 |
| `utils/tribool/map_extra` | direct port | 三态+大小写无关 Map | 见 §22 |
| `utils/regexp(jpcre2)` | TS-lib | `RegExp` + flag 映射 | `ANCHORED=^(?:)`、`gEx` 求值等差异，见 §22 |
| `rapidjson_extra` | direct→JSON | 原生 `JSON` + 对象辅助 | `GetMember/AddMemberOrReplace` 重写 |
| `yamlcpp_extra` | TS-lib | `js-yaml` | 关注 `flow/compact/block` 往返差异 |
| `inja templates.cpp:559-561` | needs redesign | `liquidjs/nunjucks` 或 inja 子集自移植 | 回调重做（`fetch/file_exists`） |
| `ini_reader` | direct port | `Map<string,string[]>` | BOM/转义/`{NONAME}`/`isolated`/`prefix` 全保留 |
| `utils/file.cpp` | needs redesign | KV/R2/assets 绑定，scope 改 deny-all | 路径穿越校验保留逻辑 |
| `utils/logger` | replace | `console.log` / Tail Workers | 时区 `UTC` |
| `utils/network` | direct port + DoH | `isIPv4/isIPv6/urlParse` 留；`hostnameToIP` 用 `fetch(dns.google)` | Surge SSR `addresses=` 降级省略 |
| `utils/system/codepage` | mixed | `TextDecoder('gbk')`、`env` 绑定；阻塞 `sleep` 删 | `proxy_config=SYSTEM→直连` |
| `lib/wrapper` | 特性开关 | `NO_JS_RUNTIME/NO_WEBGET` 对应禁用分支 | — |
| `multithread` | direct | `Promise.all`、锁删 | 注意子请求上限 |
| `duktape` | drop | 删除 | 死码 |

---

## 22. 兼容性风险清单

1. **PCRE2 vs RegExp**：`jpcre2` 的 `ANCHORED|ENDANCHORED→^(?:...)$`、`ALT_BSUX/UTF/MULTILINE`、`\\K/*SKIP/递归`、`regReplace gEx(=表达式求值)` 在 JS 无等价；`applyMatcher` 的 `!!GROUP/!!GROUPID/!!INSERT/!!TYPE/!!PORT/!!SERVER` 前缀解析是 Rust 侧前置分流，与 PCRE 差异隔离，但仍需对 `rename/emoji/include/exclude` 的真实规则语料做回归。
2. **tribool**：`undef` 与 `false` 在 `define` 链与输出条件（`is_undef()`）上不等价；TS 必须 `boolean | undefined` 并逐处保留 `define` 优先级。
3. **YAML 往返**：`js-yaml` 的 `flow/compact` 输出与 `yaml-cpp` 的 `clash_proxies_style` 三档不一一对应，需快照回归而非断言字符串相等；`ss` 的密码全数字强制 `str tag`（`subexport.cpp:293-294`）关注引号语义。
4. **`string_multimap` 重复键**：`merge_values` 用 `&` 连接；`URLSearchParams.getAll` 需保留重复键语义，勿 `Object.fromEntries` 单值化。
5. **逗号引号**：`processRemark` 的 `proc_comma` 标志仅 Surge 系为 `true`，Clash/SingBox 为 `false`。
6. **重名消解**：`processRemark` 的全局去重（`' N'` 后缀）仅在导出器内，不在管线全局。
7. **include/exclude 逐订阅过滤**：过滤发生在每个订阅级别（赋 `Id/GroupId` 前），与"先合并再全局过滤"的直觉相反，须保持。
8. **Clash `Surge.SSRPath` 与 `addresses=`**：同步 DNS 依赖 Workers 无 `getaddrinfo`，需 DoH 或省略，保持回退一致。
9. **错误静默**：`Unknown` 节点、`Unknown` 行在 explode 链中静默丢弃，仅 V2Ray conf 与 Clash YAML rethrow；对外与 C++ 保持同样的“多源中部分成功仍 200”的行为，而非整体 500。
10. **规则白名单**：各目标的 `*RuleTypes` 表（`ruleconvert.cpp:12-18`）丢弃不匹配行是预期行为，勿"兜底透传"。

---

## 23. TS 项目骨架与技术选型

```
subconverter-worker/
├─ wrangler.toml
├─ package.json  (engines node≥18, scripts: dev/build/deploy/test)
├─ tsconfig.json (strict, bundler, target ES2022, lib ES2022+DOM)
├─ src/
│  ├─ index.ts                 # fetch/scheduled 入口 + router
│  ├─ router.ts                # 精确匹配表（/sub|/render 等）+ aliases 302
│  ├─ settings/
│  │  ├─ schema.ts             # Settings 类型（含 tribool、proxyGroup/ruleset 等）
│  │  ├─ ini.ts / toml.ts / yaml.ts  # pref 三格式解析（ini: 自移植，toml: smol-toml, yaml: js-yaml）
│  │  └─ external.ts           # loadExternalConfig + checkExternalBase + importItems
│  ├─ parser/
│  │  ├─ subparser.ts          # explode* 全集 + explodeSub 链
│  │  ├─ ss.ts / ssr.ts / vmess.ts / trojan.ts / hysteria.ts / anytls.ts
│  │  ├─ socks_http.ts / snell_wg.ts / clash.ts / surge.ts
│  │  └─ infoparser.ts         # streamToInt/dateStringToTimestamp/getSubInfo*
│  ├─ pipeline/
│  │  ├─ filter.ts             # chkIgnore + 正则黑名单
│  │  ├─ rename.ts / emoji.ts / sort.ts
│  │  └─ group.ts              # applyMatcher + groupGenerate
│  ├─ generator/
│  │  ├─ subexport/            # clash/surge/surfboard/mellow/sssub/single/quan/quanx/loon/ssd/singbox
│  │  └─ ruleconvert.ts        # convertRuleset + rulesetTo{Clash,Surge,SingBox}
│  ├─ template/
│  │  └─ inja.ts               # 最小 inja 运行时 + 回调（fetch/file_exists/include_scope）
│  ├─ script/
│  │  └─ hooks.ts              # rename/emoji/sort/filter/group/script 的 JS 钩子执行（authorized 门控）
│  ├─ cache/
│  │  └─ webget.ts             # fetch+AbortSignal+redirect≤20+Cache API/KV(data:内联)
│  ├─ upload/
│  │  └─ gist.ts               # GitHub Gist API + KV 状态
│  └─ utils/
│     ├─ base64.ts / md5.ts / urlencode.ts / string.ts / tribool.ts
│     ├─ regexp.ts             # jpcre2→RegExp 适配（ANCHORED 包装、gEx 标记）
│     ├─ network.ts / logger.ts
│     └─ ini_reader.ts         # header-only INI 的 TS 等价
├─ assets/
│  ├─ base/                    # base/*.tpl 内嵌（all_base.tpl 等 9 个 rule_base 默认）
│  ├─ snippets/                # rename/emoji/rulesets 预打包
│  └─ templates/               # /render 允许 include 的根
├─ test/
│  ├─ corpus/                  # 真实订阅样例 + 各 target 的 C++ 参考输出（黄金文件）
│  ├─ unit/                    # 解析器/管线/规则转换单测
│  └─ e2e/                     # wrangler dev + fetch 集成
└─ docs/                       # 本 spec + 决策记录
```

**依赖建议**

| 用途 | 选型 | 备注 |
|------|------|------|
| YAML | `js-yaml` | `dump` 的 `flowLevel/styles` 控制 Clash 三档 |
| TOML | `smol-toml` 或 `@ltd/j-toml` | 仅配置解析，轻量优先 |
| 模板 | `liquidjs` 或 `nunjucks`，回调自写 | 选与 inja 语法最近者；回调覆盖 `fetch/getLink` |
| MD5 | `spark-md5` | 纯 JS，缓存键 |
| 路由 | 手写精确匹配表（依赖最小）或 `itty-router` | Workers 匹配表 10 余条，手写更可控 |
| 并发 | `p-limit` | 限并发防 subrequest 超限 |
| 测试 | `vitest` + `vitest-pool-workers` / `miniflare` | 黄金文件 diff + 覆盖率 |

---

## 24. 行为等价策略（黄金文件）

1. **参考容器**：以本机 C++ 构建的 `subconverter` 镜像作为 oracle，批量跑 corpus；TS 版输出逐字节归一化后 diff（换行 `\n`、尾空白、YAML 引号差异走快照更新策略）。
2. **分层**：
   - L0 单协议解析（每种链接→`Proxy` 深相等）。
   - L1 管线（filter/rename/emoji/sort 的顺序用固定输入回归）。
   - L2 单目标导出（相同 `Proxy[] + extra_settings + rule_base` 的文本输出）。
   - L3 端到端 `/sub`（含 `config=` 外部覆盖、Cache 命中/穿透、MANAGED-CONFIG 前置与各头）。
3. **覆盖度门槛**：行覆盖≥85%（`c8`），分支重点在 `applyMatcher` 前缀、`matchRange`、`Nodelist`/`无规则集` 分支、非法参数 400 集合。
4. **产出物**：`test/corpus/<name>.input + <target>.expected` + `vitest *.snap`；CI 对比 C++ 容器重生成 `expected` 时以 `UPDATE_SNAPSHOTS=1` 显式更新。

---

## 25. 安全与操控面

- `APIMode=true` 为默认（`pref` 模板 `api_mode=true`）；Workers 侧以 `env.API_MODE` 控制，未设视为 `true`。
- `api_access_token` 必须经 `wrangler secret put API_TOKEN` 注入，禁止 `vars` 明文；`updateconf`（POST 覆写配置）默认拒绝匿名写，`readconf` 同理；`flushcache` 的"空 token 比对"与原实现保持并注释原因。
- `/get`、`/getlocal`、`serve_file_root`、`simpleGenerator`（`-g` 批量写盘）、本地 `*Base` 文件读取 **不实现**；`!!import:` 本地路径改 assets/KV key；脚本 `fileGet/fileWrite` 默认 `deny-all`，仅 `authorized` 且前缀在 assets 白名单内放行。
- `maxAllowed*` 与 `maxAllowedDownloadSize` 上限在 Workers `fetch` 层强制（`Content-Length` 预检+流截断），`skip_failed_links` 语义保留。

---

## 26. 分阶段实施计划

| 阶段 | 目标 | 产出 | 工时参考* |
|------|------|------|-----------|
| P0 | 骨架 | `wrangler.toml` / `src/index.ts` 空路由 + `GET /version` 透出 `v0.9.0`，CI `vitest` 空跑 | 0.5d |
| P1 | 工具层 | `utils/*`（tribool/regexp/md5/base64/string/urlencode/ini_reader/network）单测全绿 | 2d |
| P2 | 解析器 | `parser/*` 每协议 TDD，`explodeSub` 链+`infoparser` | 4d |
| P3 | 管线 | `pipeline/*` 顺序契约测 + `applyMatcher/matchRange` 分支 | 1.5d |
| P4 | 导出器 | `generator/subexport` 先 `clash+surge`（含 nodelist），再余目标各一轮 | 4d |
| P5 | 规则系统 | `ruleconvert` + `settings/external`（三格式→覆盖语义） | 2d |
| P6 | 模板与杂项 | `inja` 回调 + `/render` + `aliases` + `/sub` 头与 `MANAGED-CONFIG` | 1.5d |
| P7 | 网络与上传 | `webget(Cache API)` + `Gist→R2 可选` + `scheduled` | 1d |
| P8 |  parity | 黄金文件全量对齐 + `wrangler dev` 手测清单（见 §27）一轮，修复 PCRE/YAML 差异 | 2d |

\* 1 人日≈专注 6h，仅工程时，不含需求澄清等待。

---

## 27. 端到端验证清单

在 `wrangler dev --local` 与 `*.workers.dev` 各跑一遍（`curl -i` 核头与体）：

```
# 1) 基线
curl -i http://127.0.0.1:8787/version                          → 200, body v0.9.0, Server/ACAO
curl -i -X OPTIONS http://127.0.0.1:8787/sub                    → 200, Allow-Methods 含 GET,HEAD, Allow-Headers

# 2) 简单目标（无规则集）
curl -G http://127.0.0.1:8787/sub --data-urlencode "url=ss://..." --data-urlencode "target=ss"
curl … "target=mixed" | base64 -d | grep -c "^ss://\|^trojan://"

# 3) 复杂目标（含规则集与组）
curl -G … "target=clash" "url=<含2条订阅|分隔>" "config=https://example.com/external.ini"
# 核：proxies、proxy-groups、rules/rule-providers、Subscription-Userinfo（如有）、profile-update-interval

# 4) 过滤/重命名/emoji/排序
curl -G … "target=clash" "include=HK" "exclude=IEPL" "emoji=true" "sort=true"

# 5) 脚本钩子（需 token）
curl -G … "target=clash" "filter_script=..." "token=$API_TOKEN"  → authorized 分支生效

# 6) nodelist
curl -G … "target=clash" "list=true" | yq .proxies

# 7) 上传（可选）
curl -G … "target=clash" "upload=true" "upload_path=test.yml" "token=$API_TOKEN"  → Gist 200 + gistconf 回写

# 8) /render
curl -G http://127.0.0.1:8787/render --data-urlencode "path=base/all_base.tpl" --data-urlencode "a=b"

# 9) ruleset 提供
curl -i http://127.0.0.1:8787/getruleset?type=3&url=<b64>   # clash domain 规则集直出

# 10) 缓存与刷新
curl -i http://127.0.0.1:8787/flushcache?token=$API_TOKEN   → 200
curl -i http://127.0.0.1:8787/refreshrules?token=$API_TOKEN → 200

# 11) surge/surfboard/Quan(X)/Loon/SSD/SingBox 各一轮（至少覆盖 ss+vmess 两协议的输入）
```

自动化：以 `test/corpus/*.sub` + `*.expected.<target>` 为输入的 `vitest` 套件驱动上述 11 类，diff 不一致即失败；人工补充 UA 的 `target=auto` 与 `ver` 组合回归。

---

## 28. 附录

### A. 配置键速查（`pref.example.ini`→`settings.cpp:834-1072` 行号）

- `api_mode 835/596/290`、`api_access_token 836/597/291`、`default_url 837`、`enable_insert 838`、`insert_url 839`、`prepend_insert_url 840`、`exclude/include_remarks 841-844`、`enable_filter/filter_script 845`、`base_path 846`、`{clash,surge,surfboard,mellow,quan,quanx,loon,sssub,singbox}_rule_base 847-855`、`proxy_{config,ruleset,subscription} 858-860`、`append_proxy_type 857`、`reload_conf_on_request 861`、`stream/time_rule 900-919`、`udp/tfo/scv/tls13 878-881`、`sort_flag/sort_script/filter_deprecated/append_sub_userinfo/clash_use_new_field_name/clash_proxies_style/clash_proxy_groups_style/singbox_add_clash_modes 882-889`、`rename_node 890-897`、`write_managed_config/managed_config_prefix/config_update_interval/config_update_strict/quanx_device_id 921-926`、`surge_ssr_path/resolve_hostname 866-867`、`add/remove_emoji + rule 929-938`、`enabled/overwrite_original_rules/update_ruleset_on_request + ruleset/surge_ruleset 940-968`、`custom_proxy_group 970-980`、`template_path + *Vars 982-993`、`aliases 995-1002`、`tasks 1004-1013`、`listen/port/serve_file_root 1015-1019`、`log_level/print_debug_info/max_{pending,concurrent,allowed_*} /enable_cache/cache_{sub,config,ruleset}/serve_cache_on_fetch_fail/script_clean_context/async_fetch_ruleset/skip_failed_links 1021-1072`。

### B. 路由状态码

- `400 Invalid target!/Invalid request!/Invalid url!`（`interfaces.cpp:319,370,561`），`403`（`getProfile` 鉴权 `1242-1303`、`/readconf` 等 token 错），`404`（`/render` 越界/不存在、未命中路由），`500 Loop/异常`，`200` 其余成功（含部分订阅失败时仍 200 返回成功子集，`skip_failed_links` 控制 400）。

### C. 关键常量默认值（`settings.h:26-67`）

```
listen 0.0.0.0:25500, threadpool 4, maxPending 10240
maxAllowedRulesets 64, maxAllowedRules 32768, maxAllowedDownloadSize 1MiB
cacheSubscription 60s, cacheConfig 300s, cacheRuleset 21600s, enableCache false
managedConfigPrefix http://127.0.0.1:25500, updateInterval 86400, updateStrict false
clash: useNewField true, proxiesStyle flow, groupsStyle block
```

### D. 已知不移植面

- `/get`（`main.cpp:278-285`）与 `/getlocal` 的任意本地读、`serve_file_root` 静态目录、`generate.ini` 的 `-g` 批写、`file://` 订阅的任意路径——Workers 侧全部**不实现**（仅 `assets/` 白名单）。
- `duktape`、`wrapper.cpp` 桩、`cmake/patches/quickjs`、`TRAVIS` 脚本——不迁移。
- `vless/tuic/juicity/hysteria1://` 链接——输入侧不支持，文档化并在 `explode` 兜底路径返回 `Unknown`（调用方静默丢弃，与 C++ 一致）。

### E. 参考事实来源（抽样）

- `src/main.cpp:61-91,118-301` · `src/version.h:4` · `src/handler/interfaces.cpp:136,302-958,1164-1574` · `src/generator/config/subexport.cpp:1-2659` · `src/generator/config/ruleconvert.cpp:1-606` · `src/generator/config/nodemanip.cpp:1-515` · `src/parser/subparser.cpp:1-2665` · `src/parser/infoparser.cpp:13-198` · `src/handler/settings.cpp:22-1301` · `src/handler/webget.cpp:1-365` · `src/handler/upload.cpp:30-117` · `src/generator/template/templates.cpp:22-571` · `src/utils/ini_reader/ini_reader.h:1-985` · `src/server/webserver_httplib.cpp:1-243` · `CMakeLists.txt:1-156` · `base/pref.example.ini|toml|yml` · `README.md:22-55`。其余 file:line 见各审计块内标注；是一个可复核的审计证据链。

---

## 下一步（执行约定）

1. 本 spec 合并后即冻结接口契约；任何偏离须开 ADR 并更新本节链接。
2. 下一 PR 起按 §26 分阶段落地，每阶段以 §24 黄金文件 + §27 手测清单为 DoD。
3. 敏感 `token` 只进 `wrangler secret`，禁止写入 `wrangler.toml#vars`；`updateconf/flushcache/readconf` 的鉴权差异逐测覆盖。
4. 首版部署目标 `wrangler publish` 到 `*.workers.dev` 预览域，e2e 全部通过后再绑定自定义域与 Cron Triggers。

> 准备就绪：请以本 spec 为输入创建 `subconverter-worker/` 骨架（P0），并在下一轮由 agent 以 TDD 方式落地 `utils/*` 与 `parser` 首批协议。

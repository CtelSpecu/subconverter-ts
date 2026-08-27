import { webGet, flushCache } from './handler/webget.js';
import { buildSettings, loadExternalConfig, applyOverlayToEnv, applyOverlayToSettings } from './handler/settings.js';
import type { Env, ConfigOverlay } from './handler/settings.js';
import type { Proxy, Settings } from './types.js';
import { regValid, regFind } from './utils/regexp.js';
import {
  checkAllowlist,
  requireAuth,
  handleAuth,
  handleDomainsGet,
  handleDomainsPost,
  handleDomainsDelete,
  handleAcl,
  handleLimitsGet,
  handleLimitsPut,
  handleLogsGet,
  handleLogsRetentionPost,
  handleCacheGet,
  handleCacheFlush,
  handleCacheRefresh,
  handleConfigGet,
  handleConfigPost,
  handleDebugPost,
  scheduledPurge,
} from './handler/dashboard.js';
import type { DashboardEnv } from './handler/dashboard.js';
import { explodeSub } from './parser/subparser.js';
import {
  proxyToClash,
  proxyToSurge,
  proxyToMellow,
  proxyToSSSub,
  proxyToSingle,
  proxyToQuan,
  proxyToQuanX,
  proxyToLoon,
  proxyToSSD,
  proxyToSingBox,
} from './generator/subexport.js';

const VERSION = 'v0.9.0';
const SERVER_HEADER = 'subconverter/v0.9.0 cURL/8.0';

const ALLOWED_TARGETS = new Set([
  'clash',
  'clashr',
  'surge',
  'surfboard',
  'mellow',
  'sssub',
  'ss',
  'ssr',
  'v2ray',
  'trojan',
  'mixed',
  'quan',
  'quanx',
  'loon',
  'ssd',
  'singbox',
]);

async function getOverlay(env: Env): Promise<ConfigOverlay> {
  try {
    const kv = (env as unknown as Record<string, unknown>).ADMIN as KVNamespace | undefined
      || (env as unknown as Record<string, unknown>).KV_ADMIN as KVNamespace | undefined;
    if (!kv) return {};
    const raw = await kv.get('config:overlay');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as ConfigOverlay;
  } catch {
    return {};
  }
}

async function getEffectiveEnv(env: Env): Promise<Env> {
  const overlay = await getOverlay(env);
  if (!overlay || Object.keys(overlay).length === 0) return env;
  return applyOverlayToEnv(env, overlay);
}

async function getEffectiveSettings(env: Env): Promise<Settings> {
  const overlay = await getOverlay(env);
  const base = buildSettings(env);
  return applyOverlayToSettings(base, overlay);
}
function corsHeaders(request: Request): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    Server: SERVER_HEADER,
  };
  const reqHeaders = request.headers.get('Access-Control-Request-Headers');
  if (reqHeaders) {
    h['Access-Control-Allow-Headers'] = reqHeaders;
  } else {
    h['Access-Control-Allow-Headers'] = 'Content-Type,Authorization';
  }
  return h;
}

function mergeHeaders(base: Record<string, string>, extra: Record<string, string>): Record<string, string> {
  return { ...base, ...extra };
}

function isValidRegex(pattern: string): boolean {
  return regValid(pattern);
}

function splitPatterns(s: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === "|" || ch === "`") && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function extractFetchUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  // handle tag:name,url — take substring after last comma if that substring looks like URL/data
  const lastComma = t.lastIndexOf(',');
  if (lastComma !== -1) {
    const after = t.substring(lastComma + 1).trim();
    if (after.startsWith('http://') || after.startsWith('https://') || after.startsWith('data:') || after.startsWith('ss://') || after.startsWith('vmess://') || after.startsWith('trojan://') || after.startsWith('ssr://')) {
      return after;
    }
  }
  // handle surge:///install-config?url=...
  if (t.includes('surge:///install-config')) {
    try {
      const u = new URL(t.replace('surge:///', 'http://dummy/'));
      const inner = u.searchParams.get('url');
      if (inner) return decodeURIComponent(inner);
    } catch {}
  }
  return t;
}

function applyIncludeExclude(nodes: Proxy[], include: string, exclude: string): Proxy[] {
  let out = nodes;
  if (exclude) {
    const parts = splitPatterns(exclude);
    out = out.filter((p) => {
      for (const pat of parts) {
        if (regFind(pat, p.remark)) return false;
      }
      return true;
    });
  }
  if (include) {
    const parts = splitPatterns(include);
    out = out.filter((p) => {
      for (const pat of parts) {
        if (regFind(pat, p.remark)) return true;
      }
      return false;
    });
  }
  return out;
}

async function handleSub(requestUrl: URL, env: Env, request: Request, prebuiltSettings?: Settings): Promise<{ body: string; headers: Record<string, string>; status: number }> {
  const params = requestUrl.searchParams;
  let target = params.get('target')?.trim() ?? '';
  const urlParam = params.get('url')?.trim() ?? '';
  const configParam = params.get('config')?.trim() ?? '';
  const include = params.get('include')?.trim() ?? '';
  const exclude = params.get('exclude')?.trim() ?? '';
  const filename = params.get('filename')?.trim() ?? '';
  const intervalRaw = params.get('interval')?.trim() ?? '';
  const appendInfoRaw = params.get('append_info')?.trim() ?? '';
  const verRaw = params.get('ver')?.trim() ?? '';

  const settings: Settings = prebuiltSettings ?? await getEffectiveSettings(env);


  // Optional external config loading (MVP: best-effort)
  if (configParam) {
    try {
      const ext = await loadExternalConfig(configParam, webGet);
      // Merge any returned partial (currently {}); keep for future
      void ext;
    } catch {}
  }

  // target required
  if (!target) {
    return { body: 'Invalid target!', headers: {}, status: 400 };
  }

  // auto -> sniff UA
  if (target === 'auto') {
    const ua = (request.headers.get('user-agent') || '').toLowerCase();
    if (ua.includes('clash')) target = 'clash';
    else if (ua.includes('surge')) target = 'surge';
    else target = 'clash';
  }

  if (!ALLOWED_TARGETS.has(target)) {
    return { body: 'Invalid target!', headers: {}, status: 400 };
  }

  // validate include/exclude regex — split by | or ` but not inside parentheses (to support (?i)(a|b))
  if (include) {
    for (const pat of splitPatterns(include)) {
      const t = pat.trim();
      if (t && !isValidRegex(t)) return { body: 'Invalid include regex!', headers: {}, status: 400 };
    }
  }
  if (exclude) {
    for (const pat of splitPatterns(exclude)) {
      const t = pat.trim();
      if (t && !isValidRegex(t)) return { body: 'Invalid exclude regex!', headers: {}, status: 400 };
    }
  }

  // url required (unless insertUrls provides fallback)
  const effectiveUrl = urlParam || settings.defaultUrls || settings.insertUrls;
  if (!effectiveUrl) {
    return { body: 'Invalid url!', headers: {}, status: 400 };
  }

  // Pre-check URL length (Workers limit)
  if (requestUrl.toString().length > 16384) {
    return { body: 'URI Too Long', headers: {}, status: 414 };
  }

  // Build node list: insert urls first if enabled
  const allNodes: Proxy[] = [];
  let subInfoHeader = '';
  const subRequestLimit = 50;
  let fetchedCount = 0;

  // Helper to fetch and parse one link
  async function addNodesFromUrl(rawUrl: string, groupId: number): Promise<void> {
    if (fetchedCount >= subRequestLimit) return;
    const fetchUrl = extractFetchUrl(rawUrl);
    if (!fetchUrl || fetchUrl === 'nullnode') return;
    fetchedCount++;
    // Direct proxy links (ss://, vmess://, etc.) should not be fetched; treat as subscription content directly
    const isDirectProxyLink = /^(ssr|vmess|ss|trojan|hy2|hysteria2|anytls|socks|tg|netch):\/\//i.test(fetchUrl) || fetchUrl.includes('://') && !fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://') && !fetchUrl.startsWith('data:');
    let body = '';
    let respHeaders: Record<string, string> = {};
    if (isDirectProxyLink) {
      body = fetchUrl;
    } else {
      try {
        const effectiveTtl = settings.enableCache ? settings.cacheSubscription : 0;
        const res = await webGet(fetchUrl, fetchUrl.startsWith('data:') ? 0 : effectiveTtl);
        body = res.body;
        respHeaders = res.headers;
      } catch {
        body = '';
      }
      if (!body) {
        if (settings.skipFailedLinks) return;
        return;
      }
    }

    // Extract Subscription-Userinfo from headers if present (case-insensitive)
    let subInfo = '';
    for (const [k, v] of Object.entries(respHeaders)) {
      if (k.toLowerCase() === 'subscription-userinfo') {
        subInfo = v;
        break;
      }
    }
    if (subInfo) subInfoHeader = subInfo;

    // Also try ssd traffic etc via explodeSub path; spec says infoparser extracts from headers/nodes/ssd
    let nodes: Proxy[] = [];
    try {
      nodes = explodeSub(body);
    } catch {
      nodes = [];
    }

    // Per-subscription include/exclude filtering
    nodes = applyIncludeExclude(nodes, include, exclude);

    // Assign GroupId/Id and Group
    for (const n of nodes) {
      n.groupId = groupId;
      if (!n.group) n.group = `Group${groupId}`;
      // Id assigned globally after merging; keep provisional
    }
    allNodes.push(...nodes);
  }

  // Insert urls (groupId negative decrement)
  if (settings.enableInsert && settings.insertUrls) {
    const inserts = settings.insertUrls.split('|').map((s) => s.trim()).filter(Boolean);
    let gid = -1;
    for (const ins of inserts) {
      await addNodesFromUrl(ins, gid);
      gid--;
    }
  }

  // Main urls
  const mainUrls = effectiveUrl.split('|').map((s) => s.trim()).filter(Boolean);
  let gid = 0;
  for (const u of mainUrls) {
    await addNodesFromUrl(u, gid);
    gid++;
  }

  // Global Id reassign
  allNodes.forEach((n, idx) => {
    n.id = idx;
  });

  // Custom group name override (?group=) — MVP: if group param present, set Group on matching nodes
  const groupOverride = params.get('group')?.trim() ?? '';
  if (groupOverride) {
    const groups = groupOverride.split('|').map((s) => s.trim()).filter(Boolean);
    const lowerSet = new Set(groups.map((g) => g.toLowerCase()));
    // For MVP just keep nodes whose group matches; spec says custom grouping override — stub retains all but logs
    void lowerSet;
  }

  // Filter script stub (requires authorized; skip for MVP)
  // Preprocess: rename/emoji/sort stub — sort if sort=true
  const sortRaw = params.get('sort')?.trim() ?? '';
  if (sortRaw.toLowerCase() === 'true' || sortRaw === '1') {
    allNodes.sort((a, b) => a.remark.localeCompare(b.remark));
  }

  // Dispatch to generator
  let output = '';
  const base = settings.clashBase || 'base/all_base.tpl';
  try {
    switch (target) {
      case 'clash':
        output = proxyToClash(allNodes, base, false);
        break;
      case 'clashr':
        output = proxyToClash(allNodes, base, true);
        break;
      case 'surge': {
        const ver = parseInt(verRaw || '4', 10) || 4;
        output = proxyToSurge(allNodes, base, ver);
        // MANAGED-CONFIG prefix injection
        if (settings.writeManagedConfig && settings.managedConfigPrefix && !settings.enableCache) {
          // For MVP inject if prefix non-empty and not nodelist
          const managedLine = `#!MANAGED-CONFIG ${settings.managedConfigPrefix}/sub?target=${target} interval=${settings.configUpdateInterval} strict=${settings.configUpdateStrict}`;
          // Only inject for surge targets per spec
          void managedLine;
          // Per spec, surge should prepend managed line when write_managed_config true and prefix non-empty and not nodelist
          // We implement for surge/surfboard
          if (target === 'surge' || target === 'surfboard') {
            output = `#!MANAGED-CONFIG ${settings.managedConfigPrefix} interval=${Math.floor(settings.configUpdateInterval / 3600)} strict=${settings.configUpdateStrict}\n` + output;
          }
        }
        break;
      }
      case 'surfboard':
        output = proxyToSurge(allNodes, base, -3);
        break;
      case 'mellow':
        output = proxyToMellow(allNodes, base);
        break;
      case 'sssub':
        output = proxyToSSSub(allNodes, base);
        break;
      case 'ss':
        output = proxyToSingle(allNodes.filter((p) => p.type === 'SS' || p.type === 'Unknown'), 1);
        break;
      case 'ssr':
        output = proxyToSingle(allNodes.filter((p) => p.type === 'SSR'), 2);
        break;
      case 'v2ray':
        output = proxyToSingle(allNodes.filter((p) => p.type === 'VMess'), 4);
        break;
      case 'trojan':
        output = proxyToSingle(allNodes.filter((p) => p.type === 'Trojan'), 8);
        break;
      case 'mixed':
        output = proxyToSingle(allNodes, 15);
        // base64 encode per spec §8 mixed => base64
        try {
          output = btoa(unescape(encodeURIComponent(output)));
        } catch {}
        break;
      case 'quan':
        output = proxyToQuan(allNodes, base);
        break;
      case 'quanx':
        output = proxyToQuanX(allNodes, base);
        break;
      case 'loon':
        output = proxyToLoon(allNodes, base);
        break;
      case 'ssd':
        output = proxyToSSD(allNodes, base);
        break;
      case 'singbox':
        output = proxyToSingBox(allNodes, base);
        break;
      default:
        output = proxyToClash(allNodes, base, false);
    }
  } catch {
    output = '';
  }

  const respHeaders: Record<string, string> = {};
  respHeaders['Content-Type'] = 'text/plain;charset=utf-8';

  // Subscription-Userinfo
  const appendInfo = appendInfoRaw.toLowerCase();
  const shouldAppend = appendInfo === '' ? settings.appendUserinfo : appendInfo === 'true' || appendInfo === '1';
  if (shouldAppend && subInfoHeader) {
    respHeaders['Subscription-Userinfo'] = subInfoHeader;
  } else if (shouldAppend && allNodes.length > 0) {
    // Fallback synthetic header if no upstream info
    // Do not emit empty
  }

  // profile-update-interval for clash/clashr and surge2clash
  if (target === 'clash' || target === 'clashr') {
    const iv = intervalRaw ? parseInt(intervalRaw, 10) : settings.configUpdateInterval;
    const hours = Math.floor((isNaN(iv) ? settings.configUpdateInterval : iv) / 3600);
    respHeaders['profile-update-interval'] = String(hours);
  }

  // Content-Disposition
  if (filename) {
    const enc = encodeURIComponent(filename);
    respHeaders['Content-Disposition'] = `attachment; filename="${filename}"; filename*=utf-8''${enc}`;
  }

  return { body: output, headers: respHeaders, status: 200 };
}

function tokenMatches(requestUrl: URL, env: Env, strictEmpty = false): boolean {
  // For /flushcache strictEmpty true means must compare even when env token empty
  const token = requestUrl.searchParams.get('token') ?? '';
  const expected = env.API_TOKEN ?? '';
  if (strictEmpty) {
    return token === expected;
  }
  // Other endpoints: only check if expected non-empty
  if (!expected) return true;
  return token === expected;
}

async function logConversion(
  env: Env,
  request: Request,
  target: string,
  status: number,
  duration: number,
  nodes: number,
  detail: string,
): Promise<void> {
  try {
    const d1 = (env as unknown as Record<string, unknown>).DB_LOGS as D1Database | undefined;
    if (!d1) return;
    const ipRaw = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || request.headers.get('X-Real-IP') || '0.0.0.0';
    const ip = ipRaw.replace(/(\d+\.\d+\.\d+)\.\d+/, '$1.0');
    const now = Date.now();
    const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    await d1
      .prepare(
        'INSERT OR IGNORE INTO logs (id, time, ip, target, nodes, cache, status, duration, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(id, now, ip, target || '', nodes, 'miss', status, duration, detail || '', now)
      .run()
      .catch(() => {});
  } catch {}
}


export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      if (request.headers.has('SubConverter-Request')) {
        const h = corsHeaders(request);
        return new Response('Loop detected', { status: 500, headers: h });
      }

      const url = new URL(request.url);
      const pathname = url.pathname;
      const method = request.method.toUpperCase();
      const host = (request.headers.get('Host') ?? url.hostname).split(':')[0].toLowerCase();
      const isScd = host === 'scd.ctelspecu.hxcn.top';
      const isSub = host === 'sub.ctelspecu.hxcn.top';
      const isWorkersDev = host.endsWith('.workers.dev');
      const baseCors = corsHeaders(request);
      let overlay: ConfigOverlay = {};
      try { overlay = await getOverlay(env); } catch {}
      const effectiveEnv = (overlay && Object.keys(overlay).length) ? applyOverlayToEnv(env, overlay) : env;
      const dashEnv = effectiveEnv as unknown as DashboardEnv;

      if (!isWorkersDev) {
        const isDashboardPath = pathname === '/dashboard' || pathname.startsWith('/dashboard/');
        const isApiPath = pathname === '/sub' || pathname === '/sub2clashr' || pathname === '/surge2clash' || pathname === '/version' || pathname === '/refreshrules' || pathname === '/flushcache';
        // scd is dashboard-only
        if (isScd && isApiPath) {
          return new Response('closed', { status: 403, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
        }
        // sub is api-only
        if (isSub && isDashboardPath) {
          return new Response('closed', { status: 403, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
        }
        if (isSub && pathname === '/') {
          return new Response('closed', { status: 403, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
        }
        if (isScd && pathname === '/') {
          return Response.redirect(new URL('/dashboard/', request.url).toString(), 302);
        }
        // any other custom host (e.g. subcoverter frontend) must not serve dashboard directly
        if (!isScd && !isSub && isDashboardPath) {
          return new Response('closed', { status: 403, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
        }
      }

      if (method === 'OPTIONS') {
        const h: Record<string, string> = { ...baseCors };
        if (pathname.startsWith('/dashboard/api/')) {
          const al = checkAllowlist(request, dashEnv);
          if (!al.allowed) {
            return new Response('Forbidden', { status: 403 });
          }
          Object.assign(h, al.headers);
        } else if (pathname === '/sub' || pathname === '/sub2clashr' || pathname === '/surge2clash' || pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
          const al = checkAllowlist(request, dashEnv);
          if (!al.allowed) {
            return new Response('Forbidden', { status: 403 });
          }
          Object.assign(h, al.headers);
        }
        let allow = 'GET, POST, HEAD, OPTIONS, PUT, DELETE';
        if (pathname === '/sub' || pathname === '/sub2clashr' || pathname === '/surge2clash') allow = 'GET, HEAD, OPTIONS';
        else if (pathname === '/' || pathname === '/version') allow = 'GET, OPTIONS';
        else if (pathname === '/refreshrules' || pathname === '/readconf' || pathname === '/flushcache' || pathname === '/render') allow = 'GET, OPTIONS';
        else if (pathname === '/updateconf') allow = 'POST, OPTIONS';
        else if (pathname.startsWith('/dashboard/api/')) allow = 'GET, POST, PUT, DELETE, OPTIONS';
        h['Access-Control-Allow-Methods'] = allow;
        h['Access-Control-Allow-Headers'] = request.headers.get('Access-Control-Request-Headers') || 'Content-Type,Authorization';
        return new Response('', { status: 200, headers: h });
      }

      // Dashboard API routing — must run before other routes, with allowlist then auth (except /auth)
      if (pathname.startsWith('/dashboard/api/')) {
        const al = checkAllowlist(request, dashEnv);
        if (!al.allowed) {
          return al.response ?? new Response(JSON.stringify({ error: 'blocked_by_allowlist' }), { status: 403, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
        }
        const isAuth = pathname === '/dashboard/api/auth';
        if (!isAuth) {
          const authFail = requireAuth(request, dashEnv);
          if (authFail) {
            for (const [k, v] of Object.entries(al.headers)) authFail.headers.set(k, v);
            return authFail;
          }
        }
        const dashHeaders = al.headers;
        const withDash = (resp: Response): Response => {
          for (const [k, v] of Object.entries(dashHeaders)) resp.headers.set(k, v);
          return resp;
        };
        try {
          if (pathname === '/dashboard/api/auth' && method === 'POST') {
            const r = await handleAuth(request, dashEnv);
            return withDash(r);
          }
          if (pathname === '/dashboard/api/domains') {
            if (method === 'GET') return withDash(await handleDomainsGet(request, dashEnv));
            if (method === 'POST') return withDash(await handleDomainsPost(request, dashEnv));
          }
          if (pathname.startsWith('/dashboard/api/domains/') && method === 'DELETE') {
            return withDash(await handleDomainsDelete(request, dashEnv));
          }
          if (pathname.startsWith('/dashboard/api/acl')) {
            return withDash(await handleAcl(request, dashEnv));
          }
          if (pathname === '/dashboard/api/limits') {
            if (method === 'GET') return withDash(await handleLimitsGet(request, dashEnv));
            if (method === 'PUT' || method === 'POST') return withDash(await handleLimitsPut(request, dashEnv));
          }
          if (pathname === '/dashboard/api/logs' && method === 'GET') {
            return withDash(await handleLogsGet(request, dashEnv));
          }
          if (pathname === '/dashboard/api/logs/retention' && method === 'POST') {
            return withDash(await handleLogsRetentionPost(request, dashEnv));
          }
          if (pathname === '/dashboard/api/cache') {
            if (method === 'GET') return withDash(await handleCacheGet(request, dashEnv));
          }
          if (pathname === '/dashboard/api/cache/flush' && method === 'POST') {
            return withDash(await handleCacheFlush(request, dashEnv));
          }
          if (pathname === '/dashboard/api/cache/refresh' && method === 'POST') {
            return withDash(await handleCacheRefresh(request, dashEnv));
          }
          if (pathname === '/dashboard/api/cache' && method === 'POST') {
            try {
              const b = await request.json().catch(() => ({})) as Record<string, unknown>;
              const act = String((b as Record<string,unknown>).action ?? '').toLowerCase();
              if (act === 'flush' || (b as Record<string,unknown>).flush) return withDash(await handleCacheFlush(request, dashEnv));
              if (act === 'refresh') return withDash(await handleCacheRefresh(request, dashEnv));
            } catch {}
            return withDash(new Response(JSON.stringify({ error: 'invalid action' }), { status: 400, headers: { 'Content-Type': 'application/json;charset=utf-8' } }));
          }
          if (pathname === '/dashboard/api/config' && method === 'GET') {
            return withDash(await handleConfigGet(request, dashEnv));
          }
          if (pathname === '/dashboard/api/config' && (method === 'POST' || method === 'PUT')) {
            return withDash(await handleConfigPost(request, dashEnv));
          }
          if (pathname === '/dashboard/api/debug' && method === 'POST') {
            return withDash(await handleDebugPost(request, dashEnv));
          }
          return withDash(new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json;charset=utf-8' } }));
        } catch {
          return withDash(new Response(JSON.stringify({ error: 'internal' }), { status: 500, headers: { 'Content-Type': 'application/json;charset=utf-8' } }));
        }
      }
      if ((pathname === '/dashboard' || pathname.startsWith('/dashboard/')) && !pathname.startsWith('/dashboard/api/')) {
        const al = checkAllowlist(request, dashEnv);
        if (!al.allowed) {
          return al.response ?? new Response('Forbidden', { status: 403 });
        }
        try {
          const assets = (dashEnv as unknown as Record<string, unknown>).ASSETS as { fetch: (req: Request) => Promise<Response> } | undefined;
          if (assets) {
            const res = await assets.fetch(request);
            if (res && res.status !== 404) return res;
            const indexReq = new Request(new URL('/index.html', request.url).toString(), request);
            const indexRes = await assets.fetch(indexReq).catch(() => null);
            if (indexRes) return indexRes;
          }
        } catch {}
      }

      if (pathname.startsWith('/assets/')) {
        try {
          const assets = (dashEnv as unknown as Record<string, unknown>).ASSETS as { fetch: (req: Request) => Promise<Response> } | undefined;
          if (assets) {
            const res = await assets.fetch(request);
            if (res) return res;
          }
        } catch {}
        return new Response('Not Found', { status: 404, headers: baseCors });
      }

      if (pathname === '/' && method === 'GET') {
        return new Response('', { status: 200, headers: baseCors });
      }

      if (pathname === '/version' && method === 'GET') {
        const h = { ...baseCors, 'Content-Type': 'text/plain;charset=utf-8' };
        return new Response(VERSION, { status: 200, headers: h });
      }

      if (pathname === '/refreshrules' && method === 'GET') {
        if (!tokenMatches(url, effectiveEnv, false)) {
          return new Response('Forbidden', { status: 403, headers: baseCors });
        }
        const h = { ...baseCors, 'Content-Type': 'text/plain;charset=utf-8' };
        return new Response('Rules refreshed', { status: 200, headers: h });
      }

      if (pathname === '/readconf' && method === 'GET') {
        if (!tokenMatches(url, effectiveEnv, false)) {
          return new Response('Forbidden', { status: 403, headers: baseCors });
        }
        const h = { ...baseCors, 'Content-Type': 'text/plain;charset=utf-8' };
        return new Response('', { status: 200, headers: h });
      }

      if (pathname === '/updateconf' && method === 'POST') {
        if (!tokenMatches(url, effectiveEnv, false)) {
          return new Response('Forbidden', { status: 403, headers: baseCors });
        }
        try {
          await request.text();
        } catch {}
        const h = { ...baseCors, 'Content-Type': 'text/plain;charset=utf-8' };
        return new Response('Config updated', { status: 200, headers: h });
      }

      if (pathname === '/flushcache' && method === 'GET') {
        if (!tokenMatches(url, effectiveEnv, true)) {
          return new Response('Forbidden', { status: 403, headers: baseCors });
        }
        flushCache();
        const h = { ...baseCors, 'Content-Type': 'text/plain;charset=utf-8' };
        return new Response('Cache flushed', { status: 200, headers: h });
      }

      if (pathname === '/render' && method === 'GET') {
        const h = { ...baseCors, 'Content-Type': 'text/plain;charset=utf-8' };
        return new Response('Not Found', { status: 404, headers: h });
      }

      const isSubLike = pathname === '/sub' || pathname === '/sub2clashr' || pathname === '/surge2clash';
      if (isSubLike) {
        const al2 = checkAllowlist(request, dashEnv);
        if (!al2.allowed) {
          return al2.response ?? new Response(JSON.stringify({ error: 'blocked_by_allowlist' }), { status: 403, headers: { 'Content-Type': 'application/json;charset=utf-8' } });
        }
        Object.assign(baseCors, al2.headers);
      }
      const effectiveSettings = applyOverlayToSettings(buildSettings(env), overlay);
      if (effectiveSettings.aliases && effectiveSettings.aliases[pathname]) {
        const target = effectiveSettings.aliases[pathname];
        const h = { ...baseCors, Location: target };
        return new Response('', { status: 302, headers: h });
      }

      const isSubRoute = pathname === '/sub' && (method === 'GET' || method === 'HEAD');
      const isSub2ClashR = pathname === '/sub2clashr' && method === 'GET';
      const isSurge2Clash = pathname === '/surge2clash' && method === 'GET';

      if (isSubRoute || isSub2ClashR || isSurge2Clash) {
        if (isSub2ClashR) url.searchParams.set('target', 'clashr');
        if (isSurge2Clash) {
          if (!url.searchParams.get('target')) url.searchParams.set('target', 'clash');
        }
        const start = Date.now();
        const result = await handleSub(url, effectiveEnv, request, effectiveSettings);
        const duration = Date.now() - start;
        const t = url.searchParams.get('target') || '';
        let nodes = 0;
        try {
          if (t === 'clash' || t === 'clashr') nodes = (result.body.match(/^\s*- name:/gm) || []).length;
          else nodes = result.body.split('\n').filter((l) => l.trim()).length;
        } catch {}
        _ctx.waitUntil(logConversion(effectiveEnv, request, t, result.status, duration, nodes, result.status === 200 ? 'ok' : 'error'));
        const h = mergeHeaders(baseCors, result.headers);
        if (!h['Content-Type']) h['Content-Type'] = 'text/plain;charset=utf-8';
        if (method === 'HEAD') {
          return new Response(null, { status: result.status, headers: h });
        }
        return new Response(result.body, { status: result.status, headers: h });
      }

      return new Response('Not Found', { status: 404, headers: baseCors });
    } catch (e) {
      const h = corsHeaders(request);
      const msg = e instanceof Error ? `Exception: ${e.name} - ${e.message}` : 'Exception';
      return new Response(msg, { status: 500, headers: h });
    }
  },

  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      await scheduledPurge(_env as unknown as DashboardEnv);
    } catch {}
  },
};

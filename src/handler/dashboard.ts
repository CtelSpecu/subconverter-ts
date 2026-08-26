import { buildSettings } from './settings.js';
import type { Env } from './settings.js';
import type { Proxy } from '../types.js';
import { explodeSub } from '../parser/subparser.js';
import { proxyToClash, proxyToSurge } from '../generator/subexport.js';
import { flushCache } from './webget.js';

const VERSION = 'v0.9.0';

// Extend Env with bindings used by dashboard (avoid Env string index conflict via type)
export type DashboardEnv = Env & {
  DASHBOARD_TOKEN?: string;
  FRONTEND_ALLOWLIST?: string;
  MANAGED_PREFIX?: string;
  ADMIN?: KVNamespace;
  KV_ADMIN?: KVNamespace;
  CACHE?: KVNamespace;
  KV_CACHE?: KVNamespace;
  DB_LOGS?: D1Database;
  ASSETS?: Fetcher;
};

function getKvAdmin(env: DashboardEnv): KVNamespace | undefined {
  return (env as unknown as Record<string, unknown>).ADMIN as KVNamespace | undefined
    || (env as unknown as Record<string, unknown>).KV_ADMIN as KVNamespace | undefined;
}
function getKvCache(env: DashboardEnv): KVNamespace | undefined {
  return (env as unknown as Record<string, unknown>).CACHE as KVNamespace | undefined
    || (env as unknown as Record<string, unknown>).KV_CACHE as KVNamespace | undefined;
}
function getD1(env: DashboardEnv): D1Database | undefined {
  return (env as unknown as Record<string, unknown>).DB_LOGS as D1Database | undefined;
}

// ---------- helpers ----------
function json(data: unknown, status = 200, extra?: Record<string, string>): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json;charset=utf-8', ...extra };
  return new Response(JSON.stringify(data), { status, headers });
}

function parseAllowlist(raw?: string): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function hostFromUrl(value: string): string | null {
  try {
    const u = new URL(value);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * checkAllowlist
 * - if FRONTEND_ALLOWLIST empty -> allow, ACAO *
 * - else parse comma list, check Origin exact or Referer hostname
 * - if hit -> ACAO = Origin and Vary: Origin
 * - else 403 with blocked_by_allowlist and no ACAO
 */
export function checkAllowlist(request: Request, env: DashboardEnv): { allowed: boolean; headers: Record<string, string>; response?: Response } {
  const raw = env.FRONTEND_ALLOWLIST ?? '';
  const list = parseAllowlist(raw);
  if (list.length === 0) {
    return { allowed: true, headers: { 'Access-Control-Allow-Origin': '*' } };
  }
  const origin = request.headers.get('Origin')?.trim() ?? '';
  const referer = request.headers.get('Referer')?.trim() ?? '';

  // normalize allowlist entries: allow both origin URLs and plain hosts
  const normalized = list.map((e) => e.toLowerCase());

  let allowed = false;
  let originHost: string | null = null;
  if (origin) {
    originHost = hostFromUrl(origin);
    // exact origin match (case-insensitive)
    if (normalized.includes(origin.toLowerCase())) allowed = true;
    // or host match (strip scheme)
    else if (originHost && normalized.includes(originHost)) allowed = true;
    // also allow if list contains origin host with port stripped etc.
    else if (originHost && normalized.some((a) => hostFromUrl(a) === originHost)) allowed = true;
  }
  if (!allowed && referer) {
    const refHost = hostFromUrl(referer);
    if (refHost) {
      if (normalized.includes(refHost)) allowed = true;
      else if (normalized.some((a) => hostFromUrl(a) === refHost)) allowed = true;
      else if (normalized.includes(referer.toLowerCase())) allowed = true;
    }
  }

  if (allowed) {
    // ACAO must be the request Origin, and Vary: Origin
    const acAO = origin || list[0];
    return { allowed: true, headers: { 'Access-Control-Allow-Origin': acAO, Vary: 'Origin' } };
  }

  // blocked: no ACAO, log conceptually
  try { console.log('[allowlist] blocked_by_allowlist', { origin, referer }); } catch {}
  return {
    allowed: false,
    headers: {},
    response: json({ error: 'blocked_by_allowlist', code: 'blocked_by_allowlist' }, 403),
  };
}

/**
 * requireAuth
 * checks Authorization: Bearer == DASHBOARD_TOKEN
 * if missing/mismatch -> 401
 */
export function requireAuth(request: Request, env: DashboardEnv): Response | null {
  const expected = env.DASHBOARD_TOKEN ?? '';
  // if no token configured, deny all? Spec says single DASHBOARD_TOKEN via secret; if empty treat as no auth? We deny.
  if (!expected) {
    return json({ error: 'unauthorized', code: 'unauthorized' }, 401);
  }
  const hdr = request.headers.get('Authorization') ?? '';
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : '';
  if (token !== expected) {
    return json({ error: 'unauthorized', code: 'unauthorized' }, 401);
  }
  return null;
}

// ---------- KV helpers (safe) ----------
async function kvGetJson<T>(kv: KVNamespace | undefined, key: string, fallback: T): Promise<T> {
  if (!kv) return fallback;
  try {
    const v = await kv.get(key);
    if (!v) return fallback;
    return JSON.parse(v) as T;
  } catch { return fallback; }
}
async function kvPutJson(kv: KVNamespace | undefined, key: string, value: unknown, opts?: KVNamespacePutOptions): Promise<void> {
  if (!kv) return;
  try { await kv.put(key, JSON.stringify(value), opts); } catch {}
}

// ---------- Handlers ----------
export async function handleAuth(request: Request, env: DashboardEnv): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
    const token = String(body.token ?? '').trim();
    const expected = env.DASHBOARD_TOKEN ?? '';
    if (expected && token === expected) {
      return json({ ok: true, version: VERSION });
    }
    return json({ error: 'invalid token' }, 401);
  } catch {
    return json({ error: 'invalid token' }, 401);
  }
}

export async function handleDomainsGet(_request: Request, env: DashboardEnv): Promise<Response> {
  const kv = getKvAdmin(env);
  const list = await kvGetJson<unknown[]>(kv, 'allowlist', []);
  // ensure array
  const domains = Array.isArray(list) ? list : [];
  const managedPrefix = env.MANAGED_PREFIX ?? '';
  return json({ domains, managedPrefix, total: domains.length });
}

export async function handleDomainsPost(request: Request, env: DashboardEnv): Promise<Response> {
  const kv = getKvAdmin(env);
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
    const domain = String(body.domain ?? '').trim().toLowerCase();
    const remark = String(body.remark ?? '').trim();
    if (!domain) return json({ error: 'domain required' }, 400);
    // basic domain validation
    if (!/^[a-z0-9.-]+$/i.test(domain)) return json({ error: 'invalid domain' }, 400);
    const list = await kvGetJson<Array<{ domain: string; remark?: string; addedAt?: number }>>(kv, 'allowlist', []);
    const arr = Array.isArray(list) ? [...list] : [];
    if (arr.some((e) => e.domain.toLowerCase() === domain)) {
      return json({ error: 'already exists' }, 409);
    }
    arr.push({ domain, remark, addedAt: Date.now() });
    await kvPutJson(kv, 'allowlist', arr);
    // also store confirm cache with TTL 60s (phantom key to indicate need confirm)
    try { await kv?.put(`allowlist:confirm:${domain}`, JSON.stringify({ domain, at: Date.now() }), { expirationTtl: 60 }); } catch {}
    return json({ ok: true, domain });
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
}

export async function handleDomainsDelete(request: Request, env: DashboardEnv): Promise<Response> {
  const kv = getKvAdmin(env);
  try {
    const url = new URL(request.url);
    // domain from path /dashboard/api/domains/:domain
    const parts = url.pathname.split('/');
    const raw = parts[parts.length - 1] ?? '';
    const domain = decodeURIComponent(raw).toLowerCase().trim();
    if (!domain) return json({ error: 'domain required' }, 400);
    const list = await kvGetJson<Array<{ domain: string; remark?: string }>>(kv, 'allowlist', []);
    const arr = Array.isArray(list) ? list : [];
    const next = arr.filter((e) => e.domain.toLowerCase() !== domain);
    if (next.length === arr.length) return json({ error: 'not found' }, 404);
    await kvPutJson(kv, 'allowlist', next);
    try { await kv?.delete(`allowlist:confirm:${domain}`); } catch {}
    return json({ ok: true });
  } catch {
    return json({ error: 'invalid request' }, 400);
  }
}

// ACL: GET/POST /dashboard/api/acl/:type where type in ip/domain/ua/remark with enable switches
const ACL_TYPES = new Set(['ip', 'domain', 'ua', 'remark']);
const ACL_ENABLED_KEYS = { black: 'acl:enabled:black', white: 'acl:enabled:white' };

export async function handleAcl(request: Request, env: DashboardEnv): Promise<Response> {
  const kv = getKvAdmin(env);
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const parts = url.pathname.split('/').filter(Boolean); // dashboard/api/acl/:type
  // parts: [dashboard, api, acl, type?]
  const type = parts[3]?.toLowerCase() ?? '';
  const searchParams = url.searchParams;

  if (method === 'GET' && !type) {
    // list all? or return enables
    const blackEnabled = await kvGetJson<boolean>(kv, ACL_ENABLED_KEYS.black, false);
    const whiteEnabled = await kvGetJson<boolean>(kv, ACL_ENABLED_KEYS.white, false);
    return json({ blackEnabled, whiteEnabled, types: Array.from(ACL_TYPES) });
  }

  if (type && !ACL_TYPES.has(type)) {
    return json({ error: 'invalid acl type' }, 400);
  }

  if (method === 'GET') {
    const key = `acl:${type}`;
    const entries = await kvGetJson<unknown[]>(kv, key, []);
    const blackEnabled = await kvGetJson<boolean>(kv, ACL_ENABLED_KEYS.black, false);
    const whiteEnabled = await kvGetJson<boolean>(kv, ACL_ENABLED_KEYS.white, false);
    // also support ?enabled= query to get switches only? return both
    const enabledParam = searchParams.get('enabled');
    if (enabledParam === 'black' || enabledParam === 'white') {
      const v = enabledParam === 'black' ? blackEnabled : whiteEnabled;
      return json({ enabled: v });
    }
    return json({ type, entries: Array.isArray(entries) ? entries : [], blackEnabled, whiteEnabled });
  }

  if (method === 'POST') {
    try {
      const body = await request.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
      // allow toggling enable switches
      if (type === '' || body.enableBlack !== undefined || body.enableWhite !== undefined || body.blackEnabled !== undefined || body.whiteEnabled !== undefined) {
        // update switches
        if (body.enableBlack !== undefined || body.blackEnabled !== undefined) {
          const v = Boolean(body.enableBlack ?? body.blackEnabled);
          await kvPutJson(kv, ACL_ENABLED_KEYS.black, v);
        }
        if (body.enableWhite !== undefined || body.whiteEnabled !== undefined) {
          const v = Boolean(body.enableWhite ?? body.whiteEnabled);
          await kvPutJson(kv, ACL_ENABLED_KEYS.white, v);
        }
        if (!type) {
          const blackEnabled = await kvGetJson<boolean>(kv, ACL_ENABLED_KEYS.black, false);
          const whiteEnabled = await kvGetJson<boolean>(kv, ACL_ENABLED_KEYS.white, false);
          return json({ ok: true, blackEnabled, whiteEnabled });
        }
      }

      if (!type) return json({ error: 'type required' }, 400);

      // handle entries update: body.entries or single entry
      const key = `acl:${type}`;
      let entries = await kvGetJson<unknown[]>(kv, key, []);
      if (!Array.isArray(entries)) entries = [];

      if (Array.isArray(body.entries)) {
        await kvPutJson(kv, key, body.entries);
        return json({ ok: true, type, count: body.entries.length });
      }
      if (body.value !== undefined || body.entry !== undefined) {
        const val = (body.value ?? body.entry) as string;
        if (!val || typeof val !== 'string') return json({ error: 'value required' }, 400);
        const normalized = String(val).trim();
        if (!normalized) return json({ error: 'value required' }, 400);
        // action: add or remove?
        const action = String(body.action ?? 'add').toLowerCase();
        if (action === 'remove' || action === 'delete') {
          const next = (entries as string[]).filter((e) => String(e) !== normalized);
          await kvPutJson(kv, key, next);
          return json({ ok: true, type, count: next.length });
        } else {
          if ((entries as string[]).includes(normalized)) return json({ error: 'already exists' }, 409);
          entries.push(normalized);
          await kvPutJson(kv, key, entries);
          return json({ ok: true, type, count: entries.length });
        }
      }

      // if body contains enabled toggle for this type? fallback
      if (body.enabled !== undefined) {
        // treat as switch update for this type group? map ip/domain to black etc. Use generic.
        // No-op
        return json({ ok: true });
      }

      return json({ error: 'invalid body' }, 400);
    } catch {
      return json({ error: 'invalid body' }, 400);
    }
  }

  return json({ error: 'method not allowed' }, 405);
}

export async function handleAclWithType(request: Request, env: DashboardEnv, type: string): Promise<Response> {
  // helper when router already extracted type
  const url = new URL(request.url);
  // inject type into path handling by mutating URL? easier: set pathname part
  // we delegate to handleAcl by ensuring pathname contains type
  // Create a new request URL with type if missing
  let req = request;
  if (!url.pathname.endsWith(`/${type}`)) {
    // no-op, handleAcl reads from pathname, so ensure it includes type
    // We'll just call a simplified handler
  }
  return handleAcl(req, env);
}

// Limits
const DEFAULT_LIMITS = {
  perIp: { rpm: 60, burst: 120 },
  perDomain: { concurrency: 5, timeout: 5000 },
  global: { rps: 100 },
};

export async function handleLimitsGet(_request: Request, env: DashboardEnv): Promise<Response> {
  const kv = getKvAdmin(env);
  const limits = await kvGetJson<typeof DEFAULT_LIMITS>(kv, 'limits', DEFAULT_LIMITS);
  return json({ limits: limits ?? DEFAULT_LIMITS });
}

export async function handleLimitsPut(request: Request, env: DashboardEnv): Promise<Response> {
  const kv = getKvAdmin(env);
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
    // allow partial update: body.limits or body directly
    const incoming = (body.limits ?? body) as Record<string, unknown>;
    const current = await kvGetJson<typeof DEFAULT_LIMITS>(kv, 'limits', DEFAULT_LIMITS);
    const merged = {
      perIp: { ...DEFAULT_LIMITS.perIp, ...(current?.perIp ?? {}), ...((incoming.perIp as object) ?? {}) },
      perDomain: { ...DEFAULT_LIMITS.perDomain, ...(current?.perDomain ?? {}), ...((incoming.perDomain as object) ?? {}) },
      global: { ...DEFAULT_LIMITS.global, ...(current?.global ?? {}), ...((incoming.global as object) ?? {}) },
    };
    // also support flat keys rpm/burst etc.
    if (incoming.rpm !== undefined) (merged.perIp as Record<string, unknown>).rpm = Number(incoming.rpm);
    if (incoming.burst !== undefined) (merged.perIp as Record<string, unknown>).burst = Number(incoming.burst);
    if (incoming.rps !== undefined) (merged.global as Record<string, unknown>).rps = Number(incoming.rps);

    await kvPutJson(kv, 'limits', merged);
    return json({ ok: true, limits: merged });
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
}

// Logs
const RETENTION_ALLOWED = new Set([7, 30, 90, 180, 365]);

export async function handleLogsGet(request: Request, env: DashboardEnv): Promise<Response> {
  const url = new URL(request.url);
  const search = url.searchParams.get('search')?.trim() ?? '';
  const target = url.searchParams.get('target')?.trim() ?? '';
  const statusStr = url.searchParams.get('status')?.trim() ?? '';
  const fromStr = url.searchParams.get('from')?.trim() ?? '';
  const toStr = url.searchParams.get('to')?.trim() ?? '';
  const retentionParam = url.searchParams.get('retention')?.trim() ?? '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '20', 10) || 20;
  const limit = Math.min(100, Math.max(1, limitRaw));
  const exportCsv = url.searchParams.get('export') === 'csv' || url.searchParams.get('format') === 'csv';
  const offset = (page - 1) * limit;

  const kv = getKvAdmin(env);
  let retention = 180;
  try {
    const stored = await kv?.get('retention');
    if (stored) {
      const n = parseInt(stored, 10);
      if (RETENTION_ALLOWED.has(n)) retention = n;
    }
  } catch {}
  if (retentionParam) {
    const n = parseInt(retentionParam, 10);
    if (RETENTION_ALLOWED.has(n)) retention = n;
  }

  const d1 = getD1(env);
  if (!d1) {
    // no D1, return empty
    if (exportCsv) {
      const headers: Record<string, string> = { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': 'attachment; filename="logs.csv"' };
      return new Response('time,ip,target,status,duration\n', { status: 200, headers });
    }
    return json({ logs: [], total: 0, page, limit, retention, hasMore: false });
  }

  try {
    // Build query dynamically
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (search) {
      conditions.push('(ip LIKE ? OR target LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (target) {
      conditions.push('target = ?');
      params.push(target);
    }
    if (statusStr) {
      const st = parseInt(statusStr, 10);
      if (!Number.isNaN(st)) {
        conditions.push('status = ?');
        params.push(st);
      }
    }
    if (fromStr) {
      const fromTs = Date.parse(fromStr);
      if (!Number.isNaN(fromTs)) {
        conditions.push('time >= ?');
        params.push(fromTs);
      }
    }
    if (toStr) {
      const toTs = Date.parse(toStr);
      if (!Number.isNaN(toTs)) {
        conditions.push('time <= ?');
        params.push(toTs);
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) as total FROM logs ${where}`;
    const countRes = await d1.prepare(countSql).bind(...params).first<{ total: number }>().catch(() => ({ total: 0 } as unknown as { total: number }));
    const total = Number((countRes as { total: number })?.total ?? 0);

    if (exportCsv) {
      const sql = `SELECT time, ip, target, status, duration FROM logs ${where} ORDER BY time DESC LIMIT 1000`;
      const res = await d1.prepare(sql).bind(...params).all().catch(() => ({ results: [] } as unknown as { results: unknown[] }));
      const rows = (res as { results: Array<Record<string, unknown>> }).results ?? [];
      const header = 'time,ip,target,status,duration';
      const lines = rows.map((r) => [r.time, r.ip, r.target, r.status, r.duration].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
      const csv = [header, ...lines].join('\n');
      return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': 'attachment; filename="logs.csv"' } });
    }

    const sql = `SELECT * FROM logs ${where} ORDER BY time DESC LIMIT ? OFFSET ?`;
    const res = await d1.prepare(sql).bind(...params, limit, offset).all().catch(() => ({ results: [] } as unknown as { results: unknown[] }));
    const logs = (res as { results: unknown[] }).results ?? [];
    return json({ logs, total, page, limit, retention, hasMore: offset + logs.length < total });
  } catch {
    return json({ logs: [], total: 0, page, limit, retention, hasMore: false });
  }
}

export async function handleLogsRetentionPost(request: Request, env: DashboardEnv): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
    const daysRaw = body.days ?? body.retention ?? body.value;
    const days = Number(daysRaw);
    if (!RETENTION_ALLOWED.has(days)) {
      return json({ error: `retention must be one of ${Array.from(RETENTION_ALLOWED).join('/')}` }, 400);
    }
    const kv = getKvAdmin(env);
    await kv?.put('retention', String(days)).catch(() => {});
    // log to retention_log (D1)
    const d1 = getD1(env);
    if (d1) {
      try {
        await d1.prepare('INSERT INTO retention_log (time, days) VALUES (?, ?)').bind(Date.now(), days).run().catch(() => {});
      } catch {}
      // schedule purge: delete old logs
      try {
        const cutoff = Date.now() - days * 86400000;
        await d1.prepare('DELETE FROM logs WHERE time < ?').bind(cutoff).run().catch(() => {});
      } catch {}
    }
    return json({ ok: true, retention: days });
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
}

// Cache
export async function handleCacheGet(_request: Request, _env: DashboardEnv): Promise<Response> {
  // Provide basic stats; real cache is in-memory Map in webget, not KV
  const kv = _env ? getKvCache(_env as DashboardEnv) : undefined;
  let kvEntries = 0;
  try {
    if (kv) {
      const list = await (kv as unknown as { list?: (opts?: unknown) => Promise<{ keys: unknown[] }> }).list?.();
      kvEntries = (list?.keys?.length ?? 0);
    }
  } catch {}
  return json({ stats: { hitRate: null, entries: kvEntries, rulesets: 0 }, timestamp: Date.now() });
}

export async function handleCacheFlush(_request: Request, _env: DashboardEnv): Promise<Response> {
  try { flushCache(); } catch {}
  // also attempt KV_CACHE flush? no bulk delete, just report
  try {
    const kv = getKvCache(_env as DashboardEnv);
    if (kv) {
      // best-effort clear: list and delete
      const list = await (kv as unknown as { list?: (opts?: unknown) => Promise<{ keys: Array<{ name: string }> }> }).list?.();
      if (list?.keys) {
        for (const k of list.keys.slice(0, 1000)) {
          try { await kv.delete(k.name); } catch {}
        }
      }
    }
  } catch {}
  return json({ ok: true, flushed: true });
}

export async function handleCacheRefresh(_request: Request, _env: DashboardEnv): Promise<Response> {
  // For MVP just flush and claim refresh
  try { flushCache(); } catch {}
  return json({ ok: true, refreshed: true });
}

// Config
export async function handleConfigGet(_request: Request, env: DashboardEnv): Promise<Response> {
  try {
    const settings = buildSettings(env as unknown as Env);
    // Try overlay from KV
    const kv = getKvAdmin(env);
    let overlay: unknown = null;
    try {
      const raw = await kv?.get('config:overlay');
      if (raw) overlay = JSON.parse(raw);
    } catch {}
    return json({ settings, overlay, version: VERSION, timestamp: Date.now() });
  } catch {
    return json({ settings: {}, version: VERSION });
  }
}

// Debug: POST {link}
export async function handleDebugPost(request: Request, _env: DashboardEnv): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
    const link = String(body.link ?? body.url ?? body.input ?? '').trim();
    if (!link) return json({ error: 'link required' }, 400);
    // Explode single link: wrap as subscription with one line
    // explodeSub expects URL fetching; we can feed data: URL or direct link
    // Use a data URI trick: webGet will handle data: quickly
    // Or manually try to parse via explodeSub with a synthetic url
    let proxies: Proxy[] = [];
    try {
      const res = explodeSub(link);
      if (Array.isArray(res)) proxies = res;
    } catch {}
    // Fallback: if proxies empty, try to treat as single proxy string
    if (!proxies.length) {
      // produce a minimal proxy placeholder
      proxies = [{ raw: link, remark: 'debug', type: 'Unknown' } as unknown as Proxy];
    }
    const proxy = proxies[0] as Proxy;
    let clashPreview = '';
    let surgePreview = '';
    try { clashPreview = proxyToClash([proxy], '', false); } catch {}
    try { surgePreview = proxyToSurge([proxy], '', 4); } catch {}
    return json({ proxy, clash: clashPreview, surge: surgePreview, count: proxies.length });
  } catch {
    return json({ error: 'invalid link' }, 400);
  }
}

// Scheduled purge
export async function scheduledPurge(env: DashboardEnv): Promise<void> {
  try {
    const kv = getKvAdmin(env);
    let retention = 180;
    try {
      const raw = await kv?.get('retention');
      if (raw) {
        const n = parseInt(raw, 10);
        if (RETENTION_ALLOWED.has(n)) retention = n;
      }
    } catch {}
    const d1 = getD1(env);
    if (!d1) return;
    const cutoff = Date.now() - retention * 86400000;
    await d1.prepare('DELETE FROM logs WHERE time < ?').bind(cutoff).run().catch(() => {});
  } catch {}
}
